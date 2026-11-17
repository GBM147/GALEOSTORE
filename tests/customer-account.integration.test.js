// Customer self-service: forgotten password, password change while signed in
// and account deletion. Runs against the isolated local API and database used
// by the e-mail verification suite; no real e-mail is ever sent.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { VerificationRuntime } from './helpers/email-verification-runtime.mjs'

const runtime = new VerificationRuntime()
const newPassword = runtime.password + '-nova'
const orderIds = []
before(async () => { await runtime.initialize() })
after(async () => {
  try {
    if (orderIds.length) await runtime.query('DELETE FROM store_orders WHERE id IN (' + orderIds.map(() => '?').join(',') + ')', orderIds)
  } finally { await runtime.close() }
})

const RESET_LINK = /#redefinir=(\d{1,12}\.\d{10}\.[A-Za-z0-9_-]{43})/

async function activeCustomer(label) {
  const fixture = await runtime.register(label)
  const confirmed = await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: runtime.password } })
  assert.equal(confirmed.status, 200)
  return fixture
}

async function signedIn(email, password = runtime.password) {
  const client = runtime.client()
  const response = await client.request('/api/customer/login', { method: 'POST', body: { email, password } })
  assert.equal(response.status, 200, 'login must succeed')
  return client
}

async function login(email, password) {
  return (await runtime.client().request('/api/customer/login', { method: 'POST', body: { email, password } })).status
}

async function mails(email, pattern) {
  return (await runtime.calls()).filter(call => call.payload.to.includes(email) && pattern.test(call.payload.subject))
}

async function resetToken(email) {
  const call = (await mails(email, /nova senha/)).at(-1)
  assert.ok(call, 'the reset e-mail must reach the fixture')
  const token = call.payload.html.match(RESET_LINK)?.[1]
  assert.ok(token, 'the e-mail carries a complete reset link')
  assert.equal(call.payload.text.match(RESET_LINK)?.[1], token, 'the text version carries the same link')
  return { token, call }
}

const confirmReset = (client, token, password) => client.request('/api/customer/password-reset/confirm', { method: 'POST', body: { token, password } })

