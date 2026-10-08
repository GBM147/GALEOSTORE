import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import mysql from 'mysql2/promise'

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
if (!loopbackHosts.has(process.env.DB_HOST) || process.env.DB_NAME !== 'galeo_store_test') {
  throw new Error('Os testes exigem DB_HOST loopback e DB_NAME=galeo_store_test; bancos de produção são recusados.')
}
if (!process.env.GALEO_TEST_BASE_URL) {
  throw new Error('Configure GALEO_TEST_BASE_URL com o endereço HTTP do servidor local de testes.')
}
const baseUrl = new URL(process.env.GALEO_TEST_BASE_URL)
if (!loopbackHosts.has(baseUrl.hostname) || baseUrl.protocol !== 'http:') {
  throw new Error('GALEO_TEST_BASE_URL deve apontar para um servidor HTTP loopback.')
}
if (!process.env.DISTRIBUTOR_WEBHOOK_SECRET) {
  throw new Error('Configure DISTRIBUTOR_WEBHOOK_SECRET para testar o webhook local.')
}

const suffix = randomBytes(8).toString('hex')
const password = 'Galeo-local-' + randomBytes(12).toString('hex')
const fixtures = { products: [], customers: [], admins: [], orders: [], sales: [], recurring: [], events: [], sessions: new Set() }
let db
let passwordHash
let adminEmail
let operationsLogin

async function execute(sql, params = []) {
  const [rows] = await db.execute(sql, params)
  return rows
}

