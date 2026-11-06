import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import bcrypt from 'bcrypt'
import mysql from 'mysql2/promise'
import { createPaymentReservationExpiry } from '../server/payment-reservations.js'

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
const mpFixtures = { orders: {}, creations: {}, searches: {} }
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

// A provider reference is normally already persisted before an Orders webhook
// arrives. Creation/race tests opt out and exercise that binding through HTTP.
async function orderFixture(quantity = 2, { bind = true } = {}) {
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
  const fixture = { productId, order, quantity, providerId: 'ORD' + suffix.toUpperCase() + String(order.id),
    attemptId: randomUUID(), testAddress: '127.0.1.' + fixtures.orders.length }
  await setPayment(fixture, 'pending')
  if (bind) {
    await execute("INSERT INTO payments(channel,store_order_id,method,provider,provider_reference,status,amount,idempotency_key,raw_payload) VALUES('ONLINE',?,'PIX','MERCADO_PAGO',?,'PENDING',?,?,?)", [order.id, fixture.providerId, Number(order.total), fixture.attemptId, JSON.stringify(mpFixtures.orders[fixture.providerId])])
    await execute("UPDATE store_orders SET payment_provider='MERCADO_PAGO',payment_method='PIX',payment_reference=? WHERE id=?", [fixture.providerId, order.id])
  }
  return fixture
}

async function setPayment(fixture, status, amount = fixture.order.total) {
  const paid = status === 'approved' || status === 'refunded'
  const providerStatus = { approved: 'processed', pending: 'action_required', rejected: 'failed' }[status] || status
  const detail = { approved: 'accredited', pending: 'waiting_payment', rejected: 'rejected_by_issuer', refunded: 'refunded' }[status] || status
  mpFixtures.orders[fixture.providerId] = {
    id: fixture.providerId, user_id: '42', country_code: 'BRA', external_reference: fixture.order.code,
    type: 'online', processing_mode: 'automatic', created_date: fixture.createdDate ||= new Date().toISOString(),
    status: providerStatus, status_detail: detail, total_amount: Number(amount).toFixed(2),
    total_paid_amount: paid ? Number(amount).toFixed(2) : '0.00',
    transactions: { payments: [{ id: 'PAY' + fixture.providerId, status: providerStatus, status_detail: detail,
      amount: Number(amount).toFixed(2), paid_amount: paid ? Number(amount).toFixed(2) : '0.00',
      payment_method: { id: 'pix', type: 'bank_transfer', qr_code: '000201-LOCAL-TEST-' + fixture.providerId, qr_code_base64: 'bG9jYWwtdGVzdA==' }
    }] }
  }
  await saveMpFixtures()
}

function paymentBody(fixture, extra = {}) {
  // Official Brazil test CPF from the Mercado Pago plugin's checkout-api guide.
  return { method: 'pix', identification: { type: 'CPF', number: '12345678909' }, use_shipping_address: true, attempt_id: fixture.attemptId, ...extra }
}

async function startPayment(fixture, extra = {}) {
  // Each isolated scenario is a separate local client. Retries and concurrent
  // requests for that scenario retain one address and the real rate limiter.
  return customer.request('/api/store/orders/' + fixture.order.id + '/payment', {
    method: 'POST', body: paymentBody(fixture, extra), headers: { 'X-Forwarded-For': fixture.testAddress }
  })
}

async function lostApprovedPayment({ card = false } = {}) {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = { __throw: true }
  await saveMpFixtures()
  const creation = await startPayment(fixture, card ? {
    method: 'credit_card', token: 'local-card-token-read-recovery', payment_method_id: 'visa', installments: 1
  } : {})
  assert.equal(creation.response.status, 503, creation.data.error)
  assert.equal(creation.data.code, 'PAYMENT_RESULT_PENDING')
  await setPayment(fixture, 'approved')
  if (card) {
    mpFixtures.orders[fixture.providerId].transactions.payments[0].payment_method = { id: 'visa', type: 'credit_card', installments: 1 }
    await saveMpFixtures()
  }
  return fixture
}

