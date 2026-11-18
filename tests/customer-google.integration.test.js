// "Continuar com o Google" against the isolated local API: the test signs ID
// tokens with a local key that the API trusts in place of Google's.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { VerificationRuntime } from './helpers/email-verification-runtime.mjs'
import { LEGAL_VERSION } from '../src/legal/pages.js'

const runtime = new VerificationRuntime()
before(async () => { await runtime.initialize() })
after(async () => { await runtime.close() })

async function nonceFor(client) {
  const config = await client.request('/api/customer/google/config')
  assert.equal(config.status, 200)
  assert.equal(config.data.available, true)
  assert.equal(config.data.client_id, runtime.googleClientId)
  assert.match(config.data.nonce, /^[A-Za-z0-9_-]{32}$/)
  assert.match(config.headers.get('cache-control') || '', /no-store/)
  return config.data.nonce
}

const post = (client, credential, acceptTerms = false) => client.request('/api/customer/google', { method: 'POST', body: { credential, accept_terms: acceptTerms } })

async function google(client, email, { acceptTerms = false, claims = {} } = {}) {
  const nonce = await nonceFor(client)
  return post(client, runtime.googleToken({ email, nonce, ...claims }), acceptTerms)
}

async function confirmedCustomer(label) {
  const fixture = await runtime.register(label)
  const confirmed = await fixture.client.request('/api/customer/verify-email', { method: 'POST', body: { token: fixture.token, password: runtime.password } })
  assert.equal(confirmed.status, 200)
  return fixture
}

const login = async (email, password) => (await runtime.client().request('/api/customer/login', { method: 'POST', body: { email, password } })).status

test('conta nova pelo Google exige o aceite; com ele nasce confirmada, com sessão e boas-vindas', async () => {
  const email = runtime.email('google-new')
  const client = runtime.client()
  const refused = await google(client, email)
  assert.equal(refused.status, 409)
  assert.equal(refused.data.code, 'GOOGLE_TERMS_REQUIRED')
  assert.equal(refused.data.email, email)
  assert.equal(client.csrfToken, '', 'nothing signs in without the acceptance')

  const created = await google(client, email.toUpperCase(), { acceptTerms: true, claims: { name: 'Cliente  Google' } })
  assert.equal(created.status, 200, created.data?.error)
  assert.equal(created.data.created, true)
  assert.equal(created.data.user.email, email)
  assert.equal(created.data.user.auth_method, 'google')
  assert.ok(client.csrfToken)
  runtime.ids.add(created.data.user.id)
  const [row] = await runtime.query('SELECT email_verified_at,terms_version,terms_accepted_at,active FROM customers WHERE id=?', [created.data.user.id])
  assert.ok(row.email_verified_at instanceof Date, 'Google already confirmed the e-mail')
  assert.equal(row.terms_version, LEGAL_VERSION)
  assert.ok(row.terms_accepted_at)
  const me = await client.request('/api/customer/me')
  assert.equal(me.status, 200)
  assert.equal(me.data.user.auth_method, 'google')
  assert.equal(me.data.user.name, 'Cliente Google')
  assert.equal((await client.request('/api/customer/orders')).status, 200)
  const welcome = (await runtime.calls()).filter(call => call.payload.to.includes(email) && call.payload.subject === 'Boas-vindas à GALEO Store')
  assert.equal(welcome.length, 1)
  assert.match(welcome[0].payload.text, /criada com o Google/)
  assert.equal(await login(email, runtime.password), 401, 'the random password is unknown to everybody')

  const again = await google(runtime.client(), email)
  assert.equal(again.status, 200, 'an existing account signs in without the checkbox')
  assert.equal(again.data.created, false)
  assert.equal(again.data.user.id, created.data.user.id)
})

