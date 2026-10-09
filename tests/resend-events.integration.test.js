import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import bcrypt from 'bcrypt'
import { createDatabasePrivacy } from '../server/database-privacy.js'
import { VerificationRuntime } from './helpers/email-verification-runtime.mjs'

const runtime = new VerificationRuntime()
const fixtures = { admins: new Set(), products: new Set(), orders: new Set() }
let privacy, admin, ownerId

async function deleteIds(table, field, ids) {
  if (!ids.size) return
  await runtime.query('DELETE FROM `' + table + '` WHERE `' + field + '` IN (' + [...ids].map(() => '?').join(',') + ')', [...ids])
}

async function adminFixture(role = 'owner') {
  const email = runtime.email('events-' + role)
  const passwordHash = await bcrypt.hash(runtime.password, 12)
  const personal = { email }
  const safe = privacy.pendingFields('admin_users', personal)
  const conn = await runtime.db.getConnection()
  let id
  try {
    await conn.beginTransaction()
    const [inserted] = await conn.execute('INSERT INTO admin_users(email,password_hash,role,active) VALUES(?,?,?,1)', [safe.email, passwordHash, role])
    id = inserted.insertId
    await privacy.completeInsert('admin_users', id, personal, conn)
    await conn.commit()
    fixtures.admins.add(id)
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally { conn.release() }
  const client = runtime.client()
  const login = await client.request('/api/auth/login', { method: 'POST', body: { email, password: runtime.password } })
  assert.equal(login.status, role === 'owner' ? 200 : 403, 'administrative login must remain exclusive to store owners')
  if (role !== 'owner') assert.equal(login.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
  return { client, id, email }
}

async function waitForCalls(predicate, message) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const calls = await runtime.calls()
    if (predicate(calls)) return calls
    await delay(10)
  }
  assert.fail(message || 'The isolated provider must capture the expected asynchronous notification.')
}

async function noNewCalls(beforeCount) {
  // Notifications are fire-and-forget after commit. Let their local fixture
  // callbacks run before asserting that a no-op never contacted the provider.
  await delay(50)
  assert.equal((await runtime.calls()).length, beforeCount)
}

const welcomeCalls = (calls, id) => calls.filter(call => call.idempotencyKey === 'welcome-customer-' + id)
const statusCalls = (calls, code) => calls.filter(call => call.idempotencyKey.startsWith('order-status-event-') && call.payload.subject.includes(code))

async function verifiedCustomer(label) {
  const fixture = await runtime.register(label)
  const verified = await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: runtime.password } })
  assert.equal(verified.status, 200, verified.data.error)
  await waitForCalls(calls => welcomeCalls(calls, fixture.id).length === 1)
  const login = await fixture.client.request('/api/customer/login', { method: 'POST', body: { email: fixture.email, password: runtime.password } })
  assert.equal(login.status, 200, login.data.error)
  return fixture
}

async function product() {
  const created = await runtime.query('INSERT INTO products(name,brand,description,price,cost,stock,active) VALUES(?,?,?,?,?,20,1)', [
    'Peça local de e-mail ' + runtime.suffix + '-' + fixtures.products.size, 'GALEO local', 'Fixture de notificação', 21.5, 7
  ])
  fixtures.products.add(created.insertId)
  return created.insertId
}

