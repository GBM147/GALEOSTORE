import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { VerificationRuntime, tokenDigest } from './helpers/email-verification-runtime.mjs'

const runtime = new VerificationRuntime()
before(async () => { await runtime.initialize() })
after(async () => { await runtime.close() })

async function assertPending(id) {
  const rows = await runtime.query('SELECT email_verified_at,active FROM customers WHERE id=?', [id])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].email_verified_at, null)
}

async function verify(client, token, password = runtime.password) {
  return client.request('/api/customer/verify-email', { method: 'POST', body: { token, password } })
}

async function resend(client, email, password = runtime.password) {
  return client.request('/api/customer/resend-verification', { method: 'POST', body: { email, password } })
}

test('cadastro aguarda e-mail, não cria sessão e guarda somente digest com prazo de24 horas', async () => {
  const { client, email, id, token, response } = await runtime.register('pending')
  assert.equal(response.data.success, true)
  assert.equal(response.data.verification_required, true)
  assert.equal(response.data.user, undefined)
  assert.equal(response.data.csrfToken, undefined)
  assert.equal(response.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
  assert.equal(client.cookie, '')
  await assertPending(id)
  if (runtime.protection) {
    const [stored] = await runtime.query('SELECT name,email,phone,password_hash,private_data FROM customers WHERE id=?', [id])
    assert.equal(stored.name, '')
    assert.equal(stored.phone, '')
    assert.match(stored.email, /^private-[a-f0-9]{64}@galeo\.invalid$/)
    assert.ok(/^\$2[aby]\$12\$/.test(stored.password_hash), 'passwords remain strong one-way hashes')
    const envelope = typeof stored.private_data === 'string' ? JSON.parse(stored.private_data) : stored.private_data
    assert.equal(envelope.alg, 'A256GCM')
    assert.equal(JSON.stringify(envelope).includes(email), false)
    assert.deepEqual(runtime.protection.decryptJSON(envelope, { table: 'customers', field: 'private_data', rowId: id }), {
      name: 'Cliente local pending', email, phone: '11999999999'
    })
  }
  const rows = await runtime.query('SELECT *,TIMESTAMPDIFF(SECOND,sent_at,expires_at) AS lifetime FROM customer_email_verifications WHERE customer_id=?', [id])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].token_hash, tokenDigest(token))
  assert.notEqual(rows[0].token_hash, token)
  assert.equal(Number(rows[0].lifetime), 24 * 60 * 60)
  assert.equal(JSON.stringify(rows[0]).includes(token), false)
  const { call } = await runtime.verificationMail(email)
  assert.ok(call.payload.text.includes('#verify='))
  assert.ok(call.idempotencyKey.endsWith(tokenDigest(token)))
  assert.equal((await client.request('/api/customer/me')).status, 401)
  assert.equal((await client.request('/api/customer/orders')).status, 401)
  const blockedOrder = await client.request('/api/store/orders', { method: 'POST', body: { items: [] } })
  assert.equal(blockedOrder.status, 403)
  assert.match(blockedOrder.data.error, /CSRF/)
  const login = await client.request('/api/customer/login', { method: 'POST', body: { email, password: runtime.password } })
  assert.equal(login.status, 403)
  assert.equal(login.data.code, 'EMAIL_VERIFICATION_REQUIRED')
  assert.equal(login.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
})

