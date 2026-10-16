import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { v2 as cloudinary } from 'cloudinary'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'
import { MySqlRateLimitStore } from '../server/mysql-rate-limit-store.js'
import { lambdaEvent, webResponse } from '../netlify/lib/http.mjs'

// This fixture refuses external MySQL, creates one random local schema and drops
// only that schema. All provider calls are stubs; no email or media is sent.
const fixture = new HomeWorkflowRuntime(), exec = promisify(execFile)
const origin = 'https://galeo-fixture.netlify.app'
const statements = [], providerAssets = new Map(), destroyed = []
let api, request, pool, owner, customer, productId, originalCreatePool

before(async () => {
  await fixture.initialize({ port: 10138 })
  for (const key of ['RESEND_API_KEY', 'EMAIL_FROM', 'STORE_NOTIFICATION_EMAIL', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_POINT_TERMINAL_ID', 'MERCADO_PAGO_WEBHOOK_SECRET', 'DISTRIBUTOR_WEBHOOK_SECRET', 'DATA_ENCRYPTION_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'CLOUDINARY_URL']) process.env[key] = ''
  Object.assign(process.env, { DB_NAME: fixture.database, DB_SSL: 'false', NODE_ENV: 'production', APP_URL: origin, ALLOWED_ORIGINS: origin, GALEO_SERVERLESS: 'true', DATA_ENCRYPTION_ENABLED: 'false', CLOUDINARY_CLOUD_NAME: 'galeo-fixture', CLOUDINARY_API_KEY: 'public-test-key', CLOUDINARY_API_SECRET: 'provider-test-secret' })
  originalCreatePool = mysql.createPool
  mysql.createPool = (...args) => {
    pool = originalCreatePool(...args)
    for (const name of ['execute', 'query']) {
      const original = pool[name].bind(pool)
      pool[name] = (...args) => { statements.push(args[0]); return original(...args) }
    }
    return pool
  }
  api = await import('../server/index.js')
  assert.ok(statements.every(sql => /^\s*SELECT\b/i.test(sql)), 'importing a serverless function must not migrate or seed')
  const { insertId: existingCategory } = await fixture.query("INSERT INTO categories(name,sort_order) VALUES('Vestidos',99)")
  await api.migrateSchema()
  assert.equal((await fixture.query('SELECT name FROM categories WHERE id=?', [existingCategory]))[0]?.name, 'Vestidos', 'hosting migration must preserve existing categories')
  request = (await import('../netlify/functions/api.mjs')).default
  cloudinary.api.resource = async id => {
    assert.ok(providerAssets.has(id), 'provider metadata must be explicitly mocked')
    return providerAssets.get(id)
  }
  cloudinary.uploader.destroy = async id => { destroyed.push(id); return { result: 'ok' } }
  cloudinary.uploader.explicit = async () => { throw new Error('Unexpected provider transformation') }
  const { insertId } = await fixture.query("INSERT INTO products(name,description,price,stock,active) VALUES('Camiseta local','Fixture',100,4,1)")
  productId = insertId
}, { timeout: 60000 })

after(async () => {
  if (originalCreatePool) mysql.createPool = originalCreatePool
  await api?.closeRuntime()
  await fixture.close()
})

async function call(path, { method = 'GET', body, client, csrf = true, ip = '198.51.100.7', headers = {} } = {}) {
  const response = await request(new Request(origin + path, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(client?.cookie ? { Cookie: client.cookie } : {}), ...(csrf && client?.csrf ? { 'X-CSRF-Token': client.csrf } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), { ip, requestId: 'local-netlify-fixture' })
  for (const cookie of response.headers.getSetCookie()) if (cookie.startsWith('galeo_sid=')) {
    if (client) client.cookie = cookie.split(';', 1)[0]
  }
  const data = response.status === 204 ? null : await response.json()
  if (client && data?.csrfToken) client.csrf = data.csrfToken
  return { status: response.status, data, headers: response.headers }
}

test('cold initialization is read-only; public routes, query strings and JSON 404 survive rewrites', async () => {
  statements.length = 0
  await Promise.all([api.initializeRuntime(), api.initializeRuntime()])
  assert.ok(statements.length > 5)
  assert.ok(statements.every(sql => /^\s*SELECT\b/i.test(sql)), 'cold starts must never migrate or seed the database')
  for (const path of ['/api/store', '/.netlify/functions/api/api/store']) {
    const result = await call(path)
    assert.equal(result.status, 200)
    assert.ok(result.data.products.some(product => product.id === productId))
    assert.equal(result.headers.get('cache-control'), 'no-store')
  }
  assert.equal((await call('/health')).status, 200)
  assert.equal((await call('/.netlify/functions/api/health')).status, 200)
  assert.equal((await call('/api/missing')).status, 404)
  const event = await lambdaEvent(new Request(origin + '/.netlify/functions/api/api/store?tag=a&tag=b'), { ip: '198.51.100.9' })
  assert.equal(event.path, '/api/store')
  assert.deepEqual(event.multiValueQueryStringParameters.tag, ['a', 'b'])
})

test('OWNER sessions persist across calls, cookies remain secure and write APIs require CSRF', async () => {
  owner = {}
  const login = await call('/api/auth/login', { method: 'POST', body: { email: fixture.email, password: fixture.password }, client: owner })
  assert.equal(login.status, 200)
  assert.ok(owner.csrf)
  const cookie = login.headers.getSetCookie().find(value => value.startsWith('galeo_sid='))
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i)
  assert.equal((await call('/api/admin/home', { client: owner })).status, 200)
  assert.equal((await call('/api/admin/home')).status, 401)
  assert.equal((await call('/api/admin/media-upload/sign', { method: 'POST', body: {}, client: owner, csrf: false })).status, 403)
  const expired = webResponse({ statusCode: 200, body: '{}', multiValueHeaders: { 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] } })
  assert.equal(expired.headers.getSetCookie().length, 2)
})

