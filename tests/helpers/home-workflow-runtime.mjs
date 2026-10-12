import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import bcrypt from 'bcrypt'

const projectDirectory = fileURLToPath(new URL('../..', import.meta.url))
const fixtureName = name => /^galeo_store_test_home_[a-f0-9]{12}$/.test(name)

export class HomeWorkflowRuntime {
  suffix = randomBytes(6).toString('hex')
  database = 'galeo_store_test_home_' + this.suffix
  password = 'Local-home-' + randomBytes(12).toString('hex')
  cookie = ''
  csrfToken = ''

  async initialize({ port = 10130, frontendOrigin = '' } = {}) {
    if (!new Set(['127.0.0.1', 'localhost', '::1']).has(process.env.DB_HOST) ||
        process.env.DB_PORT !== '3307' || process.env.DB_NAME !== 'galeo_store_test') {
      throw new Error('Home workflow tests require loopback MySQL:3307 and DB_NAME=galeo_store_test; production is refused.')
    }
    if (!process.env.MYSQL_ROOT_PASSWORD || !process.env.DB_USER || !process.env.SESSION_SECRET) throw new Error('Use the disposable local MySQL administrator and test application environment.')
    if (!Number.isInteger(port) || port < 10130 || port > 10139) throw new Error('Use a reserved loopback Home fixture API port.')
    if (frontendOrigin) {
      const address = new URL(frontendOrigin)
      if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) || address.origin !== frontendOrigin) throw new Error('The optional browser origin must be an exact HTTP loopback origin.')
    }
    this.port = port
    this.baseUrl = 'http://127.0.0.1:' + port
    this.directory = await mkdtemp(join(tmpdir(), 'galeo-home-test-'))
    this.networkGuardPath = join(this.directory, 'provider-attempts.jsonl')
    this.adminDb = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: 'root', password: process.env.MYSQL_ROOT_PASSWORD })
    assert.ok(fixtureName(this.database))
    await this.adminDb.query('CREATE DATABASE `' + this.database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
    this.created = true
    // CREATE/DROP are restricted to a generated fixture database; the web API
    // still runs with the ordinary local application account, never root.
    await this.adminDb.query('GRANT ALL PRIVILEGES ON `' + this.database + '`.* TO ?@?', [process.env.DB_USER, '%'])
    this.db = mysql.createPool({ host: '127.0.0.1', port: 3307, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: this.database, connectionLimit: 4 })
    await this.startApi(frontendOrigin)
    this.email = 'home-owner-' + this.suffix + '@example.invalid'
    const inserted = await this.query('INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,?,1)', [this.email, await bcrypt.hash(this.password, 12), 'owner'])
    this.ownerId = inserted.insertId
    const login = await this.request('/api/auth/login', { method: 'POST', body: { email: this.email, password: this.password } })
    assert.equal(login.status, 200)
    assert.ok(this.csrfToken)
  }

  async query(sql, values = []) { const [rows] = await this.db.execute(sql, values); return rows }

  async request(path, { method = 'GET', body, csrf = true, auth = true } = {}) {
    const response = await fetch(this.baseUrl + path, {
      method, headers: {
        ...(auth && this.cookie ? { Cookie: this.cookie } : {}),
        ...(auth && csrf && this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    for (const cookie of response.headers.getSetCookie()) if (cookie.startsWith('galeo_sid=')) this.cookie = cookie.split(';', 1)[0]
    const data = await response.json()
    if (data.csrfToken) this.csrfToken = data.csrfToken
    return { status: response.status, data }
  }

  async startApi(frontendOrigin) {
    this.child = spawn(process.execPath, ['--import', './tests/helpers/home-workflow-network-guard.mjs', 'server/index.js'], {
      cwd: projectDirectory, env: {
        ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '3307', DB_NAME: this.database, DB_SSL: 'false', MYSQL_ROOT_PASSWORD: '',
        PORT: String(this.port), NODE_ENV: 'test', APP_URL: this.baseUrl, ALLOWED_ORIGINS: [this.baseUrl, frontendOrigin].filter(Boolean).join(','),
        DATA_ENCRYPTION_ENABLED: 'false', DATA_ENCRYPTION_KEY: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
        CLOUDINARY_URL: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
        RESEND_API_KEY: '', EMAIL_FROM: '', STORE_NOTIFICATION_EMAIL: '', MERCADO_PAGO_ACCESS_TOKEN: '',
        MERCADO_PAGO_POINT_TERMINAL_ID: '', MERCADO_PAGO_WEBHOOK_SECRET: '', DISTRIBUTOR_WEBHOOK_SECRET: '',
        GALEO_TEST_MEDIA_NETWORK_GUARD: this.networkGuardPath
      }, stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    this.child.stderr.on('data', () => {})
    this.child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-8192) })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The isolated local Home API did not start in 30 seconds.')), 30000)
      this.child.once('error', () => { clearTimeout(timer); reject(new Error('The isolated Home API could not start.')) })
      this.child.once('exit', () => { clearTimeout(timer); reject(new Error('The isolated Home API stopped before startup.')) })
      this.child.stdout.on('data', () => { if (output.includes('GALEO API running on port ' + this.port)) { clearTimeout(timer); resolve() } })
    })
  }

  async providerAttempts() {
    try { return (await readFile(this.networkGuardPath, 'utf8')).trim().split('\n').filter(Boolean).map(value => JSON.parse(value)) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }

  async close() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 5000)
      this.child.once('close', () => { clearTimeout(timer); resolve() })
      this.child.kill('SIGTERM')
    })
    await this.db?.end()
    if (this.created && this.adminDb) {
      assert.ok(fixtureName(this.database), 'only this generated Home test database may be removed')
      await this.adminDb.query('DROP DATABASE `' + this.database + '`')
      this.created = false
    }
    await this.adminDb?.end()
    if (this.directory) await rm(this.directory, { recursive: true, force: true })
  }
}
