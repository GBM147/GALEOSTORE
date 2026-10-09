import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import mysql from 'mysql2/promise'
import { createDatabasePrivacy } from '../server/database-privacy.js'

if (!new Set(['127.0.0.1', 'localhost', '::1']).has(process.env.DB_HOST) ||
    process.env.DB_NAME !== 'galeo_store_test' || process.env.DB_PORT !== '3308') {
  throw new Error('Os testes de privacidade de negócio exigem MySQL loopback isolado, DB_NAME=galeo_store_test e DB_PORT=3308; produção é recusada.')
}
if (process.env.DATA_ENCRYPTION_ENABLED !== 'true' || !process.env.DATA_ENCRYPTION_KEY || !process.env.SESSION_SECRET) {
  throw new Error('Configure DATA_ENCRYPTION_ENABLED=true, chave local e SESSION_SECRET para estes testes.')
}

const projectDirectory = fileURLToPath(new URL('..', import.meta.url))
const baseUrl = 'http://127.0.0.1:10010'
const suffix = randomBytes(8).toString('hex')
const password = 'Local-business-' + randomBytes(12).toString('hex')
const ownerEmail = 'business-owner-' + suffix + '@example.invalid'
const customerEmail = 'business-customer-' + suffix + '@example.invalid'
const customerName = 'Pessoa local ' + suffix
const phone = '11999887766'
const fixtures = { products:new Set(), orders:new Set(), sales:new Set(), entries:new Set(), recurring:new Set(), sessions:new Set() }
let db, privacy, child, ownerId, customerId, admin, customer

async function query(sql, values = []) {
  const [rows] = await db.execute(sql, values)
  return rows
}

async function deleteIds(table, field, ids) {
  if (!ids.size) return
  await query('DELETE FROM `' + table + '` WHERE `' + field + '` IN (' + [...ids].map(() => '?').join(',') + ')', [...ids])
}

async function stopApi() {
  const stopping = child
  child = undefined
  if (!stopping || stopping.exitCode !== null || stopping.signalCode !== null) return
  await new Promise(resolve => {
    const timeout = setTimeout(() => stopping.kill('SIGKILL'), 5000)
    stopping.once('close', () => { clearTimeout(timeout); resolve() })
    stopping.kill('SIGTERM')
  })
}

async function startApi() {
  await stopApi()
  child = spawn(process.execPath, ['server/index.js'], {
    cwd:projectDirectory,
    env:{
      ...process.env, PORT:'10010', NODE_ENV:'test', APP_URL:baseUrl, ALLOWED_ORIGINS:baseUrl,
      ADMIN_EMAIL:ownerEmail, ADMIN_PASSWORD:password,
      // No network provider is used or enabled by these business tests.
      RESEND_API_KEY:'', EMAIL_FROM:'', STORE_NOTIFICATION_EMAIL:'',
      MERCADO_PAGO_ACCESS_TOKEN:'', MERCADO_PAGO_POINT_TERMINAL_ID:'', MERCADO_PAGO_WEBHOOK_SECRET:'',
      DISTRIBUTOR_WEBHOOK_SECRET:'', CLOUDINARY_URL:'', CLOUDINARY_CLOUD_NAME:'', CLOUDINARY_API_KEY:'', CLOUDINARY_API_SECRET:''
    },
    stdio:['ignore', 'pipe', 'pipe']
  })
  let output = ''
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('A API isolada de privacidade não iniciou em 30 segundos.')), 30000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('A API isolada de privacidade terminou antes de iniciar.')) })
    child.stderr.on('data', () => {})
    child.stdout.on('data', chunk => {
      output = (output + chunk.toString()).slice(-8192)
      if (output.includes('GALEO API running on port 10010')) { clearTimeout(timeout); resolve() }
    })
  })
}

class Client {
  cookie = ''
  csrfToken = ''
  async request(path, { method = 'GET', body } = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      headers:{
        ...(this.cookie ? { Cookie:this.cookie } : {}),
        ...(this.csrfToken ? { 'X-CSRF-Token':this.csrfToken } : {}),
        ...(body === undefined ? {} : { 'Content-Type':'application/json' })
      },
      ...(body === undefined ? {} : { body:JSON.stringify(body) })
    })
    for (const cookie of response.headers.getSetCookie()) {
      if (!cookie.startsWith('galeo_sid=')) continue
      this.cookie = cookie.split(';', 1)[0]
      const value = decodeURIComponent(this.cookie.slice('galeo_sid='.length))
      if (value.startsWith('s:')) fixtures.sessions.add(value.slice(2, value.lastIndexOf('.')))
    }
    const data = await response.json()
    if (data.csrfToken) this.csrfToken = data.csrfToken
    return { status:response.status, data }
  }
}

