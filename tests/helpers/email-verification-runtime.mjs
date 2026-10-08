import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { createDataProtection } from '../../server/data-protection.js'

const loopback = new Set(['localhost', '127.0.0.1', '::1'])
export const baseUrl = 'http://127.0.0.1:10006'
export const tokenDigest = token => createHash('sha256').update(token).digest('hex')
const projectDirectory = fileURLToPath(new URL('../..', import.meta.url))
let ipCounter = 0

export class VerificationClient {
  cookie = ''
  csrfToken = ''
  constructor(runtime, ip = `127.21.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`) {
    this.runtime = runtime
    this.ip = ip
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        'X-Forwarded-For': this.ip,
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
      if (value.startsWith('s:')) this.runtime.sessions.add(value.slice(2, value.lastIndexOf('.')))
    }
    const data = (response.headers.get('Content-Type') || '').includes('application/json') ? await response.json() : null
    if (data?.csrfToken) this.csrfToken = data.csrfToken
    return { status: response.status, data, cookies, headers: response.headers }
  }
}

export class VerificationRuntime {
  ids = new Set()
  sessions = new Set()
  suffix = randomBytes(8).toString('hex')
  password = 'Local-email-' + randomBytes(12).toString('hex')

  async initialize() {
    if (!loopback.has(process.env.DB_HOST) || process.env.DB_NAME !== 'galeo_store_test') {
      throw new Error('Email verification tests require DB_HOST loopback and DB_NAME=galeo_store_test; production is refused.')
    }
    for (const name of ['DB_USER', 'SESSION_SECRET']) {
      if (!process.env[name]) throw new Error('Configure the local test variable ' + name + '.')
    }
    this.protection = process.env.DATA_ENCRYPTION_ENABLED === 'true' ? createDataProtection() : null
    this.directory = await mkdtemp(join(tmpdir(), 'galeo-email-test-'))
    this.fixturePath = join(this.directory, 'resend.json')
    await this.setMailStatus(200)
    this.db = mysql.createPool({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME, connectionLimit: 4
    })
    assert.equal((await this.query('SELECT DATABASE() AS name'))[0].name, 'galeo_store_test')
    await this.startApi()
  }

  async query(sql, params = []) {
    const [rows] = await this.db.execute(sql, params)
    return rows
  }

  email(label) { return `verify-${label}-${this.suffix}@example.invalid` }
  client(ip) { return new VerificationClient(this, ip) }
  async setMailStatus(status) { await writeFile(this.fixturePath, JSON.stringify({ status }), { mode: 0o600 }) }

