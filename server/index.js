import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcrypt'
import { newPasswordError } from './password-policy.js'
import { createDataProtection } from './data-protection.js'
import { createDatabasePrivacy } from './database-privacy.js'
import { protectSessionStore } from './protected-session-store.js'
import { issueEmailVerification, consumeEmailVerification, verificationRequired, EmailVerificationError } from './email-verification.js'
import { rateLimit } from 'express-rate-limit'
import session from 'express-session'
import MySQLStoreFactory from 'express-mysql-session'
import mysql from 'mysql2/promise'
import { v2 as cloudinary } from 'cloudinary'
import multer from 'multer'
import { Readable } from 'node:stream'
import cron from 'node-cron'
import { registerMediaLibrary } from './media-library.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { mercadoPagoOnlineConfigured, mercadoPagoPointConfigured, createMercadoPagoOnlineOrder, createMercadoPagoPointOrder, getMercadoPagoOrder, validateMercadoPagoWebhookSignature } from './mercado-pago.js'
import {
  configurarPersistenciaSessao,
  normalizarManterConectado,
  sessaoDevePersistir
} from '../session-policy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

wss.on('connection', (socket) => {
  socket.isAlive = true
  socket.on('pong', () => { socket.isAlive = true })
  socket.on('message', (message) => {
    socket.isAlive = true
    try {
      const payload = JSON.parse(String(message || '{}'))
      if (payload?.type === 'keepalive') socket.send(JSON.stringify({ type:'keepalive_ack', at:Date.now() }))
    } catch {
      socket.send(JSON.stringify({ type:'keepalive_ack', at:Date.now() }))
    }
  })
  socket.on('error', () => {})
})

const websocketHeartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) return socket.terminate()
    socket.isAlive = false
    socket.ping()
  })
}, 30000)

wss.on('close', () => clearInterval(websocketHeartbeat))

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  })
}

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 8 },
  fileFilter(req, file, callback) {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
      'video/mp4', 'video/webm', 'video/quicktime'
    ]
    if (!allowed.includes(String(file.mimetype || '').toLowerCase())) {
      const error = new Error('Arquivo não suportado. Use JPG, PNG, WebP ou AVIF para fotos; MP4, WebM ou MOV para vídeos.')
      error.status = 400
      return callback(error)
    }
    callback(null, true)
  }
})
app.disable('x-powered-by')
app.set('trust proxy', 1)

const PORT = Number(process.env.PORT || 10000)
const NODE_ENV = process.env.NODE_ENV || 'production'
const DB_PORT = Number(process.env.DB_PORT || 3306)
const DB_SSL = process.env.DB_SSL !== 'false'
const DB_SSL_REJECT_UNAUTHORIZED = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
if (process.env.DATA_ENCRYPTION_ENABLED && !['true', 'false'].includes(process.env.DATA_ENCRYPTION_ENABLED)) {
  throw new Error('DATA_ENCRYPTION_ENABLED deve ser true ou false.')
}
const DATA_ENCRYPTION_ENABLED = process.env.DATA_ENCRYPTION_ENABLED === 'true'

if (DATA_ENCRYPTION_ENABLED && NODE_ENV === 'production' && (!DB_SSL || !DB_SSL_REJECT_UNAUTHORIZED)) {
  throw new Error('A proteção de dados em produção exige TLS MySQL com validação de certificado.')
}

for (const key of ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','SESSION_SECRET']) {
  if (!process.env[key]) throw new Error(key + ' não configurada')
}

const dbConfig = {
  host: process.env.DB_HOST,
  port: DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  ssl: DB_SSL ? {
    rejectUnauthorized: DB_SSL_REJECT_UNAUTHORIZED,
    verifyIdentity: true,
    ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {})
  } : undefined
}

const db = mysql.createPool(dbConfig)
const privacy = createDatabasePrivacy({ db, enabled: DATA_ENCRYPTION_ENABLED })
const dataProtection = DATA_ENCRYPTION_ENABLED ? createDataProtection() : null

const appUrl = String(process.env.APP_URL || '').trim()
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || appUrl)
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)
const emailFrom = String(process.env.EMAIL_FROM || '').trim()
const storeNotificationEmail = String(process.env.STORE_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || '').trim()

function confirmationEmailConfigured() {
  if (!String(process.env.RESEND_API_KEY || '').trim() || !emailFrom) return false
  try {
    const url = new URL(appUrl)
    return url.protocol === 'https:' || (NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch { return false }
}

async function sendTransactionalEmail({ to, subject, html, text = '', idempotencyKey = '' }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim()
  if (!apiKey || !emailFrom) {
    throw new Error('Provedor de e-mail não configurado.')
  }
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean)
  if (!recipients.length) throw new Error('Destinatário de e-mail não configurado.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify({ from: emailFrom, to: recipients, subject, html, ...(text ? { text } : {}) })
  })
  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}
  if (!response.ok) throw new Error('Resend HTTP ' + response.status)
  if (typeof data?.id !== 'string' || !data.id) throw new Error('Resposta do serviço de e-mail inválida.')
  return data
}

async function sendEmailSafely(payload) {
  try { return await sendTransactionalEmail(payload) }
  catch (error) { console.error('EMAIL ERROR:', error.message); return { error: error.message } }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]))
}
function moneyBR(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
}


app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '256kb' }))

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      connectSrc: ["'self'", 'https://galeo-api-go.onrender.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
      mediaSrc: ["'self'", 'blob:', 'https://res.cloudinary.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}))

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('Origem não autorizada pelo CORS.'))
  }
}))

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})

function criarLimitador({ janelaMs, maximo, prefixo }) {
  return rateLimit({
    windowMs: janelaMs,
    limit: maximo,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: prefixo,
    validate: { trustProxy: false },
    handler(req, res) {
      const expiraEm = req.rateLimit?.resetTime?.getTime?.()
      const segundos = Number.isFinite(expiraEm)
        ? Math.max(1, Math.ceil((expiraEm - Date.now()) / 1000))
        : Math.ceil(janelaMs / 1000)
      res.setHeader('Retry-After', String(segundos))
      return res.status(429).json({
        success: false,
        error: `Muitas tentativas. Aguarde ${segundos} segundos.`
      })
    }
  })
}

const limitarAutenticacao = criarLimitador({
  janelaMs: 15 * 60 * 1000,
  maximo: 20,
  prefixo: 'admin-auth'
})

const limitarAlteracaoSenha = criarLimitador({
  janelaMs: 15 * 60 * 1000,
  maximo: 5,
  prefixo: 'admin-password'
})

const limitarConfirmacaoEmail = criarLimitador({ janelaMs: 15 * 60 * 1000, maximo: 10, prefixo: 'customer-email-confirmation' })
const limitarReenvioEmail = criarLimitador({ janelaMs: 15 * 60 * 1000, maximo: 10, prefixo: 'customer-email-resend' })

const Store = MySQLStoreFactory(session)
// Use the actual TLS-configured pool: the store's internal pool builder omits ssl.
const rawSessionStore = new Store({ endConnectionOnClose: false }, db)
const sessionStore = protectSessionStore(rawSessionStore, { db, protection: dataProtection })

app.use(session({
  name: 'galeo_sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax'
  }
}))

app.use(validarCsrf)

