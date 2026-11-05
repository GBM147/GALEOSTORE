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
  if (url.hostname !== 'api.mercadopago.com') {
    if (!loopbackHosts.has(url.hostname)) throw new Error('External network is forbidden by the local Mercado Pago fixture runner.')
    return realFetch(input, options)
  }

  const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const body = options.body ? JSON.parse(options.body) : null
  const headers = new Headers(options.headers)
  if (headers.get('Authorization') !== 'Bearer APP_USR-local-test-only') return Response.json({ error: 'UNEXPECTED_LOCAL_TEST_CREDENTIAL' }, { status: 401 })
  appendFileSync(fixturePath + '.calls', JSON.stringify({ phase: 'started', method, path: url.pathname,
    external_reference: body?.external_reference, idempotency_key: headers.get('X-Idempotency-Key'), body }) + '\n')
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))
  let payload
  if (method === 'GET' && url.pathname === '/users/me') {
    payload = { id: 42, site_id: 'MLB', tags: ['test_user'] }
  } else if (method === 'GET' && url.pathname.startsWith('/v1/orders/')) {
    payload = fixtures.orders[decodeURIComponent(url.pathname.slice('/v1/orders/'.length))]
  } else if (method === 'POST' && url.pathname === '/v1/orders') {
    // Reject the previous hosted Checkout Pro-shaped request. These are the
    // official Orders API fields exercised by this isolated local suite.
    const payment = body?.transactions?.payments?.[0]
    const valid = body?.type === 'online' && body?.processing_mode === 'automatic' &&
      Object.keys(body).every(key => ['type', 'processing_mode', 'total_amount', 'external_reference', 'payer', 'transactions'].includes(key)) &&
      Object.keys(body?.payer || {}).length === 1 && typeof body?.payer?.email === 'string' &&
      /^\d+\.\d{2}$/.test(body?.total_amount) && payment?.amount === body.total_amount &&
      ['pix', 'visa', 'master'].includes(payment?.payment_method?.id) &&
      ['bank_transfer', 'credit_card', 'debit_card'].includes(payment?.payment_method?.type) &&
      headers.has('X-Idempotency-Key') && !body?.config?.online?.success_url && !body?.expiration_time
    if (!valid) return Response.json({ error: 'INVALID_LOCAL_ORDERS_CONTRACT' }, { status: 400 })
    payload = fixtures.creations[body.external_reference]
  }
  const responsePayload = payload ? { ...payload } : { error: 'Missing local Mercado Pago fixture.' }
  const delay = Number(responsePayload.__delay_ms || 0)
  const responseStatus = Number(responsePayload.__http_status || (payload ? method === 'POST' ? 201 : 200 : 404))
  const throws = responsePayload.__throw
  delete responsePayload.__delay_ms
  delete responsePayload.__http_status
  delete responsePayload.__throw
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  if (throws) throw new TypeError('Simulated isolated transport failure')
  return new Response(JSON.stringify(responsePayload), {
    status: responseStatus,
    headers: { 'Content-Type': 'application/json' }
  })
}
