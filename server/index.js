import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcrypt'
import { rateLimit } from 'express-rate-limit'
import session from 'express-session'
import MySQLStoreFactory from 'express-mysql-session'
import mysql from 'mysql2/promise'
import cron from 'node-cron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  configurarPersistenciaSessao,
  normalizarManterConectado
} from '../session-policy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

const PORT = Number(process.env.PORT || 10000)
const NODE_ENV = process.env.NODE_ENV || 'production'
const DB_PORT = Number(process.env.DB_PORT || 3306)
const DB_SSL = process.env.DB_SSL !== 'false'
const DB_SSL_REJECT_UNAUTHORIZED = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'

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
  ssl: DB_SSL ? { rejectUnauthorized: DB_SSL_REJECT_UNAUTHORIZED } : undefined
}

const db = mysql.createPool(dbConfig)

const appUrl = String(process.env.APP_URL || '').trim()
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || appUrl)
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '256kb' }))

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      connectSrc: ["'self'"],
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

const Store = MySQLStoreFactory(session)
const sessionStore = new Store({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  ssl: dbConfig.ssl
})

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

async function query(sql, params = [], executor = db) {
  const [rows] = await executor.execute(sql, params)
  return rows
}

async function audit(userId, action, entity, entityId, details = null) {
  await query(
    'INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)',
    [userId || null, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null]
  )
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ]

  for (const statement of schema) await query(statement)

  const productCategories = [
    ['Camisetas', 10], ['Calças', 20], ['Vestidos', 30],
    ['Casacos', 40], ['Calçados', 50], ['Acessórios', 60], ['Outros', 99]
  ]
  for (const [name, sortOrder] of productCategories) {
    await query('INSERT IGNORE INTO categories(name,sort_order) VALUES(?,?)', [name, sortOrder])
  }

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

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const existing = await query(
      'SELECT id FROM admin_users WHERE email=? LIMIT 1',
      [process.env.ADMIN_EMAIL]
    )
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)

    if (existing.length) {
      await query(
        'UPDATE admin_users SET password_hash=?, active=1 WHERE id=?',
        [passwordHash, existing[0].id]
      )
    } else {
      await query(
        "INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?, 'owner', 1)",
        [process.env.ADMIN_EMAIL, passwordHash]
      )
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
      'SELECT id,email,role,active FROM admin_users WHERE id=? LIMIT 1',
      [req.session.userId]
    )
    if (!rows.length || !rows[0].active) {
      return req.session.destroy(() => {
        res.clearCookie('galeo_sid', {
          httpOnly: true,
          secure: NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/'
        })
        return res.status(401).json({
          success: false,
          error: 'Esta conta não está disponível.'
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

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Informe e-mail e senha.' })
  }

  try {
    const rows = await query(
      'SELECT id,email,password_hash,role,active FROM admin_users WHERE email=? LIMIT 1',
      [email]
    )

    if (!rows.length || !rows[0].active || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({
        success: false,
        error: 'E-mail ou senha inválidos.'
      })
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
      req.session.role = rows[0].role
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
            role: rows[0].role
          }
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

app.get('/api/auth/me', exigirLogin, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.admin.id,
      email: req.admin.email,
      role: req.admin.role
    }
  })
})

app.get('/api/store', async (req, res) => {
  try {
    const [products, categories] = await Promise.all([
      query(`
        SELECT p.*, c.name AS category
        FROM products p
        LEFT JOIN categories c ON c.id=p.category_id
        WHERE p.active=1
        ORDER BY p.id DESC
      `),
      query('SELECT id,name,sort_order FROM categories ORDER BY sort_order,id')
    ])
    res.json({ products, categories })
  } catch (error) {
    console.error('Erro no catálogo:', error)
    res.status(500).json({ error: 'Não foi possível carregar o catálogo.' })
  }
})

async function generateCurrentRecurring() {
  const recs = await query(`
    SELECT r.*, DATE_FORMAT(CURRENT_DATE,'%Y-%m') AS current_month
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

    const dueDate = `${rec.current_month}-${String(rec.due_day).padStart(2, '0')}`
    await query(
      `INSERT INTO financial_entries
       (account_id,category_id,type,description,amount,due_date,status,recurring,recurrence,reference_type,reference_id)
       VALUES(?,?, 'DESPESA',?,?,?,'PENDENTE',1,'MENSAL','RECURRING',?)`,
      [rec.account_id, rec.category_id, rec.description, rec.amount, dueDate, referenceId]
    )
  }
}

async function seedAndScheduleRecurring() {
  try { await generateCurrentRecurring() } catch (error) {
    console.error('Erro ao gerar recorrências:', error)
  }
}

cron.schedule('10 3 * * *', seedAndScheduleRecurring, { timezone: 'America/Sao_Paulo' })

app.get('/api/admin/dashboard', exigirLogin, async (req, res) => {
  try {
    await generateCurrentRecurring()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0,0,0,0)
    const currentMonth = monthStart.toISOString().slice(0,10)

    const [productSummary, stockSummary, incomeSummary, expenseSummary, payableSummary, receivableSummary] = await Promise.all([
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
          COALESCE(SUM(CASE WHEN type IN ('SAIDA','AJUSTE') AND quantity>0 THEN quantity ELSE 0 END),0) AS saidas
        FROM stock_movements
        WHERE created_at>=?
      `, [currentMonth]),
      query(`
        SELECT COALESCE(SUM(amount),0) AS total
        FROM financial_entries
        WHERE type='RECEITA' AND status='PAGO' AND DATE(COALESCE(paid_at,created_at))>=?
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

app.get('/api/admin/products', exigirLogin, async (req, res) => {
  const rows = await query(`
    SELECT p.*, c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    ORDER BY p.id DESC
  `)
  res.json(rows)
})

app.post('/api/admin/products', exigirLogin, async (req, res) => {
  const b = req.body || {}
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
      await conn.execute(
        `INSERT INTO stock_movements
         (product_id,type,quantity,stock_before,stock_after,reason,user_id)
         VALUES(?,'ENTRADA',?,0,?,'Estoque inicial',?)`,
        [productId, Number(b.stock), Number(b.stock), req.admin.id]
      )
    }

    await conn.commit()
    await audit(req.admin.id, 'CRIAR', 'produto', productId, { name })
    const rows = await query(
      'SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?',
      [productId]
    )
    res.status(201).json(rows[0])
  } catch (error) {
    await conn.rollback()
    console.error('Erro ao criar produto:', error)
    res.status(500).json({ error: 'Não foi possível criar o produto.' })
  } finally {
    conn.release()
  }
})

app.put('/api/admin/products/:id', exigirLogin, async (req, res) => {
  const productId = Number(req.params.id)
  const oldRows = await query('SELECT * FROM products WHERE id=? LIMIT 1', [productId])
  if (!oldRows.length) return res.status(404).json({ error: 'Produto não encontrado.' })

  const b = req.body || {}
  const newStock = Number(b.stock)
  if (!Number.isInteger(newStock) || newStock < 0) {
    return res.status(400).json({ error: 'Estoque inválido.' })
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
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
      await conn.execute(
        `INSERT INTO stock_movements
         (product_id,type,quantity,stock_before,stock_after,reason,user_id)
         VALUES(?,'AJUSTE',?,?,?,'Ajuste manual pelo painel',?)`,
        [productId, newStock - oldStock, oldStock, newStock, req.admin.id]
      )
    }

    await conn.commit()
    await audit(req.admin.id, 'EDITAR', 'produto', productId, {
      oldStock,
      newStock
    })
    const rows = await query(
      'SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?',
      [productId]
    )
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

  if (!productId || !['ENTRADA','SAIDA','AJUSTE'].includes(type) || !Number.isInteger(quantity) || quantity <= 0) {
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
    await conn.execute(
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
      ]
    )

    await conn.commit()
    await audit(req.admin.id, 'MOVIMENTAR', 'estoque', productId, {
      type,
      before: Number(product.stock),
      after: stockAfter
    })
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
    SELECT m.*, p.name AS product, u.email AS user_email
    FROM stock_movements m
    INNER JOIN products p ON p.id=m.product_id
    LEFT JOIN admin_users u ON u.id=m.user_id
    ORDER BY m.id DESC
    LIMIT 500
  `)
  res.json(rows)
})