test('abrir link não autentica; confirmação exige senha e token válido de uso único', async () => {
  const { client, email, id, token } = await runtime.register('confirm')
  const requestPage = await fetch('http://127.0.0.1:10006/account')
  assert.equal(requestPage.status, 200)
  await assertPending(id)
  for (const [candidate, password] of [[token, 'wrong-local-password'], [token, ''], [randomBytes(32).toString('hex'), runtime.password], ['not-a-token', runtime.password]]) {
    const response = await verify(client, candidate, password)
    assert.equal(response.status, 400)
    assert.equal(response.data.code, 'VERIFY_EMAIL_INVALID')
    await assertPending(id)
  }
  const confirmed = await verify(client, token)
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.verified, true)
  assert.equal(confirmed.data.user, undefined)
  assert.equal(confirmed.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
  assert.equal((await runtime.query('SELECT email_verified_at FROM customers WHERE id=?', [id]))[0].email_verified_at instanceof Date, true)
  assert.equal((await runtime.query('SELECT token_hash FROM customer_email_verifications WHERE customer_id=?', [id])).length, 0)
  assert.equal((await verify(client, token)).status, 400)
  assert.equal((await client.request('/api/customer/me')).status, 401)
  const login = await client.request('/api/customer/login', { method: 'POST', body: { email, password: runtime.password } })
  assert.equal(login.status, 200)
  assert.equal(login.data.user.id, id)
  assert.equal(login.data.user.email, email)
  assert.ok(client.csrfToken)
  assert.ok(login.cookies.some(cookie => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie)))
  if (runtime.protection) {
    const signed = decodeURIComponent(client.cookie.slice('galeo_sid='.length))
    const sid = signed.slice(2, signed.lastIndexOf('.'))
    const [row] = await runtime.query('SELECT data FROM sessions WHERE session_id=?', [sid])
    const stored = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    assert.equal(stored.customerId, undefined)
    assert.equal(stored.csrfToken, undefined)
    assert.equal(stored.protected_session.alg, 'A256GCM')
    assert.equal(JSON.stringify(stored).includes(client.csrfToken), false)
    const restored = runtime.protection.decryptJSON(stored.protected_session, { table: 'sessions', field: 'data', rowId: sid })
    assert.equal(restored.customerId, id)
    assert.equal(restored.csrfToken, client.csrfToken)
  }
  assert.equal((await client.request('/api/customer/me')).status, 200)
  assert.equal((await client.request('/api/customer/orders')).status, 200)
  assert.equal((await client.request('/api/customer/logout', { method: 'POST' })).status, 200)
  assert.equal((await client.request('/api/customer/me')).status, 401)
})

test('link expirado não ativa conta e link ativo também não ativa conta desabilitada', async () => {
  const expired = await runtime.register('expired')
  await runtime.query('UPDATE customer_email_verifications SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE customer_id=?', [expired.id])
  const expiredResponse = await verify(expired.client, expired.token)
  assert.equal(expiredResponse.status, 400)
  assert.equal(expiredResponse.data.code, 'VERIFY_EMAIL_INVALID')
  await assertPending(expired.id)
  const disabled = await runtime.register('disabled')
  await runtime.query('UPDATE customers SET active=0 WHERE id=?', [disabled.id])
  assert.equal((await verify(disabled.client, disabled.token)).status, 400)
  assert.equal((await disabled.client.request('/api/customer/login', { method: 'POST', body: { email: disabled.email, password: runtime.password } })).status, 401)
  const before = (await runtime.calls()).length
  assert.equal((await resend(disabled.client, disabled.email)).status, 202)
  assert.equal((await runtime.calls()).length, before)
  assert.equal((await (await runtime.legacySession(disabled.id)).request('/api/customer/me')).status, 401)
  await assertPending(disabled.id)
})

test('duas confirmações concorrentes consomem o link somente uma vez e não criam sessões', async () => {
  const fixture = await runtime.register('concurrent')
  const results = await Promise.all([
    verify(runtime.client(), fixture.token),
    verify(runtime.client(), fixture.token)
  ])
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400])
  assert.equal(results.some(result => result.cookies.some(cookie => cookie.startsWith('galeo_sid='))), false)
  assert.equal((await runtime.query('SELECT token_hash FROM customer_email_verifications WHERE customer_id=?', [fixture.id])).length, 0)
  assert.notEqual((await runtime.query('SELECT email_verified_at FROM customers WHERE id=?', [fixture.id]))[0].email_verified_at, null)
})

