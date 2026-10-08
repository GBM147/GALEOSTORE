import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import mysql from 'mysql2/promise'

const loopback = new Set(['localhost', '127.0.0.1', '::1'])
if (!loopback.has(process.env.DB_HOST) || process.env.DB_NAME !== 'galeo_store_test') {
  throw new Error('A segurança de autenticação exige DB_HOST loopback e DB_NAME=galeo_store_test; produção é recusada.')
}
for (const name of ['DB_USER', 'SESSION_SECRET']) {
  if (!process.env[name]) throw new Error('Configure a variável local de testes ' + name + '.')
}

const baseUrl = 'http://127.0.0.1:10002'
const projectDirectory = fileURLToPath(new URL('..', import.meta.url))
const suffix = randomBytes(8).toString('hex')
const initialPassword = 'Local-auth-' + randomBytes(12).toString('hex')
const legacyPrefix = 'L-' + randomBytes(35).toString('hex')
const legacyPassword = legacyPrefix + '-sufixo-legado'
const fixtureEmails = new Set()
const customerEmails = new Set()
const sessions = new Set()
let db, child, owner, inactiveOwner, inactiveStaff, activeStaff, legacyOwner, downgradedOwner, normalOwner

async function query(sql, params = []) {
  const [rows] = await db.execute(sql, params)
  return rows
}

function uniqueEmail(label) {
  const email = `auth-${label}-${suffix}@example.invalid`
  fixtureEmails.add(email)
  return email
}

async function account(label, role, active, passwordHash) {
  const email = uniqueEmail(label)
  const inserted = await query('INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,?,?)', [email, passwordHash, role, active])
  return { id: inserted.insertId, email }
}

async function accountState(id) {
  const rows = await query('SELECT active,role,password_hash FROM admin_users WHERE id=?', [id])
  return rows[0]
}

async function stopApi() {
  const processToStop = child
  child = undefined
  if (!processToStop || processToStop.exitCode !== null || processToStop.signalCode !== null) return
  await new Promise(resolve => {
    const timeout = setTimeout(() => processToStop.kill('SIGKILL'), 5000)
    processToStop.once('close', () => { clearTimeout(timeout); resolve() })
    processToStop.kill('SIGTERM')
  })
}

async function startApi({ email = owner.email, password = initialPassword, shouldFail = false } = {}) {
  await stopApi()
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      PORT: '10002', NODE_ENV: 'test',
      ADMIN_EMAIL: email, ADMIN_PASSWORD: password,
      RESEND_API_KEY: '', EMAIL_FROM: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  let errors = ''
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('A API local isolada não iniciou/terminou em 30 segundos.')), 30000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); resolve({ started: false, code }) })
    child.stdout.on('data', chunk => {
      output = (output + chunk.toString()).slice(-8192)
      if (output.includes('GALEO API running on port 10002')) {
        clearTimeout(timeout)
        resolve({ started: true })
      }
    })
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-8192) })
  })
  if (shouldFail) {
    assert.equal(result.started, false, 'senha inválida de conta nova deve impedir o startup')
    assert.notEqual(result.code, 0)
    assert.ok(errors.includes('ADMIN_PASSWORD inválida'), 'startup deve explicar qual requisito falhou')
    assert.equal(errors.includes(password), false, 'startup não pode revelar o valor da senha')
  } else {
    assert.equal(result.started, true, 'a API isolada deve iniciar sem alterar contas existentes')
  }
}

class Client {
  cookie = ''
  csrfToken = ''

  async request(path, { method = 'GET', body } = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const cookies = response.headers.getSetCookie()
    for (const cookie of cookies) {
      if (!cookie.startsWith('galeo_sid=')) continue
      this.cookie = cookie.split(';', 1)[0]
      const value = decodeURIComponent(this.cookie.slice('galeo_sid='.length))
      if (value.startsWith('s:')) sessions.add(value.slice(2, value.lastIndexOf('.')))
    }
    const data = await response.json()
    if (data.csrfToken) this.csrfToken = data.csrfToken
    return { status: response.status, data, cookies }
  }
}

async function adminLogin(email, password) {
  const client = new Client()
  const response = await client.request('/api/auth/login', { method: 'POST', body: { email, password, manterConectado: true } })
  assert.equal(response.status, 200)
  return client
}

async function legacyStaffSession(role = 'staff') {
  const sid = 'auth-staff-' + suffix + '-' + randomBytes(10).toString('hex')
  const csrfToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 60 * 60 * 1000)
  await query('INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)', [sid, Math.floor(expires.getTime() / 1000), JSON.stringify({
    cookie: { originalMaxAge: 60 * 60 * 1000, expires: expires.toISOString(), secure: false, httpOnly: true, sameSite: 'lax', path: '/' },
    userId: activeStaff.id, role, csrfToken, manterConectado: true
  })])
  sessions.add(sid)
  const signature = createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '')
  const client = new Client()
  client.cookie = 'galeo_sid=' + encodeURIComponent('s:' + sid + '.' + signature)
  client.csrfToken = csrfToken
  return { client, sid }
}