function assertPublic(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    assert.equal(key.includes('private_data') || key === 'protected_session', false, 'respostas não devem expor envelopes privados: ' + key)
    assertPublic(item)
  }
}

async function assertProtected(table, id, expected) {
  const [row] = await query('SELECT * FROM `' + table + '` WHERE id=?', [id])
  assert.ok(row, 'fixture deve existir em ' + table)
  const envelope = typeof row.private_data === 'string' ? JSON.parse(row.private_data) : row.private_data
  assert.equal(envelope?.alg, 'A256GCM', table + ' deve armazenar AES-GCM autenticado')
  const restored = privacy.decodeRow(table, row)
  for (const [field, value] of Object.entries(expected)) {
    assert.deepEqual(restored[field], value, table + '.' + field + ' deve ser restaurado')
    if (field === 'email' && ['admin_users', 'customers'].includes(table)) {
      assert.match(row[field], /^private-[a-f0-9]{64}@galeo\.invalid$/)
    } else {
      assert.ok(row[field] === '' || row[field] === null, table + '.' + field + ' não deve manter texto legível')
    }
  }
  const serialized = JSON.stringify(row)
  for (const value of [ownerEmail, customerEmail, customerName]) {
    assert.equal(serialized.includes(value), false, table + ' não deve guardar identidade legível')
  }
  return row
}

async function product(stock = 10) {
  const response = await admin.request('/api/admin/products', { method:'POST', body:{
    name:'Peça de teste ' + suffix + '-' + fixtures.products.size, brand:'GALEO local', price:21.5, cost:7, stock, min_stock:1
  } })
  assert.equal(response.status, 201, response.data.error)
  fixtures.products.add(response.data.id)
  return response.data.id
}

before(async () => {
  db = mysql.createPool({ host:process.env.DB_HOST, port:Number(process.env.DB_PORT), user:process.env.DB_USER, password:process.env.DB_PASSWORD, database:process.env.DB_NAME, connectionLimit:4 })
  assert.equal((await query('SELECT DATABASE() AS name'))[0].name, 'galeo_store_test')
  privacy = createDatabasePrivacy({ db, enabled:true })
  const hash = await bcrypt.hash(password, 12)
  // Deliberately create legacy plaintext fixtures before startup to test migration.
  ownerId = (await query('INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,\'owner\',1)', [ownerEmail, hash])).insertId
  customerId = (await query('INSERT INTO customers(name,email,password_hash,phone,active,email_verified_at) VALUES(?,?,?,?,1,UTC_TIMESTAMP())', [customerName, customerEmail, hash, phone])).insertId
  await startApi()
  admin = new Client()
  customer = new Client()
  const ownerLogin = await admin.request('/api/auth/login', { method:'POST', body:{ email:ownerEmail, password } })
  assert.equal(ownerLogin.status, 200, ownerLogin.data.error)
  const customerLogin = await customer.request('/api/customer/login', { method:'POST', body:{ email:customerEmail, password } })
  assert.equal(customerLogin.status, 200, customerLogin.data.error)
})

