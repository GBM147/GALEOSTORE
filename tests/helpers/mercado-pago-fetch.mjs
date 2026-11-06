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
    external_reference: body?.external_reference || url.searchParams.get('external_reference') || undefined,
    ...(method === 'GET' && url.pathname === '/v1/orders' ? { query: Object.fromEntries(url.searchParams) } : {}),
    idempotency_key: headers.get('X-Idempotency-Key'),
    device_id: headers.get('X-Meli-Session-Id'),
    official_sdk: (headers.get('User-Agent') || '').startsWith('MercadoPago Node.js SDK '), body }) + '\n')
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))
  let payload
  if (method === 'GET' && url.pathname === '/users/me') {
    payload = { id: 42, site_id: 'MLB', tags: ['test_user'] }
  } else if (method === 'GET' && url.pathname === '/v1/orders') {
    const reference = url.searchParams.get('external_reference')
    const complete = reference && Number.isFinite(Date.parse(url.searchParams.get('begin_date'))) &&
      Number.isFinite(Date.parse(url.searchParams.get('end_date')))
    if (!complete) return Response.json({ error: 'INVALID_LOCAL_ORDER_SEARCH' }, { status: 400 })
    const matched = Object.values(fixtures.orders).filter(order => order.external_reference === reference)
    payload = fixtures.searches?.[reference] || { data: matched,
      paging: { total: String(matched.length), total_pages: matched.length ? '1' : '0', offset: '0', limit: '50' } }
  } else if (method === 'GET' && url.pathname.startsWith('/v1/orders/')) {
    payload = fixtures.orders[decodeURIComponent(url.pathname.slice('/v1/orders/'.length))]
  } else if (method === 'POST' && url.pathname === '/v1/orders') {
    // Current SDK Orders contract, including the fields required by the
    // real quality evaluation. No external request leaves this fixture.
    const payment = body?.transactions?.payments?.[0]
    const card = payment?.payment_method?.type !== 'bank_transfer'
    const valid = body?.type === 'online' && body?.processing_mode === 'automatic' &&
      body.capture_mode === 'automatic' &&
      Object.keys(body).every(key => ['type', 'processing_mode', 'capture_mode', 'total_amount', 'external_reference', 'payer', 'transactions', 'config', 'items', 'additional_info'].includes(key)) &&
      typeof body?.payer?.email === 'string' && typeof body.payer.first_name === 'string' &&
      body.config?.statement_descriptor === 'GALEO' &&
      Array.isArray(body.items) && body.items.length > 0 && body.items.every(item =>
        Number.isSafeInteger(item.quantity) && item.quantity > 0 && /^\d+\.\d{2}$/.test(item.unit_price) &&
        typeof item.unit_price === 'string' && typeof item.title === 'string' &&
        typeof item.external_code === 'string' && item.category_id === 'fashion') &&
      (!card || (body.config.online?.transaction_security?.validation === 'on_fraud_risk' &&
        body.config.online.transaction_security.liability_shift === 'required')) &&
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