async function assertSessionRevoked(response, sid) {
  assert.equal(response.status, 403)
  assert.ok(response.cookies.some(cookie => cookie.startsWith('galeo_sid=;') && /Expires=/i.test(cookie)), 'recusa de STAFF deve limpar o cookie')
  assert.equal((await query('SELECT session_id FROM sessions WHERE session_id=?', [sid])).length, 0)
}

before(async () => {
  db = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 4
  })
  assert.equal((await query('SELECT DATABASE() AS name'))[0].name, 'galeo_store_test')
  const hash = await bcrypt.hash(initialPassword, 12)
  owner = await account('owner', 'owner', 1, hash)
  inactiveOwner = await account('inactive-owner', 'owner', 0, hash)
  inactiveStaff = await account('inactive-staff', 'staff', 0, hash)
  activeStaff = await account('active-staff', 'staff', 1, hash)
  downgradedOwner = await account('downgraded-owner', 'owner', 1, hash)
  normalOwner = await account('normal-owner', 'owner', 1, hash)
  legacyOwner = await account('legacy-owner', 'owner', 1, await bcrypt.hash(legacyPassword, 12))
})

after(async () => {
  await stopApi()
  if (!db) return
  try {
    if (fixtureEmails.size) {
      const emails = [...fixtureEmails]
      const placeholders = emails.map(() => '?').join(',')
      await query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM admin_users WHERE email IN (' + placeholders + '))', emails)
      await query('DELETE FROM admin_users WHERE email IN (' + placeholders + ')', emails)
    }
    if (customerEmails.size) await query('DELETE FROM customers WHERE email IN (' + [...customerEmails].map(() => '?').join(',') + ')', [...customerEmails])
    if (sessions.size) await query('DELETE FROM sessions WHERE session_id IN (' + [...sessions].map(() => '?').join(',') + ')', [...sessions])
  } finally {
    await db.end()
  }
})

test('bootstrap preserva status, papel e hash de OWNER/STAFF existentes mesmo com ADMIN_PASSWORD inválida', async () => {
  for (const fixture of [owner, inactiveOwner, inactiveStaff, activeStaff]) {
    const original = await accountState(fixture.id)
    await startApi({ email: fixture.email, password: 'A'.repeat(73) })
    assert.deepEqual(await accountState(fixture.id), original)
    const login = await new Client().request('/api/auth/login', { method: 'POST', body: { email: fixture.email, password: initialPassword } })
    assert.equal(login.status, original.active ? (original.role === 'owner' ? 200 : 403) : 401)
  }
})

test('bootstrap cria OWNER ausente com senha Unicode válida de exatamente72 bytes', async () => {
  const email = uniqueEmail('new-owner')
  const password = 'é'.repeat(36)
  assert.equal(Buffer.byteLength(password, 'utf8'), 72)
  await startApi({ email, password })
  const rows = await query('SELECT active,role,password_hash FROM admin_users WHERE email=?', [email])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].active, 1)
  assert.equal(rows[0].role, 'owner')
  assert.ok(/^\$2[aby]\$12\$/.test(rows[0].password_hash))
  assert.equal(await bcrypt.compare(password, rows[0].password_hash), true)
  await adminLogin(email, password)
})

test('bootstrap rejeita senha ASCII/Unicode acima72 bytes sem criar conta ou revelar a senha', async () => {
  for (const [label, password] of [['ascii', 'A'.repeat(73)], ['accent', 'é'.repeat(37)], ['emoji', '😀'.repeat(19)]]) {
    const email = uniqueEmail('invalid-' + label)
    await startApi({ email, password, shouldFail: true })
    assert.equal((await query('SELECT id FROM admin_users WHERE email=?', [email])).length, 0)
  }
})