async function calls() {
  const text = await readFile(fixturePath + '.calls', 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : []
}

function eventId() { return 'mp-event-' + suffix + '-' + (++eventSequence) }

async function notify(fixture, id = eventId(), { signatureOverride, bodyId = fixture.providerId, topic = 'orders' } = {}) {
  if (!fixtures.events.includes(id)) fixtures.events.push(id)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestId = 'request-' + id
  const manifest = 'id:' + fixture.providerId.toLowerCase() + ';request-id:' + requestId + ';ts:' + timestamp + ';'
  const signature = createHmac('sha256', webhookSecret).update(manifest).digest('hex')
  return new Client().request('/api/integrations/mercado-pago/webhook?data.id=' + encodeURIComponent(fixture.providerId), {
    method: 'POST',
    headers: { 'X-Request-Id': requestId, 'X-Signature': signatureOverride || 'ts=' + timestamp + ',v1=' + signature },
    body: { id, type: topic, data: { id: bodyId } }
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
      MERCADO_PAGO_MODE: 'test', MERCADO_PAGO_ACCESS_TOKEN: '', MERCADO_PAGO_PUBLIC_KEY: '', MERCADO_PAGO_WEBHOOK_SECRET: '',
      GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN: 'APP_USR-local-test-only',
      GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY: 'APP_USR-local-public-test-only',
      GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET: webhookSecret,
      MERCADO_PAGO_TEST_SELLER_ID: '42', MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED: 'true',
      GALEO_TEST_MP_FIXTURES: fixturePath,
      RESEND_API_KEY: '', EMAIL_FROM: '', STORE_NOTIFICATION_EMAIL: '',
      CLOUDINARY_URL: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
      MERCADO_PAGO_POINT_TERMINAL_ID: '', DATA_ENCRYPTION_ENABLED: 'false', DATA_ENCRYPTION_KEY: ''
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
  // Buyers are already verified local fixtures. Registration/delivery is tested
  // separately and must never grant an authenticated session before confirmation.
  const hash = await bcrypt.hash(password, 12)
  const customerEmail = 'mp-customer-' + suffix + '@example.invalid'
  const insertedCustomer = await execute('INSERT INTO customers(name,email,password_hash,phone,email_verified_at) VALUES(?,?,?,?,NOW())',
    ['Cliente teste MP', customerEmail, hash, '11999999999'])
  customerId = insertedCustomer.insertId
  customer = new Client()
  const customerLogin = await customer.request('/api/customer/login', {
    method: 'POST', body: { email: customerEmail, password }
  })
  assert.equal(customerLogin.response.status, 200, customerLogin.data.error)
  assert.equal(customerLogin.data.user.id, customerId)
  const insertedAdmin = await execute("INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,'owner',1)", ['mp-admin-' + suffix + '@example.invalid', hash])
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
      // New callback event keys are derived from the provider state, not the
      // caller-controlled notification id. Remove only this run's provider ids.
      for (const id of Object.keys(mpFixtures.orders)) await execute("DELETE FROM integration_events WHERE provider='MERCADO_PAGO' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.id'))=?", [id])
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
    assert.equal(stale.data.ignored, true)
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
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].status, 'PENDING')
  const events = await execute('SELECT id FROM integration_events WHERE provider=? AND event_id=?', ['MERCADO_PAGO', id])
  assert.equal(events.length, 0)
  await setPayment(fixture, 'approved')
  const retried = await notify(fixture, id)
  assert.equal(retried.response.status, 200, retried.data.error)
  assert.equal((await state(fixture)).order.payment_status, 'APPROVED')
})

test('Pix persistido é reutilizado sem segunda criação e expõe somente instruções seguras', async () => {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = mpFixtures.orders[fixture.providerId]
  await saveMpFixtures()
  for (let attempt = 0; attempt < 2; attempt++) {
    const payment = await startPayment(fixture)
    assert.equal(payment.response.status, 200, payment.data.error)
    assert.equal(payment.data.payment.provider_reference, fixture.providerId)
    assert.equal(payment.data.payment.qr_code, '000201-LOCAL-TEST-' + fixture.providerId)
    assert.equal(payment.data.checkout_url, undefined)
    assert.equal(payment.data.payment.token, undefined)
    assert.equal(payment.data.payment.raw_payload, undefined)
  }
  const providerCalls = (await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code)
  assert.equal(providerCalls.length, 1)
  assert.equal(providerCalls[0].body.processing_mode, 'automatic')
  assert.equal(providerCalls[0].body.transactions.payments[0].payment_method.id, 'pix')
  assert.equal(providerCalls[0].body.total_amount, '40.00')
  assert.equal(providerCalls[0].idempotency_key, fixture.attemptId)
  const current = await state(fixture)
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].provider_reference, fixture.providerId)
  assert.ok(!current.payments[0].payment_url)
  assert.ok(!current.order.payment_url)
  const status = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.equal(status.response.status, 200, status.data.error)
  assert.equal(status.data.payment.provider_reference, fixture.providerId)
})

test('webhook sem tentativa vinculada pede retry e só confirma após criação persistida', async () => {
  const fixture = await orderFixture(2, { bind: false })
  await setPayment(fixture, 'approved')
  const premature = await notify(fixture)
  assert.ok([500, 503].includes(premature.response.status))
  assert.equal((await state(fixture)).sales.length, 0)
  mpFixtures.creations[fixture.order.code] = mpFixtures.orders[fixture.providerId]
  await saveMpFixtures()
  assert.equal((await startPayment(fixture)).response.status, 200)
  assert.equal((await notify(fixture)).response.status, 200)
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'APPROVED')
  assert.equal(current.sales.length, 1)
  assert.equal(current.entries.length, 1)
  assert.equal(current.stock, 8)
})

