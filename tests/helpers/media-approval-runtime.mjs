import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import bcrypt from 'bcrypt'

export const mediaApprovalBaseUrl = 'http://127.0.0.1:10128'
const projectDirectory = fileURLToPath(new URL('../..', import.meta.url))

export class MediaApprovalClient {
  cookie = ''
  csrfToken = ''
  constructor(runtime) { this.runtime = runtime }

  async request(path, { method = 'GET', body, csrf = true } = {}) {
    const response = await fetch(mediaApprovalBaseUrl + path, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(csrf && this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const cookies = response.headers.getSetCookie()
    for (const cookie of cookies) {
      if (!cookie.startsWith('galeo_sid=')) continue
      this.cookie = cookie.split(';', 1)[0]
      const signed = decodeURIComponent(this.cookie.slice('galeo_sid='.length))
      if (signed.startsWith('s:')) this.runtime.sessions.add(signed.slice(2, signed.lastIndexOf('.')))
    }
    const data = await response.json()
    if (data.csrfToken) this.csrfToken = data.csrfToken
    return { status: response.status, data, cookies }
  }
}

export class MediaApprovalRuntime {
  suffix = randomBytes(8).toString('hex')
  password = 'Local-media-' + randomBytes(12).toString('hex')
  products = new Set()
  assets = new Set()
  sessions = new Set()

  async initialize({ frontendOrigin = '' } = {}) {
    if (!new Set(['127.0.0.1', 'localhost', '::1']).has(process.env.DB_HOST) ||
        process.env.DB_PORT !== '3307' || process.env.DB_NAME !== 'galeo_store_test') {
      throw new Error('Media approval tests require loopback MySQL:3307 and DB_NAME=galeo_store_test; production is refused.')
    }
    if (process.env.DATA_ENCRYPTION_ENABLED === 'true') throw new Error('Use the plaintext local audit database for this media suite; privacy has a separate isolated suite.')
    if (!process.env.DB_USER || !process.env.SESSION_SECRET) throw new Error('Configure the local test environment before running media approval tests.')
    if (frontendOrigin) {
      const address = new URL(frontendOrigin)
      if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) || address.origin !== frontendOrigin) {
        throw new Error('The optional browser origin must be an exact HTTP loopback origin.')
      }
    }
    this.frontendOrigin = frontendOrigin
    this.prefix = 'Media fixture ' + this.suffix + ' '
    this.email = 'media-owner-' + this.suffix + '@example.invalid'
    this.directory = await mkdtemp(join(tmpdir(), 'galeo-media-test-'))
    this.networkGuardPath = join(this.directory, 'provider-attempts.jsonl')
    this.db = mysql.createPool({
      host: '127.0.0.1', port: 3307, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      database: 'galeo_store_test', connectionLimit: 4
    })
    assert.equal((await this.query('SELECT DATABASE() AS name'))[0].name, 'galeo_store_test')
    await this.startApi()
    const inserted = await this.query('INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,?,1)', [this.email, await bcrypt.hash(this.password, 12), 'owner'])
    this.ownerId = inserted.insertId
    this.owner = this.client()
    const login = await this.owner.request('/api/auth/login', { method: 'POST', body: { email: this.email, password: this.password } })
    assert.equal(login.status, 200)
    assert.equal(login.data.user.role, 'owner')
    assert.ok(this.owner.csrfToken, 'a real authenticated session must issue a CSRF token')
  }

  client() { return new MediaApprovalClient(this) }
  async query(statement, values = []) { const [result] = await this.db.execute(statement, values); return result }

  async asset({ media_type = 'image', ai_status = 'done', use_ai = false, url, ai_url, title = 'Foto local' } = {}) {
    const publicId = 'local-media-' + this.suffix + '-' + this.assets.size
    const originalUrl = url ?? 'https://example.invalid/' + publicId + '-original.png'
    const aiUrl = ai_url === undefined ? 'https://example.invalid/' + publicId + '-transparent.png' : ai_url
    const inserted = await this.query('INSERT INTO media_assets(public_id,url,media_type,title,ai_url,ai_status,use_ai,created_by) VALUES(?,?,?,?,?,?,?,?)', [publicId, originalUrl, media_type, title, aiUrl, ai_status, use_ai ? 1 : 0, this.ownerId])
    this.assets.add(inserted.insertId)
    return { id: inserted.insertId, originalUrl, aiUrl }
  }