test('troca rejeita novas senhas inválidas sem mudar hash/sessão e aceita Unicode72 bytes', async () => {
  // Quatro rejeições + uma troca válida ficam dentro do limite de5 por IP.
  await startApi()
  const client = await adminLogin(owner.email, initialPassword)
  const original = await accountState(owner.id)
  const cookie = client.cookie
  const csrf = client.csrfToken
  for (const password of ['A'.repeat(73), 'é'.repeat(37), '😀'.repeat(19), '😀'.repeat(5)]) {
    const rejected = await client.request('/api/auth/password', { method: 'PATCH', body: { currentPassword: initialPassword, newPassword: password } })
    assert.equal(rejected.status, 400)
    assert.deepEqual(await accountState(owner.id), original)
    assert.equal(client.cookie === cookie, true)
    assert.equal(client.csrfToken === csrf, true)
    const me = await client.request('/api/auth/me')
    assert.equal(me.status, 200)
    assert.equal(client.csrfToken === csrf, true)
  }
  const boundary = 'é'.repeat(36)
  const changed = await client.request('/api/auth/password', { method: 'PATCH', body: { currentPassword: initialPassword, newPassword: boundary } })
  assert.equal(changed.status, 200)
  assert.equal(client.cookie === cookie, false)
  assert.equal(client.csrfToken === csrf, false)
  const current = await accountState(owner.id)
  assert.equal(current.active, original.active)
  assert.equal(current.role, original.role)
  assert.equal(await bcrypt.compare(boundary, current.password_hash), true)
  const oldLogin = await new Client().request('/api/auth/login', { method: 'POST', body: { email: owner.email, password: initialPassword } })
  assert.equal(oldLogin.status, 401)
  await adminLogin(owner.email, boundary)
})

test('login legado acima72 bytes funciona; trocar por prefixo equivalente é rejeitado sem alterações', async () => {
  await startApi({ email: legacyOwner.email, password: 'A'.repeat(73) })
  const client = await adminLogin(legacyOwner.email, legacyPassword)
  const original = await accountState(legacyOwner.id)
  const cookie = client.cookie
  const csrf = client.csrfToken
  const equivalent = await client.request('/api/auth/password', { method: 'PATCH', body: { currentPassword: legacyPassword, newPassword: legacyPrefix } })
  assert.equal(equivalent.status, 400)
  assert.deepEqual(await accountState(legacyOwner.id), original)
  assert.equal(client.cookie === cookie, true)
  assert.equal(client.csrfToken === csrf, true)
  await adminLogin(legacyOwner.email, legacyPassword)
  const different = randomBytes(18).toString('hex') + 'é'.repeat(18)
  assert.equal(Buffer.byteLength(different, 'utf8'), 72)
  const changed = await client.request('/api/auth/password', { method: 'PATCH', body: { currentPassword: legacyPassword, newPassword: different } })
  assert.equal(changed.status, 200)
  assert.equal(await bcrypt.compare(different, (await accountState(legacyOwner.id)).password_hash), true)
  await adminLogin(legacyOwner.email, different)
})

test('cadastro rejeita senha inválida sem linha e aceita72 bytes ou mínimo10 pontos de código', async () => {
  await startApi()
  for (const [label, password] of [
    ['ascii', 'A'.repeat(73)], ['accent', 'é'.repeat(37)], ['emoji-long', '😀'.repeat(19)],
    ['minimum-ascii', 'A'.repeat(9)], ['minimum-emoji', '😀'.repeat(5)]
  ]) {
    const email = `customer-invalid-${label}-${suffix}@example.invalid`
    customerEmails.add(email)
    const rejected = await new Client().request('/api/customer/register', { method: 'POST', body: { name: 'Cliente teste segurança', email, password } })
    assert.equal(rejected.status, 400)
    assert.equal((await query('SELECT id FROM customers WHERE email=?', [email])).length, 0)
  }
  for (const [label, password] of [['boundary', 'é'.repeat(36)], ['minimum-emoji-valid', '😀'.repeat(10)], ['minimum-ascii-valid', 'A'.repeat(10)]]) {
    const email = `customer-valid-${label}-${suffix}@example.invalid`
    customerEmails.add(email)
    const created = await new Client().request('/api/customer/register', { method: 'POST', body: { name: 'Cliente teste segurança', email, password } })
    assert.equal(created.status, 200)
    const rows = await query('SELECT password_hash FROM customers WHERE email=?', [email])
    assert.equal(rows.length, 1)
    assert.ok(/^\$2[aby]\$12\$/.test(rows[0].password_hash))
    assert.equal(await bcrypt.compare(password, rows[0].password_hash), true)
    const login = await new Client().request('/api/customer/login', { method: 'POST', body: { email, password } })
    assert.equal(login.status, 200)
  }
})

