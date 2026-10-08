import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import bcrypt from 'bcrypt'
import mysql from 'mysql2/promise'

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
if (!loopbackHosts.has(process.env.DB_HOST) || process.env.DB_NAME !== 'galeo_store_test') {
  throw new Error('Os testes Mercado Pago exigem DB_HOST loopback e DB_NAME=galeo_store_test.')
}
const checkoutRoot = fileURLToPath(new URL('..', import.meta.url))
const baseUrl = new URL('http://127.0.0.1:10001')
const suffix = randomBytes(8).toString('hex')
const password = 'MP-local-' + randomBytes(12).toString('hex')
const webhookSecret = randomBytes(32).toString('hex')
const fixtures = { products: [], orders: [], events: [], sessions: new Set() }
const mpFixtures = { orders: {}, checkouts: {} }
let db, child, childExited, tempDirectory, fixturePath, customerId, adminId, customer, admin
let eventSequence = 0

async function execute(sql, params = []) {
  const [rows] = await db.execute(sql, params)
  return rows
}

async function removeIds(table, column, ids) {
  if (!ids.length) return
  await execute(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(',')})`, ids)
}

class Client {
  cookie = ''
  csrfToken = ''

  async request(requestPath, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(new URL(requestPath, baseUrl), {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    for (const cookie of response.headers.getSetCookie()) {
      if (!cookie.startsWith('galeo_sid=')) continue
      this.cookie = cookie.split(';', 1)[0]
      const value = decodeURIComponent(this.cookie.slice('galeo_sid='.length))
      if (value.startsWith('s:')) fixtures.sessions.add(value.slice(2, value.lastIndexOf('.')))
    }
    const data = await response.json()
    if (data.csrfToken) this.csrfToken = data.csrfToken
    return { response, data }
  }
}

async function saveMpFixtures() {
  await writeFile(fixturePath + '.next', JSON.stringify(mpFixtures), { mode: 0o600 })
  await rename(fixturePath + '.next', fixturePath)
}

async function waitForCheckoutStart(fixture) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const log = await readFile(fixturePath + '.calls', 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const calls = log.trim() ? log.trim().split('\n').map(line => JSON.parse(line)) : []
    if (calls.some(call => call.phase === 'started' && call.method === 'POST' && call.external_reference === fixture.order.code)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('A criação do checkout simulado não iniciou.')
}

async function orderFixture(quantity = 2) {
  const inserted = await execute(
    'INSERT INTO products(name,description,price,cost,stock,min_stock,active) VALUES(?,?,?,?,?,?,1)',
    ['Teste MP ' + suffix + '-' + fixtures.products.length, 'Produto de integração local', 20, 8, 10, 2]
  )
  const productId = inserted.insertId
  fixtures.products.push(productId)
  const created = await customer.request('/api/store/orders', {
    method: 'POST',
    body: {
      items: [{ product_id: productId, quantity }],
      shipping: { name: 'Cliente teste MP', phone: '11999999999', postal_code: '01001000', street: 'Rua de teste', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' }
    }
  })
  assert.equal(created.response.status, 200, created.data.error)
  const order = created.data.order
  fixtures.orders.push(order.id)
  return { productId, order, quantity, providerId: 'mp-' + suffix + '-' + order.id }
}

async function setPayment(fixture, status, amount = fixture.order.total) {
  mpFixtures.orders[fixture.providerId] = {
    id: fixture.providerId, external_reference: fixture.order.code, status,
    total_amount: Number(amount).toFixed(2),
    transactions: { payments: [{ status, amount: Number(amount).toFixed(2), payment_method: { type: 'pix' } }] }
  }
  await saveMpFixtures()
}

function eventId() { return 'mp-event-' + suffix + '-' + (++eventSequence) }

async function notify(fixture, id = eventId()) {
  if (!fixtures.events.includes(id)) fixtures.events.push(id)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestId = 'request-' + id
  const manifest = 'id:' + fixture.providerId + ';request-id:' + requestId + ';ts:' + timestamp + ';'
  const signature = createHmac('sha256', webhookSecret).update(manifest).digest('hex')
  return new Client().request('/api/integrations/mercado-pago/webhook?data.id=' + encodeURIComponent(fixture.providerId), {
    method: 'POST',
    headers: { 'X-Request-Id': requestId, 'X-Signature': 'ts=' + timestamp + ',v1=' + signature },
    body: { id, type: 'order', data: { id: fixture.providerId } }
  })
}

async function state(fixture) {
  const [order] = await execute('SELECT * FROM store_orders WHERE id=?', [fixture.order.id])
  const [product] = await execute('SELECT stock FROM products WHERE id=?', [fixture.productId])
  const payments = await execute('SELECT * FROM payments WHERE store_order_id=?', [fixture.order.id])
  const movements = await execute('SELECT type,quantity FROM stock_movements WHERE product_id=?', [fixture.productId])
  const sales = order.sale_id ? await execute('SELECT * FROM sales WHERE id=?', [order.sale_id]) : []
  const entries = order.sale_id ? await execute("SELECT * FROM financial_entries WHERE reference_type='VENDA' AND reference_id=?", ['sale:' + order.sale_id]) : []
  return { order, stock: Number(product.stock), payments, movements, sales, entries }
}

async function cancel(fixture) {
  const result = await admin.request('/api/admin/store-orders/' + fixture.order.id + '/status', {
    method: 'PATCH', body: { status: 'CANCELLED' }
  })
  assert.equal(result.response.status, 200, result.data.error)
}

before(async () => {
  tempDirectory = await mkdtemp(path.join(tmpdir(), 'galeo-mp-tests-'))
  fixturePath = path.join(tempDirectory, 'fixtures.json')
  await saveMpFixtures()
  let serverOutput = ''
  let spawnError
  child = spawn(process.execPath, ['--import', path.join(checkoutRoot, 'tests/helpers/mercado-pago-fetch.mjs'), 'server/index.js'], {
    cwd: checkoutRoot,
    env: {
      ...process.env, NODE_ENV: 'development', PORT: '10001', DB_SSL: 'false',
      APP_URL: baseUrl.origin, ALLOWED_ORIGINS: baseUrl.origin,
      SESSION_SECRET: randomBytes(32).toString('hex'),
      MERCADO_PAGO_ACCESS_TOKEN: 'galeo-test-token', MERCADO_PAGO_WEBHOOK_SECRET: webhookSecret,
      GALEO_TEST_MP_FIXTURES: fixturePath,
      RESEND_API_KEY: '', EMAIL_FROM: '', STORE_NOTIFICATION_EMAIL: '',
      CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.on('error', (error) => { spawnError = error })
  childExited = new Promise((resolve) => child.once('exit', resolve))
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { serverOutput = (serverOutput + chunk).slice(-3000) })
  let ready = false
  for (let attempt = 0; attempt < 150; attempt++) {
    if (spawnError || child.exitCode !== null) throw new Error('Servidor MP local falhou: ' + (spawnError?.message || serverOutput))
    if (serverOutput.includes('GALEO API running on port 10001')) {
      try {
        const response = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(300) })
        if (response.status === 200) { ready = true; break }
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, 'Servidor MP local não iniciou: ' + serverOutput)
  db = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 4 })
  const [database] = await execute('SELECT DATABASE() AS name')
  assert.equal(database.name, 'galeo_store_test')
  customer = new Client()
  const registered = await customer.request('/api/customer/register', {
    method: 'POST', body: { name: 'Cliente teste MP', email: 'mp-customer-' + suffix + '@example.invalid', phone: '11999999999', password }
  })
  assert.equal(registered.response.status, 200, registered.data.error)
  customerId = registered.data.user.id
  const insertedAdmin = await execute("INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,'owner',1)", ['mp-admin-' + suffix + '@example.invalid', await bcrypt.hash(password, 12)])
  adminId = insertedAdmin.insertId
  admin = new Client()
  const login = await admin.request('/api/auth/login', { method: 'POST', body: { email: 'mp-admin-' + suffix + '@example.invalid', password } })
  assert.equal(login.response.status, 200, login.data.error)
}, { timeout: 25000 })

after(async () => {
  if (child?.pid && child.exitCode === null) {
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
    timer.unref()
    await childExited
    clearTimeout(timer)
  }
  try {
    if (db) {
      const orders = fixtures.orders.length ? await execute(`SELECT sale_id FROM store_orders WHERE id IN (${fixtures.orders.map(() => '?').join(',')})`, fixtures.orders) : []
      const sales = [...new Set(orders.map(order => order.sale_id).filter(Boolean))]
      await removeIds('integration_events', 'event_id', fixtures.events)
      await removeIds('payments', 'store_order_id', fixtures.orders)
      await removeIds('financial_entries', 'reference_id', sales.map(id => 'sale:' + id))
      await removeIds('store_order_items', 'order_id', fixtures.orders)
      await removeIds('store_orders', 'id', fixtures.orders)
      await removeIds('sale_items', 'sale_id', sales)
      await removeIds('sales', 'id', sales)
      await removeIds('stock_movements', 'product_id', fixtures.products)
      await removeIds('products', 'id', fixtures.products)
      if (adminId) await execute('DELETE FROM audit_logs WHERE user_id=?', [adminId])
      for (const id of fixtures.orders) await execute("DELETE FROM audit_logs WHERE entity='pedido_online' AND entity_id=?", [String(id)])
      if (customerId) await execute('DELETE FROM customers WHERE id=?', [customerId])
      if (adminId) await execute('DELETE FROM admin_users WHERE id=?', [adminId])
      await removeIds('sessions', 'session_id', [...fixtures.sessions])
    }
  } finally {
    if (db) await db.end()
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true })
  }
})

test('aprovações repetidas e concorrentes geram somente uma venda e uma receita', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'approved')
  const responses = await Promise.all([notify(fixture), notify(fixture)])
  for (const result of responses) assert.equal(result.response.status, 200, result.data.error)
  const repeated = await notify(fixture)
  assert.equal(repeated.response.status, 200)
  const current = await state(fixture)
  assert.equal(current.order.status, 'CONFIRMED')
  assert.equal(current.order.payment_status, 'APPROVED')
  assert.equal(current.stock, 8)
  assert.equal(current.sales.length, 1)
  assert.equal(current.sales[0].status, 'PAGA')
  assert.equal(current.entries.length, 1)
  assert.equal(current.entries[0].status, 'PAGO')
  assert.equal(Number(current.entries[0].amount), 40)
  assert.equal(current.payments.length, 1)
})

test('estornos repetidos após aprovação devolvem estoque e cancelam receita somente uma vez', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'approved')
  assert.equal((await notify(fixture)).response.status, 200)
  await setPayment(fixture, 'refunded')
  for (const result of await Promise.all([notify(fixture), notify(fixture)])) assert.equal(result.response.status, 200, result.data.error)
  const current = await state(fixture)
  assert.equal(current.order.status, 'CANCELLED')
  assert.equal(current.order.payment_status, 'REFUNDED')
  assert.equal(current.stock, 10)
  assert.equal(current.movements.filter(item => item.type === 'ENTRADA').length, 1)
  assert.equal(current.sales[0].status, 'CANCELADA')
  assert.equal(current.entries[0].status, 'CANCELADO')
})

test('estorno de pedido sem venda devolve reserva somente uma vez', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'refunded')
  for (const result of [await notify(fixture), await notify(fixture)]) assert.equal(result.response.status, 200, result.data.error)
  const current = await state(fixture)
  assert.equal(current.stock, 10)
  assert.equal(current.order.payment_status, 'REFUNDED')
  assert.equal(current.order.sale_id, null)
  assert.equal(current.movements.filter(item => item.type === 'ENTRADA').length, 1)
})

test('estorno de pedido já cancelado preserva estoque previamente restituído', async () => {
  const fixture = await orderFixture()
  await cancel(fixture)
  await setPayment(fixture, 'refunded')
  assert.equal((await notify(fixture)).response.status, 200)
  const current = await state(fixture)
  assert.equal(current.stock, 10)
  assert.equal(current.order.payment_status, 'REFUNDED')
  assert.equal(current.order.sale_id, null)
  assert.equal(current.movements.filter(item => item.type === 'ENTRADA').length, 1)
})

test('notificações pendentes após aprovação ou estorno não regridem pagamento', async () => {
  for (const terminalStatus of ['approved', 'refunded']) {
    const fixture = await orderFixture()
    await setPayment(fixture, terminalStatus)
    assert.equal((await notify(fixture)).response.status, 200)
    const previous = await state(fixture)
    await setPayment(fixture, 'pending')
    const stale = await notify(fixture)
    assert.equal(stale.response.status, 200)
    assert.equal(stale.data.reason, 'status_pagamento_regressivo')
    const current = await state(fixture)
    assert.equal(current.order.payment_status, previous.order.payment_status)
    assert.equal(current.order.status, previous.order.status)
    assert.equal(current.order.paid_at?.getTime(), previous.order.paid_at?.getTime())
    assert.equal(current.payments[0].status, previous.payments[0].status)
    assert.equal(current.stock, previous.stock)
  }
})

test('aprovação após cancelamento exige conciliação e não recria venda nem consome estoque', async () => {
  const fixture = await orderFixture()
  await cancel(fixture)
  await setPayment(fixture, 'approved')
  const approved = await notify(fixture)
  assert.equal(approved.response.status, 200, approved.data.error)
  assert.equal(approved.data.reconciliation_required, true)
  const current = await state(fixture)
  assert.equal(current.order.status, 'CANCELLED')
  assert.equal(current.order.payment_status, 'APPROVED')
  assert.equal(current.order.sale_id, null)
  assert.equal(current.stock, 10)
  assert.equal(current.payments.length, 1)
})

test('valor aprovado divergente rejeita evento com rollback atômico e permite nova tentativa', async () => {
  const fixture = await orderFixture()
  const id = eventId()
  await setPayment(fixture, 'approved', 1)
  const rejected = await notify(fixture, id)
  assert.equal(rejected.response.status, 500)
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'PENDING')
  assert.equal(current.order.sale_id, null)
  assert.equal(current.stock, 8)
  assert.equal(current.payments.length, 0)
  const events = await execute('SELECT id FROM integration_events WHERE provider=? AND event_id=?', ['MERCADO_PAGO', id])
  assert.equal(events.length, 0)
  await setPayment(fixture, 'approved')
  const retried = await notify(fixture, id)
  assert.equal(retried.response.status, 200, retried.data.error)
  assert.equal((await state(fixture)).order.payment_status, 'APPROVED')
})

test('link de pagamento persistido é reutilizado sem segunda criação no provedor', async () => {
  const fixture = await orderFixture()
  const checkoutUrl = 'https://example.invalid/local-checkout/' + fixture.providerId
  mpFixtures.checkouts[fixture.order.code] = { id: fixture.providerId, checkout_url: checkoutUrl }
  await saveMpFixtures()
  for (let attempt = 0; attempt < 2; attempt++) {
    const payment = await customer.request('/api/store/orders/' + fixture.order.id + '/payment', { method: 'POST', body: {} })
    assert.equal(payment.response.status, 200, payment.data.error)
    assert.equal(payment.data.checkout_url, checkoutUrl)
  }
  const calls = (await readFile(fixturePath + '.calls', 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(calls.filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1)
  const current = await state(fixture)
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].payment_url, checkoutUrl)
  assert.equal(current.order.payment_url, checkoutUrl)
})

test('aprovação durante criação do checkout preserva pagamento aprovado e retorna pedido pago', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'approved')
  mpFixtures.checkouts[fixture.order.code] = {
    id: fixture.providerId, checkout_url: 'https://example.invalid/delayed-checkout/' + fixture.providerId, __delay_ms: 750
  }
  await saveMpFixtures()
  const checkoutRequest = customer.request('/api/store/orders/' + fixture.order.id + '/payment', { method: 'POST', body: {} })
  checkoutRequest.catch(() => {})
  await waitForCheckoutStart(fixture)
  const approved = await notify(fixture)
  assert.equal(approved.response.status, 200, approved.data.error)
  const checkout = await checkoutRequest
  assert.equal(checkout.response.status, 200, checkout.data.error)
  assert.equal(checkout.data.paid, true)
  assert.equal(checkout.data.order.payment_status, 'APPROVED')
  assert.equal(checkout.data.checkout_url, undefined)
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'APPROVED')
  assert.equal(current.order.status, 'CONFIRMED')
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].status, 'APPROVED')
  assert.equal(current.order.payment_url, null)
  assert.equal(current.stock, 8)
  assert.equal(current.sales.length, 1)
  assert.equal(current.entries.length, 1)
})

test('cancelamento durante criação do checkout impede persistir link e mantém estoque restituído', async () => {
  const fixture = await orderFixture()
  mpFixtures.checkouts[fixture.order.code] = {
    id: fixture.providerId, checkout_url: 'https://example.invalid/delayed-checkout/' + fixture.providerId, __delay_ms: 750
  }
  await saveMpFixtures()
  const checkoutRequest = customer.request('/api/store/orders/' + fixture.order.id + '/payment', { method: 'POST', body: {} })
  checkoutRequest.catch(() => {})
  await waitForCheckoutStart(fixture)
  await cancel(fixture)
  const checkout = await checkoutRequest
  assert.equal(checkout.response.status, 409)
  assert.equal(checkout.data.checkout_url, undefined)
  const current = await state(fixture)
  assert.equal(current.order.status, 'CANCELLED')
  assert.equal(current.order.payment_status, 'CANCELLED')
  assert.equal(current.order.payment_url, null)
  assert.equal(current.order.sale_id, null)
  assert.equal(current.payments.length, 0)
  assert.equal(current.stock, 10)
  assert.equal(current.movements.filter(item => item.type === 'ENTRADA').length, 1)
})