async function query(sql, params = [], executor = db) {
  const [rows] = await executor.execute(sql, params)
  const table = sql.match(/\bFROM\s+`?([a-z_]+)/i)?.[1]?.toLowerCase()
  if (Array.isArray(rows) && table) return privacy.decodeRows(table, rows)
  return rows
}

async function audit(userId, action, entity, entityId, details = null, executor = db) {
  const conn = executor === db ? await db.getConnection() : executor
  try {
    if (executor === db) await conn.beginTransaction()
    await insertPrivateBusiness(conn, 'audit_logs',
      'INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)',
      [userId || null, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null],
      { details: 4 })
    if (executor === db) await conn.commit()
  } catch (error) {
    if (executor === db) await conn.rollback().catch(() => {})
    throw error
  } finally {
    if (executor === db) conn.release()
  }
}

// The initial INSERT contains placeholders only; encrypted data is completed
// under the same transaction, after the row id is known for authenticated AAD.
async function insertPrivateBusiness(conn, table, sql, params, sensitivePositions) {
  const original = Object.fromEntries(Object.entries(sensitivePositions).map(([field, position]) => [field, params[position]]))
  const pending = privacy.pendingFields(table, original)
  const protectedParams = [...params]
  for (const [field, position] of Object.entries(sensitivePositions)) protectedParams[position] = pending[field]
  const [result] = await conn.execute(sql, protectedParams)
  await privacy.completeInsert(table, result.insertId, original, conn)
  return result
}

async function ensureColumn(table, column, definition) {
  const rows = await query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1',
    [table, column]
  )
  if (!rows.length) await query('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition)
}

async function ensureIndex(table, indexName, createSql) {
  const rows = await query(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=? LIMIT 1',
    [table, indexName]
  )
  if (!rows.length) await query(createSql)
}

async function init() {
  const schema = [
    `CREATE TABLE IF NOT EXISTS admin_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('owner','manager','staff') NOT NULL DEFAULT 'owner',
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(180) NOT NULL,
      brand VARCHAR(120) NOT NULL DEFAULT '',
      category_id INT NULL,
      description TEXT NOT NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      cost DECIMAL(12,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      min_stock INT NOT NULL DEFAULT 0,
      image VARCHAR(1000) NOT NULL DEFAULT '',
      video VARCHAR(1000) NOT NULL DEFAULT '',
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      INDEX idx_products_active (active),
      INDEX idx_products_category (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS product_media (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      media_type ENUM('image','video') NOT NULL,
      url VARCHAR(1200) NOT NULL,
      public_id VARCHAR(255) NOT NULL,
      width INT NULL,
      height INT NULL,
      duration DECIMAL(12,3) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_media_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      INDEX idx_media_product_order (product_id,sort_order,id),
      INDEX idx_media_public_id (public_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS stock_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      type ENUM('ENTRADA','SAIDA','AJUSTE') NOT NULL,
      quantity INT NOT NULL,
      stock_before INT NOT NULL,
      stock_after INT NOT NULL,
      reason VARCHAR(255) NOT NULL DEFAULT '',
      reference_id VARCHAR(120) NULL,
      unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
      user_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
      CONSTRAINT fk_stock_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      INDEX idx_stock_product_created (product_id, created_at),
      INDEX idx_stock_reference (reference_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS financial_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      type ENUM('RECEITA','DESPESA') NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS financial_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      initial_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS financial_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NULL,
      category_id INT NULL,
      type ENUM('RECEITA','DESPESA') NOT NULL,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      due_date DATE NULL,
      paid_at DATETIME NULL,
      status ENUM('PENDENTE','PAGO','CANCELADO') NOT NULL DEFAULT 'PENDENTE',
      recurring TINYINT(1) NOT NULL DEFAULT 0,
      recurrence VARCHAR(40) NULL,
      reference_type VARCHAR(80) NULL,
      reference_id VARCHAR(120) NULL,
      user_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_fin_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id) ON DELETE SET NULL,
      CONSTRAINT fk_fin_category FOREIGN KEY (category_id) REFERENCES financial_categories(id) ON DELETE SET NULL,
      CONSTRAINT fk_fin_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      UNIQUE KEY uq_fin_reference (reference_id),
      INDEX idx_fin_due_status (due_date, status),
      INDEX idx_fin_type_status (type, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS recurring_expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      description VARCHAR(255) NOT NULL,
      category_id INT NULL,
      account_id INT NULL,
      amount DECIMAL(12,2) NOT NULL,
      due_day INT NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_rec_category FOREIGN KEY (category_id) REFERENCES financial_categories(id) ON DELETE SET NULL,
      CONSTRAINT fk_rec_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id) ON DELETE SET NULL,
      INDEX idx_rec_active_day (active, due_day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS sales (      id INT AUTO_INCREMENT PRIMARY KEY,      code VARCHAR(32) NOT NULL UNIQUE,      customer_name VARCHAR(180) NOT NULL DEFAULT '',      payment_method ENUM('PIX','CARTAO_CREDITO','CARTAO_DEBITO','DINHEIRO','TRANSFERENCIA','OUTRO') NOT NULL DEFAULT 'PIX',      total DECIMAL(12,2) NOT NULL DEFAULT 0,      status ENUM('PAGA','CANCELADA') NOT NULL DEFAULT 'PAGA',      notes TEXT NULL,      sold_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,      user_id INT NULL,      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,      CONSTRAINT fk_sales_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL,      INDEX idx_sales_sold_status (sold_at, status)    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,    `CREATE TABLE IF NOT EXISTS sale_items (      id INT AUTO_INCREMENT PRIMARY KEY,      sale_id INT NOT NULL,      product_id INT NOT NULL,      quantity INT NOT NULL,      unit_price DECIMAL(12,2) NOT NULL,      unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,      line_total DECIMAL(12,2) NOT NULL,      CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,      CONSTRAINT fk_sale_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,      INDEX idx_sale_items_sale (sale_id),      INDEX idx_sale_items_product (product_id)    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(80) NOT NULL,
      entity VARCHAR(80) NOT NULL,
      entity_id VARCHAR(120) NULL,
      details JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      INDEX idx_audit_entity_created (entity, entity_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(180) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(40) NOT NULL DEFAULT '',
      active TINYINT(1) NOT NULL DEFAULT 1,
      email_verified_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customer_active_email (active,email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS customer_email_verifications (
      token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      customer_id INT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      sent_at DATETIME NOT NULL,
      CONSTRAINT fk_email_verification_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      INDEX idx_email_verification_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS store_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(32) NOT NULL UNIQUE,
      customer_id INT NOT NULL,
      customer_name VARCHAR(180) NOT NULL,
      customer_email VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(40) NOT NULL DEFAULT '',
      payment_status ENUM('PENDING','APPROVED','REJECTED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING',
      payment_provider VARCHAR(60) NOT NULL DEFAULT '',
      payment_method VARCHAR(40) NOT NULL DEFAULT '',
      payment_reference VARCHAR(160) NULL,
      payment_url VARCHAR(1200) NULL,
      paid_at DATETIME NULL,
      sale_id INT NULL,
      status ENUM('RECEIVED','CONFIRMED','PREPARING','SHIPPED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'RECEIVED',
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      postal_code VARCHAR(20) NOT NULL DEFAULT '',
      street VARCHAR(180) NOT NULL DEFAULT '',
      number VARCHAR(40) NOT NULL DEFAULT '',
      complement VARCHAR(120) NOT NULL DEFAULT '',
      neighborhood VARCHAR(120) NOT NULL DEFAULT '',
      city VARCHAR(120) NOT NULL DEFAULT '',
      state CHAR(2) NOT NULL DEFAULT '',
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
      INDEX idx_order_customer_created (customer_id,created_at),
      INDEX idx_order_status_created (status,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS store_order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(180) NOT NULL,
      brand VARCHAR(120) NOT NULL DEFAULT '',
      quantity INT NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL,
      line_total DECIMAL(12,2) NOT NULL,
      CONSTRAINT fk_order_item_order FOREIGN KEY (order_id) REFERENCES store_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_order_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
      INDEX idx_order_item_order (order_id),
      INDEX idx_order_item_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel ENUM('ONLINE','POINT') NOT NULL,
      store_order_id INT NULL,
      sale_id INT NULL,
      method VARCHAR(40) NOT NULL DEFAULT '',
      provider VARCHAR(60) NOT NULL,
      provider_reference VARCHAR(160) NULL,
      status ENUM('PENDING','APPROVED','REJECTED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING',
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_url VARCHAR(1200) NULL,
      idempotency_key VARCHAR(160) NULL,
      raw_payload JSON NULL,
      paid_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_payment_order FOREIGN KEY (store_order_id) REFERENCES store_orders(id) ON DELETE RESTRICT,
      CONSTRAINT fk_payment_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
      UNIQUE KEY uq_payment_provider_reference (provider,provider_reference),
      UNIQUE KEY uq_payment_idempotency (idempotency_key),
      INDEX idx_payment_order_status (store_order_id,status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS integration_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(60) NOT NULL,
      event_id VARCHAR(255) NOT NULL,
      event_type VARCHAR(80) NOT NULL DEFAULT '',
      payload JSON NOT NULL,
      processed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_integration_event (provider,event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS home_sections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      section_key VARCHAR(80) NOT NULL UNIQUE,
      section_type VARCHAR(50) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      visible TINYINT(1) NOT NULL DEFAULT 1,
      draft_content JSON NOT NULL,
      published_content JSON NOT NULL,
      updated_by INT NULL,
      published_by INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      published_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_home_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
      CONSTRAINT fk_home_published_by FOREIGN KEY (published_by) REFERENCES admin_users(id) ON DELETE SET NULL,
      INDEX idx_home_order_visible (sort_order, visible)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS home_settings (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value JSON NOT NULL,
      updated_by INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_home_setting_user FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ]

  for (const statement of schema) await query(statement)
  // Existing customers retain their data, but must confirm ownership of their
  // email before a new or previously issued customer session can be used.
  await ensureColumn('customers', 'email_verified_at', 'DATETIME NULL')
  await ensureColumn('payments', 'payment_url', 'VARCHAR(1200) NULL')
  await ensureColumn('home_sections', 'published_sort_order', 'INT NULL')
  await ensureColumn('home_sections', 'published_visible', 'TINYINT(1) NULL')
  await ensureColumn('home_settings', 'draft_value', 'JSON NULL')
  await ensureColumn('sales', 'client_reference', 'VARCHAR(80) NULL')
  await ensureIndex('sales', 'uq_sale_client_reference', 'CREATE UNIQUE INDEX uq_sale_client_reference ON sales(user_id,client_reference)')
  await ensureColumn('store_orders', 'payment_status', "ENUM('PENDING','APPROVED','REJECTED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING'")
  await ensureColumn('store_orders', 'payment_provider', "VARCHAR(60) NOT NULL DEFAULT ''")
  await ensureColumn('store_orders', 'payment_method', "VARCHAR(40) NOT NULL DEFAULT ''")
  await ensureColumn('store_orders', 'payment_reference', "VARCHAR(160) NULL")
  await ensureColumn('store_orders', 'payment_url', "VARCHAR(1200) NULL")
  await ensureColumn('store_orders', 'paid_at', "DATETIME NULL")
  await ensureColumn('store_orders', 'sale_id', "INT NULL")
  await ensureIndex('store_orders', 'uq_store_order_sale', 'CREATE UNIQUE INDEX uq_store_order_sale ON store_orders(sale_id)')
  await privacy.ensureSchemaAndMigrate()
  await sessionStore.migrate()

  const productCategories = [
    ['Camisetas', 10],
    ['Calças', 20],
    ['Camisas', 30],
    ['Moletons', 40],
    ['Bermudas', 50],
    ['Casacos', 60],
    ['Calçados', 70],
    ['Acessórios', 80]
  ]
  for (const [name, sortOrder] of productCategories) {
    await query('INSERT IGNORE INTO categories(name,sort_order) VALUES(?,?)', [name, sortOrder])
  }

  // A GALEO é uma loja de moda masculina. Esta categoria foi semeada
  // por uma versão anterior e não deve continuar aparecendo no catálogo.
  await query("DELETE FROM categories WHERE name='Vestidos'")

  const financialCategories = [
    ['Vendas', 'RECEITA'], ['Outras receitas', 'RECEITA'],
    ['Compra de mercadorias', 'DESPESA'], ['Aluguel', 'DESPESA'],
    ['Condomínio', 'DESPESA'], ['Água', 'DESPESA'],
    ['Energia', 'DESPESA'], ['Internet', 'DESPESA'],
    ['Marketing', 'DESPESA'], ['Salários', 'DESPESA'],
    ['Impostos', 'DESPESA'], ['Frete', 'DESPESA'],
    ['Embalagens', 'DESPESA'], ['Taxas de cartão', 'DESPESA'],
    ['Taxas de marketplace', 'DESPESA'], ['Manutenção', 'DESPESA'],
    ['Outras despesas', 'DESPESA']
  ]
  for (const [name, type] of financialCategories) {
    await query(
      'INSERT INTO financial_categories(name,type) VALUES(?,?) ON DUPLICATE KEY UPDATE name=name',
      [name, type]
    )
  }

  await query(
    "INSERT INTO financial_accounts(name) VALUES('Caixa da loja') ON DUPLICATE KEY UPDATE name=name"
  )
  const homeDefaults = [
    { key: 'hero', type: 'hero', order: 10, content: { eyebrow: 'GALEO / MULTIBRAND STORE', title: 'Vista o que representa você', description: 'Curadoria de marcas, peças e estilos para quem não precisa seguir o mesmo caminho', button_label: 'Explorar coleção', button_url: '/shop', desktop_media_id: null, mobile_media_id: null, video_media_id: null } },
    { key: 'utility', type: 'utility', order: 20, content: { items: ['Curadoria multimarcas', 'Compra segura', 'Envio para todo o Brasil', 'Novas peças toda semana'] } },
    { key: 'categories', type: 'categories', order: 30, content: { eyebrow: '01 / CATEGORIAS', title: 'Escolha seu movimento', button_label: 'Ver catálogo', button_url: '/shop', items: [{ title: 'Camisetas', url: '/shop', media_id: null }, { title: 'Calças', url: '/shop', media_id: null }, { title: 'Blusas', url: '/shop', media_id: null }] } },
    { key: 'featured_products', type: 'featured_products', order: 40, content: { eyebrow: '02 / TRENDING NOW', title: 'Seleção multimarcas', button_label: 'Ver todos', button_url: '/shop', source: 'latest', product_ids: [] } },
    { key: 'campaigns', type: 'campaigns', order: 50, content: { defaults: { effect: 'zoom', transition: 'crossfade', speed: 'slow', duration_seconds: 6 }, items: [{ eyebrow: 'NEW DROPS', title: 'Peças que marcam presença', button_label: 'Descobrir agora', button_url: '/shop', media_id: null }, { eyebrow: 'PREMIUM SELECTION', title: 'Seu estilo, sem rótulo', button_label: 'Ver seleção', button_url: '/shop', media_id: null }, { eyebrow: 'LIMITED EDITION', title: 'Feito para ser notado', button_label: 'Explorar', button_url: '/shop', media_id: null }] } },
    { key: 'manifesto', type: 'manifesto', order: 60, content: { eyebrow: '03 / SOBRE A GALEO', text: 'Não seguimos o padrão\nCriamos o nosso' } },
    { key: 'newsletter', type: 'newsletter', order: 70, content: { eyebrow: 'GALEO / INSIDER', title: 'Entre para a próxima fase', button_label: 'Entrar' } }
  ]

  for (const section of homeDefaults) {
    const payload = JSON.stringify(section.content)
    await query(
      "INSERT INTO home_sections (section_key,section_type,sort_order,visible,draft_content,published_content) VALUES(?,?,?,1,?,?) ON DUPLICATE KEY UPDATE section_key=section_key",
      [section.key, section.type, section.order, payload, payload]
    )
  }

  await query('UPDATE home_sections SET published_sort_order=sort_order WHERE published_sort_order IS NULL')
  await query('UPDATE home_sections SET published_visible=visible WHERE published_visible IS NULL')

  await query(
    "INSERT INTO home_settings(setting_key,setting_value) VALUES('campaign_defaults',?) ON DUPLICATE KEY UPDATE setting_key=setting_key",
    [JSON.stringify({ effect: 'zoom', transition: 'crossfade', speed: 'slow', duration_seconds: 6 })]
  )

  await query(
    "INSERT INTO home_settings(setting_key,setting_value) VALUES('storefront_visual_defaults',?) ON DUPLICATE KEY UPDATE setting_key=setting_key",
    [JSON.stringify({"visual_direction":"editorial_multibrand","theme":"dark","palette":{"background":"#050505","surface":"#0d0c0b","surface_alt":"#15120f","text":"#f2eadb","muted":"#978b78","accent":"#c4934c","accent_soft":"#e2c27f","accent_deep":"#72501f","line":"rgba(224,189,125,.19)"},"typography":{"display":{"family":"Inter","weight":850,"tracking":"-0.075em","line_height":0.88},"editorial":{"family":"Georgia","weight":400,"style":"italic"},"ui":{"family":"Inter","weight":700,"tracking":"0.11em","transform":"uppercase"}},"layout":{"max_width":1440,"side_gutter":28,"section_spacing":128,"borders":"hairline","corners":"minimal","shadows":"restrained"},"interaction":{"smooth_scroll":{"enabled":true,"library":"Lenis","duration":1.05,"wheel_multiplier":0.95,"sync_with_scroll_animations":true},"scroll_reveal":{"enabled":true,"library":"GSAP ScrollTrigger","duration":0.8,"stagger":0.06,"distance":24,"once":true},"hero_text_reveal":{"enabled":true,"duration":0.9,"stagger":0.08,"style":"line-rise"},"image_hover":{"enabled":true,"duration":0.45,"scale":1.035,"directional_overlay":true},"product_hover":{"enabled":true,"image_scale":1.04,"lift_px":6}},"accessibility":{"respect_reduced_motion":true,"preserve_native_scroll":true,"no_motion_only_information":true},"guardrails":{"no_neon":true,"no_heavy_glassmorphism":true,"no_excessive_gradients":true,"no_permanent_cursor_effects":true,"no_animation_on_every_element":true,"prioritize_content_and_product_images":true},"inspiration":{"component_language":"Inspira UI","smooth_scroll":"Lenis","animation_system":"GSAP"}})]
  )

  const legacyTextMigrations = [
    ['Vista o que representa você.', 'Vista o que representa você'],
    ['Curadoria de marcas, peças e estilos para quem não precisa seguir o mesmo caminho.', 'Curadoria de marcas, peças e estilos para quem não precisa seguir o mesmo caminho'],
    ['Escolha seu movimento.', 'Escolha seu movimento'],
    ['Seleção multimarcas.', 'Seleção multimarcas'],
    ['Peças que marcam presença.', 'Peças que marcam presença'],
    ['Seu estilo, sem rótulo.', 'Seu estilo, sem rótulo'],
    ['Feito para ser notado.', 'Feito para ser notado'],
    ['Não seguimos o padrão. Criamos o nosso.', 'Não seguimos o padrão Criamos o nosso'],
    ['Entre para a próxima fase.', 'Entre para a próxima fase']
  ]
  for (const [legacyText, cleanText] of legacyTextMigrations) {
    await query(
      'UPDATE home_sections SET draft_content=REPLACE(draft_content,?,?), published_content=REPLACE(published_content,?,?) WHERE draft_content LIKE ? OR published_content LIKE ?',
      [legacyText, cleanText, legacyText, cleanText, '%' + legacyText + '%', '%' + legacyText + '%']
    )
  }

  await query(
    "INSERT INTO home_settings(setting_key,setting_value) VALUES('navigation',?) ON DUPLICATE KEY UPDATE setting_key=setting_key",
    [JSON.stringify({ items: [
      { label: 'Camisetas', url: '/shop?category=Camisetas' },
      { label: 'Calças', url: '/shop?category=Cal%C3%A7as' },
      { label: 'Camisas', url: '/shop?category=Camisas' },
      { label: 'Moletons', url: '/shop?category=Moletons' }
    ] })]
  )
  await query(
    "INSERT INTO home_settings(setting_key,setting_value) VALUES('footer',?) ON DUPLICATE KEY UPDATE setting_key=setting_key",
    [JSON.stringify({ brand: 'GALEO STORE', location: 'São Paulo / BR', year: '2026' })]
  )

  await query("UPDATE admin_users SET role='staff' WHERE role='manager'")
  await query("ALTER TABLE admin_users MODIFY role ENUM('owner','staff') NOT NULL DEFAULT 'owner'")

  if (process.env.ADMIN_EMAIL) {
    const existing = await query(
      'SELECT id FROM admin_users WHERE email=? LIMIT 1',
      [privacy.emailForLookup('admin_users', process.env.ADMIN_EMAIL)]
    )

    if (!existing.length && process.env.ADMIN_PASSWORD) {
      const passwordError = newPasswordError(process.env.ADMIN_PASSWORD)
      if (passwordError) throw new Error('ADMIN_PASSWORD inválida: ' + passwordError)
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
      const connection = await db.getConnection()
      try {
        await connection.beginTransaction()
        const record = { email: process.env.ADMIN_EMAIL }
        const safe = privacy.pendingFields('admin_users', record)
        const [inserted] = await connection.execute("INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?, 'owner', 1)", [safe.email, passwordHash])
        await privacy.completeInsert('admin_users', inserted.insertId, record, connection)
        await connection.commit()
      } catch (error) {
        await connection.rollback().catch(() => {})
        throw error
      } finally { connection.release() }
    }
  }
}
async function exigirLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Sessão expirada. Faça login novamente.'
    })
  }

  try {
    const rows = await query(
      'SELECT id,email,role,active,private_data FROM admin_users WHERE id=? LIMIT 1',
      [req.session.userId]
    )
    if (!rows.length || !rows[0].active || rows[0].role !== 'owner') {
      const roleDenied = rows[0]?.active && rows[0]?.role !== 'owner'
      return req.session.destroy(() => {
        res.clearCookie('galeo_sid', {
          httpOnly: true,
          secure: NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/'
        })
        return res.status(roleDenied ? 403 : 401).json({
          success: false,
          ...(roleDenied ? { code: 'ADMIN_OWNER_REQUIRED' } : {}),
          error: roleDenied ? 'Acesso administrativo exclusivo dos proprietários.' : 'Esta conta não está disponível.'
        })
      })
    }
    req.admin = rows[0]
    next()
  } catch (error) {
    console.error('Erro ao validar sessão:', error)
    res.status(500).json({ success: false, error: 'Não foi possível validar a sessão.' })
  }
}

function salvarSessao(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve())
  })
}

function renovarSessao(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve())
  })
}

function normalizarPapel(role) {
  return role === 'owner' ? 'owner' : 'staff'
}

function permissoesDoPapel(role) {
  const papel = normalizarPapel(role)
  return {
    role: papel,
    content: papel === 'owner',
    users: false,
    operations: papel === 'owner'
  }
}

function gerarCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex')
  return req.session.csrfToken
}

function validarCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  if (req.path === '/api/auth/login' || req.path === '/api/customer/login' || req.path === '/api/customer/register' || req.path === '/api/customer/verify-email' || req.path === '/api/customer/resend-verification' || req.path === '/api/integrations/mercado-pago/webhook' || req.path === '/api/integrations/distributor/webhook') return next()

  const expected = String(req.session.csrfToken || '')
  const provided = String(req.get('X-CSRF-Token') || '')
  if (!expected || !provided) {
    return res.status(403).json({ success: false, error: 'Proteção CSRF: token ausente.' })
  }

  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(provided, 'utf8')
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(403).json({ success: false, error: 'Proteção CSRF: token inválido.' })
  }
  next()
}

function exigirPapel(...papeisPermitidos) {
  return (req, res, next) => {
    const papel = normalizarPapel(req.admin?.role)
    if (papeisPermitidos.includes(papel)) return next()
    return res.status(403).json({ success: false, error: 'Você não tem permissão para esta ação.' })
  }
}

const exigirOwner = exigirPapel('owner')

async function registrarEventoIntegracao(conn, provider, eventId, eventType, payload) {
  if (!eventId) return true
  const original = { payload: JSON.stringify(payload || {}) }
  await conn.execute(
    'INSERT INTO integration_events(provider,event_id,event_type,payload) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE event_id=event_id',
    [provider, eventId, eventType, privacy.pendingFields('integration_events', original).payload]
  )
  const [events] = await conn.execute(
    'SELECT id,processed_at FROM integration_events WHERE provider=? AND event_id=? FOR UPDATE',
    [provider, eventId]
  )
  if (!events[0]?.processed_at) await privacy.updateFields('integration_events', events[0].id, original, conn)
  return !events[0]?.processed_at
}

// O chamador bloqueia o pedido na mesma transação antes de devolver a reserva.
async function devolverReservaPedido(conn, order, userId = null) {
  if (order.status === 'CANCELLED') return
  const [items] = await conn.execute('SELECT * FROM store_order_items WHERE order_id=? ORDER BY product_id', [order.id])
  for (const item of items) {
    const [products] = await conn.execute('SELECT stock,cost FROM products WHERE id=? FOR UPDATE', [item.product_id])
    if (!products.length) throw new Error('Produto do pedido não encontrado.')
    const stockBefore = Number(products[0].stock)
    const stockAfter = stockBefore + Number(item.quantity)
    await conn.execute('UPDATE products SET stock=? WHERE id=?', [stockAfter, item.product_id])
    await insertPrivateBusiness(conn, 'stock_movements',
      "INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id) VALUES(?,'ENTRADA',?,?,?,?,?,?,?)",
      [item.product_id, item.quantity, stockBefore, stockAfter, 'Cancelamento do pedido ' + order.code, 'store-order:' + order.id, Number(products[0].cost || 0), userId],
      { reason: 4 }
    )
  }
}

function mapMercadoPagoStatus(status, statusDetail = '') {
  const value = String(status || '').toLowerCase()
  const detail = String(statusDetail || '').toLowerCase()
  if (value === 'processed' || value === 'approved' || detail === 'accredited') return 'APPROVED'
  if (value === 'refunded' || value === 'refund') return 'REFUNDED'
  if (value === 'cancelled' || value === 'canceled') return 'CANCELLED'
  if (value === 'failed' || value === 'rejected') return 'REJECTED'
  return 'PENDING'
}

function mapPaymentMethod(paymentMethod) {
  const value = String(paymentMethod || '').toLowerCase()
  if (value === 'pix') return 'PIX'
  if (value === 'debit_card') return 'CARTAO_DEBITO'
  if (value === 'credit_card') return 'CARTAO_CREDITO'
  return 'OUTRO'
}

async function promoverPedidoPagoParaVenda(conn, orderId, paymentData = {}) {
  const [orderRows] = await conn.execute('SELECT * FROM store_orders WHERE id=? FOR UPDATE', [orderId])
  if (!orderRows.length) throw new Error('Pedido online não encontrado.')
  const order = privacy.decodeRow('store_orders', orderRows[0])
  if (order.sale_id) return { saleId: Number(order.sale_id), created: false, code: order.code }
  if (String(order.payment_status) !== 'APPROVED') throw new Error('O pagamento do pedido ainda não foi aprovado.')

  const [items] = await conn.execute('SELECT * FROM store_order_items WHERE order_id=? ORDER BY id', [orderId])
  if (!items.length) throw new Error('O pedido online não possui itens.')
  const paymentMethod = mapPaymentMethod(paymentData.payment_method_type || order.payment_method)
  const saleResult = await insertPrivateBusiness(conn, 'sales',
    "INSERT INTO sales(code,customer_name,payment_method,total,status,notes,user_id) VALUES(?,?,?,?, 'PAGA',?,NULL)",
    ['PENDING', order.customer_name, paymentMethod, Number(order.total), 'Origem: pedido online ' + order.code],
    { customer_name: 1, notes: 4 }
  )
  const saleId = saleResult.insertId
  const saleCode = 'VDA-' + String(saleId).padStart(6, '0')

  for (const item of items) {
    const [productRows] = await conn.execute('SELECT id,cost FROM products WHERE id=? FOR UPDATE', [item.product_id])
    if (!productRows.length) throw new Error('Produto do pedido não encontrado.')
    await conn.execute(
      'INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost,line_total) VALUES(?,?,?,?,?,?)',
      [saleId, item.product_id, item.quantity, Number(item.unit_price), Number(productRows[0].cost || 0), Number(item.line_total)]
    )
  }

  await conn.execute('UPDATE sales SET code=?, total=? WHERE id=?', [saleCode, Number(order.total), saleId])
  const [categoryRows] = await conn.execute("SELECT id FROM financial_categories WHERE name='Vendas' AND type='RECEITA' LIMIT 1")
  const [accountRows] = await conn.execute("SELECT id FROM financial_accounts WHERE name='Caixa da loja' LIMIT 1")
  if (!categoryRows.length || !accountRows.length) throw new Error('Categoria ou conta financeira da venda não encontrada.')
  await insertPrivateBusiness(conn, 'financial_entries',
    "INSERT INTO financial_entries(account_id,category_id,type,description,amount,due_date,paid_at,status,recurring,reference_type,reference_id,user_id) VALUES(?,?,?,?,?,CURDATE(),NOW(),'PAGO',0,'VENDA',?,NULL)",
    [accountRows[0].id, categoryRows[0].id, 'RECEITA', 'Venda ' + saleCode, Number(order.total), 'sale:' + saleId],
    { description: 3 }
  )
  await conn.execute("UPDATE payments SET sale_id=?,status='APPROVED',paid_at=COALESCE(paid_at,NOW()) WHERE store_order_id=? AND provider='MERCADO_PAGO'", [saleId, orderId])
  await conn.execute("UPDATE store_orders SET status=CASE WHEN status='RECEIVED' THEN 'CONFIRMED' ELSE status END,payment_status='APPROVED',paid_at=COALESCE(paid_at,NOW()),sale_id=? WHERE id=?", [saleId, orderId])
  return { saleId, saleCode, code: order.code, total: Number(order.total), customerEmail: order.customer_email, customerName: order.customer_name, created: true }
}

async function processarNotificacaoMercadoPago({ eventId, eventType, mpOrder }) {
  const externalReference = String(mpOrder?.external_reference || '').trim()
  if (!externalReference) return { ignored: true, reason: 'sem_external_reference' }
  const orderRows = await query('SELECT id FROM store_orders WHERE code=? LIMIT 1', [externalReference])
  if (!orderRows.length) return { ignored: true, reason: 'pedido_nao_encontrado' }
  const orderId = Number(orderRows[0].id)
  const payment = mpOrder?.transactions?.payments?.[0] || {}
  const status = mapMercadoPagoStatus(mpOrder?.status || payment.status, mpOrder?.status_detail || payment.status_detail)
  const providerReference = String(mpOrder?.id || '')
  const method = String(payment?.payment_method?.type || payment?.payment_method?.id || '')
  const amount = Number(mpOrder?.total_amount || payment?.amount || 0)
  const conn = await db.getConnection()
  let promoted = null
  let reconciliationRequired = false
  try {
    await conn.beginTransaction()
    if (!(await registrarEventoIntegracao(conn, 'MERCADO_PAGO', eventId, eventType, mpOrder))) {
      await conn.commit()
      return { duplicate: true }
    }
    const [lockedOrders] = await conn.execute('SELECT * FROM store_orders WHERE id=? FOR UPDATE', [orderId])
    const originalOrder = privacy.decodeRow('store_orders', lockedOrders[0])
    if (!originalOrder) throw new Error('Pedido online não encontrado.')
    if (status === 'APPROVED' && Math.round(amount * 100) !== Math.round(Number(originalOrder.total) * 100)) {
      throw new Error('O valor aprovado não corresponde ao total do pedido.')
    }
    if ((originalOrder.payment_status === 'REFUNDED' && status !== 'REFUNDED') ||
        (originalOrder.payment_status === 'APPROVED' && !['APPROVED', 'REFUNDED'].includes(status))) {
      if (eventId) await conn.execute('UPDATE integration_events SET processed_at=NOW() WHERE provider=? AND event_id=?', ['MERCADO_PAGO', eventId])
      await conn.commit()
      return { ignored: true, reason: 'status_pagamento_regressivo' }
    }
    const paymentPrivate = { raw_payload: JSON.stringify(mpOrder) }
    await conn.execute(
      "INSERT INTO payments(channel,store_order_id,method,provider,provider_reference,status,amount,raw_payload,paid_at) VALUES('ONLINE',?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),method=VALUES(method),amount=VALUES(amount),raw_payload=VALUES(raw_payload),paid_at=VALUES(paid_at)",
      [orderId, method, 'MERCADO_PAGO', providerReference, status, amount, privacy.pendingFields('payments', paymentPrivate).raw_payload, status === 'APPROVED' ? new Date() : null]
    )
    const [paymentRows] = await conn.execute('SELECT id FROM payments WHERE provider=? AND provider_reference=? FOR UPDATE', ['MERCADO_PAGO', providerReference])
    await privacy.updateFields('payments', paymentRows[0].id, paymentPrivate, conn)
    await conn.execute("UPDATE store_orders SET payment_status=?,payment_provider='MERCADO_PAGO',payment_method=?,payment_reference=?,paid_at=? WHERE id=?", [status, method, providerReference || null, status === 'APPROVED' ? new Date() : null, orderId])
    if (status === 'APPROVED' && originalOrder.status !== 'CANCELLED') {
      promoted = await promoverPedidoPagoParaVenda(conn, orderId, { payment_method_type: method })
    } else if (status === 'APPROVED') {
      reconciliationRequired = true
      console.error('Pagamento aprovado após cancelamento; conciliação necessária:', originalOrder.code)
    } else if (status === 'REFUNDED') {
      const [refundOrderRows]=await conn.execute('SELECT * FROM store_orders WHERE id=? FOR UPDATE',[orderId])
      const refundOrder=privacy.decodeRow('store_orders', refundOrderRows[0])
      if(refundOrder?.sale_id){
        const [saleRows]=await conn.execute('SELECT * FROM sales WHERE id=? FOR UPDATE',[refundOrder.sale_id])
        if(saleRows.length && saleRows[0].status!=='CANCELADA'){
          const [saleItems]=await conn.execute('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id',[refundOrder.sale_id])
          for(const item of saleItems){
            const [productRows]=await conn.execute('SELECT * FROM products WHERE id=? FOR UPDATE',[item.product_id])
            if(!productRows.length) throw new Error('Produto da venda não encontrado.')
            const product=productRows[0]
            const stockBefore=Number(product.stock)
            const stockAfter=stockBefore+Number(item.quantity)
            await conn.execute('UPDATE products SET stock=? WHERE id=?',[stockAfter,item.product_id])
            await insertPrivateBusiness(conn, 'stock_movements',
              "INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id) VALUES(?,'ENTRADA',?,?,?,?,?,?,NULL)",
              [item.product_id,item.quantity,stockBefore,stockAfter,'Estorno do pedido online '+refundOrder.code,'store-order:'+orderId,Number(item.unit_cost||0)],
              { reason: 4 }
            )
          }
          await conn.execute("UPDATE sales SET status='CANCELADA' WHERE id=?",[refundOrder.sale_id])
          await conn.execute("UPDATE financial_entries SET status='CANCELADO',paid_at=NULL WHERE reference_type='VENDA' AND reference_id=?",['sale:'+refundOrder.sale_id])
        }
      } else await devolverReservaPedido(conn, originalOrder)
      await conn.execute("UPDATE store_orders SET status='CANCELLED',payment_status='REFUNDED' WHERE id=?",[orderId])
    }
    if (eventId) await conn.execute('UPDATE integration_events SET processed_at=NOW() WHERE provider=? AND event_id=?', ['MERCADO_PAGO', eventId])
    await conn.commit()
  } catch (error) {
    await conn.rollback().catch(()=>{})
    throw error
  } finally {
    conn.release()
  }
  if (promoted?.created && promoted.customerEmail) void sendEmailSafely({
    to: promoted.customerEmail,
    subject: 'Pagamento aprovado — pedido ' + promoted.code,
    idempotencyKey: 'payment-approved-customer-' + promoted.saleId,
    html: '<div style="font-family:Arial,sans-serif"><h1>Pagamento aprovado</h1><p>Olá, ' + escapeHtml(promoted.customerName) + '</p><p>O pagamento do pedido <strong>' + escapeHtml(promoted.code) + '</strong> foi aprovado</p><p>Seu pedido está confirmado e aguardando preparação</p><p><strong>Total: ' + escapeHtml(moneyBR(promoted.total)) + '</strong></p></div>'
  })
  return { ignored: false, status, promoted, reconciliation_required: reconciliationRequired }
}

async function exigirCliente(req,res,next) {
  if (!req.session.customerId) return res.status(401).json({ success:false,authenticated:false,error:'Faça login para continuar.' })
  try {
    const rows=await query('SELECT id,name,email,phone,active,created_at,email_verified_at,private_data FROM customers WHERE id=? LIMIT 1',[req.session.customerId])
    if (!rows.length || !rows[0].active) {
      delete req.session.customerId
      return res.status(401).json({ success:false,authenticated:false,error:'Esta conta não está disponível.' })
    }
    if (!rows[0].email_verified_at) {
      delete req.session.customerId
      if (!req.session.userId) delete req.session.csrfToken
      await salvarSessao(req)
      return res.status(403).json({ ...verificationRequired, email: rows[0].email })
    }
    req.customer=rows[0]
    next()
  } catch(error) {
    console.error('Erro ao validar cliente:',error)
    res.status(500).json({ success:false,error:'Não foi possível validar sua conta.' })
  }
}


app.get('/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    await Promise.race([
      db.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ])
    return res.status(200).json({
      status: 'ok',
      service: 'galeo-api',
      database: 'ok'
    })
  } catch {
    return res.status(503).json({
      status: 'indisponivel',
      service: 'galeo-api',
      database: 'erro'
    })
  }
})

app.get('/api/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    await db.query('SELECT 1')
    res.json({ ok: true, service: 'galeo-api', database: 'ok' })
  } catch {
    res.status(503).json({ ok: false, service: 'galeo-api', database: 'erro' })
  }
})

app.post('/api/auth/login', limitarAutenticacao, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const manterConectado = normalizarManterConectado(req.body?.manterConectado)

  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255 || !password) {
    return res.status(400).json({ success: false, error: 'Informe e-mail e senha.' })
  }

  try {
    const rows = await query(
      'SELECT id,email,password_hash,role,active,private_data FROM admin_users WHERE email=? LIMIT 1',
      [privacy.emailForLookup('admin_users', email)]
    )

    if (!rows.length || !rows[0].active || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({
        success: false,
        error: 'E-mail ou senha inválidos.'
      })
    }
    if (rows[0].role !== 'owner') {
      return res.status(403).json({ success: false, code: 'ADMIN_OWNER_REQUIRED', error: 'Acesso administrativo exclusivo dos proprietários.' })
    }

    req.session.regenerate(async (error) => {
      if (error) {
        console.error('Erro ao renovar sessão:', error)
        return res.status(500).json({
          success: false,
          error: 'Não foi possível iniciar a sessão.'
        })
      }

      req.session.userId = rows[0].id
      req.session.role = normalizarPapel(rows[0].role)
      req.session.csrfToken = randomBytes(32).toString('hex')
      configurarPersistenciaSessao(req.session, manterConectado)

      try {
        await salvarSessao(req)
        await audit(rows[0].id, 'LOGIN', 'admin_user', rows[0].id, {
          manterConectado
        })
        return res.json({
          success: true,
          user: {
            id: rows[0].id,
            email: rows[0].email,
            role: normalizarPapel(rows[0].role)
          },
          csrfToken: req.session.csrfToken
        })
      } catch (saveError) {
        console.error('Erro ao salvar login:', saveError)
        return res.status(500).json({
          success: false,
          error: 'Não foi possível salvar a sessão.'
        })
      }
    })
  } catch (error) {
    console.error('Erro no login:', error)
    res.status(500).json({
      success: false,
      error: 'Não foi possível processar o login.'
    })
  }
})

app.post('/api/auth/logout', async (req, res) => {
  const userId = req.session.userId || null
  req.session.destroy(async (error) => {
    res.clearCookie('galeo_sid', {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    })
    if (error) {
      console.error('Erro ao encerrar sessão:', error)
      return res.status(500).json({ success: false, error: 'Não foi possível sair.' })
    }
    if (userId) {
      try { await audit(userId, 'LOGOUT', 'admin_user', userId) } catch {}
    }
    res.json({ success: true })
  })
})

app.get('/api/auth/me', exigirLogin, async (req, res) => {
  try {
    const csrfToken = gerarCsrfToken(req)
    await salvarSessao(req)
    res.json({
      success: true,
      user: {
        id: req.admin.id,
        email: req.admin.email,
        role: normalizarPapel(req.admin.role)
      },
      permissions: permissoesDoPapel(req.admin.role),
      csrfToken
    })
  } catch (error) {
    console.error('Erro ao carregar sessão administrativa:', error)
    res.status(500).json({ success: false, error: 'Não foi possível carregar a sessão.' })
  }
})

app.patch('/api/auth/password', exigirLogin, limitarAlteracaoSenha, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '')
  const newPassword = String(req.body?.newPassword || '')

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Informe a senha atual e a nova senha.' })
  }
  const passwordError = newPasswordError(newPassword)
  if (passwordError) return res.status(400).json({ success: false, error: passwordError })
  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, error: 'A nova senha deve ser diferente da atual.' })
  }

  try {
    const rows = await query('SELECT id,password_hash FROM admin_users WHERE id=? AND active=1 LIMIT 1', [req.admin.id])
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(401).json({ success: false, error: 'A senha atual está incorreta.' })
    }
    if (await bcrypt.compare(newPassword, rows[0].password_hash)) {
      return res.status(400).json({ success: false, error: 'A nova senha deve ser diferente da atual.' })
    }

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await query('UPDATE admin_users SET password_hash=? WHERE id=?', [passwordHash, req.admin.id])

    await audit(req.admin.id, 'ALTERAR_SENHA', 'admin_user', req.admin.id)

    const manterConectado = sessaoDevePersistir(req.session)
    req.session.regenerate(async (regenerateError) => {
      if (regenerateError) {
        console.error('Erro ao renovar sessão após alteração de senha:', regenerateError)
        return res.status(500).json({ success: false, error: 'Senha alterada, mas não foi possível renovar a sessão.' })
      }

      req.session.userId = req.admin.id
      req.session.role = normalizarPapel(req.admin.role)
      req.session.csrfToken = randomBytes(32).toString('hex')
      configurarPersistenciaSessao(req.session, manterConectado)

      try {
        await salvarSessao(req)
        res.json({ success: true, csrfToken: req.session.csrfToken })
      } catch (saveError) {
        console.error('Erro ao salvar sessão após alteração de senha:', saveError)
        res.status(500).json({ success: false, error: 'Senha alterada, mas não foi possível salvar a sessão.' })
      }
    })
  } catch (error) {
    console.error('Erro ao alterar senha:', error)
    res.status(500).json({ success: false, error: 'Não foi possível alterar a senha.' })
  }
})

app.get('/api/store/products/:id', async (req,res) => {
  const productId=Number(req.params.id)
  if(!Number.isInteger(productId)||productId<=0) return res.status(400).json({error:'Produto inválido.'})
  try {
    const products=await query('SELECT p.id,p.name,p.brand,p.category_id,p.description,p.price,p.stock,p.image,p.video,c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.active=1 LIMIT 1',[productId])
    if(!products.length) return res.status(404).json({error:'Produto não encontrado.'})
    const media=await query('SELECT id,media_type,url,width,height,duration,sort_order FROM product_media WHERE product_id=? ORDER BY sort_order,id',[productId])
    const related=await query('SELECT p.id,p.name,p.brand,p.price,p.stock,p.image,p.video,c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 AND p.category_id <=> ? AND p.id<>? ORDER BY p.id DESC LIMIT 8',[products[0].category_id,productId])
    res.json({product:{...products[0],media},related})
  } catch(error) {
    console.error('Erro ao carregar produto público:',error)
    res.status(500).json({error:'Não foi possível carregar este produto.'})
  }
})

app.get('/api/store/home', async (req, res) => {
  try {
    const rows = await query('SELECT section_key,section_type,published_sort_order AS sort_order,published_visible AS visible,published_content,published_at FROM home_sections WHERE published_visible=1 ORDER BY published_sort_order,id')
    res.json({ sections: rows.map((row) => ({ key: row.section_key, type: row.section_type, order: Number(row.sort_order), visible: Boolean(row.visible), content: typeof row.published_content === 'string' ? JSON.parse(row.published_content) : row.published_content, published_at: row.published_at })) })
  } catch (error) {
    console.error('Erro ao carregar conteúdo publicado da home:', error)
    res.status(500).json({ error: 'Não foi possível carregar o conteúdo da home.' })
  }
})

app.get('/api/store/home/settings', async (req, res) => {
  try {
    const rows = await query('SELECT setting_key,setting_value FROM home_settings ORDER BY setting_key')
    res.json({ settings: rows.map((row) => ({ key: row.setting_key, value: typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : row.setting_value })) })
  } catch (error) {
    console.error('Erro ao carregar configurações públicas da home:', error)
    res.status(500).json({ error: 'Não foi possível carregar as configurações da home.' })
  }
})
app.get('/api/store', async (req, res) => {
  try {
    const [products, categories] = await Promise.all([
      query(`
        SELECT p.id,p.name,p.brand,p.category_id,p.description,p.price,p.stock,p.image,p.video,c.name AS category
        FROM products p
        LEFT JOIN categories c ON c.id=p.category_id
        WHERE p.active=1
        ORDER BY p.id DESC
      `),
      query('SELECT id,name,sort_order FROM categories ORDER BY sort_order,id')
    ])
    console.log(
      'STORE CATALOG:',
      JSON.stringify({
        activeProducts: products.length,
        productIds: products.map(product => product.id),
        categories: categories.map(category => category.name)
      })
    )

    res.json({ products, categories })
  } catch (error) {
    console.error('Erro no catálogo:', error)
    res.status(500).json({ error: 'Não foi possível carregar o catálogo.' })
  }
})

async function generateCurrentRecurring() {
  const recs = await query(`
    SELECT r.*, DATE_FORMAT(CURRENT_DATE,'%Y-%m') AS current_month,
      DAY(LAST_DAY(CURRENT_DATE)) AS last_day
    FROM recurring_expenses r
    WHERE r.active=1
  `)

  for (const rec of recs) {
    const referenceId = `recurring:${rec.id}:${rec.current_month}`
    const existing = await query(
      'SELECT id FROM financial_entries WHERE reference_id=? LIMIT 1',
      [referenceId]
    )
    if (existing.length) continue

    const dueDay = Math.min(Number(rec.due_day), Number(rec.last_day))
    const dueDate = `${rec.current_month}-${String(dueDay).padStart(2, '0')}`
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const original = { description: rec.description }
      await conn.execute(
        `INSERT INTO financial_entries
         (account_id,category_id,type,description,amount,due_date,status,recurring,recurrence,reference_type,reference_id)
         VALUES(?,?, 'DESPESA',?,?,?,'PENDENTE',1,'MENSAL','RECURRING',?)
         ON DUPLICATE KEY UPDATE reference_id=reference_id`,
        [rec.account_id, rec.category_id, privacy.pendingFields('financial_entries', original).description, rec.amount, dueDate, referenceId]
      )
      const [created] = await conn.execute('SELECT id FROM financial_entries WHERE reference_id=? FOR UPDATE', [referenceId])
      await privacy.updateFields('financial_entries', created[0].id, original, conn)
      await conn.commit()
    } catch (error) {
      await conn.rollback().catch(() => {})
      throw error
    } finally { conn.release() }
  }
}

async function seedAndScheduleRecurring() {
  try { await generateCurrentRecurring() } catch (error) {
    console.error('Erro ao gerar recorrências:', error)
  }
}

cron.schedule('10 3 * * *', seedAndScheduleRecurring, { timezone: 'America/Sao_Paulo' })

function responderErroVerificacao(res, error) {
  if (error instanceof EmailVerificationError) {
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter))
    return res.status(error.status).json({ success: false, code: error.code, error: error.message, ...(error.retryAfter ? { retry_after: error.retryAfter } : {}) })
  }
  // SQL errors may include query values. Keep personal data and tokens out of logs.
  console.error('Erro na confirmação de e-mail:', error?.code || 'INTERNAL_ERROR')
  return res.status(500).json({ success: false, error: 'Não foi possível concluir a confirmação de e-mail.' })
}

app.get('/api/customer/registration-status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ email_verification_required: true, registration_available: confirmationEmailConfigured() })
})

app.post('/api/customer/register', limitarAutenticacao, async (req,res) => {
  const name=String(req.body?.name || '').trim()
  const email=String(req.body?.email || '').trim().toLowerCase()
  const phone=String(req.body?.phone || '').trim()
  const password=String(req.body?.password || '')
  if(name.length<2||name.length>180) return res.status(400).json({error:'Informe um nome válido.'})
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>255) return res.status(400).json({error:'Informe um e-mail válido.'})
  if(phone.length>40) return res.status(400).json({error:'Informe um telefone válido.'})
  const passwordError=newPasswordError(password)
  if(passwordError) return res.status(400).json({error:passwordError})
  const conn=await db.getConnection()
  try {
    await conn.beginTransaction()
    const [exists]=await conn.execute('SELECT id,name,email,password_hash,active,email_verified_at,private_data FROM customers WHERE email=? LIMIT 1 FOR UPDATE',[privacy.emailForLookup('customers', email)])
    let customer=exists[0] ? privacy.decodeRow('customers', exists[0]) : null
    if(customer) {
      if (!customer.active || customer.email_verified_at || !(await bcrypt.compare(password,customer.password_hash))) {
        await conn.rollback()
        return res.status(409).json({error:'Já existe uma conta com este e-mail.'})
      }
      // Repeating a pending registration only resends the link with the same
      // password. It never changes account identity or overrides credentials.
    } else {
      const passwordHash=await bcrypt.hash(password,12)
      const personal = { name, email, phone }
      const safe = privacy.pendingFields('customers', personal)
      const [result]=await conn.execute('INSERT INTO customers(name,email,password_hash,phone) VALUES(?,?,?,?)',[safe.name,safe.email,passwordHash,safe.phone])
      await privacy.completeInsert('customers', result.insertId, personal, conn)
      customer={id:result.insertId,name,email}
    }
    await issueEmailVerification(conn,customer,{appUrl,sendTransactionalEmail})
    await conn.commit()
    // Registration never issues an authenticated customer session.
    return res.status(202).json({success:true,verification_required:true,message:'Enviamos um link para confirmar seu e-mail. Abra o link e informe a senha escolhida para ativar sua conta.'})
  } catch(error) {
    await conn.rollback().catch(()=>{})
    if (error?.code==='ER_DUP_ENTRY') return res.status(409).json({error:'Já existe uma conta com este e-mail. Tente entrar ou reenviar a confirmação.'})
    return responderErroVerificacao(res,error)
  } finally {
    conn.release()
  }
})

app.post('/api/customer/resend-verification', limitarReenvioEmail, async (req,res) => {
  const email=String(req.body?.email || '').trim().toLowerCase()
  const password=String(req.body?.password || '')
  const generic={success:true,message:'Se os dados estiverem corretos e o e-mail ainda não estiver confirmado, você receberá um novo link.'}
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length>255 || !password) return res.status(202).json(generic)
  const conn=await db.getConnection()
  try {
    await conn.beginTransaction()
    const [rows]=await conn.execute('SELECT id,email,password_hash,active,email_verified_at,private_data FROM customers WHERE email=? LIMIT 1 FOR UPDATE',[privacy.emailForLookup('customers', email)])
    const customer=rows[0] ? privacy.decodeRow('customers', rows[0]) : null
    if (!customer?.active || customer.email_verified_at || !(await bcrypt.compare(password,customer.password_hash))) {
      await conn.rollback()
      return res.status(202).json(generic)
    }
    await issueEmailVerification(conn,customer,{appUrl,sendTransactionalEmail})
    await conn.commit()
    return res.status(202).json(generic)
  } catch(error) {
    await conn.rollback().catch(()=>{})
    return responderErroVerificacao(res,error)
  } finally {
    conn.release()
  }
})

app.post('/api/customer/verify-email', limitarConfirmacaoEmail, async (req,res) => {
  const token=String(req.body?.token || '')
  const password=String(req.body?.password || '')
  const conn=await db.getConnection()
  try {
    await conn.beginTransaction()
    const verified=await consumeEmailVerification(conn,token,password)
    if (!verified) {
      await conn.rollback()
      return res.status(400).json({success:false,code:'VERIFY_EMAIL_INVALID',error:'Link inválido, expirado ou já utilizado, ou senha incorreta. Confira a senha ou solicite uma nova confirmação.'})
    }
    await conn.commit()
    // Confirmation never grants or revives a customer login, including an old
    // session from before verification became mandatory. Preserve owner login.
    if (req.session.customerId) {
      delete req.session.customerId
      if (!req.session.userId) delete req.session.csrfToken
      await salvarSessao(req)
    }
    return res.json({success:true,verified:true,message:'E-mail confirmado. Agora entre na sua conta com seu e-mail e senha.'})
  } catch(error) {
    await conn.rollback().catch(()=>{})
    return responderErroVerificacao(res,error)
  } finally {
    conn.release()
  }
})

app.post('/api/customer/login', limitarAutenticacao, async (req,res) => {
  const email=String(req.body?.email || '').trim().toLowerCase()
  const password=String(req.body?.password || '')
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255 || !password) return res.status(401).json({error:'E-mail ou senha inválidos.'})
  try {
    const rows=await query('SELECT id,name,email,password_hash,phone,active,email_verified_at,private_data FROM customers WHERE email=? LIMIT 1',[privacy.emailForLookup('customers', email)])
    if(!rows.length||!rows[0].active||!(await bcrypt.compare(password,rows[0].password_hash))) return res.status(401).json({error:'E-mail ou senha inválidos.'})
    if (!rows[0].email_verified_at) return res.status(403).json({...verificationRequired,email:rows[0].email})
    await renovarSessao(req)
    req.session.customerId=rows[0].id
    req.session.csrfToken=randomBytes(32).toString('hex')
    configurarPersistenciaSessao(req.session, true)
    await salvarSessao(req)
    res.json({success:true,user:{id:rows[0].id,name:rows[0].name,email:rows[0].email,phone:rows[0].phone},csrfToken:req.session.csrfToken})
  } catch(error) {
    console.error('Erro no login do cliente:',error)
    res.status(500).json({error:'Não foi possível entrar na sua conta.'})
  }
})

app.get('/api/customer/me', async (req,res) => {
  if(!req.session.customerId) return res.status(401).json({success:false,authenticated:false,error:'Não autenticado.'})
  try {
    const rows=await query('SELECT id,name,email,phone,created_at,active,email_verified_at,private_data FROM customers WHERE id=? LIMIT 1',[req.session.customerId])
    if(!rows.length||!rows[0].active) return res.status(401).json({success:false,authenticated:false,error:'Não autenticado.'})
    if (!rows[0].email_verified_at) {
      delete req.session.customerId
      if (!req.session.userId) delete req.session.csrfToken
      await salvarSessao(req)
      return res.status(403).json({...verificationRequired,email:rows[0].email})
    }
    const csrfToken=gerarCsrfToken(req)
    await salvarSessao(req)
    res.json({success:true,authenticated:true,user:{id:rows[0].id,name:rows[0].name,email:rows[0].email,phone:rows[0].phone,created_at:rows[0].created_at},csrfToken})
  } catch(error) {
    console.error('Erro ao carregar conta do cliente:',error)
    res.status(500).json({error:'Não foi possível carregar sua conta.'})
  }
})

app.post('/api/customer/logout', exigirCliente, async (req,res) => {
  delete req.session.customerId
  req.session.csrfToken=randomBytes(32).toString('hex')
  await salvarSessao(req)
  res.json({success:true})
})

app.put('/api/customer/profile', exigirCliente, async (req,res) => {
  const name=String(req.body?.name || '').trim()
  const phone=String(req.body?.phone || '').trim()
  if(name.length<2||name.length>180) return res.status(400).json({error:'Informe um nome válido.'})
  if(phone.length>40) return res.status(400).json({error:'Informe um telefone válido.'})
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    await privacy.updateFields('customers', req.customer.id, { name, phone }, connection)
    await connection.commit()
    res.json({success:true,user:{...req.customer,name,phone}})
  } catch(error) {
    await connection.rollback().catch(() => {})
    console.error('Erro ao atualizar cliente:',error?.code || 'INTERNAL_ERROR')
    res.status(500).json({error:'Não foi possível atualizar seus dados.'})
  } finally { connection.release() }
})

app.get('/api/customer/orders', exigirCliente, async (req,res) => {
  try {
    const orders=await query('SELECT id,code,status,subtotal,shipping_fee,total,created_at,updated_at FROM store_orders WHERE customer_id=? ORDER BY id DESC',[req.customer.id])
    for(const order of orders) {
      order.items=await query('SELECT product_id,product_name AS name,brand,quantity,unit_price,line_total FROM store_order_items WHERE order_id=? ORDER BY id',[order.id])
      order.status_label=({RECEIVED:'Recebido',CONFIRMED:'Confirmado',PREPARING:'Em preparação',SHIPPED:'Enviado',DELIVERED:'Entregue',CANCELLED:'Cancelado'})[order.status]||order.status
    }
    res.json({success:true,orders})
  } catch(error) {
    console.error('Erro ao carregar pedidos:',error)
    res.status(500).json({error:'Não foi possível carregar seus pedidos.'})
  }
})

app.post('/api/store/orders', exigirCliente, async (req,res) => {
  const itemsInput=Array.isArray(req.body?.items)?req.body.items:[]
  if(!itemsInput.length||itemsInput.length>50) return res.status(400).json({error:'Seu carrinho está vazio.'})
  const shipping=req.body?.shipping&&typeof req.body.shipping==='object'?req.body.shipping:{}
  const fields={
    name:String(shipping.name||req.customer.name||'').trim().slice(0,180),
    phone:String(shipping.phone||req.customer.phone||'').trim().slice(0,40),
    postal_code:String(shipping.postal_code||'').trim().slice(0,20),
    street:String(shipping.street||'').trim().slice(0,180),
    number:String(shipping.number||'').trim().slice(0,40),
    complement:String(shipping.complement||'').trim().slice(0,120),
    neighborhood:String(shipping.neighborhood||'').trim().slice(0,120),
    city:String(shipping.city||'').trim().slice(0,120),
    state:String(shipping.state||'').trim().toUpperCase().slice(0,2)
  }
  for(const key of ['name','phone','postal_code','street','number','neighborhood','city','state']) if(!fields[key]) return res.status(400).json({error:'Preencha todos os dados de entrega.'})
  const ids=[...new Set(itemsInput.map(item=>Number(item.product_id)).filter(id=>Number.isInteger(id)&&id>0))]
  if(!ids.length||ids.length!==itemsInput.length) return res.status(400).json({error:'Há itens inválidos ou duplicados no carrinho.'})
  const conn=await db.getConnection()
  try {
    await conn.beginTransaction()
    const placeholders=ids.map(()=>'?').join(',')
    const [products]=await conn.execute('SELECT p.id,p.name,p.brand,p.price,p.stock,p.active,c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id IN ('+placeholders+') AND p.active=1 FOR UPDATE',ids)
    const byId=new Map(products.map(item=>[Number(item.id),item]))
    let subtotal=0
    const lines=[]
    for(const input of itemsInput){
      const product=byId.get(Number(input.product_id))
      const quantity=Number(input.quantity)
      if(!product) throw new Error('Um dos produtos não está mais disponível.')
      if(!Number.isInteger(quantity)||quantity<1||quantity>50) throw new Error('Quantidade inválida para '+product.name+'.')
      if(quantity>Number(product.stock)) throw new Error('Estoque insuficiente para '+product.name+'.')
      const lineTotal=Number(product.price)*quantity
      subtotal+=lineTotal
      lines.push({product_id:Number(product.id),product_name:product.name,brand:product.brand,quantity,unit_price:Number(product.price),line_total:lineTotal})
    }
    const shippingFee=0
    const total=subtotal+shippingFee
    const code='GALEO-'+Date.now().toString(36).toUpperCase().slice(-7)+'-'+randomBytes(2).toString('hex').toUpperCase()
    const insertSql="INSERT INTO store_orders(code,customer_id,customer_name,customer_email,customer_phone,status,subtotal,shipping_fee,total,postal_code,street,number,complement,neighborhood,city,state) VALUES(?,?,?,?,?,'RECEIVED',?,?,?,?,?,?,?,?,?,?)"
    const orderResult=await insertPrivateBusiness(conn, 'store_orders', insertSql,
      [code,req.customer.id,fields.name,req.customer.email,fields.phone,subtotal,shippingFee,total,fields.postal_code,fields.street,fields.number,fields.complement,fields.neighborhood,fields.city,fields.state],
      { customer_name:2, customer_email:3, customer_phone:4, postal_code:8, street:9, number:10, complement:11, neighborhood:12, city:13, state:14 })
    for(const line of lines){
      await conn.execute('INSERT INTO store_order_items(order_id,product_id,product_name,brand,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?)',[orderResult.insertId,line.product_id,line.product_name,line.brand,line.quantity,line.unit_price,line.line_total])
      const [currentRows]=await conn.execute('SELECT stock,cost FROM products WHERE id=? FOR UPDATE',[line.product_id])
      const currentStock=Number(currentRows[0]?.stock || 0)
      const nextStock=currentStock-line.quantity
      if(nextStock<0) throw new Error('Estoque insuficiente para '+line.product_name+'.')
      await conn.execute('UPDATE products SET stock=? WHERE id=?',[nextStock,line.product_id])
      await insertPrivateBusiness(conn, 'stock_movements',
        "INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id) VALUES(?,'SAIDA',?,?,?,?,?,?,NULL)",
        [line.product_id,line.quantity,currentStock,nextStock,'Reserva do pedido '+code,'store-order:'+orderResult.insertId,Number(currentRows[0]?.cost || 0)],
        { reason:4 }
      )
    }
    await audit(null, 'CRIAR', 'pedido_online', orderResult.insertId, { code, total, payment_status: 'PENDING' }, conn)
    await conn.commit()
    const itemHtml=lines.map(line=>'<li>'+escapeHtml(line.product_name)+' × '+line.quantity+' — '+escapeHtml(moneyBR(line.line_total))+'</li>').join('')
    void sendEmailSafely({to:req.customer.email,subject:'Pedido '+code+' recebido',idempotencyKey:'order-customer-'+orderResult.insertId,html:'<div style="font-family:Arial,sans-serif"><h1>Pedido recebido</h1><p>Olá, '+escapeHtml(fields.name)+'</p><p>Seu pedido <strong>'+escapeHtml(code)+'</strong> foi registrado</p><ul>'+itemHtml+'</ul><p><strong>Total: '+escapeHtml(moneyBR(total))+'</strong></p></div>'})
    if(storeNotificationEmail) void sendEmailSafely({to:storeNotificationEmail,subject:'Novo pedido '+code,idempotencyKey:'order-store-'+orderResult.insertId,html:'<div style="font-family:Arial,sans-serif"><h1>Novo pedido '+escapeHtml(code)+'</h1><p>Cliente: '+escapeHtml(fields.name)+' — '+escapeHtml(req.customer.email)+'</p><ul>'+itemHtml+'</ul><p><strong>Total: '+escapeHtml(moneyBR(total))+'</strong></p></div>'})
    res.json({success:true,payment_configured:mercadoPagoOnlineConfigured(),order:{id:orderResult.insertId,code,status:'RECEIVED',payment_status:'PENDING',subtotal,shipping_fee:shippingFee,total}})
  } catch(error) {
    await conn.rollback().catch(()=>{})
    console.error('Erro ao criar pedido:',error)
    res.status(400).json({error:error.message||'Não foi possível registrar seu pedido.'})
  } finally { conn.release() }
})

app.post('/api/store/orders/:id/payment', exigirCliente, async (req,res) => {
  const orderId=Number(req.params.id)
  if(!Number.isInteger(orderId)||orderId<=0) return res.status(400).json({error:'Pedido inválido.'})
  try {
    const orders=await query('SELECT * FROM store_orders WHERE id=? AND customer_id=? LIMIT 1',[orderId,req.customer.id])
    if(!orders.length) return res.status(404).json({error:'Pedido não encontrado.'})
    const order=orders[0]
    if(order.sale_id || order.payment_status==='APPROVED') return res.json({success:true,paid:true,order:{id:order.id,code:order.code,status:order.status,payment_status:order.payment_status}})
    if(order.status==='CANCELLED') return res.status(409).json({error:'Este pedido está cancelado.'})
    if (!mercadoPagoOnlineConfigured()) return res.json({success:true,payment_configured:false,checkout_url:'',order:{id:order.id,code:order.code,status:order.status,payment_status:order.payment_status}})
    const existing=await query("SELECT id,private_data,provider_reference,payment_url FROM payments WHERE store_order_id=? AND provider='MERCADO_PAGO' AND status='PENDING' ORDER BY id DESC LIMIT 1",[orderId])
    if(existing.length && existing[0].payment_url) return res.json({success:true,checkout_url:existing[0].payment_url,payment_reference:existing[0].provider_reference})
    const items=await query('SELECT product_id,product_name,quantity,unit_price,line_total FROM store_order_items WHERE order_id=? ORDER BY id',[orderId])
    const mpOrder=await createMercadoPagoOnlineOrder({order,items,idempotencyKey:'galeo-order-'+orderId})
    const conn=await db.getConnection()
    try {
      await conn.beginTransaction()
      const [currentOrders] = await conn.execute('SELECT * FROM store_orders WHERE id=? AND customer_id=? FOR UPDATE', [orderId, req.customer.id])
      const currentOrder = privacy.decodeRow('store_orders', currentOrders[0])
      if (!currentOrder) throw new Error('Pedido não encontrado.')
      if (currentOrder.status === 'CANCELLED' || currentOrder.payment_status === 'REFUNDED') {
        await conn.rollback()
        return res.status(409).json({error:'Este pedido está cancelado.'})
      }
      if (currentOrder.sale_id || currentOrder.payment_status === 'APPROVED') {
        await conn.commit()
        return res.json({success:true,paid:true,order:{id:currentOrder.id,code:currentOrder.code,status:currentOrder.status,payment_status:currentOrder.payment_status}})
      }
      const paymentPrivate = { raw_payload:JSON.stringify(mpOrder), payment_url:String(mpOrder.checkout_url||'') }
      const pendingPayment = privacy.pendingFields('payments', paymentPrivate)
      await conn.execute(
        "INSERT INTO payments(channel,store_order_id,method,provider,provider_reference,status,amount,idempotency_key,raw_payload,payment_url) VALUES('ONLINE',?,'CHECKOUT_PRO','MERCADO_PAGO',?,'PENDING',?,?,?,?) ON DUPLICATE KEY UPDATE provider_reference=VALUES(provider_reference),raw_payload=VALUES(raw_payload),payment_url=VALUES(payment_url)",
        [orderId,String(mpOrder.id||''),Number(order.total),'galeo-order-'+orderId,pendingPayment.raw_payload,pendingPayment.payment_url]
      )
      const [paymentRows] = await conn.execute('SELECT id FROM payments WHERE idempotency_key=? FOR UPDATE', ['galeo-order-'+orderId])
      await privacy.updateFields('payments', paymentRows[0].id, paymentPrivate, conn)
      await conn.execute("UPDATE store_orders SET payment_provider='MERCADO_PAGO',payment_method='CHECKOUT_PRO',payment_reference=?,payment_status='PENDING' WHERE id=?",[String(mpOrder.id||''),orderId])
      await privacy.updateFields('store_orders', orderId, { payment_url:String(mpOrder.checkout_url||'') }, conn)
      await conn.commit()
    }catch(error){ await conn.rollback().catch(()=>{}); throw error } finally { conn.release() }
    res.json({success:true,checkout_url:String(mpOrder.checkout_url||''),payment_reference:String(mpOrder.id||''),order:{id:order.id,code:order.code,payment_status:'PENDING'}})
  } catch(error) {
    console.error('Erro ao iniciar pagamento Mercado Pago:',error)
    res.status(400).json({error:error.message||'Não foi possível iniciar o pagamento.'})
  }
})

app.post('/api/integrations/mercado-pago/webhook', async (req,res) => {
  const secret=String(process.env.MERCADO_PAGO_WEBHOOK_SECRET||'').trim()
  if(!secret) return res.status(503).json({error:'Webhook Mercado Pago ainda não está configurado.'})
  const signature=req.get('x-signature')||''
  const requestId=req.get('x-request-id')||''
  const dataId=String(req.query['data.id']||req.body?.data?.id||'')
  const valid=validateMercadoPagoWebhookSignature({signature,requestId,dataId,secret})
  if(!valid) return res.status(401).json({error:'Assinatura de webhook inválida.'})
  const eventId=String(req.body?.id||req.get('x-request-id')||('mp-'+dataId+'-'+String(req.body?.date_created||Date.now())))
  const eventType=String(req.body?.type||req.query.type||'order')
  const existing=await query('SELECT id FROM integration_events WHERE provider=? AND event_id=? AND processed_at IS NOT NULL LIMIT 1',['MERCADO_PAGO',eventId])
  if(existing.length) return res.status(200).json({received:true,duplicate:true})
  try {
    if(!dataId) return res.status(200).json({received:true,ignored:true})
    const mpOrder=await getMercadoPagoOrder(dataId)
    const result=await processarNotificacaoMercadoPago({eventId,eventType,mpOrder})
    return res.status(200).json({received:true,...result})
  } catch(error) {
    console.error('Erro no webhook Mercado Pago:',error)
    return res.status(500).json({error:'Não foi possível processar o webhook.'})
  }
})

app.post('/api/integrations/distributor/webhook', async (req,res) => {
  const secret=String(process.env.DISTRIBUTOR_WEBHOOK_SECRET||'').trim()
  if(!secret) return res.status(503).json({error:'Integração da distribuidora ainda não está configurada.'})
  const provided=String(req.get('x-distributor-webhook-secret')||req.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  if(!provided || provided!==secret) return res.status(401).json({error:'Credencial de webhook da distribuidora inválida.'})
  const eventId=String(req.body?.event_id||req.body?.id||req.get('x-event-id')||'')
  const orderCode=String(req.body?.order_code||req.body?.external_reference||req.body?.reference||'').trim()
  const nextStatus=String(req.body?.status||req.body?.event||'').trim().toUpperCase()
  const statusMap={RECEIVED:'RECEIVED',CONFIRMED:'CONFIRMED',PREPARING:'PREPARING',READY:'PREPARING',SHIPPED:'SHIPPED',IN_TRANSIT:'SHIPPED',DELIVERED:'DELIVERED',CANCELLED:'CANCELLED'}
  const mapped=statusMap[nextStatus]
  if(!orderCode || !mapped) return res.status(400).json({error:'Evento da distribuidora incompleto.'})
  const uniqueEventId=eventId||('dist-'+orderCode+'-'+mapped+'-'+String(Date.now()))
  const rank={RECEIVED:1,CONFIRMED:2,PREPARING:3,SHIPPED:4,DELIVERED:5,CANCELLED:99}
  try {
    const conn=await db.getConnection()
    let customer=null
    try {
      await conn.beginTransaction()
      if (!(await registrarEventoIntegracao(conn, 'DISTRIBUTOR', uniqueEventId, nextStatus, req.body))) {
        await conn.commit()
        return res.status(200).json({received:true,duplicate:true})
      }
      const [rows]=await conn.execute('SELECT * FROM store_orders WHERE code=? FOR UPDATE',[orderCode])
      if(!rows.length) throw new Error('Pedido não encontrado.')
      const order=privacy.decodeRow('store_orders', rows[0])
      const terminal = ['CANCELLED', 'DELIVERED'].includes(order.status)
      const paidCancellation = mapped === 'CANCELLED' && (order.payment_status === 'APPROVED' || order.sale_id)
      if ((terminal && mapped !== order.status) ||
          (mapped !== 'CANCELLED' && rank[mapped] < rank[order.status]) || paidCancellation) {
        await conn.execute('UPDATE integration_events SET processed_at=NOW() WHERE provider=? AND event_id=?',['DISTRIBUTOR',uniqueEventId])
        await conn.commit()
        return res.status(200).json({received:true,ignored:true,reason:paidCancellation?'estorno_pagamento_necessario':'status_regressivo'})
      }
      if (mapped === 'CANCELLED') await devolverReservaPedido(conn, order)
      await conn.execute("UPDATE store_orders SET status=?,payment_status=CASE WHEN ?='CANCELLED' THEN 'CANCELLED' ELSE payment_status END WHERE id=?",[mapped,mapped,order.id])
      if (mapped !== order.status) customer={email:order.customer_email,name:order.customer_name}
      await conn.execute('UPDATE integration_events SET processed_at=NOW() WHERE provider=? AND event_id=?',['DISTRIBUTOR',uniqueEventId])
      await conn.commit()
    }catch(error){await conn.rollback().catch(()=>{});throw error}finally{conn.release()}
    if(customer?.email && ['PREPARING','SHIPPED','DELIVERED'].includes(mapped)) void sendEmailSafely({
      to:customer.email,
      subject:'Pedido '+orderCode+' — '+({PREPARING:'em preparação',SHIPPED:'enviado',DELIVERED:'entregue'})[mapped],
      idempotencyKey:'distributor-'+uniqueEventId,
      html:'<div style="font-family:Arial,sans-serif"><h1>Atualização do pedido</h1><p>Olá, '+escapeHtml(customer.name)+'</p><p>Seu pedido <strong>'+escapeHtml(orderCode)+'</strong> está '+escapeHtml(({PREPARING:'em preparação',SHIPPED:'a caminho',DELIVERED:'entregue'})[mapped])+'</p></div>'
    })
    return res.status(200).json({received:true,status:mapped})
  } catch(error) {
    console.error('Erro no webhook da distribuidora:',error)
    return res.status(500).json({error:'Não foi possível processar o webhook da distribuidora.'})
  }
})

app.use('/api/admin', exigirLogin, exigirOwner)
app.get('/api/admin/security-status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    email_confirmation_configured: confirmationEmailConfigured(),
    data_encryption_enabled: privacy.enabled,
    mysql_tls: { enabled: DB_SSL, certificate_verified: DB_SSL && DB_SSL_REJECT_UNAUTHORIZED },
    storage_and_backups: 'PROVIDER_VERIFICATION_REQUIRED'
  })
})
app.get('/api/admin/store-orders', async (req,res) => {
  try {
    const orders=await query('SELECT id,private_data,code,customer_id,customer_name,customer_email,customer_phone,status,payment_status,payment_provider,payment_method,payment_reference,payment_url,paid_at,sale_id,subtotal,shipping_fee,total,postal_code,street,number,complement,neighborhood,city,state,created_at,updated_at FROM store_orders ORDER BY id DESC LIMIT 500')
    for(const order of orders){
      order.items=await query('SELECT product_id,product_name,brand,quantity,unit_price,line_total FROM store_order_items WHERE order_id=? ORDER BY id',[order.id])
      order.status_label=({RECEIVED:'Recebido',CONFIRMED:'Confirmado',PREPARING:'Em preparação',SHIPPED:'Enviado',DELIVERED:'Entregue',CANCELLED:'Cancelado'})[order.status]||order.status
    }
    res.json(orders)
  } catch(error){
    console.error('Erro ao listar pedidos online:',error)
    res.status(500).json({error:'Não foi possível carregar os pedidos online.'})
  }
})

app.get('/api/admin/store-orders/:id', async (req,res) => {
  try {
    const id=Number(req.params.id)
    const rows=await query('SELECT * FROM store_orders WHERE id=? LIMIT 1',[id])
    if(!rows.length) return res.status(404).json({error:'Pedido não encontrado.'})
    const items=await query('SELECT product_id,product_name,brand,quantity,unit_price,line_total FROM store_order_items WHERE order_id=? ORDER BY id',[id])
    res.json({...rows[0],items})
  } catch(error){
    console.error('Erro ao detalhar pedido online:',error)
    res.status(500).json({error:'Não foi possível carregar o pedido.'})
  }
})

app.patch('/api/admin/store-orders/:id/status', async (req,res) => {
  const id=Number(req.params.id)
  const status=String(req.body?.status || '').trim().toUpperCase()
  const allowed=['RECEIVED','CONFIRMED','PREPARING','SHIPPED','DELIVERED','CANCELLED']
  if(!allowed.includes(status)) return res.status(400).json({error:'Status de pedido inválido.'})

  const conn=await db.getConnection()
  try{
    await conn.beginTransaction()
    const [orderRows]=await conn.execute('SELECT * FROM store_orders WHERE id=? FOR UPDATE',[id])
    if(!orderRows.length) throw new Error('Pedido não encontrado.')
    const order=privacy.decodeRow('store_orders', orderRows[0])
    if(order.status==='CANCELLED' && status!=='CANCELLED') throw new Error('Pedido cancelado não pode voltar ao fluxo.')
    if(order.status==='DELIVERED' && status!=='DELIVERED') throw new Error('Pedido entregue não pode voltar ao fluxo.')

    if(status==='CANCELLED' && order.status!=='CANCELLED'){
      if(order.payment_status==='APPROVED' || order.sale_id) throw new Error('Pagamento aprovado não pode ser cancelado por este painel. O estorno deve ser processado no Mercado Pago.')
      await devolverReservaPedido(conn, order, req.admin.id)
    }

    await conn.execute("UPDATE store_orders SET status=?,payment_status=CASE WHEN ?='CANCELLED' THEN 'CANCELLED' ELSE payment_status END WHERE id=?",[status,status,id])
    await audit(req.admin.id,status==='CANCELLED'?'CANCELAR':'ATUALIZAR','pedido_online',id,{code:order.code,from:order.status,to:status},conn)
    await conn.commit()
    res.json({success:true,id,status})
  }catch(error){
    await conn.rollback().catch(()=>{})
    console.error('Erro ao atualizar pedido online:',error)
    res.status(400).json({error:error.message||'Não foi possível atualizar o pedido.'})
  }finally{conn.release()}
})


app.get('/api/admin/home', exigirLogin, exigirOwner, async (req, res) => {
  try {
    const rows = await query('SELECT section_key,section_type,sort_order,visible,draft_content,published_content,updated_by,published_by,updated_at,published_at FROM home_sections ORDER BY sort_order,id')
    res.json({ sections: rows.map((row) => ({ key: row.section_key, type: row.section_type, order: Number(row.sort_order), visible: Boolean(row.visible), draft: typeof row.draft_content === 'string' ? JSON.parse(row.draft_content) : row.draft_content, published: typeof row.published_content === 'string' ? JSON.parse(row.published_content) : row.published_content, updated_by: row.updated_by, published_by: row.published_by, updated_at: row.updated_at, published_at: row.published_at })) })
  } catch (error) {
    console.error('Erro ao carregar CMS da home:', error)
    res.status(500).json({ error: 'Não foi possível carregar o conteúdo administrativo da home.' })
  }
})

app.put('/api/admin/home/:key', exigirLogin, exigirOwner, async (req, res) => {
  const key = String(req.params.key || '').trim()
  const allowedKeys = ['hero','utility','categories','featured_products','campaigns','manifesto','newsletter']
  if (!allowedKeys.includes(key)) return res.status(400).json({ error: 'Seção de home inválida.' })
  const content = req.body?.content
  if (!content || typeof content !== 'object' || Array.isArray(content)) return res.status(400).json({ error: 'O conteúdo da seção deve ser um objeto JSON válido.' })
  const payload = JSON.stringify(content)
  if (Buffer.byteLength(payload, 'utf8') > 100 * 1024) return res.status(413).json({ error: 'O conteúdo desta seção excede o limite de 100 KB.' })
  try {
    const rows = await query('SELECT id FROM home_sections WHERE section_key=? LIMIT 1', [key])
    if (!rows.length) return res.status(404).json({ error: 'Seção de home não encontrada.' })
    const nextVisible = req.body?.visible === undefined ? null : (req.body.visible ? 1 : 0)
    const nextOrderRaw = req.body?.order
    const nextOrder = nextOrderRaw === undefined ? null : Number(nextOrderRaw)
    if (nextOrder !== null && (!Number.isInteger(nextOrder) || nextOrder < 0 || nextOrder > 999)) return res.status(400).json({ error: 'A ordem da seção deve ficar entre 0 e 999.' })
    if (nextVisible === null && nextOrder === null) {
      await query('UPDATE home_sections SET draft_content=?, updated_by=? WHERE section_key=?', [payload, req.admin.id, key])
    } else {
      await query(
        `UPDATE home_sections
         SET draft_content=?,
             visible=COALESCE(?, visible),
             sort_order=COALESCE(?, sort_order),
             updated_by=?
         WHERE section_key=?`,
        [payload, nextVisible, nextOrder, req.admin.id, key]
      )
    }
    res.json({ success: true, key, saved_as: 'draft' })
  } catch (error) {
    console.error('Erro ao salvar rascunho da home:', error)
    res.status(500).json({ error: 'Não foi possível salvar o conteúdo da home.' })
  }
})


app.post('/api/admin/home/publish', exigirLogin, exigirOwner, async (req, res) => {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      'UPDATE home_sections SET published_content=draft_content, published_sort_order=sort_order, published_visible=visible, published_by=?, published_at=NOW() WHERE id IS NOT NULL',
      [req.admin.id]
    )
    await conn.execute('UPDATE home_settings SET setting_value=draft_value WHERE draft_value IS NOT NULL')
    await audit(req.admin.id, 'PUBLICAR', 'home', null, { sections:'all' }, conn)
    await conn.commit()
    res.json({ success:true, published_at:new Date().toISOString() })
  } catch (error) {
    await conn.rollback().catch(() => {})
    console.error('Erro ao publicar Home:', error)
    res.status(500).json({ error: 'Não foi possível publicar a Home.' })
  } finally {
    conn.release()
  }
})

app.get('/api/admin/home/settings', exigirLogin, exigirOwner, async (req, res) => {
  try {
    const rows = await query('SELECT setting_key,COALESCE(draft_value,setting_value) AS setting_value FROM home_settings ORDER BY setting_key')
    res.json({ settings: rows.map((row) => ({ key: row.setting_key, value: typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : row.setting_value })) })
  } catch (error) {
    console.error('Erro ao carregar configurações do CMS:', error)
    res.status(500).json({ error: 'Não foi possível carregar as configurações do CMS.' })
  }
})

app.put('/api/admin/home/settings/:key', exigirLogin, exigirOwner, async (req, res) => {
  const key = String(req.params.key || '').trim()
  const value = req.body?.value
  const allowedKeys = ['campaign_defaults','storefront_visual_defaults','navigation','footer']
  if (!allowedKeys.includes(key)) return res.status(400).json({ error:'Configuração inválida.' })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return res.status(400).json({ error:'A configuração deve ser um objeto JSON válido.' })

  let setting = value

  if (key === 'campaign_defaults') {
    const effects = ['static','zoom','pan-horizontal','pan-vertical','parallax','ken-burns']
    const transitions = ['fade','slide','crossfade']
    const speeds = ['slow','normal','fast']
    const effect = effects.includes(String(value.effect)) ? String(value.effect) : 'zoom'
    const transition = transitions.includes(String(value.transition)) ? String(value.transition) : 'crossfade'
    const speed = speeds.includes(String(value.speed)) ? String(value.speed) : 'slow'
    const duration = Number(value.duration_seconds)
    if (!Number.isFinite(duration) || duration < 2 || duration > 30) return res.status(400).json({ error:'A duração da campanha deve ficar entre 2 e 30 segundos.' })
    setting = { effect, transition, speed, duration_seconds: duration }
  }

  if (key === 'storefront_visual_defaults') {
    const palette = value.palette && typeof value.palette === 'object' ? value.palette : {}
    const validColor = (color) => typeof color === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\))$/i.test(color.trim())
    const safe = {}
    for (const paletteKey of ['background','surface','surface_alt','text','muted','accent','accent_soft','accent_deep','line']) {
      if (palette[paletteKey] !== undefined) {
        if (!validColor(palette[paletteKey])) return res.status(400).json({ error:'Cor inválida em ' + paletteKey + '.' })
        safe[paletteKey] = String(palette[paletteKey]).trim()
      }
    }
    setting = { ...value, visual_direction:'editorial_multibrand', theme:['dark','light'].includes(String(value.theme)) ? String(value.theme) : 'dark', palette:safe }
  }

  if (key === 'navigation') {
    const items = Array.isArray(value.items) ? value.items.slice(0,8).map((item) => ({ label:String(item?.label || '').trim().slice(0,80), url:String(item?.url || '/shop').trim().slice(0,300) })).filter((item) => item.label) : []
    setting = { items }
  }

  if (key === 'footer') {
    setting = { brand:String(value.brand || 'GALEO STORE').trim().slice(0,120), location:String(value.location || 'São Paulo / BR').trim().slice(0,120), year:String(value.year || '2026').trim().slice(0,12) }
  }

  try {
    await query("INSERT INTO home_settings(setting_key,setting_value,draft_value,updated_by) VALUES(?,JSON_OBJECT(),?,?) ON DUPLICATE KEY UPDATE draft_value=VALUES(draft_value), updated_by=VALUES(updated_by)", [key, JSON.stringify(setting), req.admin.id])
    res.json({ success:true, key, value:setting, saved_as:'draft' })
  } catch (error) {
    console.error('Erro ao salvar configuração do CMS:', error)
    res.status(500).json({ error:'Não foi possível salvar a configuração do CMS.' })
  }
})

app.get('/api/admin/dashboard', exigirLogin, async (req, res) => {
  try {
    await generateCurrentRecurring()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0,0,0,0)
    const currentMonth = monthStart.toISOString().slice(0,10)

    const [productSummary, stockSummary, salesSummary, incomeSummary, expenseSummary, payableSummary, receivableSummary] = await Promise.all([
      query(`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM(stock),0) AS stock,
          SUM(CASE WHEN stock<=min_stock AND active=1 THEN 1 ELSE 0 END) AS low_stock
        FROM products
      `),
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN type='ENTRADA' THEN quantity ELSE 0 END),0) AS entradas,
          COALESCE(SUM(CASE WHEN type='SAIDA' AND quantity>0 THEN quantity ELSE 0 END),0) AS saidas
        FROM stock_movements
        WHERE created_at>=?
      `, [currentMonth]),
      query(
        "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM sales WHERE status='PAGA' AND sold_at>=?",
        [currentMonth + ' 00:00:00']
      ),
      query(`
        SELECT COALESCE(SUM(amount),0) AS total
        FROM financial_entries
        WHERE type='RECEITA' AND status='PAGO'
          AND DATE(COALESCE(paid_at,created_at))>=?
          AND COALESCE(reference_type,'')<>'VENDA'
      `, [currentMonth]),
      query(`
        SELECT COALESCE(SUM(amount),0) AS total
        FROM financial_entries
        WHERE type='DESPESA' AND status='PAGO' AND DATE(COALESCE(paid_at,created_at))>=?
      `, [currentMonth]),
      query(`SELECT COALESCE(SUM(amount),0) AS total FROM financial_entries WHERE type='DESPESA' AND status='PENDENTE'`),
      query(`SELECT COALESCE(SUM(amount),0) AS total FROM financial_entries WHERE type='RECEITA' AND status='PENDENTE'`)
    ])

    res.json({
      products: {
        count: Number(productSummary[0]?.count || 0),
        stock: Number(productSummary[0]?.stock || 0),
        low_stock: Number(productSummary[0]?.low_stock || 0)
      },
      stock: {
        entradas: Number(stockSummary[0]?.entradas || 0),
        saidas: Number(stockSummary[0]?.saidas || 0)
      },
      sales: {
        count: Number(salesSummary[0]?.count || 0),
        total: Number(salesSummary[0]?.total || 0)
      },
      income: Number(incomeSummary[0]?.total || 0),
      expense: Number(expenseSummary[0]?.total || 0),
      payable: Number(payableSummary[0]?.total || 0),
      receivable: Number(receivableSummary[0]?.total || 0)
    })
  } catch (error) {
    console.error('Erro no dashboard:', error)
    res.status(500).json({ error: 'Não foi possível carregar o dashboard.' })
  }
})


app.get('/api/admin/sales', exigirLogin, async (req, res) => {
  try {
    const rows = await query('SELECT s.*, COUNT(si.id) AS items_count FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id GROUP BY s.id ORDER BY s.sold_at DESC, s.id DESC LIMIT 500')
    res.json(rows)
  } catch (error) {
    console.error('Erro ao listar vendas:', error)
    res.status(500).json({ error: 'Não foi possível carregar as vendas.' })
  }
})

app.get('/api/admin/sales/:id', exigirLogin, async (req, res) => {
  try {
    const saleId = Number(req.params.id)
    const saleRows = await query('SELECT * FROM sales WHERE id=? LIMIT 1', [saleId])
    if (!saleRows.length) return res.status(404).json({ error: 'Venda não encontrada.' })
    const items = await query('SELECT si.*, p.name AS product, p.brand FROM sale_items si INNER JOIN products p ON p.id=si.product_id WHERE si.sale_id=? ORDER BY si.id', [saleId])
    res.json({ ...saleRows[0], items })
  } catch (error) {
    console.error('Erro ao detalhar venda:', error)
    res.status(500).json({ error: 'Não foi possível carregar a venda.' })
  }
})

app.post('/api/admin/sales', exigirLogin, async (req, res) => {
  const body = req.body || {}
  if (body.expected_total !== undefined && (!Number.isFinite(Number(body.expected_total)) || Number(body.expected_total) < 0)) {
    return res.status(400).json({ error: 'Total da venda inválido.' })
  }
  const clientReference = String(body.client_reference || '').trim() || null
  if (clientReference && !/^[A-Za-z0-9_-]{8,80}$/.test(clientReference)) {
    return res.status(400).json({ error: 'Referência da venda inválida.' })
  }
  if (clientReference) {
    const existing = await query('SELECT * FROM sales WHERE user_id=? AND client_reference=? LIMIT 1', [req.admin.id, clientReference])
    if (existing.length) return res.json(existing[0])
  }
  const rawItems = Array.isArray(body.items) ? body.items : []
  if (!rawItems.length) return res.status(400).json({ error: 'Adicione pelo menos um produto à venda.' })

  const merged = new Map()
  for (const item of rawItems) {
    const productId = Number(item?.product_id)
    const quantity = Number(item?.quantity)
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Item de venda inválido.' })
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity)
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const paymentMethods = ['PIX','CARTAO_CREDITO','CARTAO_DEBITO','DINHEIRO','TRANSFERENCIA','OUTRO']
    const paymentMethod = paymentMethods.includes(String(body.payment_method || '')) ? String(body.payment_method) : 'PIX'

    const saleResult = await insertPrivateBusiness(conn, 'sales',
      "INSERT INTO sales(code,customer_name,payment_method,total,status,notes,user_id,client_reference) VALUES(?,?,?,?, 'PAGA',?,?,?)",
      ['PENDING', String(body.customer_name || '').trim(), paymentMethod, 0, String(body.notes || '').trim(), req.admin.id, clientReference],
      { customer_name:1, notes:4 }
    )

    const saleId = saleResult.insertId
    const saleCode = 'VDA-' + String(saleId).padStart(6, '0')
    let total = 0

    for (const [productId, quantity] of merged.entries()) {
      const [productRows] = await conn.execute('SELECT * FROM products WHERE id=? AND active=1 FOR UPDATE', [productId])
      if (!productRows.length) throw new Error('Produto não encontrado ou inativo.')
      const product = productRows[0]
      const stock = Number(product.stock)
      if (stock < quantity) throw new Error('Estoque insuficiente para ' + product.name + '. Disponível: ' + stock + '.')

      const unitPrice = Number(product.price)
      const unitCost = Number(product.cost)
      const lineTotal = unitPrice * quantity
      total += lineTotal

      await conn.execute(
        'INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost,line_total) VALUES(?,?,?,?,?,?)',
        [saleId, productId, quantity, unitPrice, unitCost, lineTotal]
      )

      const stockAfter = stock - quantity
      await conn.execute('UPDATE products SET stock=? WHERE id=?', [stockAfter, productId])
      await insertPrivateBusiness(conn, 'stock_movements',
        "INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id) VALUES(?,'SAIDA',?,?,?,?,?,?,?)",
        [productId, quantity, stock, stockAfter, 'Venda ' + saleCode, 'sale:' + saleId, unitCost, req.admin.id],
        { reason:4 }
      )
    }

    await conn.execute('UPDATE sales SET code=?, total=? WHERE id=?', [saleCode, total, saleId])
    if (body.expected_total !== undefined && Math.round(Number(body.expected_total) * 100) !== Math.round(total * 100)) {
      const error = new Error('Os preços foram atualizados. Confira o novo total antes de confirmar o pagamento.')
      error.status = 409
      throw error
    }

    const [categoryRows] = await conn.execute("SELECT id FROM financial_categories WHERE name='Vendas' AND type='RECEITA' LIMIT 1")
    const [accountRows] = await conn.execute("SELECT id FROM financial_accounts WHERE name='Caixa da loja' LIMIT 1")
    if (!categoryRows.length || !accountRows.length) throw new Error('Categoria ou conta financeira da venda não encontrada.')

    await insertPrivateBusiness(conn, 'financial_entries',
      "INSERT INTO financial_entries(account_id,category_id,type,description,amount,due_date,paid_at,status,recurring,reference_type,reference_id,user_id) VALUES(?,?,?,?,?,CURDATE(),NOW(),'PAGO',0,'VENDA',?,?)",
      [accountRows[0].id, categoryRows[0].id, 'RECEITA', 'Venda ' + saleCode, total, 'sale:' + saleId, req.admin.id],
      { description:3 }
    )

    await audit(req.admin.id, 'CRIAR', 'venda', saleId, { code: saleCode, total, items: Array.from(merged.entries()) }, conn)
    const inserted = await query('SELECT * FROM sales WHERE id=? LIMIT 1', [saleId], conn)
    await conn.commit()
    res.status(201).json(inserted[0])
  } catch (error) {
    await conn.rollback()
    if (clientReference && error.code === 'ER_DUP_ENTRY') {
      const existing = await query('SELECT * FROM sales WHERE user_id=? AND client_reference=? LIMIT 1', [req.admin.id, clientReference])
      if (existing.length) return res.json(existing[0])
    }
    console.error('Erro ao registrar venda:', error)
    res.status(error.status || 400).json({ error: error.message || 'Não foi possível registrar a venda.' })
  } finally {
    conn.release()
  }
})

