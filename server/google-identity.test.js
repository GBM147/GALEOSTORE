import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createGoogleIdentity, googleClientId } from './google-identity.js'

const clientId = 'local-test.apps.googleusercontent.com'
const pair = (kid) => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } }
}
const first = pair('key-1'), second = pair('key-2')
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = 1_800_000_000_000
const claims = (extra = {}) => ({
  iss: 'https://accounts.google.com', aud: clientId, azp: clientId, sub: '1234567890', email: 'Cliente@Example.Invalid',
  email_verified: true, name: 'Cliente  Local', nonce: 'nonce-local', iat: now / 1000 - 10, exp: now / 1000 + 3600, ...extra
})
function token(payload = claims(), { key = first, header = {} } = {}) {
  const head = encode({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }) + '.' + encode(payload)
  return head + '.' + sign('RSA-SHA256', Buffer.from(head), key.privateKey).toString('base64url')
}
function identity(keys = [first], calls = []) {
  return createGoogleIdentity({
    clientId,
    now: () => now,
    fetchImpl: async url => {
      calls.push(url)
      return new Response(JSON.stringify({ keys: keys.map(key => key.jwk) }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20000' } })
    }
  })
}

test('o Client ID só vale no formato do Google', () => {
  assert.equal(googleClientId({ GOOGLE_CLIENT_ID: ' ' + clientId + ' ' }), clientId)
  assert.equal(googleClientId({ GOOGLE_CLIENT_ID: 'qualquer-coisa' }), '')
  assert.equal(googleClientId({}), '')
})

test('token válido devolve e-mail em minúsculas, nome e o identificador do Google', async () => {
  const calls = []
  const google = identity([first], calls)
  assert.deepEqual(await google.verify(token(), { nonce: 'nonce-local' }), { subject: '1234567890', email: 'cliente@example.invalid', name: 'Cliente Local' })
  await google.verify(token(), { nonce: ['outro', 'nonce-local'] })
  assert.equal(calls.length, 1, 'as chaves ficam em cache')
  await assert.rejects(google.verify(token(), { nonce: ['outro', ''] }))
})

test('recusa emissor, público, validade, nonce e e-mail não confirmado', async () => {
  const google = identity()
  const rejects = async (payload, nonce = 'nonce-local', code = 'GOOGLE_TOKEN_INVALID') =>
    assert.rejects(google.verify(token(payload), { nonce }), error => error.code === code)
  await rejects(claims({ iss: 'https://evil.example' }))
  await rejects(claims({ aud: 'outro.apps.googleusercontent.com' }))
  await rejects(claims({ azp: 'outro.apps.googleusercontent.com' }))
  await rejects(claims({ exp: now / 1000 - 120 }))
  await rejects(claims({ iat: now / 1000 + 3600 }))
  await rejects(claims(), 'outro-nonce')
  await rejects(claims(), '')
  await rejects(claims({ nonce: undefined }))
  await rejects(claims({ email_verified: false }), 'nonce-local', 'GOOGLE_EMAIL_UNVERIFIED')
  await rejects(claims({ email: 'sem-arroba' }))
  await rejects(claims({ sub: '' }))
})

test('recusa assinatura adulterada, outro algoritmo e formatos estranhos', async () => {
  const google = identity()
  const good = token()
  const [head, body, signature] = good.split('.')
  const tampered = head + '.' + encode({ ...claims(), email: 'outra@example.invalid' }) + '.' + signature
  for (const bad of [tampered, head + '.' + body + '.' + signature.slice(0, -2) + 'AA', token(claims(), { header: { alg: 'none' } }), token(claims(), { header: { alg: 'HS256' } }), 'a.b', '', null, good + '.x', 'x'.repeat(5000)]) {
    await assert.rejects(google.verify(bad, { nonce: 'nonce-local' }), error => error.code === 'GOOGLE_TOKEN_INVALID', String(bad).slice(0, 20))
  }
  await assert.rejects(google.verify(token(claims(), { key: pair('key-1') }), { nonce: 'nonce-local' }), error => error.code === 'GOOGLE_TOKEN_INVALID', 'mesma kid com outra chave')
})

test('chave nova do Google faz buscar as chaves de novo, no máximo uma vez por minuto', async () => {
  const calls = []
  let published = [first]
  const google = createGoogleIdentity({
    clientId,
    now: () => now,
    fetchImpl: async url => { calls.push(url); return new Response(JSON.stringify({ keys: published.map(key => key.jwk) }), { headers: { 'Cache-Control': 'max-age=20000' } }) }
  })
  await google.verify(token(), { nonce: 'nonce-local' })
  published = [first, second]
  // Same clock: within the refresh interval an unknown key is refused without a new fetch.
  await assert.rejects(google.verify(token(claims(), { key: second }), { nonce: 'nonce-local' }))
  assert.equal(calls.length, 1)
  let clock = now + 61_000
  const later = createGoogleIdentity({ clientId, now: () => clock, fetchImpl: async () => new Response(JSON.stringify({ keys: published.map(key => key.jwk) }), { headers: { 'Cache-Control': 'max-age=20000' } }) })
  assert.equal((await later.verify(token(claims(), { key: second }), { nonce: 'nonce-local' })).email, 'cliente@example.invalid')
  clock += 1
  const down = createGoogleIdentity({ clientId, now: () => now, fetchImpl: async () => new Response('', { status: 503 }) })
  await assert.rejects(down.verify(token(), { nonce: 'nonce-local' }), error => error.code === 'GOOGLE_KEYS_UNAVAILABLE')
  const unconfigured = createGoogleIdentity({ clientId: '' })
  await assert.rejects(unconfigured.verify(token(), { nonce: 'nonce-local' }), error => error.code === 'GOOGLE_NOT_CONFIGURED')
})