  async calls() {
    try { return (await readFile(this.fixturePath + '.calls', 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }

  async verificationMail(email) {
    const calls = (await this.calls()).filter(call => call.payload.to.includes(email) && /#verify=/.test(call.payload.html))
    const call = calls.at(-1)
    assert.ok(call, 'the provider fixture must capture a verification mail for the local recipient')
    const token = call.payload.html.match(/#verify=([a-f0-9]{64})/)?.[1]
    assert.ok(token, 'the mail must contain a complete cryptographically random verification token')
    return { token, call }
  }

  async trackMailAccount(email) {
    const { token } = await this.verificationMail(email)
    const rows = await this.query('SELECT customer_id FROM customer_email_verifications WHERE token_hash=?', [tokenDigest(token)])
    assert.equal(rows.length, 1)
    this.ids.add(rows[0].customer_id)
    return { id: rows[0].customer_id, token }
  }

  async register(label, body = {}) {
    const client = this.client()
    const email = this.email(label)
    const response = await client.request('/api/customer/register', { method: 'POST', body: {
      name: 'Cliente local ' + label, email, password: this.password, phone: '11999999999', ...body
    } })
    assert.equal(response.status, 202, 'registration must wait for email verification')
    const { id, token } = await this.trackMailAccount(email)
    return { client, email, id, token, response }
  }

  async legacySession(id) {
    const sid = 'email-test-' + this.suffix + '-' + randomBytes(8).toString('hex')
    const csrfToken = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000)
    const session = {
      cookie: { originalMaxAge: 60 * 60 * 1000, expires: expires.toISOString(), secure: false, httpOnly: true, sameSite: 'lax', path: '/' },
      customerId: id, csrfToken, manterConectado: true
    }
    const stored = this.protection ? {
      cookie: session.cookie,
      protected_session: this.protection.encryptJSON(session, { table: 'sessions', field: 'data', rowId: sid })
    } : session
    await this.query('INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)', [sid, Math.floor(expires.getTime() / 1000), JSON.stringify(stored)])
    this.sessions.add(sid)
    const signature = createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '')
    const client = this.client()
    client.cookie = 'galeo_sid=' + encodeURIComponent('s:' + sid + '.' + signature)
    client.csrfToken = csrfToken
    return client
  }

  async startApi({ provider = true } = {}) {
    await this.stopApi()
    this.child = spawn(process.execPath, ['--import', './tests/helpers/resend-fetch.mjs', 'server/index.js'], {
      cwd: projectDirectory,
      env: {
        ...process.env, PORT: '10006', NODE_ENV: 'test',
        APP_URL: baseUrl, ALLOWED_ORIGINS: baseUrl,
        RESEND_API_KEY: provider ? 'local-email-verification-fixture' : '',
        EMAIL_FROM: provider ? 'fixture@example.invalid' : '',
        STORE_NOTIFICATION_EMAIL: 'notification@example.invalid',
        GALEO_TEST_RESEND_FIXTURES: this.fixturePath,
        MERCADO_PAGO_ACCESS_TOKEN: '', MERCADO_PAGO_POINT_TERMINAL_ID: '',
        CLOUDINARY_URL: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let started = false, output = ''
    this.stderr = ''
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The isolated email verification API did not start within 30 seconds.')), 30000)
      this.child.once('error', error => { clearTimeout(timeout); reject(error) })
      this.child.once('exit', () => {
        clearTimeout(timeout)
        if (!started) reject(new Error('The isolated email verification API exited before startup; inspect server syntax/configuration.'))
      })
      this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-8192) })
      this.child.stdout.on('data', chunk => {
        output = (output + chunk.toString()).slice(-8192)
        if (output.includes('GALEO API running on port 10006')) {
          started = true; clearTimeout(timeout); resolve()
        }
      })
    })
  }

  async stopApi() {
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise(resolve => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.once('close', () => { clearTimeout(timeout); resolve() })
      child.kill('SIGTERM')
    })
  }

  async close() {
    await this.stopApi()
    try {
      // A browser assertion may fail before it tracks the newly pending row.
      // Recover only this runtime's recipients from its private delivery file.
      if (this.db && this.fixturePath) {
        for (const call of await this.calls()) {
          if (!call.payload.to.some(email => String(email).endsWith('-' + this.suffix + '@example.invalid'))) continue
          const token = String(call.payload.html || '').match(/#verify=([a-f0-9]{64})/)?.[1]
          if (!token) continue
          const rows = await this.query('SELECT customer_id FROM customer_email_verifications WHERE token_hash=?', [tokenDigest(token)])
          for (const row of rows) this.ids.add(row.customer_id)
        }
      }
      if (this.db && this.ids.size) {
        const ids = [...this.ids]
        const placeholders = ids.map(() => '?').join(',')
        await this.query('DELETE FROM customer_email_verifications WHERE customer_id IN (' + placeholders + ')', ids)
        await this.query('DELETE FROM customers WHERE id IN (' + placeholders + ')', ids)
      }
      if (this.db && this.sessions.size) await this.query('DELETE FROM sessions WHERE session_id IN (' + [...this.sessions].map(() => '?').join(',') + ')', [...this.sessions])
    } finally {
      await this.db?.end()
      if (this.directory) await rm(this.directory, { recursive: true, force: true })
    }
  }
}