test('aprovação durante criação aguarda vínculo e preserva uma única venda e receita', async () => {
  const fixture = await orderFixture(2, { bind: false })
  await setPayment(fixture, 'approved')
  mpFixtures.creations[fixture.order.code] = { ...mpFixtures.orders[fixture.providerId], __delay_ms: 750 }
  await saveMpFixtures()
  const checkoutRequest = startPayment(fixture)
  checkoutRequest.catch(() => {})
  await waitForCheckoutStart(fixture)
  const approved = await notify(fixture)
  assert.ok([200, 500, 503].includes(approved.response.status))
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
  assert.equal((await notify(fixture)).response.status, 200)
  assert.equal((await state(fixture)).sales.length, 1)
})

test('cancelamento durante criação mantém referência para conciliação e estoque restituído', async () => {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = { ...mpFixtures.orders[fixture.providerId], __delay_ms: 750 }
  await saveMpFixtures()
  const checkoutRequest = startPayment(fixture)
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
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].provider_reference, fixture.providerId)
  assert.equal(current.stock, 10)
  assert.equal(current.movements.filter(item => item.type === 'ENTRADA').length, 1)
})

test('falha de transporte conserva tentativa e impede nova cobrança com UUID diferente', async () => {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = { __throw: true }
  await saveMpFixtures()
  const first = await startPayment(fixture)
  assert.equal(first.response.status, 503, first.data.error)
  assert.equal(first.data.code, 'PAYMENT_RESULT_PENDING')
  const duplicate = await startPayment(fixture, { attempt_id: randomUUID() })
  assert.equal(duplicate.response.status, 409, duplicate.data.error)
  assert.equal(duplicate.data.code, 'PAYMENT_ATTEMPT_PENDING')
  assert.deepEqual((await state(fixture)).payments[0].raw_payload, {}, 'ambiguous outcome must not be recorded as a definitive provider rejection')
  const beforeRetry = (await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code)
  assert.equal(beforeRetry.length, 1)
  mpFixtures.creations[fixture.order.code] = mpFixtures.orders[fixture.providerId]
  await saveMpFixtures()
  const retry = await startPayment(fixture)
  assert.equal(retry.response.status, 200, retry.data.error)
  const providerCalls = (await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code)
  assert.equal(providerCalls.length, 2)
  assert.deepEqual(providerCalls.map(call => call.idempotency_key), [fixture.attemptId, fixture.attemptId])
  const current = await state(fixture)
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].provider_reference, fixture.providerId)
  assert.equal(current.sales.length, 0)
  assert.equal(current.stock, 8)
})

test('webhook recupera cobrança aceita com resposta perdida sem repetir o POST', async () => {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = { __throw: true }
  await saveMpFixtures()
  const request = await startPayment(fixture)
  assert.equal(request.response.status, 503)
  assert.equal((await state(fixture)).payments[0].provider_reference, null)
  await setPayment(fixture, 'approved')
  const notice = await notify(fixture)
  assert.equal(notice.response.status, 200, notice.data.error)
  const duplicate = await notify(fixture)
  assert.equal(duplicate.response.status, 200, duplicate.data.error)
  const current = await state(fixture)
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].provider_reference, fixture.providerId)
  assert.equal(current.order.payment_status, 'APPROVED')
  assert.equal(current.sales.length, 1)
  assert.equal(current.entries.length, 1)
  assert.equal(current.stock, 8)
  assert.equal((await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1)
})

test('consulta recupera cartão aprovado com resposta perdida sem outra cobrança e preserva uma única venda', async () => {
  const fixture = await lostApprovedPayment({ card: true })
  const recovered = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.equal(recovered.response.status, 200, recovered.data.error)
  assert.equal(recovered.data.paid, true)
  assert.equal(recovered.data.payment.provider_reference, fixture.providerId)
  assert.equal(recovered.data.payment.attempt_id, fixture.attemptId)
  const providerCalls = (await calls()).filter(call => call.external_reference === fixture.order.code)
  const searches = providerCalls.filter(call => call.method === 'GET' && call.path === '/v1/orders')
  assert.equal(searches.length, 1)
  assert.equal(searches[0].query.external_reference, fixture.order.code)
  assert.ok(Number.isFinite(Date.parse(searches[0].query.begin_date)))
  assert.ok(Number.isFinite(Date.parse(searches[0].query.end_date)))
  const reconcileEvents = await execute("SELECT event_id FROM integration_events WHERE provider='MERCADO_PAGO' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.id'))=?", [fixture.providerId])
  assert.equal(reconcileEvents.length, 1)
  assert.ok(reconcileEvents[0].event_id.startsWith('reconcile-'), 'provider GET recovery must not be recorded as an actual provider notification')
  const repeated = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.equal(repeated.response.status, 200, repeated.data.error)
  assert.equal(repeated.data.paid, true)
  assert.equal((await notify(fixture)).response.status, 200)
  const current = await state(fixture)
  assert.equal(current.order.status, 'CONFIRMED')
  assert.equal(current.order.payment_status, 'APPROVED')
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].provider_reference, fixture.providerId)
  assert.equal(current.payments[0].idempotency_key, fixture.attemptId)
  assert.equal(current.sales.length, 1)
  assert.equal(current.entries.length, 1)
  assert.equal(Number(current.entries[0].amount), 40)
  assert.equal(current.stock, 8)
  assert.equal(current.movements.filter(value => value.type === 'SAIDA').length, 1)
  assert.equal((await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1)
})

