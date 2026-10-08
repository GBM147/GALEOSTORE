// Loaded only by the local integration test server, never by production startup.
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const fixturePath = process.env.GALEO_TEST_MP_FIXTURES
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
if (!loopbackHosts.has(process.env.DB_HOST) || process.env.DB_NAME !== 'galeo_store_test' ||
    !fixturePath || !isAbsolute(fixturePath) || !statSync(fixturePath).isFile()) {
  throw new Error('Mercado Pago fixtures require the isolated loopback test database and an absolute fixture file.')
}

const realFetch = globalThis.fetch
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname !== 'api.mercadopago.com') return realFetch(input, options)

  const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const body = options.body ? JSON.parse(options.body) : null
  appendFileSync(fixturePath + '.calls', JSON.stringify({ phase: 'started', method, path: url.pathname, external_reference: body?.external_reference }) + '\n')
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))
  let payload
  if (method === 'GET' && url.pathname.startsWith('/v1/orders/')) {
    payload = fixtures.orders[decodeURIComponent(url.pathname.slice('/v1/orders/'.length))]
  } else if (method === 'POST' && url.pathname === '/v1/orders') {
    payload = fixtures.checkouts[body?.external_reference]
  }
  const responsePayload = payload ? { ...payload } : { error: 'Missing local Mercado Pago fixture.' }
  const delay = Number(responsePayload.__delay_ms || 0)
  delete responsePayload.__delay_ms
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  return new Response(JSON.stringify(responsePayload), {
    status: payload ? 200 : 404,
    headers: { 'Content-Type': 'application/json' }
  })
}