after(async () => {
  await stopApi()
  if (!db) return
  try {
    if (ownerId) await query('DELETE FROM audit_logs WHERE user_id=?', [ownerId])
    if (fixtures.orders.size) {
      await query("DELETE FROM audit_logs WHERE entity='pedido_online' AND entity_id IN (" + [...fixtures.orders].map(() => '?').join(',') + ')', [...fixtures.orders].map(String))
    }
    await deleteIds('payments', 'store_order_id', fixtures.orders)
    await deleteIds('payments', 'sale_id', fixtures.sales)
    await deleteIds('store_order_items', 'order_id', fixtures.orders)
    await deleteIds('store_orders', 'id', fixtures.orders)
    await deleteIds('sale_items', 'sale_id', fixtures.sales)
    for (const id of fixtures.sales) await query("DELETE FROM financial_entries WHERE reference_type='VENDA' AND reference_id=?", ['sale:' + id])
    for (const id of fixtures.recurring) await query("DELETE FROM financial_entries WHERE reference_type='RECURRING' AND reference_id LIKE ?", ['recurring:' + id + ':%'])
    await deleteIds('financial_entries', 'id', fixtures.entries)
    await deleteIds('recurring_expenses', 'id', fixtures.recurring)
    await deleteIds('sales', 'id', fixtures.sales)
    await deleteIds('stock_movements', 'product_id', fixtures.products)
    await deleteIds('product_media', 'product_id', fixtures.products)
    await deleteIds('products', 'id', fixtures.products)
    if (customerId) {
      await query('DELETE FROM customer_email_verifications WHERE customer_id=?', [customerId])
      await query('DELETE FROM customers WHERE id=?', [customerId])
    }
    if (ownerId) await query('DELETE FROM admin_users WHERE id=?', [ownerId])
    await deleteIds('sessions', 'session_id', fixtures.sessions)
  } finally { await db.end() }
})

test('startup migra identidades anteriores e o perfil restaura dados sem expor criptografia', async () => {
  await assertProtected('admin_users', ownerId, { email:ownerEmail })
  await assertProtected('customers', customerId, { name:customerName, email:customerEmail, phone })
  const profile = await customer.request('/api/customer/me')
  assert.equal(profile.status, 200)
  assert.equal(profile.data.user.name, customerName)
  assert.equal(profile.data.user.email, customerEmail)
  assert.equal(profile.data.user.phone, phone)
  assertPublic(profile.data)
  const ownerProfile = await admin.request('/api/auth/me')
  assert.equal(ownerProfile.status, 200)
  assert.equal(ownerProfile.data.user.email, ownerEmail)
  assertPublic(ownerProfile.data)
})

test('pedido protege cópias da identidade e endereço, mantém total e devolve reserva ao cancelar', async () => {
  const productId = await product()
  const shipping = { name:customerName, phone, postal_code:'01001000', street:'Rua local ' + suffix, number:'27', complement:'Casa local', neighborhood:'Centro local', city:'São Paulo', state:'SP' }
  const created = await customer.request('/api/store/orders', { method:'POST', body:{ items:[{ product_id:productId, quantity:2 }], shipping } })
  assert.equal(created.status, 200, created.data.error)
  const order = created.data.order
  fixtures.orders.add(order.id)
  assert.equal(order.total, 43)
  assert.equal(created.data.payment_configured, false)
  const expected = { customer_name:customerName, customer_email:customerEmail, customer_phone:phone, ...Object.fromEntries(Object.entries(shipping).filter(([key]) => !['name','phone'].includes(key))) }
  await assertProtected('store_orders', order.id, expected)
  assert.equal(Number((await query('SELECT stock FROM products WHERE id=?', [productId]))[0].stock), 8)
  const list = await admin.request('/api/admin/store-orders')
  assert.equal(list.status, 200)
  const listed = list.data.find(item => item.id === order.id)
  assert.ok(listed)
  for (const [field, value] of Object.entries(expected)) assert.equal(listed[field], value)
  assertPublic(list.data)
  const detail = await admin.request('/api/admin/store-orders/' + order.id)
  assert.equal(detail.status, 200)
  assert.equal(detail.data.customer_email, customerEmail)
  assertPublic(detail.data)
  const history = await customer.request('/api/customer/orders')
  assert.equal(history.status, 200)
  assert.ok(history.data.orders.some(item => item.id === order.id))
  assertPublic(history.data)
  const reservation = (await query("SELECT id FROM stock_movements WHERE reference_id=? AND type='SAIDA'", ['store-order:' + order.id]))[0]
  await assertProtected('stock_movements', reservation.id, { reason:'Reserva do pedido ' + order.code })
  const cancelled = await admin.request('/api/admin/store-orders/' + order.id + '/status', { method:'PATCH', body:{ status:'CANCELLED' } })
  assert.equal(cancelled.status, 200, cancelled.data.error)
  assert.equal(Number((await query('SELECT stock FROM products WHERE id=?', [productId]))[0].stock), 10)
  const cancellation = (await query("SELECT id FROM stock_movements WHERE reference_id=? AND type='ENTRADA'", ['store-order:' + order.id]))[0]
  await assertProtected('stock_movements', cancellation.id, { reason:'Cancelamento do pedido ' + order.code })
})