test('busca vazia, ambígua, incompleta ou divergente conserva a mesma tentativa sem vínculo nem venda', async () => {
  const invalidCases = [
    ['empty', (_order, search) => { search.data = []; search.paging.total = '0'; search.paging.total_pages = '0' }],
    ['multiple', (order, search) => { search.data.push({ ...structuredClone(order), id: order.id + 'OTHER' }); search.paging.total = '2' }],
    ['partial-page', (_order, search) => { search.paging.total = '2'; search.paging.total_pages = '2' }],
    ['wrong-seller', order => { order.user_id = '999' }],
    ['wrong-amount', order => { order.total_amount = '1.00' }],
    ['wrong-method', order => { order.transactions.payments[0].payment_method = { id: 'visa', type: 'credit_card' } }],
    ['old-resource', order => { order.created_date = new Date(Date.now() - 60 * 60 * 1000).toISOString() }],
    ['missing-date', order => { delete order.created_date }],
    ['wrong-paid-amount', order => { order.total_paid_amount = '1.00'; order.transactions.payments[0].paid_amount = '1.00' }],
    ['unavailable-search', (_order, search) => { search.__http_status = 503 }]
  ]
  for (const [name, mutate] of invalidCases) {
    const fixture = await lostApprovedPayment()
    const order = mpFixtures.orders[fixture.providerId]
    const search = { data: [order], paging: { total: '1', total_pages: '1', offset: '0', limit: '50' } }
    mutate(order, search)
    mpFixtures.searches[fixture.order.code] = search
    await saveMpFixtures()
    const response = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
    assert.ok([200, 503].includes(response.response.status), name + ': ' + response.data.error)
    assert.notEqual(response.data.paid, true, name)
    const current = await state(fixture)
    assert.equal(current.order.payment_status, 'PENDING', name)
    assert.equal(current.order.payment_reference, null, name)
    assert.equal(current.payments.length, 1, name)
    assert.equal(current.payments[0].status, 'PENDING', name)
    assert.equal(current.payments[0].provider_reference, null, name)
    assert.equal(current.payments[0].idempotency_key, fixture.attemptId, name)
    assert.equal(current.sales.length, 0, name)
    assert.equal(current.entries.length, 0, name)
    assert.equal(current.stock, 8, name)
    assert.equal((await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1, name)
  }
})

test('GET autenticado divergente da busca não vincula cobrança nem altera a tentativa', async () => {
  const fixture = await lostApprovedPayment()
  const searchedOrder = structuredClone(mpFixtures.orders[fixture.providerId])
  mpFixtures.searches[fixture.order.code] = { data: [searchedOrder], paging: { total: '1', total_pages: '1', offset: '0', limit: '50' } }
  mpFixtures.orders[fixture.providerId].external_reference = 'ANOTHER-ORDER-' + suffix
  await saveMpFixtures()
  const response = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.ok([200, 503].includes(response.response.status))
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'PENDING')
  assert.equal(current.payments[0].provider_reference, null)
  assert.equal(current.payments[0].idempotency_key, fixture.attemptId)
  assert.equal(current.sales.length, 0)
  assert.equal(current.stock, 8)
})

test('cliente de outro pedido não consulta o provedor nem recupera tentativa alheia', async () => {
  const fixture = await lostApprovedPayment()
  const foreign = await execute("INSERT INTO customers(name,email,password_hash,phone,email_verified_at) SELECT 'Outro cliente MP',?,password_hash,phone,NOW() FROM customers WHERE id=?", ['mp-other-' + suffix + '@example.invalid', customerId])
  try {
    await execute('UPDATE store_orders SET customer_id=? WHERE id=?', [foreign.insertId, fixture.order.id])
    const beforeCalls = (await calls()).length
    const response = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
    assert.equal(response.response.status, 404)
    assert.equal((await calls()).length, beforeCalls)
    const current = await state(fixture)
    assert.equal(current.payments[0].provider_reference, null)
    assert.equal(current.payments[0].idempotency_key, fixture.attemptId)
    assert.equal(current.sales.length, 0)
  } finally {
    await execute('UPDATE store_orders SET customer_id=? WHERE id=?', [customerId, fixture.order.id])
    await execute('DELETE FROM customers WHERE id=?', [foreign.insertId])
  }
})