test('reenvio tem intervalo, substitui link antigo e não revela contas com credenciais incorretas', async () => {
  const { client, email, id, token } = await runtime.register('resend')
  const before = (await runtime.calls()).length
  const cooldown = await resend(client, email)
  assert.equal(cooldown.status, 429)
  assert.equal(cooldown.data.code, 'EMAIL_VERIFICATION_COOLDOWN')
  assert.ok(cooldown.data.retry_after > 0 && cooldown.data.retry_after <= 60)
  assert.equal(Number(cooldown.headers.get('Retry-After')), cooldown.data.retry_after)
  assert.equal((await runtime.calls()).length, before)
  const wrong = await resend(client, email, 'wrong-local-password')
  const unknown = await resend(client, runtime.email('unknown'))
  assert.equal(wrong.status, 202)
  assert.deepEqual(unknown.data, wrong.data)
  assert.equal((await runtime.calls()).length, before)
  await runtime.query('UPDATE customer_email_verifications SET sent_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 61 SECOND) WHERE customer_id=?', [id])
  assert.equal((await resend(client, email)).status, 202)
  const { token: replacement } = await runtime.verificationMail(email)
  assert.notEqual(replacement, token)
  assert.equal((await runtime.query('SELECT token_hash FROM customer_email_verifications WHERE customer_id=?', [id]))[0].token_hash, tokenDigest(replacement))
  assert.equal((await verify(client, token)).status, 400)
  assert.equal((await verify(client, replacement)).status, 200)
  const verifiedBefore = (await runtime.calls()).length
  const verifiedResend = await resend(client, email)
  assert.equal(verifiedResend.status, 202)
  assert.deepEqual(verifiedResend.data, unknown.data)
  assert.equal((await runtime.calls()).length, verifiedBefore)
})

test('cadastro repetido pendente não troca nome, senha ou telefone de outra pessoa', async () => {
  const fixture = await runtime.register('duplicate')
  const original = (await runtime.query('SELECT name,password_hash,phone,private_data FROM customers WHERE id=?', [fixture.id]).catch(async error => {
    if (error.code !== 'ER_BAD_FIELD_ERROR') throw error
    return runtime.query('SELECT name,password_hash,phone FROM customers WHERE id=?', [fixture.id])
  }))[0]
  const request = body => fixture.client.request('/api/customer/register', { method: 'POST', body: { name: 'Outra identidade local', email: fixture.email, phone: '11000000000', ...body } })
  assert.equal((await request({ password: 'Different-password-' + runtime.suffix })).status, 409)
  assert.equal((await request({ password: runtime.password })).status, 429)
  await runtime.query('UPDATE customer_email_verifications SET sent_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 61 SECOND) WHERE customer_id=?', [fixture.id])
  assert.equal((await request({ password: runtime.password })).status, 202)
  const select = 'SELECT ' + Object.keys(original).join(',') + ' FROM customers WHERE id=?'
  assert.deepEqual((await runtime.query(select, [fixture.id]))[0], original)
  await assertPending(fixture.id)
})

test('clientes e sessões anteriores precisam confirmar antes de acessar pedidos, perfil ou checkout', async () => {
  const fixture = await runtime.register('legacy')
  await runtime.query('DELETE FROM customer_email_verifications WHERE customer_id=?', [fixture.id])
  const client = await runtime.legacySession(fixture.id)
  const me = await client.request('/api/customer/me')
  assert.equal(me.status, 403)
  assert.equal(me.data.code, 'EMAIL_VERIFICATION_REQUIRED')
  assert.equal(me.data.email, fixture.email)
  for (const [path, method, body] of [
    ['/api/customer/orders', 'GET'],
    ['/api/customer/profile', 'PUT', { name: 'Alteração negada', phone: '' }],
    ['/api/store/orders', 'POST', { items: [] }]
  ]) {
    const isolatedSession = await runtime.legacySession(fixture.id)
    const response = await isolatedSession.request(path, { method, body })
    assert.equal(response.status, 403)
    assert.equal(response.data.code, 'EMAIL_VERIFICATION_REQUIRED')
  }
  const orders = await runtime.query('SELECT id FROM store_orders WHERE customer_id=?', [fixture.id])
  assert.equal(orders.length, 0)
  assert.equal((await resend(client, fixture.email)).status, 202)
  const { token } = await runtime.verificationMail(fixture.email)
  assert.equal((await verify(client, token)).status, 200)
  assert.equal((await client.request('/api/customer/me')).status, 401, 'confirmation must not revive a revoked legacy session')
  assert.equal((await client.request('/api/customer/login', { method: 'POST', body: { email: fixture.email, password: runtime.password } })).status, 200)
})