test('conta pendente é confirmada pelo Google e a senha de quem cadastrou para de valer', async () => {
  const pending = await runtime.register('google-pending')
  assert.equal(await login(pending.email, runtime.password), 403)
  const signed = await google(runtime.client(), pending.email)
  assert.equal(signed.status, 200, signed.data?.error)
  assert.equal(signed.data.created, false)
  const [row] = await runtime.query('SELECT email_verified_at FROM customers WHERE id=?', [pending.id])
  assert.ok(row.email_verified_at instanceof Date)
  assert.equal((await runtime.query('SELECT 1 FROM customer_email_verifications WHERE customer_id=?', [pending.id])).length, 0)
  assert.equal(await login(pending.email, runtime.password), 401)
})

test('recusa conta desativada, nonce reusado ou de outro navegador, outro Client ID e e-mail não confirmado', async () => {
  const fixture = await confirmedCustomer('google-guard')
  const client = runtime.client()
  const nonce = await nonceFor(client)
  const token = runtime.googleToken({ email: fixture.email, nonce })
  assert.equal((await post(client, token)).status, 200)
  const replay = await post(client, token)
  assert.equal(replay.status, 400, 'the nonce works once')
  assert.equal(replay.data.code, 'GOOGLE_SESSION_EXPIRED')
  await nonceFor(client)
  assert.equal((await post(client, token)).status, 401, 'an old nonce does not match the new one')

  // Two quick page loads: the token made with the first nonce still works once.
  const twoTabs = runtime.client()
  const firstNonce = await nonceFor(twoTabs)
  await nonceFor(twoTabs)
  assert.equal((await post(twoTabs, runtime.googleToken({ email: fixture.email, nonce: firstNonce }))).status, 200)

  const victim = runtime.client(), attacker = runtime.client()
  const victimNonce = await nonceFor(victim)
  await nonceFor(attacker)
  const stolen = await post(attacker, runtime.googleToken({ email: fixture.email, nonce: victimNonce }))
  assert.equal(stolen.status, 401, 'a token made for another browser is refused')
  assert.equal(stolen.data.code, 'GOOGLE_TOKEN_INVALID')

  const other = await google(runtime.client(), fixture.email, { claims: { aud: 'outro.apps.googleusercontent.com', azp: 'outro.apps.googleusercontent.com' } })
  assert.equal(other.status, 401)
  const unverified = await google(runtime.client(), runtime.email('google-unverified'), { acceptTerms: true, claims: { email_verified: false } })
  assert.equal(unverified.status, 400)
  assert.equal(unverified.data.code, 'GOOGLE_EMAIL_UNVERIFIED')
  const noSession = await post(runtime.client(), runtime.googleToken({ email: fixture.email, nonce: 'x'.repeat(32) }))
  assert.equal(noSession.status, 400)
  assert.equal(noSession.data.code, 'GOOGLE_SESSION_EXPIRED')

  await runtime.query('UPDATE customers SET active=0 WHERE id=?', [fixture.id])
  const disabled = await google(runtime.client(), fixture.email)
  assert.equal(disabled.status, 401)
  assert.equal(disabled.data.code, 'ACCOUNT_UNAVAILABLE')
})

test('logo depois de entrar pelo Google, excluir a conta não pede senha', async () => {
  const email = runtime.email('google-delete')
  const client = runtime.client()
  const created = await google(client, email, { acceptTerms: true })
  assert.equal(created.status, 200)
  runtime.ids.add(created.data.user.id)
  assert.equal((await client.request('/api/customer/account', { method: 'DELETE', body: {} })).status, 400, 'the confirmation is still required')
  const removed = await client.request('/api/customer/account', { method: 'DELETE', body: { confirm: true } })
  assert.equal(removed.status, 200, removed.data?.error)
  assert.equal((await client.request('/api/customer/me')).status, 401)
  const [row] = await runtime.query('SELECT active FROM customers WHERE id=?', [created.data.user.id])
  assert.equal(Number(row.active), 0)
  // A password session still needs the password.
  const fixture = await confirmedCustomer('google-delete-password')
  const passwordClient = runtime.client()
  assert.equal((await passwordClient.request('/api/customer/login', { method: 'POST', body: { email: fixture.email, password: runtime.password } })).status, 200)
  assert.equal((await passwordClient.request('/api/customer/account', { method: 'DELETE', body: { confirm: true } })).status, 400)
})