app.patch('/api/admin/sales/:id/cancel', exigirLogin, async (req, res) => {
  const saleId = Number(req.params.id)
  const conn = await db.getConnection()

  try {
    await conn.beginTransaction()

    const [saleRows] = await conn.execute('SELECT * FROM sales WHERE id=? FOR UPDATE', [saleId])
    if (!saleRows.length) throw new Error('Venda não encontrada.')
    const sale = privacy.decodeRow('sales', saleRows[0])
    if (sale.status === 'CANCELADA') throw new Error('Esta venda já está cancelada.')
    const [onlineOrders] = await conn.execute('SELECT id FROM store_orders WHERE sale_id=? LIMIT 1', [saleId])
    if (onlineOrders.length) throw new Error('Esta venda pertence a um pedido online. O estorno deve ser processado no Mercado Pago.')

    const [items] = await conn.execute('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', [saleId])
    for (const item of items) {
      const [productRows] = await conn.execute('SELECT * FROM products WHERE id=? FOR UPDATE', [item.product_id])
      if (!productRows.length) throw new Error('Produto da venda não encontrado.')
      const product = productRows[0]
      const stockBefore = Number(product.stock)
      const stockAfter = stockBefore + Number(item.quantity)

      await conn.execute('UPDATE products SET stock=? WHERE id=?', [stockAfter, item.product_id])
      await insertPrivateBusiness(conn, 'stock_movements',
        "INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id) VALUES(?,'ENTRADA',?,?,?,?,?,?,?)",
        [item.product_id, item.quantity, stockBefore, stockAfter, 'Estorno da venda ' + sale.code, 'sale:' + saleId, Number(item.unit_cost || 0), req.admin.id],
        { reason:4 }
      )
    }

    await conn.execute("UPDATE sales SET status='CANCELADA' WHERE id=?", [saleId])
    await conn.execute("UPDATE financial_entries SET status='CANCELADO', paid_at=NULL WHERE reference_type='VENDA' AND reference_id=?", ['sale:' + saleId])

    await audit(req.admin.id, 'CANCELAR', 'venda', saleId, { code: sale.code, total: Number(sale.total) }, conn)
    await conn.commit()
    res.json({ success: true, id: saleId })
  } catch (error) {
    await conn.rollback()
    console.error('Erro ao cancelar venda:', error)
    res.status(400).json({ error: error.message || 'Não foi possível cancelar a venda.' })
  } finally {
    conn.release()
  }
})