async function order(customer, { notifications = true } = {}) {
  const productId = await product()
  const response = await customer.client.request('/api/store/orders', { method: 'POST', body: {
    items: [{ product_id: productId, quantity: 2 }],
    shipping: { name: 'Cliente local ' + runtime.suffix, phone: '11999887766', postal_code: '01001000', street: 'Rua local', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' }
  } })
  if (response.data?.order?.id) fixtures.orders.add(response.data.order.id)
  assert.equal(response.status, 200, response.data.error)
  const created = response.data.order
  assert.equal(created.status, 'RECEIVED')
  assert.equal(created.payment_status, 'PENDING')
  assert.equal(response.data.payment_configured, false, 'these tests must not enable deferred payments')
  if (notifications) {
    await waitForCalls(calls => calls.some(call => call.idempotencyKey === 'order-customer-' + created.id) && calls.some(call => call.idempotencyKey === 'order-store-' + created.id))
  }
  return { ...created, productId }
}

async function updateStatus(created, status) {
  return admin.request('/api/admin/store-orders/' + created.id + '/status', { method: 'PATCH', body: { status } })
}

before(async () => {
  await runtime.initialize()
  privacy = createDatabasePrivacy({ db: runtime.db, enabled: Boolean(runtime.protection) })
  const owner = await adminFixture()
  admin = owner.client
  ownerId = owner.id
})

after(async () => {
  await runtime.stopApi()
  try {
    // Recover only our customers' orders if an assertion interrupted tracking.
    if (runtime.db && runtime.ids.size) {
      const ids = [...runtime.ids]
      const recovered = await runtime.query('SELECT id FROM store_orders WHERE customer_id IN (' + ids.map(() => '?').join(',') + ')', ids)
      for (const row of recovered) fixtures.orders.add(row.id)
    }
    if (runtime.db) {
      await deleteIds('audit_logs', 'user_id', fixtures.admins)
      if (fixtures.orders.size) {
        const ids = [...fixtures.orders]
        await runtime.query("DELETE FROM audit_logs WHERE entity='pedido_online' AND entity_id IN (" + ids.map(() => '?').join(',') + ')', ids.map(String))
      }
      await deleteIds('payments', 'store_order_id', fixtures.orders)
      await deleteIds('store_order_items', 'order_id', fixtures.orders)
      await deleteIds('store_orders', 'id', fixtures.orders)
      await deleteIds('stock_movements', 'product_id', fixtures.products)
      await deleteIds('product_media', 'product_id', fixtures.products)
      await deleteIds('products', 'id', fixtures.products)
      await deleteIds('admin_users', 'id', fixtures.admins)
    }
  } finally { await runtime.close() }
})

test('boas-vindas são enviadas uma vez após confirmar, sem conceder sessão ou antecipar a ativação', async () => {
  const fixture = await runtime.register('events-welcome')
  assert.equal(welcomeCalls(await runtime.calls(), fixture.id).length, 0)
  const wrongPassword = await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: 'wrong-local-password' } })
  assert.equal(wrongPassword.status, 400)
  assert.equal(welcomeCalls(await runtime.calls(), fixture.id).length, 0)
  const confirmed = await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: runtime.password } })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.verified, true)
  assert.equal(confirmed.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
  const calls = await waitForCalls(all => welcomeCalls(all, fixture.id).length === 1)
  const [welcome] = welcomeCalls(calls, fixture.id)
  assert.deepEqual(welcome.payload.to, [fixture.email])
  assert.equal(welcome.payload.from, 'fixture@example.invalid')
  assert.match(welcome.payload.subject, /Boas-vindas/)
  assert.ok(welcome.payload.text.includes('Seu e-mail foi confirmado'))
  assert.equal(welcome.payload.html.includes(fixture.token), false)
  assert.equal((await fixture.client.request('/api/customer/me')).status, 401)
  const beforeCount = calls.length
  const repeated = await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: runtime.password } })
  assert.equal(repeated.status, 400)
  await noNewCalls(beforeCount)
})

test('falha das boas-vindas preserva a confirmação e permite o login sem reutilizar o token', async () => {
  const fixture = await runtime.register('events-welcome-failure')
  await runtime.setMailStatus(503)
  try {
    const confirmed = await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: runtime.password } })
    assert.equal(confirmed.status, 200)
    assert.equal(confirmed.data.verified, true)
    const calls = await waitForCalls(all => welcomeCalls(all, fixture.id).length === 1)
    assert.equal(welcomeCalls(calls, fixture.id)[0].status, 503)
    const [row] = await runtime.query('SELECT email_verified_at FROM customers WHERE id=?', [fixture.id])
    assert.notEqual(row.email_verified_at, null)
    assert.equal((await runtime.query('SELECT token_hash FROM customer_email_verifications WHERE customer_id=?', [fixture.id])).length, 0)
    assert.equal((await fixture.client.request('/api/customer/me')).status, 401)
    const login = await fixture.client.request('/api/customer/login', { method: 'POST', body: { email: fixture.email, password: runtime.password } })
    assert.equal(login.status, 200)
    assert.equal((await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: runtime.password } })).status, 400)
    assert.equal(runtime.stderr.includes(fixture.token), false)
    assert.equal(runtime.stderr.includes(fixture.email), false)
  } finally { await runtime.setMailStatus(200) }
})

