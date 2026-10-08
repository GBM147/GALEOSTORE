// Imported only by the isolated local verification test server. Never sends mail.
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'

const fixturePath = process.env.GALEO_TEST_RESEND_FIXTURES
const loopback = new Set(['localhost', '127.0.0.1', '::1'])
if (!loopback.has(process.env.DB_HOST) || process.env.DB_NAME !== 'galeo_store_test' ||
    !fixturePath || !isAbsolute(fixturePath) || !statSync(fixturePath).isFile() ||
    !['', 'local-email-verification-fixture'].includes(process.env.RESEND_API_KEY || '')) {
  throw new Error('Email fixtures require the isolated loopback test database, a local fixture file and the fixture key.')
}

const realFetch = globalThis.fetch
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname !== 'api.resend.com') return realFetch(input, options)
  const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'POST' || url.pathname !== '/emails') throw new Error('Unexpected local Resend fixture request.')
  const payload = JSON.parse(options.body)
  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to]
  if (!recipients.length || recipients.some(value => !String(value).endsWith('@example.invalid')) ||
      !String(payload.from).endsWith('@example.invalid')) {
    throw new Error('The local email fixture refuses real recipients or senders.')
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  appendFileSync(fixturePath + '.calls', JSON.stringify({
    method, path: url.pathname, payload,
    idempotencyKey: options.headers?.['Idempotency-Key'] || '',
    status: Number(fixture.status || 200)
  }) + '\n', { mode: 0o600 })
  const status = Number(fixture.status || 200)
  return new Response(JSON.stringify(status < 300 ? { id: randomUUID() } : { message: 'Local fixture mail failure.' }), {
    status, headers: { 'Content-Type': 'application/json' }
  })
}