test('recuperação por consulta concorrente com webhook mantém somente uma venda e uma receita', async () => {
  const fixture = await lostApprovedPayment()
  const responses = await Promise.all([
    customer.request('/api/store/orders/' + fixture.order.id + '/payment'),
    customer.request('/api/store/orders/' + fixture.order.id + '/payment'),
    notify(fixture)
  ])
  assert.equal(responses[2].response.status, 200, responses[2].data.error)
  for (const response of responses.slice(0, 2)) assert.ok([200, 503].includes(response.response.status), response.data.error)
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'APPROVED')
  assert.equal(current.payments.length, 1)
  assert.equal(current.payments[0].idempotency_key, fixture.attemptId)
  assert.equal(current.payments[0].provider_reference, fixture.providerId)
  assert.equal(current.sales.length, 1)
  assert.equal(current.entries.length, 1)
  assert.equal(current.stock, 8)
  assert.equal(current.movements.filter(value => value.type === 'SAIDA').length, 1)
  assert.equal((await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1)
})

test('cancelamento durante busca de recuperação não reabre pedido nem retira estoque devolvido', async () => {
  const fixture = await lostApprovedPayment()
  mpFixtures.searches[fixture.order.code] = { data: [mpFixtures.orders[fixture.providerId]],
    paging: { total: '1', total_pages: '1', offset: '0', limit: '50' }, __delay_ms: 500 }
  await saveMpFixtures()
  const statusRequest = customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await calls()).some(call => call.method === 'GET' && call.path === '/v1/orders' && call.external_reference === fixture.order.code)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await cancel(fixture)
  const response = await statusRequest
  assert.ok([200, 503].includes(response.response.status), response.data.error)
  const current = await state(fixture)
  assert.equal(current.order.status, 'CANCELLED')
  assert.equal(current.sales.length, 0)
  assert.equal(current.entries.length, 0)
  assert.equal(current.stock, 10)
  assert.equal(current.movements.filter(value => value.type === 'ENTRADA').length, 1)
  assert.equal(current.payments[0].idempotency_key, fixture.attemptId)
  assert.equal((await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1)
})

test('UUID alterado durante busca de recuperação impede vínculo de um snapshot desatualizado', async () => {
  const fixture = await lostApprovedPayment()
  mpFixtures.searches[fixture.order.code] = { data: [mpFixtures.orders[fixture.providerId]],
    paging: { total: '1', total_pages: '1', offset: '0', limit: '50' }, __delay_ms: 500 }
  await saveMpFixtures()
  const statusRequest = customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await calls()).some(call => call.method === 'GET' && call.path === '/v1/orders' && call.external_reference === fixture.order.code)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const changedAttempt = randomUUID()
  await execute("UPDATE payments SET idempotency_key=? WHERE store_order_id=? AND status='PENDING' AND provider_reference IS NULL", [changedAttempt, fixture.order.id])
  const response = await statusRequest
  assert.ok([200, 503].includes(response.response.status), response.data.error)
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'PENDING')
  assert.equal(current.payments[0].provider_reference, null)
  assert.equal(current.payments[0].idempotency_key, changedAttempt)
  assert.equal(current.sales.length, 0)
  assert.equal(current.entries.length, 0)
  assert.equal(current.stock, 8)
  assert.equal((await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1)
})

test('duas tentativas pendentes impedem busca e recuperação mesmo quando somente a última não tem referência', async () => {
  const fixture = await orderFixture()
  const newerAttempt = randomUUID()
  await execute("INSERT INTO payments(channel,store_order_id,method,provider,provider_reference,status,amount,idempotency_key,raw_payload) VALUES('ONLINE',?,'pix','MERCADO_PAGO',NULL,'PENDING',?,?,?)", [fixture.order.id, fixture.order.total, newerAttempt, '{}'])
  const beforeCalls = (await calls()).length
  const response = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.ok([200, 503].includes(response.response.status), response.data.error)
  const providerCalls = (await calls()).slice(beforeCalls)
  assert.equal(providerCalls.some(call => call.method === 'GET' && call.path === '/v1/orders'), false)
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'PENDING')
  assert.equal(current.payments.length, 2)
  assert.equal(current.payments.find(payment => payment.idempotency_key === newerAttempt).provider_reference, null)
  assert.equal(current.sales.length, 0)
  assert.equal(current.stock, 8)
})

test('segunda tentativa com resposta perdida recupera Pix pendente e depois confirma a venda', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'rejected')
  assert.equal((await notify(fixture)).response.status, 200)
  fixture.providerId = 'ORDRECOVER' + suffix.toUpperCase() + fixture.order.id
  fixture.attemptId = randomUUID()
  await setPayment(fixture, 'pending')
  mpFixtures.creations[fixture.order.code] = { __throw: true }
  await saveMpFixtures()
  assert.equal((await startPayment(fixture)).response.status, 503)
  const pending = await notify(fixture)
  assert.equal(pending.response.status, 200, pending.data.error)
  const current = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.equal(current.response.status, 200, current.data.error)
  assert.equal(current.data.order.payment_status, 'PENDING')
  assert.equal(current.data.payment.provider_reference, fixture.providerId)
  assert.ok(current.data.payment.qr_code)
  await setPayment(fixture, 'approved')
  assert.equal((await notify(fixture)).response.status, 200)
  const final = await state(fixture)
  assert.equal(final.order.payment_status, 'APPROVED')
  assert.equal(final.sales.length, 1)
  assert.equal(final.entries.length, 1)
  assert.equal(final.stock, 8)
  assert.equal((await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code).length, 1)
})