test('pedido recebido avisa cliente e loja; mudanças confirmadas usam eventos únicos sem repetir notificações', async () => {
  const customer = await verifiedCustomer('events-order')
  const created = await order(customer)
  const initialCalls = await runtime.calls()
  const customerMail = initialCalls.filter(call => call.idempotencyKey === 'order-customer-' + created.id)
  const storeMail = initialCalls.filter(call => call.idempotencyKey === 'order-store-' + created.id)
  assert.equal(customerMail.length, 1)
  assert.equal(storeMail.length, 1)
  assert.deepEqual(customerMail[0].payload.to, [customer.email])
  assert.deepEqual(storeMail[0].payload.to, ['notification@example.invalid'])
  assert.ok(customerMail[0].payload.html.includes(created.code))
  assert.ok(storeMail[0].payload.html.includes(customer.email))

  let expected = 0
  for (const [status, label] of [['CONFIRMED', 'confirmado'], ['PREPARING', 'em preparação'], ['SHIPPED', 'a caminho'], ['DELIVERED', 'entregue']]) {
    const response = await updateStatus(created, status)
    assert.equal(response.status, 200, response.data.error)
    expected++
    const calls = await waitForCalls(all => statusCalls(all, created.code).length === expected)
    const notification = statusCalls(calls, created.code).at(-1)
    assert.deepEqual(notification.payload.to, [customer.email])
    assert.ok(notification.payload.subject.includes(label))
    assert.ok(notification.payload.text.includes(created.code))
    const eventId = Number(notification.idempotencyKey.slice('order-status-event-'.length))
    const [event] = await runtime.query('SELECT * FROM audit_logs WHERE id=?', [eventId])
    assert.equal(event.user_id, ownerId)
    assert.equal(event.entity, 'pedido_online')
    assert.equal(String(event.entity_id), String(created.id))
    assert.equal(privacy.decodeRow('audit_logs', event).details.to, status)
    const beforeCount = calls.length
    assert.equal((await updateStatus(created, status)).status, 200)
    await noNewCalls(beforeCount)
  }
  const notifications = statusCalls(await runtime.calls(), created.code)
  assert.equal(new Set(notifications.map(call => call.idempotencyKey)).size, 4)
  const beforeRejected = (await runtime.calls()).length
  assert.equal((await updateStatus(created, 'PREPARING')).status, 400)
  await noNewCalls(beforeRejected)
  assert.equal((await runtime.query('SELECT status FROM store_orders WHERE id=?', [created.id]))[0].status, 'DELIVERED')
})

test('cancelamento avisa uma vez, devolve estoque e reabertura rejeitada não envia e-mail', async () => {
  const customer = await verifiedCustomer('events-cancel')
  const created = await order(customer)
  assert.equal(Number((await runtime.query('SELECT stock FROM products WHERE id=?', [created.productId]))[0].stock), 18)
  assert.equal((await updateStatus(created, 'CANCELLED')).status, 200)
  const calls = await waitForCalls(all => statusCalls(all, created.code).length === 1)
  assert.ok(statusCalls(calls, created.code)[0].payload.subject.includes('cancelado'))
  assert.equal(Number((await runtime.query('SELECT stock FROM products WHERE id=?', [created.productId]))[0].stock), 20)
  const beforeCount = calls.length
  assert.equal((await updateStatus(created, 'CANCELLED')).status, 200)
  assert.equal((await updateStatus(created, 'CONFIRMED')).status, 400)
  await noNewCalls(beforeCount)
  assert.equal((await runtime.query('SELECT status FROM store_orders WHERE id=?', [created.id]))[0].status, 'CANCELLED')
})