test('venda manual protege nome e observações, preserva idempotência, financeiro e estorno de estoque', async () => {
  const productId = await product()
  const notes = 'Contato local ' + customerEmail
  const body = { customer_name:customerName, notes, payment_method:'DINHEIRO', expected_total:64.5, client_reference:'privacy-sale-' + suffix, items:[{ product_id:productId, quantity:3 }] }
  const created = await admin.request('/api/admin/sales', { method:'POST', body })
  assert.equal(created.status, 201, created.data.error)
  const sale = created.data
  fixtures.sales.add(sale.id)
  assert.equal(sale.customer_name, customerName)
  assert.equal(sale.notes, notes)
  assert.equal(Number(sale.total), 64.5)
  assertPublic(sale)
  await assertProtected('sales', sale.id, { customer_name:customerName, notes })
  const repeated = await admin.request('/api/admin/sales', { method:'POST', body })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.data.id, sale.id)
  assert.equal(repeated.data.customer_name, customerName)
  assert.equal(Number((await query('SELECT stock FROM products WHERE id=?', [productId]))[0].stock), 7)
  const [income] = await query("SELECT id FROM financial_entries WHERE reference_type='VENDA' AND reference_id=?", ['sale:' + sale.id])
  await assertProtected('financial_entries', income.id, { description:'Venda ' + sale.code })
  const sales = await admin.request('/api/admin/sales')
  assert.equal(sales.status, 200)
  assert.equal(sales.data.find(item => item.id === sale.id).notes, notes)
  assertPublic(sales.data)
  const detail = await admin.request('/api/admin/sales/' + sale.id)
  assert.equal(detail.status, 200)
  assert.equal(detail.data.customer_name, customerName)
  assertPublic(detail.data)
  const cancelled = await admin.request('/api/admin/sales/' + sale.id + '/cancel', { method:'PATCH' })
  assert.equal(cancelled.status, 200, cancelled.data.error)
  assert.equal(Number((await query('SELECT stock FROM products WHERE id=?', [productId]))[0].stock), 10)
  assert.equal((await query('SELECT status FROM financial_entries WHERE id=?', [income.id]))[0].status, 'CANCELADO')
})

test('estoque inicial e motivo livre ficam protegidos e a listagem restaura o e-mail do proprietário', async () => {
  const productId = await product(4)
  const [initial] = await query("SELECT id FROM stock_movements WHERE product_id=? AND type='ENTRADA' ORDER BY id", [productId])
  await assertProtected('stock_movements', initial.id, { reason:'Estoque inicial' })
  const reason = 'Solicitação de ' + customerEmail
  const moved = await admin.request('/api/admin/stock', { method:'POST', body:{ product_id:productId, type:'ENTRADA', quantity:2, reason } })
  assert.equal(moved.status, 200, moved.data.error)
  assert.equal(Number(moved.data.after), 6)
  const [movement] = await query('SELECT id FROM stock_movements WHERE product_id=? ORDER BY id DESC LIMIT 1', [productId])
  await assertProtected('stock_movements', movement.id, { reason })
  const response = await admin.request('/api/admin/stock/movements')
  assert.equal(response.status, 200)
  const item = response.data.find(row => row.id === movement.id)
  assert.equal(item.reason, reason)
  assert.equal(item.user_email, ownerEmail)
  assertPublic(response.data)
})