test('consulta continua exibindo aprovação persistida durante falha do provedor', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'approved')
  assert.equal((await notify(fixture)).response.status, 200)
  mpFixtures.orders[fixture.providerId] = { __throw: true }
  await saveMpFixtures()
  const current = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.equal(current.response.status, 200, current.data.error)
  assert.equal(current.data.order.payment_status, 'APPROVED')
  assert.equal(current.data.paid, true)
})

test('recusa permite uma nova tentativa explícita sem duplicar a reserva', async () => {
  const fixture = await orderFixture(2, { bind: false })
  await setPayment(fixture, 'rejected')
  mpFixtures.creations[fixture.order.code] = mpFixtures.orders[fixture.providerId]
  await saveMpFixtures()
  const rejected = await startPayment(fixture)
  assert.equal(rejected.response.status, 200, rejected.data.error)
  assert.equal(rejected.data.order.payment_status, 'REJECTED')
  fixture.providerId = 'ORDRETRY' + suffix.toUpperCase() + String(fixture.order.id)
  fixture.attemptId = randomUUID()
  await setPayment(fixture, 'pending')
  mpFixtures.creations[fixture.order.code] = mpFixtures.orders[fixture.providerId]
  await saveMpFixtures()
  const retried = await startPayment(fixture)
  assert.equal(retried.response.status, 200, retried.data.error)
  assert.equal(retried.data.payment.provider_reference, fixture.providerId)
  const current = await state(fixture)
  assert.equal(current.payments.length, 2)
  assert.equal(current.stock, 8)
  assert.equal(current.sales.length, 0)
})

test('erro HTTP definitivo rejeita o stub sem cobrar e permite nova tentativa explícita', async () => {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = { error: 'local_invalid_payment', code: 3001,
    message: 'private-test-message buyer@example.invalid',
    cause: [{ code: 'invalid_field', description: 'transactions.payments[0].payment_method.id; CPF 12345678909' }, { code: '12345678909' }], __http_status: 400 }
  await saveMpFixtures()
  const rejected = await startPayment(fixture)
  assert.equal(rejected.response.status, 400, rejected.data.error)
  assert.equal(rejected.data.code, 'PAYMENT_NOT_CREATED')
  const before = await state(fixture)
  assert.equal(before.payments.length, 1)
  assert.equal(before.payments[0].status, 'REJECTED')
  assert.equal(before.payments[0].provider_reference, null)
  assert.deepEqual(before.payments[0].raw_payload, { test_provider_error: { http_status: 400, codes: ['local_invalid_payment', 'invalid_field'], fields: ['transactions.payments.0.payment_method.id'] } })
  assert.equal(JSON.stringify(rejected.data).includes('test_provider_error'), false)
  assert.equal(JSON.stringify(rejected.data).includes('local_invalid_payment'), false)
  assert.equal(JSON.stringify(rejected.data).includes('transactions.payments.0.payment_method.id'), false)
  const privateView = await customer.request('/api/store/orders/' + fixture.order.id + '/payment')
  assert.equal(privateView.response.status, 200)
  assert.equal(JSON.stringify(privateView.data).includes('test_provider_error'), false)
  assert.equal(JSON.stringify(privateView.data).includes('invalid_field'), false)
  fixture.attemptId = randomUUID()
  mpFixtures.creations[fixture.order.code] = mpFixtures.orders[fixture.providerId]
  await saveMpFixtures()
  const retried = await startPayment(fixture)
  assert.equal(retried.response.status, 200, retried.data.error)
  const current = await state(fixture)
  assert.equal(current.payments.length, 2)
  assert.equal(current.stock, 8)
  assert.equal(current.sales.length, 0)
})

test('requisições concorrentes da mesma tentativa criam apenas uma cobrança', async () => {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = { ...mpFixtures.orders[fixture.providerId], __delay_ms: 700 }
  await saveMpFixtures()
  const results = await Promise.all([startPayment(fixture), startPayment(fixture)])
  assert.equal(results.filter(result => result.response.status === 200).length, 1)
  assert.equal(results.filter(result => result.response.status === 409 && result.data.code === 'PAYMENT_IN_PROGRESS').length, 1)
  for (const result of results) {
    if (result.response.status === 200) assert.equal(result.data.payment.provider_reference, fixture.providerId)
  }
  const repeated = await startPayment(fixture)
  assert.equal(repeated.response.status, 200, repeated.data.error)
  assert.equal(repeated.data.payment.provider_reference, fixture.providerId)
  const providerCalls = (await calls()).filter(call => call.method === 'POST' && call.external_reference === fixture.order.code)
  assert.equal(providerCalls.length, 1)
  assert.equal((await state(fixture)).payments.length, 1)
})