app.get('/api/admin/finance/entries', exigirLogin, async (req, res) => {
  const rows = await query(`
    SELECT e.*, c.name AS category, a.name AS account, u.email AS user_email
    FROM financial_entries e
    LEFT JOIN financial_categories c ON c.id=e.category_id
    LEFT JOIN financial_accounts a ON a.id=e.account_id
    LEFT JOIN admin_users u ON u.id=e.user_id
    ORDER BY e.due_date DESC, e.id DESC
    LIMIT 500
  `)
  res.json(rows)
})

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

  const rows = await query(
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
    ]
  )

  const id = rows.insertId
  await audit(req.admin.id, 'CRIAR', 'lancamento_financeiro', id, {
    type,
    amount
  })

  const inserted = await query(
    'SELECT e.*,c.name AS category,a.name AS account FROM financial_entries e LEFT JOIN financial_categories c ON c.id=e.category_id LEFT JOIN financial_accounts a ON a.id=e.account_id WHERE e.id=?',
    [id]
  )
  res.status(201).json(inserted[0])
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

  const result = await query(
    'INSERT INTO recurring_expenses(description,category_id,account_id,amount,due_day) VALUES(?,?,?,?,?)',
    [
      String(b.description).trim(),
      Number(b.category_id) || null,
      Number(b.account_id) || null,
      amount,
      dueDay
    ]
  )
  await audit(req.admin.id, 'CRIAR', 'despesa_recorrente', result.insertId)
  const rows = await query(
    `SELECT r.*, c.name AS category, a.name AS account
     FROM recurring_expenses r
     LEFT JOIN financial_categories c ON c.id=r.category_id
     LEFT JOIN financial_accounts a ON a.id=r.account_id
     WHERE r.id=?`,
    [result.insertId]
  )
  res.status(201).json(rows[0])
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
  app.listen(PORT, () => {
    console.log(`GALEO API running on port ${PORT}`)
  })
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar GALEO:', error)
  process.exit(1)
})
