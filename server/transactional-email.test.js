import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransactionalEmail } from './transactional-email.js'

const configuration = {
  NODE_ENV: 'production',
  RESEND_API_KEY: ' re_test-only-secret ',
  EMAIL_FROM: ' GALEO Store <loja@galeo.test> ',
  APP_URL: ' https://galeo.test ',
  ADMIN_EMAIL: 'owner@galeo.test'
}
const payload = {
  to: ' cliente@galeo.test ',
  subject: 'Confirme seu e-mail — GALEO',
  html: '<p><a href="https://galeo.test/conta#verify=private-token">Confirmar</a></p>',
  text: 'Confirme o e-mail\nhttps://galeo.test/conta#verify=private-token',
  idempotencyKey: 'verify-customer-1-token-digest'
}
const sensitive = ['re_test-only-secret', 'loja@galeo.test', 'cliente@galeo.test', 'owner@galeo.test', 'private-token', 'https://galeo.test']

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }
}
function redacted(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  for (const text of sensitive) assert.equal(serialized.includes(text), false, 'sensitive provider input must be redacted')
}
function hasCode(code, status) {
  return (error) => {
    assert.equal(error.code, code)
    assert.equal(error.status, status)
    assert.equal(error.message, code)
    assert.equal(error.cause, undefined)
    redacted(error.stack)
    redacted(error)
    return true
  }
}

test('status reports only readiness and pending variable names from a configuration snapshot', () => {
  const env = { ...configuration }
  const email = createTransactionalEmail({ env })
  assert.deepEqual(email.status(), {
    provider: 'RESEND', api_key_configured: true, sender_configured: true,
    app_url_configured: true, store_notification_configured: true,
    sending_configured: true, confirmation_configured: true, pending_configuration: []
  })
  redacted(email.status())
  env.EMAIL_FROM = ''
  env.RESEND_API_KEY = ''
  env.APP_URL = ''
  assert.equal(email.confirmationConfigured(), true)
  assert.equal(email.status().sending_configured, true)
  email.status().pending_configuration.push('CHANGED')
  assert.deepEqual(email.status().pending_configuration, [])
  const missing = createTransactionalEmail({ env: {} })
  assert.deepEqual(missing.status().pending_configuration, ['RESEND_API_KEY', 'EMAIL_FROM', 'APP_URL'])
  assert.equal(missing.status().store_notification_configured, false)
  assert.equal(missing.confirmationConfigured(), false)
})

test('store notifications use an optional owner fallback and do not block customer email', () => {
  const ownerFallback = createTransactionalEmail({ env: { ...configuration, STORE_NOTIFICATION_EMAIL: '  ' } })
  assert.equal(ownerFallback.status().store_notification_configured, true)
  const noStoreAddress = createTransactionalEmail({ env: { ...configuration, ADMIN_EMAIL: '' } })
  assert.equal(noStoreAddress.status().store_notification_configured, false)
  assert.equal(noStoreAddress.confirmationConfigured(), true)
  assert.deepEqual(noStoreAddress.status().pending_configuration, [])
  assert.equal(createTransactionalEmail({ env: { ...configuration, STORE_NOTIFICATION_EMAIL: 'invalid' } }).status().store_notification_configured, false)
})

test('confirmation requires HTTPS in production and accepts only HTTP loopback in development', () => {
  for (const APP_URL of ['', 'not a URL', 'http://galeo.test', 'http://localhost:4300', 'ftp://galeo.test', 'https://user:password@galeo.test', 'https://galeo.test\r\n']) {
    const email = createTransactionalEmail({ env: { ...configuration, APP_URL } })
    assert.equal(email.status().app_url_configured, false)
    assert.equal(email.status().sending_configured, true)
    assert.equal(email.confirmationConfigured(), false)
    assert.deepEqual(email.status().pending_configuration, ['APP_URL'])
  }
  for (const APP_URL of ['http://localhost:4300', 'http://127.0.0.1:4300', 'http://[::1]:4300', 'https://galeo.test']) {
    assert.equal(createTransactionalEmail({ env: { ...configuration, NODE_ENV: 'test', APP_URL } }).confirmationConfigured(), true)
  }
  assert.equal(createTransactionalEmail({ env: { ...configuration, NODE_ENV: 'test', APP_URL: 'http://remote.test' } }).confirmationConfigured(), false)
  assert.equal(createTransactionalEmail({ env: { ...configuration, NODE_ENV: undefined, APP_URL: 'http://localhost:4300' } }).confirmationConfigured(), false, 'missing NODE_ENV defaults to production')
})