test('cancelamento confirmado pelo provedor devolve a reserva uma única vez', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'canceled')
  for (const result of [await notify(fixture), await notify(fixture)]) assert.equal(result.response.status, 200, result.data.error)
  const current = await state(fixture)
  assert.equal(current.order.status, 'CANCELLED')
  assert.equal(current.order.payment_status, 'CANCELLED')
  assert.equal(current.stock, 10)
  assert.equal(current.movements.filter(item => item.type === 'ENTRADA').length, 1)
  assert.equal(current.sales.length, 0)
  assert.equal(current.entries.length, 0)
})

test('cartão tokenizado usa valor e comprador do pedido, com aprovação persistida no servidor', async () => {
  const fixture = await orderFixture(2, { bind: false })
  await setPayment(fixture, 'approved')
  const providerOrder = mpFixtures.orders[fixture.providerId]
  providerOrder.transactions.payments[0].payment_method = { id: 'visa', type: 'credit_card', installments: 1 }
  mpFixtures.creations[fixture.order.code] = providerOrder
  await saveMpFixtures()
  const result = await startPayment(fixture, { method: 'credit_card', token: 'local-card-token-123456789', payment_method_id: 'visa', installments: 1,
    device_id: 'device-session-from-local-sdk',
    total_amount: '0.01', payer: { email: 'untrusted@example.invalid', first_name: 'Untrusted' },
    buyerContext: { email: 'untrusted@example.invalid', name: 'Untrusted', previous_purchases: 0 } })
  assert.equal(result.response.status, 200, result.data.error)
  assert.equal(result.data.order.payment_status, 'APPROVED')
  assert.equal(result.data.paid, true)
  assert.equal(JSON.stringify(result.data).includes('local-card-token'), false)
  const creation = (await calls()).find(call => call.method === 'POST' && call.external_reference === fixture.order.code)
  assert.equal(creation.body.total_amount, '40.00')
  assert.notEqual(creation.body.payer.email, 'untrusted@example.invalid')
  assert.equal(creation.body.payer.first_name, 'Cliente')
  assert.equal(creation.body.payer.last_name, 'teste MP')
  assert.deepEqual(creation.body.payer.identification, { type: 'CPF', number: '12345678909' })
  assert.deepEqual(creation.body.payer.phone, { area_code: '11', number: '999999999' })
  assert.deepEqual(creation.body.payer.address, { state: 'SP', zip_code: '01001000', street_number: '1',
    street_name: 'Rua de teste', city: 'São Paulo', neighborhood: 'Centro' })
  assert.deepEqual(creation.body.config, { online: {
    transaction_security: { validation: 'on_fraud_risk', liability_shift: 'required' } } })
  assert.equal(creation.body.transactions.payments[0].payment_method.statement_descriptor, 'GALEO')
  assert.equal(creation.body.capture_mode, 'automatic_async')
  assert.deepEqual(creation.body.items, [{ external_code: 'galeo-' + fixture.productId,
    title: 'Teste MP ' + suffix + '-' + (fixtures.products.length - 1), quantity: 2, unit_price: '20.00', category_id: 'fashion' }])
  assert.equal(creation.body.additional_info['payer.authentication_type'], 'WEB')
  assert.equal(typeof creation.body.additional_info['payer.is_first_purchase_online'], 'boolean')
  const [registered] = await execute('SELECT UNIX_TIMESTAMP(created_at)*1000 AS epoch FROM customers WHERE id=?', [customerId])
  assert.equal(creation.body.additional_info['payer.registration_date'], new Date(Number(registered.epoch)).toISOString())
  assert.equal(creation.device_id, 'device-session-from-local-sdk')
  assert.equal(creation.official_sdk, true)
  assert.equal(Object.hasOwn(result.data.payment, 'api_response'), false)
  assert.equal(creation.body.transactions.payments[0].payment_method.token, 'local-card-token-123456789')
  assert.equal(creation.body.transactions.payments[0].payment_method.installments, 1)
  const current = await state(fixture)
  assert.equal(current.stock, 8)
  assert.equal(current.sales.length, 1)
  assert.equal(current.entries.length, 1)
  assert.equal(Number(current.entries[0].amount), 40)
})

test('dados brutos de cartão não são aceitos e não iniciam cobrança', async () => {
  const fixture = await orderFixture(2, { bind: false })
  const before = (await calls()).filter(call => call.method === 'POST').length
  const result = await startPayment(fixture, { method: 'credit_card', payment_method_id: 'visa', card_number: '4235647728025682', security_code: '123' })
  assert.ok([400, 422].includes(result.response.status))
  assert.equal((await calls()).filter(call => call.method === 'POST').length, before)
  const current = await state(fixture)
  assert.equal(current.payments.length, 0)
  assert.equal(current.sales.length, 0)
})