test('esqueci minha senha: resposta igual para qualquer e-mail, link de uso único e as outras sessões caem', async () => {
  const { email, id } = await activeCustomer('reset')
  const first = await signedIn(email), second = await signedIn(email)
  assert.equal((await first.request('/api/customer/me')).status, 200)

  const anonymous = runtime.client()
  const before = (await runtime.calls()).length
  const unknown = await anonymous.request('/api/customer/password-reset', { method: 'POST', body: { email: runtime.email('sem-conta') } })
  assert.equal(unknown.status, 202)
  assert.equal((await runtime.calls()).length, before, 'unknown e-mails get no message')
  const known = await anonymous.request('/api/customer/password-reset', { method: 'POST', body: { email: '  ' + email.toUpperCase() + ' ' } })
  assert.equal(known.status, 202)
  assert.deepEqual(known.data, unknown.data, 'the answer never reveals whether the account exists')

  const { token, call } = await resetToken(email)
  assert.equal(call.payload.subject, 'Crie uma nova senha na GALEO STORE')
  assert.equal(call.payload.reply_to, runtime.replyTo)
  assert.ok(call.payload.html.includes('http://127.0.0.1:10006/conta#redefinir=' + token))
  assert.ok(call.idempotencyKey.startsWith('customer-reset-' + id + '-'))
  assert.equal(token.split('.')[0], String(id))

  // A second request in the same 10-minute window builds the same e-mail and
  // key, so the provider sends it once.
  await anonymous.request('/api/customer/password-reset', { method: 'POST', body: { email } })
  const again = await resetToken(email)
  if (again.token.split('.')[1] === token.split('.')[1]) {
    assert.equal(again.token, token)
    assert.equal(again.call.idempotencyKey, call.idempotencyKey)
  }

  const short = await confirmReset(anonymous, token, 'curta')
  assert.equal(short.status, 400)
  assert.match(short.data.error, /10 caracteres/)
  const [id_, expires, signature] = token.split('.')
  for (const bad of ['', 'x', id_ + '.' + expires + '.' + signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A'), String(Number(id_) + 1) + '.' + expires + '.' + signature]) {
    const response = await confirmReset(anonymous, bad, newPassword)
    assert.equal(response.status, 400)
    assert.equal(response.data.code, 'RESET_LINK_INVALID')
  }
  const same = await confirmReset(anonymous, token, runtime.password)
  assert.equal(same.status, 400)
  assert.match(same.data.error, /diferente da atual/)

  const done = await confirmReset(anonymous, token, newPassword)
  assert.equal(done.status, 200)
  assert.equal(done.data.user, undefined, 'the link never signs in by itself')
  assert.equal(done.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
  assert.equal((await mails(email, /foi alterada/)).length, 1, 'the customer is told the password changed')
  const reused = await confirmReset(anonymous, token, newPassword + '2')
  assert.equal(reused.status, 400)
  assert.equal(reused.data.code, 'RESET_LINK_INVALID', 'the link works only once')

  for (const client of [first, second]) {
    const response = await client.request('/api/customer/me')
    assert.equal(response.status, 401)
    assert.equal(response.data.code, 'SESSION_PASSWORD_CHANGED')
  }
  assert.equal(await login(email, runtime.password), 401)
  assert.equal(await login(email, newPassword), 200)
})

test('o link confirma uma conta pendente; conta desativada não recebe link', async () => {
  const pending = await runtime.register('reset-pending')
  await pending.client.request('/api/customer/password-reset', { method: 'POST', body: { email: pending.email } })
  const { token } = await resetToken(pending.email)
  assert.equal((await confirmReset(runtime.client(), token, newPassword)).status, 200)
  const [row] = await runtime.query('SELECT email_verified_at FROM customers WHERE id=?', [pending.id])
  assert.ok(row.email_verified_at instanceof Date, 'opening the link proves control of the e-mail')
  assert.equal((await runtime.query('SELECT 1 FROM customer_email_verifications WHERE customer_id=?', [pending.id])).length, 0)
  assert.equal(await login(pending.email, newPassword), 200)

  const disabled = await activeCustomer('reset-disabled')
  await runtime.query('UPDATE customers SET active=0 WHERE id=?', [disabled.id])
  const before = (await runtime.calls()).length
  assert.equal((await runtime.client().request('/api/customer/password-reset', { method: 'POST', body: { email: disabled.email } })).status, 202)
  assert.equal((await runtime.calls()).length, before)
})

test('trocar a senha logado exige a senha atual e encerra só as outras sessões', async () => {
  const { email } = await activeCustomer('change')
  const current = await signedIn(email), other = await signedIn(email)
  const change = (client, body) => client.request('/api/customer/password', { method: 'PUT', body })

  const noCsrf = runtime.client(); noCsrf.cookie = current.cookie
  assert.equal((await change(noCsrf, { currentPassword: runtime.password, newPassword })).status, 403)
  const wrong = await change(current, { currentPassword: 'senha-errada-local', newPassword })
  assert.equal(wrong.status, 400, 'a wrong current password does not sign the customer out')
  assert.equal(wrong.data.code, 'CURRENT_PASSWORD_INVALID')
  assert.equal((await change(current, { currentPassword: runtime.password, newPassword: 'curta' })).status, 400)
  assert.equal((await current.request('/api/customer/me')).status, 200)

  const done = await change(current, { currentPassword: runtime.password, newPassword })
  assert.equal(done.status, 200)
  assert.equal((await current.request('/api/customer/me')).status, 200, 'this session stays signed in')
  assert.equal((await current.request('/api/customer/orders')).status, 200)
  const dropped = await other.request('/api/customer/orders')
  assert.equal(dropped.status, 401)
  assert.equal(dropped.data.code, 'SESSION_PASSWORD_CHANGED')
  assert.equal((await mails(email, /foi alterada/)).length, 1)
  assert.equal(await login(email, runtime.password), 401)
  assert.equal(await login(email, newPassword), 200)
})

test('excluir a conta: espera o pedido pago terminar, anonimiza o cadastro e guarda os pedidos', async () => {
  const { email, id } = await activeCustomer('delete')
  const client = await signedIn(email), other = await signedIn(email)
  const lookup = runtime.protection ? runtime.protection.emailLookup(email, 'newsletter_subscriptions.email') : createHash('sha256').update(email).digest('hex')
  assert.equal((await client.request('/api/store/newsletter/subscribe', { method: 'POST', body: { email } })).status, 202)
  assert.equal((await runtime.query('SELECT id FROM newsletter_subscriptions WHERE email_lookup=?', [lookup])).length, 1)
  const [order] = await runtime.db.execute(
    "INSERT INTO store_orders(code,customer_id,customer_name,customer_email,payment_status,status,subtotal,total) VALUES(?,?,?,?,'APPROVED','PREPARING',10,10)",
    ['T' + runtime.suffix.slice(0, 12), id, 'Cliente local delete', email])
  orderIds.push(order.insertId)
  const remove = (body, as = client) => as.request('/api/customer/account', { method: 'DELETE', body })

  assert.equal((await remove({ password: runtime.password })).status, 400, 'the confirmation is required')
  const wrong = await remove({ password: 'senha-errada-local', confirm: true })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.data.code, 'CURRENT_PASSWORD_INVALID')
  const open = await remove({ password: runtime.password, confirm: true })
  assert.equal(open.status, 409)
  assert.equal(open.data.code, 'ACCOUNT_HAS_OPEN_ORDERS')
  assert.equal((await client.request('/api/customer/me')).status, 200, 'nothing changes while the order is open')

  await runtime.query("UPDATE store_orders SET status='DELIVERED' WHERE id=?", [order.insertId])
  const done = await remove({ password: runtime.password, confirm: true })
  assert.equal(done.status, 200)
  assert.equal(done.data.authenticated, false)
  for (const session of [client, other]) assert.equal((await session.request('/api/customer/me')).status, 401)
  assert.equal(await login(email, runtime.password), 401)

  const [row] = await runtime.query('SELECT name,email,phone,active,email_verified_at,private_data FROM customers WHERE id=?', [id])
  assert.equal(Number(row.active), 0)
  assert.equal(row.email_verified_at, null)
  const personal = runtime.protection
    ? runtime.protection.decryptJSON(typeof row.private_data === 'string' ? JSON.parse(row.private_data) : row.private_data, { table: 'customers', field: 'private_data', rowId: id })
    : { name: row.name, email: row.email, phone: row.phone }
  assert.deepEqual(personal, { name: 'Cliente removido', email: 'removido-' + id + '@excluido.invalid', phone: '' })
  assert.equal(JSON.stringify(row).includes(email), false, 'the original e-mail is gone from the customer record')
  assert.equal((await runtime.query('SELECT id FROM store_orders WHERE customer_id=?', [id])).length, 1, 'orders stay for the legal period')
  assert.equal((await runtime.query('SELECT id FROM newsletter_subscriptions WHERE email_lookup=?', [lookup])).length, 0)
  const [audit] = await runtime.query("SELECT user_id FROM audit_logs WHERE action='EXCLUIR_CONTA' AND entity='cliente' AND entity_id=?", [String(id)])
  assert.ok(audit, 'the deletion is audited')
  assert.equal(audit.user_id, null)
  assert.equal((await mails(email, /foi excluída/)).length, 1, 'the confirmation goes to the original address')

  // The address is free again for a new account.
  const fresh = await runtime.client().request('/api/customer/register', { method: 'POST', body: {
    accept_terms: true, name: 'Cliente local delete', email, password: runtime.password, phone: ''
  } })
  assert.equal(fresh.status, 202)
  await runtime.trackMailAccount(email)
})