test('missing or invalid sender/key fails before fetch and safe sending skips without logging', async () => {
  let calls = 0
  const logs = []
  const fetchImpl = async () => { calls++; return response(200, { id: 'email-id' }) }
  for (const patch of [
    { RESEND_API_KEY: '' }, { RESEND_API_KEY: 'key\r\nsecret' }, { RESEND_API_KEY: 'key space' },
    { EMAIL_FROM: '' }, { EMAIL_FROM: 'sender' }, { EMAIL_FROM: 'loja@galeo.test\r\nBcc: other@test.com' },
    { EMAIL_FROM: 'GALEO <loja@galeo.test>\n' }, { EMAIL_FROM: 'GALEO <loja@@galeo.test>' }
  ]) {
    const email = createTransactionalEmail({ env: { ...configuration, ...patch }, fetchImpl, logger: { error: (...args) => logs.push(args) } })
    await assert.rejects(email.send(payload), hasCode('EMAIL_NOT_CONFIGURED', 503))
    assert.deepEqual(await email.sendSafely(payload), { skipped: true, reason: 'EMAIL_NOT_CONFIGURED' })
  }
  assert.equal(calls, 0)
  assert.deepEqual(logs, [])
})

test('Resend request preserves the payload and idempotency header while returning only the delivery id', async () => {
  const calls = []
  const email = createTransactionalEmail({ env: configuration, fetchImpl: async (...args) => { calls.push(args); return response(200, { id: 'delivery-id', secret: 'private-token', recipient: payload.to }) } })
  assert.deepEqual(await email.send(payload), { id: 'delivery-id' })
  assert.equal(calls.length, 1)
  const [url, options] = calls[0]
  assert.equal(url, 'https://api.resend.com/emails')
  assert.equal(options.method, 'POST')
  assert.equal(options.signal.aborted, false)
  assert.deepEqual(options.headers, {
    'Content-Type': 'application/json', Authorization: 'Bearer re_test-only-secret',
    'Idempotency-Key': payload.idempotencyKey
  })
  assert.deepEqual(JSON.parse(options.body), {
    from: 'GALEO Store <loja@galeo.test>', to: ['cliente@galeo.test'],
    subject: payload.subject, html: payload.html, text: payload.text
  })
})

test('a plain sender and recipient list work without inventing a text body or idempotency key', async () => {
  let request
  const email = createTransactionalEmail({
    env: { ...configuration, EMAIL_FROM: 'loja@galeo.test', APP_URL: '' },
    fetchImpl: async (_, options) => { request = options; return response(201, { id: 'delivery-id' }) }
  })
  assert.deepEqual(await email.send({ to: ['cliente@galeo.test', 'Equipe <team@galeo.test>'], subject: 'Pedido recebido', html: '<p>Pedido</p>' }), { id: 'delivery-id' })
  assert.equal('Idempotency-Key' in request.headers, false)
  assert.deepEqual(JSON.parse(request.body), { from: 'loja@galeo.test', to: ['cliente@galeo.test', 'Equipe <team@galeo.test>'], subject: 'Pedido recebido', html: '<p>Pedido</p>' })
})