test('endereço do comprador pode ser diferente da entrega e fica restrito ao pedido do provedor', async () => {
  const fixture = await orderFixture(2, { bind: false })
  mpFixtures.creations[fixture.order.code] = mpFixtures.orders[fixture.providerId]
  await saveMpFixtures()
  const billing = { zip_code: '20040020', street_name: 'Rua do comprador', street_number: '25',
    city: 'Rio de Janeiro', state: 'RJ', complement: 'Sala 2' }
  const result = await startPayment(fixture, { use_shipping_address: false, billing_address: billing })
  assert.equal(result.response.status, 200, result.data.error)
  const creation = (await calls()).find(call => call.method === 'POST' && call.external_reference === fixture.order.code)
  assert.deepEqual(creation.body.payer.address, billing)
  const current = await state(fixture)
  assert.equal(current.order.street, 'Rua de teste')
  assert.equal(current.order.state, 'SP')
  assert.equal(JSON.stringify(result.data).includes('Rua do comprador'), false)
  assert.equal(Object.hasOwn(current.payments[0].raw_payload, 'api_response'), false)
})

test('endereço de cobrança inválido não cria tentativa nem chama o provedor', async () => {
  const fixture = await orderFixture(2, { bind: false })
  const before = (await calls()).length
  const result = await startPayment(fixture, { use_shipping_address: false,
    billing_address: { zip_code: '1', street_name: 'Rua', street_number: '1', state: 'ZZ', city: 'Cidade' } })
  assert.equal(result.response.status, 400)
  assert.equal((await calls()).length, before)
  assert.equal((await state(fixture)).payments.length, 0)
})

test('assinatura inválida e identificadores conflitantes não consultam nem alteram pagamentos', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'approved')
  const beforeCalls = (await calls()).length
  const forged = await notify(fixture, eventId(), { signatureOverride: 'ts=1,v1=' + '0'.repeat(64) })
  assert.equal(forged.response.status, 401)
  const mismatched = await notify(fixture, eventId(), { bodyId: 'ORDOTHER' + suffix.toUpperCase() })
  assert.ok([400, 401].includes(mismatched.response.status))
  assert.equal((await calls()).length, beforeCalls)
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'PENDING')
  assert.equal(current.sales.length, 0)
})

test('notificação de vendedor diferente rejeita o pagamento com rollback', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'approved')
  mpFixtures.orders[fixture.providerId].user_id = 999
  await saveMpFixtures()
  const result = await notify(fixture)
  assert.ok([400, 500, 503].includes(result.response.status))
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'PENDING')
  assert.equal(current.sales.length, 0)
  assert.equal(current.stock, 8)
})

test('notificação de país diferente rejeita o pagamento sem criar venda nem mexer na reserva', async () => {
  const fixture = await orderFixture()
  await setPayment(fixture, 'approved')
  mpFixtures.orders[fixture.providerId].country_code = 'ARG'
  await saveMpFixtures()
  const result = await notify(fixture)
  assert.ok([400, 500, 503].includes(result.response.status))
  const current = await state(fixture)
  assert.equal(current.order.payment_status, 'PENDING')
  assert.equal(current.sales.length, 0)
  assert.equal(current.stock, 8)
})

test('cinquenta tentativas ambíguas não bloqueiam a liberação de outra reserva vencida', async () => {
  const held = []
  for (let index = 0; index < 50; index++) {
    const fixture = await orderFixture(1, { bind: false })
    held.push(fixture)
    await execute("INSERT INTO payments(channel,store_order_id,method,provider,status,amount,idempotency_key,raw_payload) VALUES('ONLINE',?,'pix','MERCADO_PAGO','PENDING',?,?,'{}')", [fixture.order.id, fixture.order.total, fixture.attemptId])
  }
  const safe = await orderFixture(1, { bind: false })
  const ids = [...held.map(fixture => fixture.order.id), safe.order.id]
  await execute('UPDATE store_orders SET created_at=DATE_SUB(NOW(),INTERVAL 2 DAY) WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids)
  const expiry = createPaymentReservationExpiry({
    db,
    query: async (sql, params) => {
      // Keep this maintenance invocation inside this test's fixtures while
      // exercising the real MySQL candidate query and its LIMIT/NOT EXISTS.
      if (sql.startsWith('SELECT id,code,total')) return execute(sql.replace(' ORDER BY EXISTS', ' AND id IN (' + ids.map(() => '?').join(',') + ') ORDER BY EXISTS'), [...params, ...ids])
      return execute(sql, params)
    },
    restoreReservation: async (connection, order) => {
      assert.equal(Number(order.id), safe.order.id)
      await connection.execute('UPDATE products SET stock=stock+1 WHERE id=?', [safe.productId])
    },
    getProviderOrder: async () => { throw new Error('Ambiguous attempts must never be polled without a reference') },
    processProviderOrder: async () => { throw new Error('No provider state is expected in this test') }
  })
  const report = await expiry.expire()
  assert.equal(report.examined, 1)
  assert.equal(report.expired, 1)
  assert.equal((await state(safe)).stock, 10)
  assert.equal((await state(safe)).order.status, 'CANCELLED')
  for (const fixture of held) {
    const value = await state(fixture)
    assert.equal(value.order.status, 'RECEIVED')
    assert.equal(value.payments[0].status, 'PENDING')
    assert.equal(value.stock, 9)
  }
})