async function removeIds(table, column, ids) {
  if (!ids.length) return
  await execute(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(',')})`, ids)
}

function jsonParameter(value) {
  return value === null || typeof value === 'string' ? value : JSON.stringify(value)
}

async function restoreCms(sections, settings) {
  for (const [table, primaryKey, rows, jsonColumns] of [
    ['home_sections', 'id', sections, new Set(['draft_content', 'published_content'])],
    ['home_settings', 'setting_key', settings, new Set(['setting_value', 'draft_value'])]
  ]) {
    for (const row of rows) {
      const columns = Object.keys(row).filter(column => column !== primaryKey)
      await execute(
        `UPDATE ${table} SET ${columns.map(column => '`' + column + '`=?').join(',')} WHERE ${primaryKey}=?`,
        [...columns.map(column => jsonColumns.has(column) ? jsonParameter(row[column]) : row[column]), row[primaryKey]]
      )
    }
  }
}

class Client {
  cookie = ''
  csrfToken = ''

  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const cookies = response.headers.getSetCookie()
    for (const cookie of cookies) {
      if (!cookie.startsWith('galeo_sid=')) continue
      this.cookie = cookie.split(';', 1)[0]
      const value = decodeURIComponent(this.cookie.slice('galeo_sid='.length))
      if (value.startsWith('s:')) fixtures.sessions.add(value.slice(2, value.lastIndexOf('.')))
    }
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error(`Resposta não JSON em ${method} ${path}: HTTP ${response.status}`) }
    if (data.csrfToken) this.csrfToken = data.csrfToken
    return { response, data, cookies }
  }
}

async function adminClient(remember = false) {
  const client = new Client()
  const login = await client.request('/api/auth/login', {
    method: 'POST', body: { email: adminEmail, password, manterConectado: remember }
  })
  assert.equal(login.response.status, 200, login.data.error)
  return { client, login }
}

async function operationsClient() {
  if (!operationsLogin) operationsLogin = await adminClient()
  return operationsLogin.client
}

async function productFixture(stock = 10) {
  const result = await execute(
    'INSERT INTO products(name,description,price,cost,stock,min_stock,active) VALUES(?,?,?,?,?,?,1)',
    ['Teste GALEO ' + suffix + '-' + fixtures.products.length, 'Produto de integração local', 20, 8, stock, 2]
  )
  fixtures.products.push(result.insertId)
  return result.insertId
}

async function customerFixture() {
  const email = `customer-${suffix}-${fixtures.customers.length}@example.invalid`
  const customer = await execute(
    'INSERT INTO customers(name,email,password_hash,phone) VALUES(?,?,?,?)',
    ['Cliente de teste', email, passwordHash, '11999999999']
  )
  fixtures.customers.push(customer.insertId)
  const client = new Client()
  const login = await client.request('/api/customer/login', { method: 'POST', body: { email, password } })
  assert.equal(login.response.status, 200, login.data.error)
  return { client, email, login, customerId: customer.insertId }
}

function orderBody(productId, quantity) {
  return {
    items: [{ product_id: productId, quantity }],
    shipping: { name: 'Cliente de teste', phone: '11999999999', postal_code: '01001000', street: 'Rua de teste', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' }
  }
}

async function orderFixture(quantity = 2) {
  const productId = await productFixture()
  const { client } = await customerFixture()
  const body = orderBody(productId, quantity)
  const created = await client.request('/api/store/orders', {
    method: 'POST',
    body
  })
  assert.equal(created.response.status, 200, created.data.error)
  const order = created.data.order
  fixtures.orders.push(order.id)
  return { productId, client, order, quantity, body }
}

async function distributorEvent(orderCode, status, eventId) {
  if (!fixtures.events.includes(eventId)) fixtures.events.push(eventId)
  return new Client().request('/api/integrations/distributor/webhook', {
    method: 'POST',
    headers: { 'X-Distributor-Webhook-Secret': process.env.DISTRIBUTOR_WEBHOOK_SECRET },
    body: { event_id: eventId, order_code: orderCode, status }
  })
}

before(async () => {
  db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 4
  })
  const database = await execute('SELECT DATABASE() AS name')
  assert.equal(database[0].name, 'galeo_store_test')
  passwordHash = await bcrypt.hash(password, 12)
  adminEmail = `admin-${suffix}@example.invalid`
  const admin = await execute("INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,'owner',1)", [adminEmail, passwordHash])
  fixtures.admins.push(admin.insertId)
})

after(async () => {
  if (!db) return
  try {
    await removeIds('integration_events', 'event_id', fixtures.events)
    await removeIds('payments', 'store_order_id', fixtures.orders)
    await removeIds('financial_entries', 'reference_id', fixtures.sales.map(id => 'sale:' + id))
    for (const id of fixtures.recurring) await execute("DELETE FROM financial_entries WHERE reference_type='RECURRING' AND reference_id LIKE ?", ['recurring:' + id + ':%'])
    await removeIds('store_order_items', 'order_id', fixtures.orders)
    await removeIds('store_orders', 'id', fixtures.orders)
    await removeIds('sale_items', 'sale_id', fixtures.sales)
    await removeIds('sales', 'id', fixtures.sales)
    await removeIds('stock_movements', 'product_id', fixtures.products)
    await removeIds('products', 'id', fixtures.products)
    await removeIds('recurring_expenses', 'id', fixtures.recurring)
    await removeIds('audit_logs', 'user_id', fixtures.admins)
    for (const id of fixtures.orders) await execute("DELETE FROM audit_logs WHERE entity='pedido_online' AND entity_id=?", [String(id)])
    await removeIds('customers', 'id', fixtures.customers)
    await removeIds('admin_users', 'id', fixtures.admins)
    await removeIds('sessions', 'session_id', [...fixtures.sessions])
  } finally {
    await db.end()
  }
})

test('o banco novo contém as tabelas e colunas usadas por pagamentos e webhooks', async () => {
  for (const [table, required] of [
    ['payments', ['channel', 'store_order_id', 'sale_id', 'method', 'provider', 'provider_reference', 'status', 'amount', 'payment_url', 'idempotency_key', 'raw_payload', 'paid_at']],
    ['integration_events', ['provider', 'event_id', 'event_type', 'payload', 'processed_at']]
  ]) {
    const columns = await execute('SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?', [table])
    const names = new Set(columns.map(row => row.name))
    for (const name of required) assert.ok(names.has(name), `${table}.${name} ausente`)
  }
})

test('catálogo e detalhe públicos omitem custo e estoque mínimo', async () => {
  const productId = await productFixture()
  const client = new Client()
  const catalog = await client.request('/api/store')
  assert.equal(catalog.response.status, 200)
  assert.ok(catalog.data.products.some(product => product.id === productId))
  for (const product of catalog.data.products) {
    assert.equal(Object.hasOwn(product, 'cost'), false)
    assert.equal(Object.hasOwn(product, 'min_stock'), false)
  }
  const detail = await client.request('/api/store/products/' + productId)
  assert.equal(detail.response.status, 200)
  assert.equal(detail.data.product.id, productId)
  assert.equal(Object.hasOwn(detail.data.product, 'cost'), false)
  assert.equal(Object.hasOwn(detail.data.product, 'min_stock'), false)
})

test('alterar senha preserva as duas opções de duração da sessão', async () => {
  try {
    for (const remember of [false, true]) {
      await execute('UPDATE admin_users SET password_hash=? WHERE id=?', [passwordHash, fixtures.admins[0]])
      const { client, login } = await adminClient(remember)
      const originalCookie = client.cookie
      const loginCookie = login.cookies.find(cookie => cookie.startsWith('galeo_sid='))
      assert.equal(/;\s*Expires=/i.test(loginCookie), remember)
      const newPassword = 'Changed-local-' + randomBytes(12).toString('hex')
      const changed = await client.request('/api/auth/password', { method: 'PATCH', body: { currentPassword: password, newPassword } })
      assert.equal(changed.response.status, 200, changed.data.error)
      const changedCookie = changed.cookies.find(cookie => cookie.startsWith('galeo_sid='))
      assert.ok(changedCookie, 'a troca de senha deve renovar o identificador da sessão')
      assert.notEqual(client.cookie, originalCookie)
      assert.equal(/;\s*Expires=/i.test(changedCookie), remember, 'a troca de senha deve preservar manter conectado')
      const me = await client.request('/api/auth/me')
      assert.equal(me.response.status, 200)
      assert.equal(me.data.user.email, adminEmail)
      const wrong = await new Client().request('/api/auth/login', { method: 'POST', body: { email: adminEmail, password } })
      assert.equal(wrong.response.status, 401)
      await client.request('/api/auth/logout', { method: 'POST' })
    }
  } finally {
    await execute('UPDATE admin_users SET password_hash=? WHERE id=?', [passwordHash, fixtures.admins[0]])
  }
})

test('CSRF bloqueia uma operação administrativa com sessão válida sem token', async () => {
  const { client } = await adminClient()
  client.csrfToken = ''
  const attempt = await client.request('/api/admin/products', { method: 'POST', body: { name: 'Não deve ser criado ' + suffix } })
  assert.equal(attempt.response.status, 403)
  const rows = await execute('SELECT id FROM products WHERE name=?', ['Não deve ser criado ' + suffix])
  assert.equal(rows.length, 0)
})

test('distribuidora cancela reserva uma vez e não reabre pedido cancelado', async () => {
  const { productId, order } = await orderFixture()
  const reserved = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(reserved[0].stock, 8)
  const firstId = `dist-${suffix}-cancel-1`
  const first = await distributorEvent(order.code, 'CANCELLED', firstId)
  assert.equal(first.response.status, 200, first.data.error)
  const duplicate = await distributorEvent(order.code, 'CANCELLED', firstId)
  assert.equal(duplicate.response.status, 200, duplicate.data.error)
  const second = await distributorEvent(order.code, 'CANCELLED', `dist-${suffix}-cancel-2`)
  assert.equal(second.response.status, 200, second.data.error)
  const reopen = await distributorEvent(order.code, 'SHIPPED', `dist-${suffix}-reopen`)
  assert.ok([200, 400, 409].includes(reopen.response.status), 'evento após cancelamento deve ser ignorado ou rejeitado')
  const rows = await execute('SELECT status,payment_status FROM store_orders WHERE id=?', [order.id])
  assert.equal(rows[0].status, 'CANCELLED')
  assert.equal(rows[0].payment_status, 'CANCELLED')
  const stock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(stock[0].stock, 10)
  const returns = await execute("SELECT COUNT(*) AS total FROM stock_movements WHERE product_id=? AND reference_id=? AND type='ENTRADA'", [productId, 'store-order:' + order.id])
  assert.equal(returns[0].total, 1, 'a reserva deve ser devolvida uma única vez')
})

test('entregas simultâneas do mesmo webhook não duplicam a restituição de estoque', async () => {
  const { productId, order } = await orderFixture()
  const eventId = `dist-${suffix}-concurrent`
  const responses = await Promise.all(Array.from({ length: 3 }, () => distributorEvent(order.code, 'CANCELLED', eventId)))
  for (const result of responses) assert.equal(result.response.status, 200, result.data.error)
  const stock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(stock[0].stock, 10)
  const events = await execute("SELECT COUNT(*) AS total,COUNT(processed_at) AS processed FROM integration_events WHERE provider='DISTRIBUTOR' AND event_id=?", [eventId])
  assert.equal(events[0].total, 1)
  assert.equal(events[0].processed, 1)
})

test('pagamento não pode acessar um pedido pertencente a outro cliente', async () => {
  const first = await orderFixture()
  const second = await orderFixture()
  const response = await second.client.request('/api/store/orders/' + first.order.id + '/payment', { method: 'POST' })
  assert.equal(response.response.status, 404)
})

test('cancelar pela aba Vendas não estorna localmente uma venda online aprovada', async () => {
  const { productId, order } = await orderFixture()
  const sale = await execute("INSERT INTO sales(code,customer_name,payment_method,total,status) VALUES(?,'Cliente de teste','PIX',40,'PAGA')", ['VDA-TEST-' + suffix])
  fixtures.sales.push(sale.insertId)
  await execute('INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost,line_total) VALUES(?,?,2,20,8,40)', [sale.insertId, productId])
  await execute("INSERT INTO financial_entries(type,description,amount,status,paid_at,reference_type,reference_id) VALUES('RECEITA','Venda online de teste',40,'PAGO',NOW(),'VENDA',?)", ['sale:' + sale.insertId])
  await execute("UPDATE store_orders SET status='CONFIRMED',payment_status='APPROVED',sale_id=? WHERE id=?", [sale.insertId, order.id])
  const client = await operationsClient()
  const cancelled = await client.request('/api/admin/sales/' + sale.insertId + '/cancel', { method: 'PATCH' })
  assert.ok([400, 409].includes(cancelled.response.status), cancelled.data.error)
  const sales = await execute('SELECT status FROM sales WHERE id=?', [sale.insertId])
  assert.equal(sales[0].status, 'PAGA')
  const stock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(stock[0].stock, 8)
  const entries = await execute('SELECT status FROM financial_entries WHERE reference_id=?', ['sale:' + sale.insertId])
  assert.equal(entries[0].status, 'PAGO')
  const orders = await execute('SELECT status,payment_status FROM store_orders WHERE id=?', [order.id])
  assert.equal(orders[0].status, 'CONFIRMED')
  assert.equal(orders[0].payment_status, 'APPROVED')
  const distributor = await distributorEvent(order.code, 'CANCELLED', `dist-${suffix}-paid-cancel`)
  assert.equal(distributor.response.status, 200)
  assert.equal(distributor.data.ignored, true)
  const afterDistributor = await execute('SELECT status,payment_status FROM store_orders WHERE id=?', [order.id])
  assert.equal(afterDistributor[0].status, 'CONFIRMED')
  assert.equal(afterDistributor[0].payment_status, 'APPROVED')
  const afterStock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(afterStock[0].stock, 8)
})

test('configurações visuais aceitam as cores CSS usadas no padrão da loja', async () => {
  const existing = await execute("SELECT setting_value,draft_value,updated_by,updated_at FROM home_settings WHERE setting_key='storefront_visual_defaults'")
  const original = existing[0].setting_value
  const client = await operationsClient()
  try {
    const saved = await client.request('/api/admin/home/settings/storefront_visual_defaults', {
      method: 'PUT',
      body: { value: { theme: 'dark', palette: { background: '#050505', line: 'rgba(224,189,125,.19)', surface: 'rgb(1,2,3)', accent: 'hsl(10,50%,20%)' } } }
    })
    assert.equal(saved.response.status, 200, saved.data.error)
    assert.equal(saved.data.value.palette.line, 'rgba(224,189,125,.19)')
    const unsafe = await client.request('/api/admin/home/settings/storefront_visual_defaults', { method: 'PUT', body: { value: { palette: { background: 'url(https://example.invalid/image)' } } } })
    assert.equal(unsafe.response.status, 400)
  } finally {
    await execute("UPDATE home_settings SET setting_value=?,draft_value=?,updated_by=?,updated_at=? WHERE setting_key='storefront_visual_defaults'", [jsonParameter(original), jsonParameter(existing[0].draft_value), existing[0].updated_by, existing[0].updated_at])
  }
})

test('consultas simultâneas ao dashboard geram uma única recorrência com vencimento válido', async () => {
  const recurring = await execute('INSERT INTO recurring_expenses(description,amount,due_day) VALUES(?,10,31)', ['Recorrência de teste ' + suffix])
  fixtures.recurring.push(recurring.insertId)
  const client = await operationsClient()
  const results = await Promise.all(Array.from({ length: 4 }, () => client.request('/api/admin/dashboard')))
  for (const result of results) assert.equal(result.response.status, 200, result.data.error)
  const dates = await execute("SELECT DATE_FORMAT(CURRENT_DATE,'%Y-%m') AS month, DAY(LAST_DAY(CURRENT_DATE)) AS last_day")
  const entries = await execute("SELECT DATE_FORMAT(due_date,'%Y-%m-%d') AS due_date FROM financial_entries WHERE reference_id=?", [`recurring:${recurring.insertId}:${dates[0].month}`])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].due_date, `${dates[0].month}-${String(dates[0].last_day).padStart(2, '0')}`)
})

test('venda física baixa estoque e receita; cancelamento restitui ambos uma única vez', async () => {
  const productId = await productFixture()
  const client = await operationsClient()
  const created = await client.request('/api/admin/sales', {
    method: 'POST', body: { customer_name: 'Cliente PDV de teste', payment_method: 'DINHEIRO', items: [{ product_id: productId, quantity: 3 }] }
  })
  if (created.data.id) fixtures.sales.push(created.data.id)
  assert.equal(created.response.status, 201, created.data.error)
  const saleId = created.data.id
  assert.equal(Number(created.data.total), 60)
  assert.equal(created.data.status, 'PAGA')
  const soldStock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(soldStock[0].stock, 7)
  const income = await execute('SELECT amount,status FROM financial_entries WHERE reference_id=?', ['sale:' + saleId])
  assert.equal(income.length, 1)
  assert.equal(Number(income[0].amount), 60)
  assert.equal(income[0].status, 'PAGO')
  const cancelled = await client.request('/api/admin/sales/' + saleId + '/cancel', { method: 'PATCH' })
  assert.equal(cancelled.response.status, 200, cancelled.data.error)
  const duplicate = await client.request('/api/admin/sales/' + saleId + '/cancel', { method: 'PATCH' })
  assert.ok([400, 409].includes(duplicate.response.status))
  const restored = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(restored[0].stock, 10)
  const cancelledIncome = await execute('SELECT status,paid_at FROM financial_entries WHERE reference_id=?', ['sale:' + saleId])
  assert.equal(cancelledIncome[0].status, 'CANCELADO')
  assert.equal(cancelledIncome[0].paid_at, null)
  const sales = await execute('SELECT status FROM sales WHERE id=?', [saleId])
  assert.equal(sales[0].status, 'CANCELADA')
  const returns = await execute("SELECT COUNT(*) AS total FROM stock_movements WHERE product_id=? AND reference_id=? AND type='ENTRADA'", [productId, 'sale:' + saleId])
  assert.equal(returns[0].total, 1)
})

test('referência do PDV evita vendas e baixas duplicadas em repetição e concorrência', async () => {
  const client = await operationsClient()
  const productId = await productFixture()
  const reference = `sale-${suffix}-repeated`
  const body = { customer_name: 'Cliente repetição PDV', client_reference: reference, payment_method: 'PIX', items: [{ product_id: productId, quantity: 2 }] }
  const created = await client.request('/api/admin/sales', { method: 'POST', body })
  if (created.data.id) fixtures.sales.push(created.data.id)
  assert.equal(created.response.status, 201, created.data.error)
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.request('/api/admin/sales', { method: 'POST', body })
    if (response.data.id && !fixtures.sales.includes(response.data.id)) fixtures.sales.push(response.data.id)
    assert.equal(response.response.status, 200, response.data.error)
    assert.equal(response.data.id, created.data.id)
    assert.equal(response.data.code, created.data.code)
  }
  const stock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(stock[0].stock, 8)
  const income = await execute('SELECT COUNT(*) AS total FROM financial_entries WHERE reference_id=?', ['sale:' + created.data.id])
  assert.equal(income[0].total, 1)

  const concurrentProduct = await productFixture()
  const concurrentReference = `sale-${suffix}-concurrent`
  const responses = await Promise.all(Array.from({ length: 3 }, () => client.request('/api/admin/sales', {
    method: 'POST', body: { ...body, client_reference: concurrentReference, items: [{ product_id: concurrentProduct, quantity: 2 }] }
  })))
  const actualSales = await execute('SELECT id FROM sales WHERE user_id=? AND client_reference=?', [fixtures.admins[0], concurrentReference])
  for (const row of actualSales) if (!fixtures.sales.includes(row.id)) fixtures.sales.push(row.id)
  for (const response of responses) assert.ok([200, 201].includes(response.response.status), response.data.error)
  const ids = new Set(responses.map(response => response.data.id))
  assert.equal(ids.size, 1)
  assert.equal(actualSales.length, 1)
  const concurrentStock = await execute('SELECT stock FROM products WHERE id=?', [concurrentProduct])
  assert.equal(concurrentStock[0].stock, 8)
  const withdrawals = await execute("SELECT COUNT(*) AS total FROM stock_movements WHERE product_id=? AND type='SAIDA'", [concurrentProduct])
  assert.equal(withdrawals[0].total, 1)
  const concurrentIncome = await execute('SELECT COUNT(*) AS total FROM financial_entries WHERE reference_id=?', ['sale:' + actualSales[0].id])
  assert.equal(concurrentIncome[0].total, 1)
})

test('criação e edição rejeitam preços negativos e estoques negativos ou fracionados', async () => {
  const client = await operationsClient()
  const productId = await productFixture()
  const valid = { name: 'Validação produto ' + suffix, brand: 'Teste', description: 'Produto de teste', category_id: null, price: 20, cost: 8, stock: 10, min_stock: 2, image: '', video: '', active: true }
  const invalid = [
    { price: -1 }, { cost: -1 }, { stock: -1 }, { stock: 1.5 },
    { min_stock: -1 }, { min_stock: 0.5 }, { price: 'inválido' }
  ]
  for (const [index, values] of invalid.entries()) {
    const name = valid.name + '-' + index
    const created = await client.request('/api/admin/products', { method: 'POST', body: { ...valid, ...values, name } })
    if (created.data.id) fixtures.products.push(created.data.id)
    assert.equal(created.response.status, 400, 'Criação deve rejeitar ' + JSON.stringify(values))
    const rows = await execute('SELECT id FROM products WHERE name=?', [name])
    assert.equal(rows.length, 0)
    const edited = await client.request('/api/admin/products/' + productId, { method: 'PUT', body: { ...valid, ...values } })
    assert.equal(edited.response.status, 400, 'Edição deve rejeitar ' + JSON.stringify(values))
  }
  const unchanged = await execute('SELECT price,cost,stock,min_stock FROM products WHERE id=?', [productId])
  assert.equal(Number(unchanged[0].price), 20)
  assert.equal(Number(unchanged[0].cost), 8)
  assert.equal(unchanged[0].stock, 10)
  assert.equal(unchanged[0].min_stock, 2)
})

test('login e cadastro do cliente renovam a sessão e enviam cookie persistente', async () => {
  const { client, email, login } = await customerFixture()
  const original = client.cookie
  assert.ok(/;\s*Expires=/i.test(login.cookies.find(cookie => cookie.startsWith('galeo_sid='))))
  const second = await client.request('/api/customer/login', { method: 'POST', body: { email, password } })
  assert.equal(second.response.status, 200, second.data.error)
  assert.notEqual(client.cookie, original)
  assert.ok(/;\s*Expires=/i.test(second.cookies.find(cookie => cookie.startsWith('galeo_sid='))))
  const beforeRegistration = client.cookie
  const registered = await client.request('/api/customer/register', {
    method: 'POST', body: { name: 'Cliente cadastrado no teste', email: `registered-${suffix}@example.invalid`, password, phone: '11999999999' }
  })
  if (registered.data.user?.id) fixtures.customers.push(registered.data.user.id)
  assert.equal(registered.response.status, 200, registered.data.error)
  assert.notEqual(client.cookie, beforeRegistration)
  assert.ok(/;\s*Expires=/i.test(registered.cookies.find(cookie => cookie.startsWith('galeo_sid='))))
  const me = await client.request('/api/customer/me')
  assert.equal(me.response.status, 200)
  assert.equal(me.data.user.id, registered.data.user.id)
})

test('ajuste de estoque aceita zero e não aceita quantidade fracionada', async () => {
  const productId = await productFixture()
  const client = await operationsClient()
  const adjusted = await client.request('/api/admin/stock', { method: 'POST', body: { product_id: productId, type: 'AJUSTE', quantity: 0, reason: 'Zeramento de teste' } })
  assert.equal(adjusted.response.status, 200, adjusted.data.error)
  assert.equal(adjusted.data.before, 10)
  assert.equal(adjusted.data.after, 0)
  const fractional = await client.request('/api/admin/stock', { method: 'POST', body: { product_id: productId, type: 'AJUSTE', quantity: 1.5 } })
  assert.equal(fractional.response.status, 400)
  const stock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(stock[0].stock, 0)
  const movements = await execute("SELECT quantity,stock_before,stock_after FROM stock_movements WHERE product_id=? AND type='AJUSTE'", [productId])
  assert.equal(movements.length, 1)
  assert.equal(movements[0].quantity, -10)
  assert.equal(movements[0].stock_before, 10)
  assert.equal(movements[0].stock_after, 0)
})

test('CMS mantém conteúdo, visibilidade, ordem e menu privados até publicar a Home', async () => {
  const sections = await execute('SELECT * FROM home_sections ORDER BY id')
  const settings = await execute('SELECT * FROM home_settings ORDER BY setting_key')
  const client = await operationsClient()
  const publicClient = new Client()
  const hero = sections.find(row => row.section_key === 'hero')
  const utility = sections.find(row => row.section_key === 'utility')
  assert.ok(hero && utility)
  const heroDraft = typeof hero.draft_content === 'string' ? JSON.parse(hero.draft_content) : hero.draft_content
  const utilityDraft = typeof utility.draft_content === 'string' ? JSON.parse(utility.draft_content) : utility.draft_content
  const newHero = { ...heroDraft, title: 'Rascunho de integração ' + suffix }
  const navigation = { items: [{ label: 'Menu rascunho ' + suffix, url: '/shop?category=Camisetas' }] }
  try {
    const beforeHome = await publicClient.request('/api/store/home')
    const beforeSettings = await publicClient.request('/api/store/home/settings')
    assert.equal(beforeHome.response.status, 200)
    assert.equal(beforeSettings.response.status, 200)
    assert.ok(beforeHome.data.sections.some(section => section.key === 'utility'), 'a seção usada para verificar ocultação deve começar publicada')

    for (const [key, body] of [
      ['hero', { content: newHero, visible: true, order: 875 }],
      ['utility', { content: utilityDraft, visible: false, order: 5 }]
    ]) {
      const saved = await client.request('/api/admin/home/' + key, { method: 'PUT', body })
      assert.equal(saved.response.status, 200, saved.data.error)
      assert.equal(saved.data.saved_as, 'draft')
    }
    const menu = await client.request('/api/admin/home/settings/navigation', { method: 'PUT', body: { value: navigation } })
    assert.equal(menu.response.status, 200, menu.data.error)
    assert.equal(menu.data.saved_as, 'draft')

    const afterDraftHome = await publicClient.request('/api/store/home')
    const afterDraftSettings = await publicClient.request('/api/store/home/settings')
    assert.deepEqual(afterDraftHome.data, beforeHome.data, 'salvar rascunho não pode mudar a Home pública')
    assert.deepEqual(afterDraftSettings.data, beforeSettings.data, 'salvar menu não pode mudar o menu publicado')

    const preview = await client.request('/api/admin/home')
    const previewSettings = await client.request('/api/admin/home/settings')
    assert.equal(preview.response.status, 200)
    assert.equal(previewSettings.response.status, 200)
    const previewHero = preview.data.sections.find(section => section.key === 'hero')
    const previewUtility = preview.data.sections.find(section => section.key === 'utility')
    assert.deepEqual(previewHero.draft, newHero)
    assert.equal(previewHero.order, 875)
    assert.equal(previewHero.visible, true)
    assert.equal(previewUtility.order, 5)
    assert.equal(previewUtility.visible, false)
    assert.deepEqual(previewSettings.data.settings.find(setting => setting.key === 'navigation').value, navigation)

    const published = await client.request('/api/admin/home/publish', { method: 'POST' })
    assert.equal(published.response.status, 200, published.data.error)
    const finalHome = await publicClient.request('/api/store/home')
    const finalSettings = await publicClient.request('/api/store/home/settings')
    const publicHero = finalHome.data.sections.find(section => section.key === 'hero')
    assert.deepEqual(publicHero.content, newHero)
    assert.equal(publicHero.order, 875)
    assert.equal(finalHome.data.sections.some(section => section.key === 'utility'), false)
    const actualOrder = finalHome.data.sections.map(section => section.order)
    assert.deepEqual(actualOrder, [...actualOrder].sort((left, right) => left - right))
    assert.deepEqual(finalSettings.data.settings.find(setting => setting.key === 'navigation').value, navigation)
  } finally {
    await restoreCms(sections, settings)
  }
  assert.deepEqual(await execute('SELECT * FROM home_sections ORDER BY id'), sections, 'o teste deve restaurar todas as colunas das seções')
  assert.deepEqual(await execute('SELECT * FROM home_settings ORDER BY setting_key'), settings, 'o teste deve restaurar todas as colunas das configurações')
})

test('STAFF não inicia sessão administrativa; prévia e publicação exigem dono', async () => {
  const publicClient = new Client()
  for (const path of ['/api/admin/home', '/api/admin/home/settings']) {
    const anonymous = await publicClient.request(path)
    assert.equal(anonymous.response.status, 401)
  }
  const email = `staff-${suffix}@example.invalid`
  const staff = await execute("INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,'staff',1)", [email, passwordHash])
  fixtures.admins.push(staff.insertId)
  const client = new Client()
  const login = await client.request('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.response.status, 403)
  assert.equal(login.data.code, 'ADMIN_OWNER_REQUIRED')
  assert.equal(client.cookie, '')
  for (const path of ['/api/admin/home', '/api/admin/home/settings']) {
    const forbidden = await client.request(path)
    assert.equal(forbidden.response.status, 401)
  }
  const forbiddenPublish = await client.request('/api/admin/home/publish', { method: 'POST' })
  assert.equal(forbiddenPublish.response.status, 403)
})

test('reiniciar a API preserva as ordens e configurações do CMS já salvas', async () => {
  const sections = await execute('SELECT * FROM home_sections ORDER BY id')
  const settings = await execute('SELECT * FROM home_settings ORDER BY setting_key')
  let child
  try {
    await execute("UPDATE home_sections SET sort_order=823,published_sort_order=824,visible=0,published_visible=1 WHERE section_key='hero'")
    await execute("UPDATE home_settings SET draft_value=? WHERE setting_key='navigation'", [JSON.stringify({ items: [{ label: 'Rascunho persistente ' + suffix, url: '/shop' }] })])
    const savedSections = await execute('SELECT * FROM home_sections ORDER BY id')
    const savedSettings = await execute('SELECT * FROM home_settings ORDER BY setting_key')
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // Apenas o sinal de prontidão é observado; logs e variáveis privadas não são exibidos.
    await new Promise((resolve, reject) => {
      let output = ''
      const timeout = setTimeout(() => reject(new Error('O processo de reinício não iniciou a API em 30 segundos.')), 30000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('O processo de reinício terminou antes de iniciar a API: ' + code)) })
      child.stdout.on('data', data => {
        output = (output + data.toString()).slice(-4096)
        if (output.includes('GALEO API running on port')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      child.stderr.resume()
    })
    assert.deepEqual(await execute('SELECT * FROM home_sections ORDER BY id'), savedSections)
    assert.deepEqual(await execute('SELECT * FROM home_settings ORDER BY setting_key'), savedSettings)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
        child.once('close', () => { clearTimeout(timeout); resolve() })
        child.kill('SIGTERM')
      })
    }
    await restoreCms(sections, settings)
  }
})

test('PDV rejeita total desatualizado sem efeitos e permite confirmar a mesma referência', async () => {
  const productId = await productFixture()
  const client = await operationsClient()
  const reference = `sale-total-${suffix}`
  const body = { client_reference: reference, expected_total: 39, payment_method: 'PIX', items: [{ product_id: productId, quantity: 2 }] }
  const originalEntries = await execute('SELECT COUNT(*) AS total FROM financial_entries WHERE user_id=?', [fixtures.admins[0]])
  const outdated = await client.request('/api/admin/sales', { method: 'POST', body })
  if (outdated.data.id) fixtures.sales.push(outdated.data.id)
  assert.equal(outdated.response.status, 409, outdated.data.error)
  const unchangedStock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(unchangedStock[0].stock, 10)
  const noSale = await execute('SELECT id FROM sales WHERE user_id=? AND client_reference=?', [fixtures.admins[0], reference])
  assert.equal(noSale.length, 0)
  const noMovement = await execute('SELECT COUNT(*) AS total FROM stock_movements WHERE product_id=?', [productId])
  assert.equal(noMovement[0].total, 0)
  const unchangedEntries = await execute('SELECT COUNT(*) AS total FROM financial_entries WHERE user_id=?', [fixtures.admins[0]])
  assert.equal(unchangedEntries[0].total, originalEntries[0].total)

  const confirmed = await client.request('/api/admin/sales', { method: 'POST', body: { ...body, expected_total: 40 } })
  if (confirmed.data.id && !fixtures.sales.includes(confirmed.data.id)) fixtures.sales.push(confirmed.data.id)
  assert.equal(confirmed.response.status, 201, confirmed.data.error)
  assert.equal(Number(confirmed.data.total), 40)
  const oneSale = await execute('SELECT id FROM sales WHERE user_id=? AND client_reference=?', [fixtures.admins[0], reference])
  assert.equal(oneSale.length, 1)
  assert.equal(oneSale[0].id, confirmed.data.id)
  const soldStock = await execute('SELECT stock FROM products WHERE id=?', [productId])
  assert.equal(soldStock[0].stock, 8)
  const income = await execute('SELECT amount,status FROM financial_entries WHERE reference_id=?', ['sale:' + confirmed.data.id])
  assert.equal(income.length, 1)
  assert.equal(Number(income[0].amount), 40)
  assert.equal(income[0].status, 'PAGO')
})