test('malformed recipients, header injection and malformed payloads are rejected without a network call', async () => {
  let calls = 0
  const email = createTransactionalEmail({ env: configuration, fetchImpl: async () => { calls++; return response(200, { id: 'delivery-id' }) } })
  for (const invalid of [
    null, [], {}, { ...payload, to: [] }, { ...payload, to: ['cliente@galeo.test', ''] },
    { ...payload, to: 'cliente@galeo.test\r\nBcc: other@test.com' },
    { ...payload, to: 'cliente@@galeo.test' }, { ...payload, to: Array(51).fill('cliente@galeo.test') },
    { ...payload, subject: '' }, { ...payload, subject: 'subject\nBcc: other@test.com' },
    { ...payload, subject: 42 }, { ...payload, html: '' }, { ...payload, text: {} },
    { ...payload, idempotencyKey: 'id\r\nAuthorization: secret' }, { ...payload, idempotencyKey: 'a'.repeat(257) }
  ]) await assert.rejects(email.send(invalid), hasCode('EMAIL_PAYLOAD_INVALID', 400))
  assert.equal(calls, 0)
})

test('a 2xx response must contain a nonempty delivery id and never exposes malformed provider content', async () => {
  for (const body of ['', 'invalid private-token JSON', {}, { id: '' }, { id: ' ' }, { id: 2 }, { id: 'id\r\nsecret' }]) {
    const email = createTransactionalEmail({ env: configuration, fetchImpl: async () => response(200, body) })
    await assert.rejects(email.send(payload), hasCode('EMAIL_PROVIDER_RESPONSE_INVALID', 502))
  }
})

test('provider rejection does not parse or expose an error body and never retries', async () => {
  let calls = 0
  let reads = 0
  const logs = []
  const email = createTransactionalEmail({
    env: configuration, logger: { error: (...args) => logs.push(args) },
    fetchImpl: async () => { calls++; return { status: 429, ok: false, text: async () => { reads++; return JSON.stringify(payload) } } }
  })
  assert.deepEqual(await email.sendSafely(payload), { error: 'EMAIL_PROVIDER_REJECTED' })
  assert.equal(calls, 1)
  assert.equal(reads, 0)
  assert.deepEqual(logs, [['EMAIL_DELIVERY', { code: 'EMAIL_PROVIDER_REJECTED', status: 429 }]])
  redacted(logs)
})

test('network exceptions are replaced with safe codes and no cause, credential or recipient logs', async () => {
  const logs = []
  const email = createTransactionalEmail({
    env: configuration, logger: { error: (...args) => logs.push(args) },
    fetchImpl: async () => { throw new Error('re_test-only-secret cliente@galeo.test https://galeo.test/conta#verify=private-token') }
  })
  await assert.rejects(email.send(payload), hasCode('EMAIL_DELIVERY_FAILED', 502))
  assert.deepEqual(await email.sendSafely(payload), { error: 'EMAIL_DELIVERY_FAILED' })
  assert.deepEqual(logs, [['EMAIL_DELIVERY', { code: 'EMAIL_DELIVERY_FAILED', status: 502 }]])
  redacted(logs)
})

test('timeouts abort the request and safely return one redacted failure without retry', async () => {
  const logs = []
  let calls = 0
  let signal
  const email = createTransactionalEmail({
    env: configuration, timeoutMs: 10, logger: { error: (...args) => logs.push(args) },
    fetchImpl: async (_, options) => {
      calls++
      signal = options.signal
      return await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted cliente@galeo.test private-token')), { once: true }))
    }
  })
  assert.deepEqual(await email.sendSafely(payload), { error: 'EMAIL_DELIVERY_TIMEOUT' })
  assert.equal(signal.aborted, true)
  assert.equal(calls, 1)
  assert.deepEqual(logs, [['EMAIL_DELIVERY', { code: 'EMAIL_DELIVERY_TIMEOUT', status: 504 }]])
  redacted(logs)
})

test('the timeout also covers a stalled provider response body', async () => {
  let signal
  const email = createTransactionalEmail({
    env: configuration, timeoutMs: 10,
    fetchImpl: async (_, options) => {
      signal = options.signal
      return { status: 200, ok: true, text: () => new Promise(() => {}) }
    }
  })
  await assert.rejects(email.send(payload), hasCode('EMAIL_DELIVERY_TIMEOUT', 504))
  assert.equal(signal.aborted, true)
})