test('descrições financeiras permanecem protegidas ao pagar e cancelar e aliases não expõem envelopes', async () => {
  const description = 'Reembolso local para ' + customerEmail
  const created = await admin.request('/api/admin/finance/entries', { method:'POST', body:{ type:'DESPESA', amount:17.25, description, status:'PENDENTE', due_date:'2026-10-15' } })
  assert.equal(created.status, 201, created.data.error)
  const entry = created.data
  fixtures.entries.add(entry.id)
  assert.equal(entry.description, description)
  assertPublic(entry)
  await assertProtected('financial_entries', entry.id, { description })
  const list = await admin.request('/api/admin/finance/entries')
  assert.equal(list.status, 200)
  const listed = list.data.find(row => row.id === entry.id)
  assert.equal(listed.description, description)
  assert.equal(listed.user_email, ownerEmail)
  assertPublic(list.data)
  const paid = await admin.request('/api/admin/finance/entries/' + entry.id + '/pay', { method:'PATCH' })
  assert.equal(paid.status, 200, paid.data.error)
  assert.equal(paid.data.status, 'PAGO')
  assert.equal(paid.data.description, description)
  await assertProtected('financial_entries', entry.id, { description })
  const cancelled = await admin.request('/api/admin/finance/entries/' + entry.id, { method:'DELETE' })
  assert.equal(cancelled.status, 200, cancelled.data.error)
  const [raw] = await query('SELECT * FROM financial_entries WHERE id=?', [entry.id])
  assert.equal(raw.status, 'CANCELADO')
  await assertProtected('financial_entries', entry.id, { description })
  const auditRows = await query("SELECT * FROM audit_logs WHERE user_id=? AND entity='lancamento_financeiro' AND entity_id=? AND action='EXCLUIR'", [ownerId, String(entry.id)])
  assert.equal(auditRows.length, 1)
  await assertProtected('audit_logs', auditRows[0].id, { details:{ type:'DESPESA', amount:17.25, description } })
})

test('recorrências geram lançamentos protegidos no restart sem duplicação ou perda da descrição', async () => {
  const description = 'Serviço recorrente de ' + customerEmail
  const created = await admin.request('/api/admin/finance/recurring', { method:'POST', body:{ description, amount:32.75, due_day:31 } })
  assert.equal(created.status, 201, created.data.error)
  const rec = created.data
  fixtures.recurring.add(rec.id)
  assert.equal(rec.description, description)
  assertPublic(rec)
  await assertProtected('recurring_expenses', rec.id, { description })
  await startApi()
  const generated = await query("SELECT * FROM financial_entries WHERE reference_type='RECURRING' AND reference_id LIKE ?", ['recurring:' + rec.id + ':%'])
  assert.equal(generated.length, 1)
  await assertProtected('financial_entries', generated[0].id, { description })
  assert.equal(Number(generated[0].amount), 32.75)
  const list = await admin.request('/api/admin/finance/recurring')
  assert.equal(list.status, 200)
  assert.equal(list.data.find(item => item.id === rec.id).description, description)
  assertPublic(list.data)
  await startApi()
  assert.equal((await query("SELECT id FROM financial_entries WHERE reference_type='RECURRING' AND reference_id LIKE ?", ['recurring:' + rec.id + ':%'])).length, 1)
  const finance = await admin.request('/api/admin/finance/entries')
  assert.equal(finance.status, 200)
  assert.equal(finance.data.find(item => item.id === generated[0].id).description, description)
  assertPublic(finance.data)
})

test('status de segurança fica restrito ao proprietário e distingue criptografia da confirmação do provedor', async () => {
  const anonymous = await new Client().request('/api/admin/security-status')
  assert.equal(anonymous.status, 401)
  const customerAccess = await customer.request('/api/admin/security-status')
  assert.equal(customerAccess.status, 401)
  assert.equal((await customer.request('/api/customer/me')).status, 200, 'a recusa no Admin deve preservar a sessão do cliente')
  const status = await admin.request('/api/admin/security-status')
  assert.equal(status.status, 200)
  assert.equal(status.data.email_confirmation_configured, false)
  assert.equal(status.data.data_encryption_enabled, true)
  assert.equal(status.data.mysql_tls.enabled, false)
  assert.equal(status.data.mysql_tls.negotiated, false)
  assert.equal(status.data.mysql_tls.cipher, null)
  assert.equal(status.data.mysql_tls.protocol, null)
  assert.equal(status.data.mysql_tls.certificate_verified, false)
  assert.equal(status.data.mysql_tls.hostname_verified, false)
  assert.equal(status.data.mysql_tls.ca_configured, false)
  assert.equal(typeof status.data.mysql_tls.server_requires_tls, 'boolean')
  assert.equal(status.data.storage_and_backups, 'PROVIDER_VERIFICATION_REQUIRED')
  assert.equal(JSON.stringify(status.data).includes(process.env.DATA_ENCRYPTION_KEY), false, 'o status não deve revelar a chave')
  assertPublic(status.data)
})