test('STAFF ativo é recusado no login administrativo sem criar sessão e sem mudar seu papel', async () => {
  await startApi()
  const original = await accountState(activeStaff.id)
  const denied = await new Client().request('/api/auth/login', { method: 'POST', body: { email: activeStaff.email, password: initialPassword } })
  assert.equal(denied.status, 403)
  assert.equal(denied.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
  assert.equal(Object.hasOwn(denied.data, 'csrfToken'), false)
  const wrongPassword = await new Client().request('/api/auth/login', { method: 'POST', body: { email: activeStaff.email, password: 'Senha-incorreta-local' } })
  assert.equal(wrongPassword.status, 401, 'a recusa por papel só deve ocorrer após credencial válida')
  assert.deepEqual(await accountState(activeStaff.id), original)
})

test('clientes continuam autenticando na loja e não acessam Admin nem o login administrativo', async () => {
  await startApi()
  const email = `customer-separate-${suffix}@example.invalid`
  const password = 'Cliente-' + randomBytes(10).toString('hex')
  customerEmails.add(email)
  const client = new Client()
  const registered = await client.request('/api/customer/register', { method: 'POST', body: { name: 'Cliente acesso separado', email, password } })
  assert.equal(registered.status, 200)
  const login = await client.request('/api/customer/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  for (const path of ['/api/auth/me', '/api/admin/dashboard', '/api/admin/products', '/api/admin/stock/movements', '/api/admin/finance/entries', '/api/admin/home', '/api/admin/media-library']) {
    const rejected = await client.request(path)
    assert.equal(rejected.status, 401, 'sessão de cliente não autoriza ' + path)
  }
  const admin = await client.request('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(admin.status, 401)
  const me = await client.request('/api/customer/me')
  assert.equal(me.status, 200, 'recusar Admin não pode encerrar a sessão de cliente')
  assert.equal(me.data.user.email, email)
})

test('sessões antigas STAFF são revogadas em operações, CMS e mídia, mesmo se o papel da sessão disser OWNER', async () => {
  await startApi()
  const original = await accountState(activeStaff.id)
  const paths = ['/api/admin/dashboard', '/api/admin/products', '/api/admin/stock/movements', '/api/admin/sales', '/api/admin/finance/entries', '/api/admin/home', '/api/admin/media-library']
  for (const [index, path] of paths.entries()) {
    // A fixture continua STAFF no banco; um papel obsoleto/forjado no JSON
    // da sessão também deve ser rejeitado após a consulta do papel atual.
    const { client, sid } = await legacyStaffSession(index === 1 ? 'owner' : 'staff')
    const denied = await client.request(path)
    await assertSessionRevoked(denied, sid)
    const afterRevocation = await client.request('/api/auth/me')
    assert.equal(afterRevocation.status, 401)
  }
  assert.deepEqual(await accountState(activeStaff.id), original)
})

test('sessão antiga STAFF não pode trocar a senha mesmo enviando CSRF válido', async () => {
  await startApi()
  const original = await accountState(activeStaff.id)
  const { client, sid } = await legacyStaffSession('owner')
  const rejected = await client.request('/api/auth/password', { method: 'PATCH', body: { currentPassword: initialPassword, newPassword: 'Nova-senha-local-' + randomBytes(10).toString('hex') } })
  await assertSessionRevoked(rejected, sid)
  assert.deepEqual(await accountState(activeStaff.id), original)
  assert.equal((await client.request('/api/auth/me')).status, 401)
})

test('rebaixar um OWNER para STAFF no banco revoga a sessão e bloqueia novo login administrativo', async () => {
  await startApi()
  const client = await adminLogin(downgradedOwner.email, initialPassword)
  const original = await accountState(downgradedOwner.id)
  const encodedCookie = client.cookie.slice('galeo_sid='.length)
  const signedCookie = decodeURIComponent(encodedCookie)
  const sid = signedCookie.slice(2, signedCookie.lastIndexOf('.'))
  assert.equal((await client.request('/api/admin/products')).status, 200)
  await query("UPDATE admin_users SET role='staff' WHERE id=?", [downgradedOwner.id])
  const denied = await client.request('/api/admin/products')
  await assertSessionRevoked(denied, sid)
  assert.equal((await client.request('/api/auth/me')).status, 401)
  const login = await new Client().request('/api/auth/login', { method: 'POST', body: { email: downgradedOwner.email, password: initialPassword } })
  assert.equal(login.status, 403)
  const current = await accountState(downgradedOwner.id)
  assert.equal(current.role, 'staff')
  assert.equal(current.active, original.active)
  assert.equal(current.password_hash === original.password_hash, true)
})

test('OWNER continua acessando Admin e CMS, com operações habilitadas e logout válido', async () => {
  await startApi()
  const client = await adminLogin(normalOwner.email, initialPassword)
  const me = await client.request('/api/auth/me')
  assert.equal(me.status, 200)
  assert.equal(me.data.user.role, 'owner')
  assert.equal(me.data.permissions.content, true)
  assert.equal(me.data.permissions.operations, true)
  for (const path of ['/api/admin/products', '/api/admin/stock/movements', '/api/admin/sales', '/api/admin/finance/entries', '/api/admin/home', '/api/admin/home/settings', '/api/admin/media-library']) {
    assert.equal((await client.request(path)).status, 200)
  }
  assert.equal((await client.request('/api/auth/logout', { method: 'POST' })).status, 200)
  assert.equal((await client.request('/api/auth/me')).status, 401)
})