test('falha de entrega não desfaz pedido ou atualização de status já confirmados no banco', async () => {
  const customer = await verifiedCustomer('events-order-failure')
  await runtime.setMailStatus(500)
  try {
    const created = await order(customer)
    const calls = await runtime.calls()
    assert.equal(calls.find(call => call.idempotencyKey === 'order-customer-' + created.id).status, 500)
    assert.equal(calls.find(call => call.idempotencyKey === 'order-store-' + created.id).status, 500)
    assert.equal((await updateStatus(created, 'CONFIRMED')).status, 200)
    const delivered = await waitForCalls(all => statusCalls(all, created.code).length === 1)
    assert.equal(statusCalls(delivered, created.code)[0].status, 500)
    const [stored] = await runtime.query('SELECT status FROM store_orders WHERE id=?', [created.id])
    assert.equal(stored.status, 'CONFIRMED')
    assert.equal((await runtime.query('SELECT id FROM store_order_items WHERE order_id=?', [created.id])).length, 1)
    assert.equal(Number((await runtime.query('SELECT stock FROM products WHERE id=?', [created.productId]))[0].stock), 18)
    const beforeCount = delivered.length
    assert.equal((await updateStatus(created, 'CONFIRMED')).status, 200)
    await noNewCalls(beforeCount)
  } finally { await runtime.setMailStatus(200) }
})

test('diagnóstico de e-mail é exclusivo do OWNER e exibe configuração segura sem dados dos remetentes', async () => {
  assert.equal((await runtime.client().request('/api/admin/email-status')).status, 401)
  const customer = await verifiedCustomer('events-status-access')
  assert.equal((await customer.client.request('/api/admin/email-status')).status, 401)
  assert.equal((await customer.client.request('/api/customer/me')).status, 200)
  const staff = await adminFixture('staff')
  assert.equal((await staff.client.request('/api/admin/email-status')).status, 401, 'a blocked STAFF login must never issue an administrative session')
  const response = await admin.request('/api/admin/email-status')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(response.data, {
    provider: 'RESEND', api_key_configured: true, sender_configured: true,
    app_url_configured: true, store_notification_configured: true,
    sending_configured: true, confirmation_configured: true,
    pending_configuration: [], provider_validation: 'PENDING', delivery_validation: 'PENDING'
  })
  const serialized = JSON.stringify(response.data)
  for (const value of ['local-email-verification-fixture', 'fixture@example.invalid', 'notification@example.invalid', customer.email, customer.token]) {
    assert.equal(serialized.includes(value), false)
  }
})

test('remetente em aberto mantém cadastro bloqueado, lista apenas EMAIL_FROM pendente e preserva operações de clientes existentes', async () => {
  const customer = await verifiedCustomer('events-sender-pending')
  const beforeCount = (await runtime.calls()).length
  await runtime.startApi({ provider: true, sender: false })
  try {
    const registration = await runtime.client().request('/api/customer/registration-status')
    assert.equal(registration.status, 200)
    assert.deepEqual(registration.data, { email_verification_required: true, registration_available: false })
    const response = await admin.request('/api/admin/email-status')
    assert.equal(response.status, 200)
    assert.equal(response.data.api_key_configured, true)
    assert.equal(response.data.sender_configured, false)
    assert.equal(response.data.sending_configured, false)
    assert.equal(response.data.confirmation_configured, false)
    assert.deepEqual(response.data.pending_configuration, ['EMAIL_FROM'])
    const serialized = JSON.stringify(response.data)
    assert.equal(serialized.includes('local-email-verification-fixture'), false)
    assert.equal(serialized.includes('notification@example.invalid'), false)
    const customersBefore = Number((await runtime.query('SELECT COUNT(*) AS total FROM customers'))[0].total)
    const newCustomer = await runtime.client().request('/api/customer/register', { method: 'POST', body: { name: 'Remetente pendente local', email: runtime.email('events-no-sender'), password: runtime.password } })
    assert.equal(newCustomer.status, 503)
    assert.equal(newCustomer.data.code, 'EMAIL_DELIVERY_UNAVAILABLE')
    assert.equal(Number((await runtime.query('SELECT COUNT(*) AS total FROM customers'))[0].total), customersBefore)
    assert.equal((await customer.client.request('/api/customer/login', { method: 'POST', body: { email: customer.email, password: runtime.password } })).status, 200)
    const created = await order(customer, { notifications: false })
    assert.equal((await updateStatus(created, 'CONFIRMED')).status, 200)
    assert.equal((await runtime.query('SELECT status FROM store_orders WHERE id=?', [created.id]))[0].status, 'CONFIRMED')
    await noNewCalls(beforeCount)
  } finally { await runtime.startApi() }
})