  productBody(label, extra = {}) {
    return { name: this.prefix + label, brand: 'Marca local', category_id: null, description: 'Produto de teste local', price: 50, cost: 10, stock: 3, min_stock: 1, image: '', video: '', active: true, ...extra }
  }

  async createProduct(label, extra = {}) {
    const body = this.productBody(label, extra)
    const response = await this.owner.request('/api/admin/products', { method: 'POST', body })
    assert.equal(response.status, 201, 'the local product must be created through the authenticated HTTP API')
    this.products.add(response.data.id)
    return { ...response.data, requestBody: body }
  }

  async gallery(productId) {
    const inserted = await this.query('INSERT INTO product_media(product_id,media_type,url,public_id,sort_order) VALUES(?,?,?,?,?)', [productId, 'image', 'https://example.invalid/gallery-' + this.suffix + '.png', 'local-gallery-' + this.suffix + '-' + productId, 7])
    return (await this.query('SELECT * FROM product_media WHERE id=?', [inserted.insertId]))[0]
  }

  async providerAttempts() {
    try { return (await readFile(this.networkGuardPath, 'utf8')).trim().split('\n').filter(Boolean).map(value => JSON.parse(value)) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }

  async startApi() {
    this.child = spawn(process.execPath, ['--import', './tests/helpers/media-approval-network-guard.mjs', 'server/index.js'], {
      cwd: projectDirectory,
      env: {
        ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '3307', DB_NAME: 'galeo_store_test', DB_SSL: 'false',
        PORT: '10128', NODE_ENV: 'test', APP_URL: mediaApprovalBaseUrl, ALLOWED_ORIGINS: [mediaApprovalBaseUrl, this.frontendOrigin].filter(Boolean).join(','),
        DATA_ENCRYPTION_ENABLED: 'false', DATA_ENCRYPTION_KEY: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
        CLOUDINARY_URL: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
        RESEND_API_KEY: '', EMAIL_FROM: '', STORE_NOTIFICATION_EMAIL: '', MERCADO_PAGO_ACCESS_TOKEN: '',
        MERCADO_PAGO_POINT_TERMINAL_ID: '', MERCADO_PAGO_WEBHOOK_SECRET: '', DISTRIBUTOR_WEBHOOK_SECRET: '',
        GALEO_TEST_MEDIA_NETWORK_GUARD: this.networkGuardPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    this.child.stderr.on('data', () => {})
    this.child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-8192) })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The isolated local media API did not start in 30 seconds.')), 30000)
      this.child.once('error', () => { clearTimeout(timeout); reject(new Error('The isolated media API could not start.')) })
      this.child.once('exit', () => { clearTimeout(timeout); reject(new Error('The isolated media API stopped before startup.')) })
      this.child.stdout.on('data', () => {
        if (output.includes('GALEO API running on port 10128')) { clearTimeout(timeout); resolve() }
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
      if (!this.db) return
      // Recover only this runtime's rows if a failed assertion did not record an ID.
      const recovered = await this.query('SELECT id FROM products WHERE name LIKE ?', [this.prefix + '%'])
      for (const row of recovered) this.products.add(row.id)
      if (this.products.size) {
        const ids = [...this.products], placeholders = ids.map(() => '?').join(',')
        await this.query('DELETE FROM product_media WHERE product_id IN (' + placeholders + ')', ids)
        await this.query('DELETE FROM stock_movements WHERE product_id IN (' + placeholders + ')', ids)
        await this.query('DELETE FROM products WHERE id IN (' + placeholders + ')', ids)
      }
      if (this.assets.size) await this.query('DELETE FROM media_assets WHERE id IN (' + [...this.assets].map(() => '?').join(',') + ')', [...this.assets])
      if (this.ownerId) {
        // Browser logins do not pass through MediaApprovalClient. Recover only
        // sessions belonging to this runtime's unique OWNER before removing it.
        const ownedSessions = await this.query("SELECT session_id FROM sessions WHERE JSON_VALID(data) AND JSON_EXTRACT(data,'$.userId')=?", [this.ownerId])
        for (const row of ownedSessions) this.sessions.add(row.session_id)
        await this.query('DELETE FROM audit_logs WHERE user_id=?', [this.ownerId])
        await this.query('DELETE FROM admin_users WHERE id=?', [this.ownerId])
      }
      if (this.sessions.size) await this.query('DELETE FROM sessions WHERE session_id IN (' + [...this.sessions].map(() => '?').join(',') + ')', [...this.sessions])
    } finally {
      await this.db?.end()
      if (this.directory) await rm(this.directory, { recursive: true, force: true })
    }
  }
}