function cloudinaryConfigurado() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  )
}

function enviarParaCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error)
      resolve(result)
    })
    Readable.from(buffer).pipe(stream)
  })
}

app.get('/api/admin/products/:id/media', exigirLogin, async (req, res) => {
  const productId = Number(req.params.id)
  try {
    const product = await query('SELECT id FROM products WHERE id=? LIMIT 1', [productId])
    if (!product.length) return res.status(404).json({ error: 'Produto não encontrado.' })
    const media = await query(
      'SELECT id,product_id,media_type,url,public_id,width,height,duration,sort_order,created_at FROM product_media WHERE product_id=? ORDER BY sort_order,id',
      [productId]
    )
    res.json(media)
  } catch (error) {
    console.error('Erro ao listar mídia:', error)
    res.status(500).json({ error: 'Não foi possível carregar a mídia do produto.' })
  }
})

app.post('/api/admin/products/:id/media', exigirLogin, mediaUpload.array('media', 8), async (req, res) => {
  const productId = Number(req.params.id)
  if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Produto inválido.' })
  if (!req.files?.length) return res.status(400).json({ error: 'Selecione pelo menos um arquivo.' })
  if (!cloudinaryConfigurado()) {
    return res.status(503).json({
      error: 'Upload de mídia ainda não configurado no servidor. Configure o Cloudinary no Render.'
    })
  }

  try {
    const product = await query('SELECT id,image,video FROM products WHERE id=? LIMIT 1', [productId])
    if (!product.length) return res.status(404).json({ error: 'Produto não encontrado.' })

    const existing = await query('SELECT COALESCE(MAX(sort_order),-1) AS max_order FROM product_media WHERE product_id=?', [productId])
    let sortOrder = Number(existing[0]?.max_order ?? -1) + 1
    const inserted = []

    for (const file of req.files) {
      const mediaType = String(file.mimetype).startsWith('video/') ? 'video' : 'image'
      const result = await enviarParaCloudinary(file.buffer, {
        folder: 'galeo-store/products/' + productId,
        resource_type: 'auto',
        type: 'upload',
        context: { product_id: String(productId) }
      })

      const [insertResult] = await db.execute(
        'INSERT INTO product_media(product_id,media_type,url,public_id,width,height,duration,sort_order) VALUES(?,?,?,?,?,?,?,?)',
        [
          productId,
          mediaType,
          result.secure_url || result.url,
          result.public_id,
          result.width || null,
          result.height || null,
          result.duration || null,
          sortOrder++
        ]
      )

      inserted.push({
        id: insertResult.insertId,
        product_id: productId,
        media_type: mediaType,
        url: result.secure_url || result.url,
        public_id: result.public_id,
        width: result.width || null,
        height: result.height || null,
        duration: result.duration || null
      })

      if (mediaType === 'image' && !product[0].image) {
        await db.execute('UPDATE products SET image=? WHERE id=?', [result.secure_url || result.url, productId])
        product[0].image = result.secure_url || result.url
      }
      if (mediaType === 'video' && !product[0].video) {
        await db.execute('UPDATE products SET video=? WHERE id=?', [result.secure_url || result.url, productId])
        product[0].video = result.secure_url || result.url
      }
    }

    await audit(req.admin.id, 'MEDIA_UPLOAD', 'produto', productId, {
      count: inserted.length,
      media: inserted.map((item) => ({ id: item.id, type: item.media_type }))
    })

    res.status(201).json({ success: true, media: inserted })
  } catch (error) {
    console.error('Erro no upload de mídia:', error)
    if (Number(error?.http_code) === 401 || Number(error?.http_code) === 403) {
      return res.status(502).json({
        error: 'O Cloudinary recusou o upload (403). Verifique a API Key e principalmente o API Secret configurados no Render.'
      })
    }
    res.status(500).json({ error: 'Não foi possível enviar a mídia. Tente novamente.' })
  }
})