test('shared MySQL rate counters are atomic between instances and cannot be evaded with XFF', async () => {
  const a = new MySqlRateLimitStore(pool, 'local-shared'), b = new MySqlRateLimitStore(pool, 'local-shared')
  a.init({ windowMs: 10000 }); b.init({ windowMs: 10000 })
  const hits = await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? a : b).increment('same-client')))
  assert.deepEqual(hits.map(hit => hit.totalHits).sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1))
  assert.equal((await a.increment('other-client')).totalHits, 1)
  for (let i = 0; i < 21; i++) {
    const result = await call('/api/auth/login', { method: 'POST', body: { email: 'missing@example.invalid', password: 'invalid' }, ip: '198.51.100.99', headers: { 'X-Forwarded-For': '192.0.2.' + (i + 1) } })
    if (result.status === 429) return
    assert.equal(result.status, 401)
  }
  assert.fail('login attempts should be limited across forged forwarded addresses')
})

test('verified customers keep separate access and an order reserves stock using the serverless API', async () => {
  const [admin] = await fixture.query('SELECT password_hash FROM admin_users WHERE id=?', [fixture.ownerId])
  await fixture.query("INSERT INTO customers(name,email,password_hash,phone,email_verified_at) VALUES('Cliente local','buyer@example.invalid',?,'11999999999',NOW())", [admin.password_hash])
  customer = {}
  assert.equal((await call('/api/customer/login', { method: 'POST', body: { email: 'buyer@example.invalid', password: fixture.password }, client: customer, ip: '198.51.100.11' })).status, 200)
  assert.equal((await call('/api/admin/home', { client: customer })).status, 401)
  const order = await call('/api/store/orders', { method: 'POST', client: customer, body: { items: [{ product_id: productId, quantity: 1 }], shipping: { name: 'Cliente local', phone: '11999999999', postal_code: '01001000', street: 'Rua local', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' } } })
  assert.equal(order.status, 200)
  const [product] = await fixture.query('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(product.stock, 3)
  assert.equal((await call('/api/customer/orders', { client: customer })).data.orders.length, 1)
})

async function signedUpload(purpose, target_id = null) {
  const result = await call('/api/admin/media-upload/sign', { method: 'POST', client: owner, body: { purpose, target_id, files: [{ name: 'camiseta.jpg', type: 'image/jpeg', size: 8000000 }] } })
  assert.equal(result.status, 200)
  const signed = result.data.uploads[0], public_id = signed.params.folder + '/' + signed.params.public_id, version = 1
  providerAssets.set(public_id, { public_id, version, type: 'upload', resource_type: 'image', format: 'jpg', bytes: 8000000, secure_url: 'https://res.cloudinary.com/galeo-fixture/image/upload/v1/' + public_id + '.jpg' })
  return { ticket: signed.ticket, public_id, version, signature: cloudinary.utils.api_sign_request({ public_id, version }, 'provider-test-secret') }
}

test('direct library, replacement and product confirmations are idempotent and never delete a stored photo', async () => {
  const upload = await signedUpload('library')
  const send = path => call(path, { method: 'POST', client: owner, body: { uploads: [upload] } })
  const first = await send('/api/admin/media-library')
  assert.equal(first.status, 201)
  assert.equal((await send('/api/admin/media-library')).data.items[0].id, first.data.items[0].id)
  const original = first.data.items[0].id
  const replacement = await signedUpload('replacement', original)
  const replace = () => call('/api/admin/media-library/' + original + '/replacement', { method: 'POST', client: owner, body: { uploads: [replacement] } })
  const results = await Promise.all([replace(), replace()])
  assert.equal(results[0].status, 201); assert.equal(results[1].status, 201)
  assert.equal(results[0].data.item.id, results[1].data.item.id)
  assert.deepEqual(destroyed, [])
  const product = await signedUpload('product', productId)
  for (let i = 0; i < 2; i++) assert.equal((await call('/api/admin/products/' + productId + '/media', { method: 'POST', client: owner, body: { uploads: [product] } })).status, 201)
  const [count] = await fixture.query('SELECT COUNT(*) AS n FROM product_media WHERE product_id=?', [productId])
  assert.equal(count.n, 1)
})

test('scheduled maintenance removes expired sessions and keeps valid owner access', async () => {
  await fixture.query("INSERT INTO sessions(session_id,expires,data) VALUES('expired-local-fixture',1,'{}')")
  const maintenance = (await import('../netlify/functions/maintenance.mjs')).default
  assert.equal((await maintenance()).status, 204)
  const [row] = await fixture.query("SELECT COUNT(*) AS n FROM sessions WHERE session_id='expired-local-fixture'")
  assert.equal(row.n, 0)
  assert.equal((await call('/api/auth/me', { client: owner })).status, 200)
})

test('the actual Netlify bundle loads native bcrypt and reads the same shared session in a fresh process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'galeo-netlify-bundle-'))
  try {
    await exec('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', '.netlify/functions-dist/api.zip', directory])
    // An isolated process has no access to checkout node_modules or the old
    // process cache. This catches missing native files and bundler regressions.
    const script = `const api=(await import(${JSON.stringify(join(directory, 'netlify/functions/api.mjs'))})).default;const r=await api(new Request(process.env.APP_URL+'/api/auth/me',{headers:{Cookie:process.env.GALEO_FIXTURE_COOKIE}}),{ip:'198.51.100.7'});if(r.status!==200||!(await r.json()).success)process.exit(1);process.exit(0)`
    await exec(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, GALEO_FIXTURE_COOKIE: owner.cookie }, timeout: 15000 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