test('limites de confirmação e reenvio independentes bloqueiam a décima primeira tentativa', async () => {
  const client = runtime.client('127.22.10.11')
  const token = randomBytes(32).toString('hex')
  for (let index = 0; index < 10; index++) assert.equal((await verify(client, token)).status, 400)
  const blocked = await verify(client, token)
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0)
  assert.equal((await resend(client, runtime.email('rate-unknown'))).status, 202, 'confirmation limit must not consume resend limit')
  for (let index = 1; index < 10; index++) assert.equal((await resend(client, runtime.email('rate-unknown'))).status, 202)
  const resendBlocked = await resend(client, runtime.email('rate-unknown'))
  assert.equal(resendBlocked.status, 429)
  assert.ok(Number(resendBlocked.headers.get('Retry-After')) > 0)
  assert.equal((await verify(runtime.client(), token)).status, 400, 'a different local forwarded IP has its own allowance')
})

test('falha do provedor desfaz novo cadastro e mantém token pendente anterior', async () => {
  const existing = await runtime.register('provider-existing')
  await runtime.query('UPDATE customer_email_verifications SET sent_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 61 SECOND) WHERE customer_id=?', [existing.id])
  const beforeTokens = await runtime.query('SELECT * FROM customer_email_verifications WHERE customer_id=?', [existing.id])
  const countBefore = Number((await runtime.query('SELECT COUNT(*) AS total FROM customers'))[0].total)
  await runtime.setMailStatus(503)
  try {
    const client = runtime.client()
    const registered = await client.request('/api/customer/register', { method: 'POST', body: { name: 'Falha local', email: runtime.email('provider-failed'), password: runtime.password } })
    assert.equal(registered.status, 503)
    assert.equal(registered.data.code, 'EMAIL_DELIVERY_UNAVAILABLE')
    assert.equal(registered.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
    assert.equal(Number((await runtime.query('SELECT COUNT(*) AS total FROM customers'))[0].total), countBefore)
    assert.equal((await client.request('/api/customer/me')).status, 401)
    const resent = await resend(existing.client, existing.email)
    assert.equal(resent.status, 503)
    assert.equal(resent.data.code, 'EMAIL_DELIVERY_UNAVAILABLE')
    assert.deepEqual(await runtime.query('SELECT * FROM customer_email_verifications WHERE customer_id=?', [existing.id]), beforeTokens)
    await assertPending(existing.id)
    assert.equal(runtime.stderr.includes(existing.token), false)
    assert.equal(runtime.stderr.includes(existing.email), false)
  } finally { await runtime.setMailStatus(200) }
})

test('provedor ausente retorna503 sem criar conta, verificar e-mail ou liberar sessão', async () => {
  const existing = await runtime.register('provider-missing-existing')
  await runtime.query('UPDATE customer_email_verifications SET sent_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 61 SECOND) WHERE customer_id=?', [existing.id])
  const countBefore = Number((await runtime.query('SELECT COUNT(*) AS total FROM customers'))[0].total)
  const beforeCalls = (await runtime.calls()).length
  await runtime.startApi({ provider: false })
  try {
    const client = runtime.client()
    const response = await client.request('/api/customer/register', { method: 'POST', body: { name: 'Sem provedor local', email: runtime.email('provider-missing'), password: runtime.password } })
    assert.equal(response.status, 503)
    assert.equal(response.data.code, 'EMAIL_DELIVERY_UNAVAILABLE')
    assert.equal(response.cookies.some(cookie => cookie.startsWith('galeo_sid=')), false)
    assert.equal(Number((await runtime.query('SELECT COUNT(*) AS total FROM customers'))[0].total), countBefore)
    assert.equal((await resend(existing.client, existing.email)).status, 503)
    await assertPending(existing.id)
    assert.equal((await runtime.calls()).length, beforeCalls)
  } finally { await runtime.startApi() }
})