app.delete('/api/admin/products/:productId/media/:mediaId', exigirLogin, async (req, res) => {
  const productId = Number(req.params.productId)
  const mediaId = Number(req.params.mediaId)

  try {
    const rows = await query(
      'SELECT * FROM product_media WHERE id=? AND product_id=? LIMIT 1',
      [mediaId, productId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Mídia não encontrada.' })

    const media = rows[0]
    if (cloudinaryConfigurado()) {
      try {
        await cloudinary.uploader.destroy(media.public_id, {
          resource_type: media.media_type === 'video' ? 'video' : 'image',
          type: 'upload'
        })
      } catch (cloudinaryError) {
        console.error('Aviso ao remover mídia no Cloudinary:', cloudinaryError)
      }
    }

    await query('DELETE FROM product_media WHERE id=?', [mediaId])

    const product = await query('SELECT image,video FROM products WHERE id=? LIMIT 1', [productId])
    if (product.length) {
      if (product[0].image === media.url) {
        const replacement = await query(
          "SELECT url FROM product_media WHERE product_id=? AND media_type='image' ORDER BY sort_order,id LIMIT 1",
          [productId]
        )
        await query('UPDATE products SET image=? WHERE id=?', [replacement[0]?.url || '', productId])
      }
      if (product[0].video === media.url) {
        const replacement = await query(
          "SELECT url FROM product_media WHERE product_id=? AND media_type='video' ORDER BY sort_order,id LIMIT 1",
          [productId]
        )
        await query('UPDATE products SET video=? WHERE id=?', [replacement[0]?.url || '', productId])
      }
    }

    await audit(req.admin.id, 'MEDIA_DELETE', 'produto', productId, {
      mediaId,
      mediaType: media.media_type
    })
    res.json({ success: true })
  } catch (error) {
    console.error('Erro ao excluir mídia:', error)
    res.status(500).json({ error: 'Não foi possível excluir a mídia.' })
  }
})

app.get('/api/admin/products', exigirLogin, async (req, res) => {
  const rows = await query(`
    SELECT p.*, c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    ORDER BY p.id DESC
  `)
  res.json(rows)
})

function validarDadosProduto(product) {
  if (!String(product.name || '').trim()) return 'Nome do produto é obrigatório.'
  for (const key of ['price', 'cost']) {
    const value = Number(product[key] ?? 0)
    if (!Number.isFinite(value) || value < 0 || value > 9999999999.99) return 'Preço e custo devem ser valores válidos e não negativos.'
  }
  for (const key of ['stock', 'min_stock']) {
    const value = Number(product[key] ?? 0)
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) return 'Estoque e estoque mínimo devem ser inteiros não negativos.'
  }
  if (product.category_id && (!Number.isInteger(Number(product.category_id)) || Number(product.category_id) < 1)) return 'Categoria inválida.'
  return null
}

app.post('/api/admin/products', exigirLogin, async (req, res) => {
  const b = req.body || {}
  const validationError = validarDadosProduto(b)
  if (validationError) return res.status(400).json({ error: validationError })
  const name = String(b.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Nome do produto é obrigatório.' })

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [result] = await conn.execute(
      `INSERT INTO products
       (name,brand,category_id,description,price,cost,stock,min_stock,image,video)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        name,
        String(b.brand || '').trim(),
        Number(b.category_id) || null,
        String(b.description || ''),
        Number(b.price || 0),
        Number(b.cost || 0),
        Number(b.stock || 0),
        Number(b.min_stock || 0),
        String(b.image || ''),
        String(b.video || '')
      ]
    )

    const productId = result.insertId
    if (Number(b.stock) > 0) {
      await insertPrivateBusiness(conn, 'stock_movements',
        `INSERT INTO stock_movements
         (product_id,type,quantity,stock_before,stock_after,reason,user_id)
         VALUES(?,'ENTRADA',?,0,?,?,?)`,
        [productId, Number(b.stock), Number(b.stock), 'Estoque inicial', req.admin.id],
        { reason:3 }
      )
    }

    await audit(req.admin.id, 'CRIAR', 'produto', productId, { name }, conn)
    const rows = await query(
      'SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?',
      [productId], conn
    )
    await conn.commit()
    res.status(201).json(rows[0])
  } catch (error) {
    await conn.rollback()
    console.error('Erro ao criar produto:', error)
    res.status(500).json({ error: 'Não foi possível criar o produto.' })
  } finally {
    conn.release()
  }
})

app.delete('/api/admin/products/:id', exigirLogin, async (req, res) => {
  const productId = Number(req.params.id)
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: 'Produto inválido.' })
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [productRows] = await conn.execute('SELECT * FROM products WHERE id=? FOR UPDATE', [productId])
    if (!productRows.length) {
      await conn.rollback()
      return res.status(404).json({ error: 'Produto não encontrado.' })
    }

    const product = productRows[0]
    const [saleRows] = await conn.execute('SELECT COUNT(*) AS total FROM sale_items WHERE product_id=?', [productId])
    const [movementRows] = await conn.execute('SELECT COUNT(*) AS total FROM stock_movements WHERE product_id=?', [productId])
    const hasHistory = Number(saleRows[0]?.total || 0) > 0 || Number(movementRows[0]?.total || 0) > 0

    if (hasHistory) {
      await conn.execute('UPDATE products SET active=0 WHERE id=?', [productId])
      await conn.commit()
      await audit(req.admin.id, 'OCULTAR', 'produto', productId, { reason: 'possui_historico' })
      return res.json({ success: true, mode: 'hidden' })
    }

    const [mediaRows] = await conn.execute('SELECT id,media_type,public_id FROM product_media WHERE product_id=?', [productId])
    await conn.execute('DELETE FROM product_media WHERE product_id=?', [productId])
    await conn.execute('DELETE FROM products WHERE id=?', [productId])
    await conn.commit()

    for (const media of mediaRows) {
      if (!cloudinaryConfigurado()) continue
      try {
        await cloudinary.uploader.destroy(media.public_id, {
          resource_type: media.media_type === 'video' ? 'video' : 'image',
          type: 'upload'
        })
      } catch (cloudinaryError) {
        console.error('Aviso ao remover mídia do produto no Cloudinary:', cloudinaryError)
      }
    }

    await audit(req.admin.id, 'EXCLUIR', 'produto', productId, { name: product.name })
    res.json({ success: true, mode: 'deleted' })
  } catch (error) {
    try { await conn.rollback() } catch {}
    console.error('Erro ao excluir produto:', error)
    res.status(400).json({ error: error.message || 'Não foi possível excluir o produto.' })
  } finally {
    conn.release()
  }
})

app.put('/api/admin/products/:id', exigirLogin, async (req, res) => {
  const productId = Number(req.params.id)
  if (!Number.isInteger(productId) || productId < 1) return res.status(400).json({ error: 'Produto inválido.' })

  const b = req.body || {}
  const validationError = validarDadosProduto(b)
  if (validationError) return res.status(400).json({ error: validationError })
  const newStock = Number(b.stock)
  if (!Number.isInteger(newStock) || newStock < 0) {
    return res.status(400).json({ error: 'Estoque inválido.' })
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [oldRows] = await conn.execute('SELECT * FROM products WHERE id=? FOR UPDATE', [productId])
    if (!oldRows.length) {
      await conn.rollback()
      return res.status(404).json({ error: 'Produto não encontrado.' })
    }
    await conn.execute(
      `UPDATE products SET
       name=?,brand=?,category_id=?,description=?,price=?,cost=?,stock=?,min_stock=?,image=?,video=?,active=?
       WHERE id=?`,
      [
        String(b.name || '').trim(),
        String(b.brand || '').trim(),
        Number(b.category_id) || null,
        String(b.description || ''),
        Number(b.price || 0),
        Number(b.cost || 0),
        newStock,
        Number(b.min_stock || 0),
        String(b.image || ''),
        String(b.video || ''),
        b.active === false ? 0 : 1,
        productId
      ]
    )

    const oldStock = Number(oldRows[0].stock)
    if (newStock !== oldStock) {
      await insertPrivateBusiness(conn, 'stock_movements',
        `INSERT INTO stock_movements
         (product_id,type,quantity,stock_before,stock_after,reason,user_id)
         VALUES(?,'AJUSTE',?,?,?,?,?)`,
        [productId, newStock - oldStock, oldStock, newStock, 'Ajuste manual pelo painel', req.admin.id],
        { reason:4 }
      )
    }

    await audit(req.admin.id, 'EDITAR', 'produto', productId, {
      oldStock,
      newStock
    }, conn)
    const rows = await query(
      'SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?',
      [productId], conn
    )
    await conn.commit()
    res.json(rows[0])
  } catch (error) {
    await conn.rollback()
    console.error('Erro ao editar produto:', error)
    res.status(500).json({ error: 'Não foi possível editar o produto.' })
  } finally {
    conn.release()
  }
})

app.post('/api/admin/stock', exigirLogin, async (req, res) => {
  const productId = Number(req.body?.product_id)
  const type = String(req.body?.type || '')
  const quantity = Number(req.body?.quantity)

  if (!Number.isInteger(productId) || productId < 1 || !['ENTRADA','SAIDA','AJUSTE'].includes(type) || !Number.isInteger(quantity) || quantity < 0 || (type !== 'AJUSTE' && quantity === 0)) {
    return res.status(400).json({ error: 'Movimentação inválida.' })
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [productRows] = await conn.execute(
      'SELECT * FROM products WHERE id=? FOR UPDATE',
      [productId]
    )
    if (!productRows.length) throw new Error('Produto não encontrado.')

    const product = productRows[0]
    let stockAfter
    if (type === 'ENTRADA') stockAfter = Number(product.stock) + quantity
    else if (type === 'SAIDA') stockAfter = Number(product.stock) - quantity
    else stockAfter = quantity

    if (stockAfter < 0) throw new Error('Estoque insuficiente.')

    await conn.execute(
      'UPDATE products SET stock=? WHERE id=?',
      [stockAfter, productId]
    )
    await insertPrivateBusiness(conn, 'stock_movements',
      `INSERT INTO stock_movements
       (product_id,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        productId,
        type,
        type === 'AJUSTE' ? stockAfter - Number(product.stock) : quantity,
        Number(product.stock),
        stockAfter,
        String(req.body?.reason || ''),
        req.body?.reference_id ? String(req.body.reference_id) : null,
        Number(req.body?.unit_cost || 0),
        req.admin.id
      ],
      { reason:5 }
    )

    await audit(req.admin.id, 'MOVIMENTAR', 'estoque', productId, {
      type,
      before: Number(product.stock),
      after: stockAfter
    }, conn)
    await conn.commit()
    res.json({
      before: Number(product.stock),
      after: stockAfter
    })
  } catch (error) {
    await conn.rollback()
    res.status(400).json({ error: error.message || 'Não foi possível movimentar o estoque.' })
  } finally {
    conn.release()
  }
})

app.get('/api/admin/stock/movements', exigirLogin, async (req, res) => {
  const rows = await query(`
    SELECT m.*, p.name AS product, u.email AS user_email, u.private_data AS user_private_data
    FROM stock_movements m
    INNER JOIN products p ON p.id=m.product_id
    LEFT JOIN admin_users u ON u.id=m.user_id
    ORDER BY m.id DESC
    LIMIT 500
  `)
  res.json(decodeBusinessUserEmails(rows))
})

app.get('/api/admin/finance/entries', exigirLogin, async (req, res) => {
  const rows = await query(`
    SELECT e.*, c.name AS category, a.name AS account, u.email AS user_email, u.private_data AS user_private_data
    FROM financial_entries e
    LEFT JOIN financial_categories c ON c.id=e.category_id
    LEFT JOIN financial_accounts a ON a.id=e.account_id
    LEFT JOIN admin_users u ON u.id=e.user_id
    ORDER BY e.due_date DESC, e.id DESC
    LIMIT 500
  `)
  res.json(decodeBusinessUserEmails(rows))
})

function decodeBusinessUserEmails(rows) {
  return rows.map(row => {
    const { user_private_data, ...publicRow } = row
    if (row.user_id && row.user_email != null) {
      publicRow.user_email = privacy.decodeRow('admin_users', { id:row.user_id, email:row.user_email, private_data:user_private_data }).email
    }
    return publicRow
  })
}

app.get('/api/admin/finance/categories', exigirLogin, async (req, res) => {
  res.json(await query('SELECT * FROM financial_categories ORDER BY type,name'))
})

app.get('/api/admin/finance/accounts', exigirLogin, async (req, res) => {
  res.json(await query('SELECT * FROM financial_accounts WHERE active=1 ORDER BY name'))
})

app.post('/api/admin/finance/entries', exigirLogin, async (req, res) => {
  const b = req.body || {}
  const type = String(b.type || 'DESPESA')
  const amount = Number(b.amount)
  if (!['RECEITA','DESPESA'].includes(type) || !b.description || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Lançamento financeiro inválido.' })
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const result = await insertPrivateBusiness(conn, 'financial_entries',
      `INSERT INTO financial_entries
       (account_id,category_id,type,description,amount,due_date,status,paid_at,recurring,recurrence,user_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        Number(b.account_id) || null,
        Number(b.category_id) || null,
        type,
        String(b.description).trim(),
        amount,
        b.due_date || null,
        b.status === 'PAGO' ? 'PAGO' : 'PENDENTE',
        b.status === 'PAGO' ? new Date() : null,
        b.recurring === true ? 1 : 0,
        b.recurrence ? String(b.recurrence) : null,
        req.admin.id
      ],
      { description:3 })
    const id = result.insertId
    await audit(req.admin.id, 'CRIAR', 'lancamento_financeiro', id, { type, amount }, conn)
    const inserted = await query(
      'SELECT e.*,c.name AS category,a.name AS account FROM financial_entries e LEFT JOIN financial_categories c ON c.id=e.category_id LEFT JOIN financial_accounts a ON a.id=e.account_id WHERE e.id=?',
      [id], conn)
    await conn.commit()
    res.status(201).json(inserted[0])
  } catch (error) {
    await conn.rollback().catch(() => {})
    console.error('Erro ao criar lançamento financeiro:', error?.code || 'INTERNAL_ERROR')
    res.status(500).json({ error:'Não foi possível criar o lançamento financeiro.' })
  } finally { conn.release() }
})

app.delete('/api/admin/finance/entries/:id', exigirLogin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Lançamento inválido.' })

  const rows = await query('SELECT * FROM financial_entries WHERE id=? LIMIT 1', [id])
  if (!rows.length) return res.status(404).json({ error: 'Lançamento não encontrado.' })

  const entry = rows[0]
  if (entry.reference_type === 'VENDA') {
    return res.status(400).json({ error: 'Esse lançamento pertence a uma venda. Cancele a venda pela aba Vendas.' })
  }

  const result = await query(
    "UPDATE financial_entries SET status='CANCELADO', paid_at=NULL WHERE id=? AND status<>'CANCELADO'",
    [id]
  )
  if (!result.affectedRows) return res.status(400).json({ error: 'O lançamento já está cancelado.' })

  await audit(req.admin.id, 'EXCLUIR', 'lancamento_financeiro', id, {
    type: entry.type,
    amount: Number(entry.amount),
    description: entry.description
  })

  res.json({ success: true, mode: 'cancelled' })
})

app.patch('/api/admin/finance/entries/:id/pay', exigirLogin, async (req, res) => {
  const id = Number(req.params.id)
  const result = await query(
    "UPDATE financial_entries SET status='PAGO',paid_at=NOW() WHERE id=? AND status<>'CANCELADO'",
    [id]
  )
  if (!result.affectedRows) return res.status(404).json({ error: 'Lançamento não encontrado.' })
  await audit(req.admin.id, 'PAGAR', 'lancamento_financeiro', id)
  const rows = await query('SELECT * FROM financial_entries WHERE id=?', [id])
  res.json(rows[0])
})

app.post('/api/admin/finance/recurring', exigirLogin, async (req, res) => {
  const b = req.body || {}
  const dueDay = Number(b.due_day)
  const amount = Number(b.amount)
  if (!b.description || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31 || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Recorrência inválida.' })
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const result = await insertPrivateBusiness(conn, 'recurring_expenses',
      'INSERT INTO recurring_expenses(description,category_id,account_id,amount,due_day) VALUES(?,?,?,?,?)',
      [String(b.description).trim(), Number(b.category_id) || null, Number(b.account_id) || null, amount, dueDay],
      { description:0 })
    await audit(req.admin.id, 'CRIAR', 'despesa_recorrente', result.insertId, null, conn)
    const rows = await query(
      `SELECT r.*, c.name AS category, a.name AS account
       FROM recurring_expenses r
       LEFT JOIN financial_categories c ON c.id=r.category_id
       LEFT JOIN financial_accounts a ON a.id=r.account_id
       WHERE r.id=?`,
      [result.insertId], conn)
    await conn.commit()
    res.status(201).json(rows[0])
  } catch (error) {
    await conn.rollback().catch(() => {})
    console.error('Erro ao criar recorrência:', error?.code || 'INTERNAL_ERROR')
    res.status(500).json({ error:'Não foi possível criar a recorrência.' })
  } finally { conn.release() }
})

app.get('/api/admin/finance/recurring', exigirLogin, async (req, res) => {
  res.json(await query(`
    SELECT r.*, c.name AS category, a.name AS account
    FROM recurring_expenses r
    LEFT JOIN financial_categories c ON c.id=r.category_id
    LEFT JOIN financial_accounts a ON a.id=r.account_id
    WHERE r.active=1
    ORDER BY r.due_day
  `))
})

const dist = path.join(__dirname, '..', 'dist')
registerMediaLibrary(app, { query, audit, exigirLogin, exigirOwner, mediaUpload, enviarParaCloudinary, cloudinaryConfigurado, cloudinary })
app.use(express.static(dist, {
  setHeaders(res, filePath) {
    if (String(filePath).endsWith('/index.html')) {
      res.setHeader('Cache-Control', 'no-store')
    }
  }
}))

app.get(/^(?!\/api\/|\/health$).*/, (req, res) => {
  res.sendFile(path.join(dist, 'index.html'))
})

app.use((error, req, res, next) => {
  console.error('Erro não tratado:', error)
  if (res.headersSent) return next(error)
  res.status(error.status || 500).json({
    success: false,
    error: 'Erro interno do servidor.'
  })
})

async function bootstrap() {
  await init()
  await seedAndScheduleRecurring()

  const productHealth = await query(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(active = 1), 0) AS active,
      COALESCE(SUM(active = 0), 0) AS inactive
    FROM products
  `)
  const activeProducts = await query(`
    SELECT p.id, p.name, p.brand, p.active, c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1
    ORDER BY p.id DESC
  `)
  console.log(
    'PRODUCT HEALTH:',
    JSON.stringify({
      total: Number(productHealth[0]?.total || 0),
      active: Number(productHealth[0]?.active || 0),
      inactive: Number(productHealth[0]?.inactive || 0),
      activeProducts
    })
  )

  httpServer.listen(PORT, () => {
    console.log(`GALEO API running on port ${PORT}`)
    console.log('GALEO WebSocket keepalive ativo em /ws')
  })
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar GALEO:', error)
  process.exit(1)
})
