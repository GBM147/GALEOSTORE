import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import test from 'node:test'
import { createMercadoPagoOnlineOrder, createMercadoPagoPointOrder, findMercadoPagoOrderForAttempt, getMercadoPagoOrder, getMercadoPagoPublicConfig, getMercadoPagoWebhookSecret, mapMercadoPagoOrderStatus, mercadoPagoOnlineConfigured, mercadoPagoPaymentForClient, mercadoPagoPointConfigured, mercadoPagoTestFailureDiagnostic, normalizeMercadoPagoPayment, validateMercadoPagoWebhookSignature } from './mercado-pago.js'

const keys = ['MERCADO_PAGO_MODE', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_PUBLIC_KEY', 'MERCADO_PAGO_WEBHOOK_SECRET', 'MERCADO_PAGO_LIVE_PAYMENTS_ENABLED', 'MERCADO_PAGO_SELLER_ID', 'MERCADO_PAGO_POINT_TERMINAL_ID', 'GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN', 'GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY', 'GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET', 'MERCADO_PAGO_TEST_SELLER_ID', 'MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED', 'DB_NAME', 'APP_URL']
const order = { id: 1, code: 'GALEO-LOCAL', customer_email: 'buyer-local@example.invalid', customer_name: 'Pessoa local', customer_phone: '11999999999', postal_code: '01001-000', street: 'Praça local', number: '20', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', total: '121.35', shipping_fee: '21.35' }
const items = [{ product_id: 11, variant_id: 21, size_label: 'M', product_name: 'Peça local', quantity: 2, unit_price: '50.00', line_total: '100.00' }]
const card = () => ({ method: 'credit_card', payment_method_id: 'visa', token: 'local-card-token-' + randomUUID(), installments: 1, identification: { type: 'CPF', number: '123.456.789-09' } })
const response = (value, status = 200) => new Response(JSON.stringify(value), { status })
const rawOrder = (overrides = {}) => ({ id: 'ORDLOCAL123', user_id: '42', country_code: 'BRA', external_reference: order.code, total_amount: order.total, status: 'action_required', status_detail: 'waiting_transfer', transactions: { payments: [{ id: 'PAYLOCAL', amount: order.total, status: 'action_required', status_detail: 'waiting_transfer', date_of_expiration: '2030-11-03T16:30:00.000Z', payment_method: { id: 'pix', type: 'bank_transfer', qr_code: '000201PIX-LOCAL' } }] }, ...overrides })

async function fixture(run, overrides = {}) {
  const environment = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  for (const key of keys) delete process.env[key]
  Object.assign(process.env, { MERCADO_PAGO_MODE: 'test', GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN: 'APP_USR-local-test-' + randomUUID(), GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY: 'APP_USR-local-public-key', GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET: 'local-webhook-secret', MERCADO_PAGO_TEST_SELLER_ID: '42', MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED: 'true', DB_NAME: 'galeo_payment_test', APP_URL: 'http://127.0.0.1:10001', ...overrides })
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response(rawOrder(), 201) }
  try { return await run(calls) }
  finally {
    globalThis.fetch = previousFetch
    for (const [key, value] of Object.entries(environment)) value === undefined ? delete process.env[key] : process.env[key] = value
  }
}

test('online payments remain disabled when only an old access token is configured', async () => fixture(async calls => {
  process.env.MERCADO_PAGO_MODE = ''
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'legacy-token'
  assert.equal(mercadoPagoOnlineConfigured(), false)
  assert.deepEqual(getMercadoPagoPublicConfig(), { configured: false, available: false, mode: 'disabled', public_key: '', methods: [], max_installments: 1 })
  assert.equal(getMercadoPagoWebhookSecret(), '')
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'PAYMENT_NOT_CONFIGURED' })
  assert.equal(calls.length, 0)
}))

test('test configuration requires separate database/origin, all credentials and deliberate test seller configuration', async () => fixture(async calls => {
  assert.equal(mercadoPagoOnlineConfigured(), true)
  const cases = [ ['DB_NAME', 'galeo_store'], ['APP_URL', 'https://galeo-store.netlify.app'], ['APP_URL', 'https://galeo-store.onrender.com'], ['APP_URL', 'http://external.example.invalid'], ['APP_URL', 'https://person:password@staging.example.invalid'], ['MERCADO_PAGO_TEST_SELLER_ID', ''], ['MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED', 'false'], ['GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN', ''], ['GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY', ''], ['GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET', ''] ]
  for (const [key, value] of cases) {
    const previous = process.env[key]; process.env[key] = value
    assert.equal(mercadoPagoOnlineConfigured(), false, key)
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'PAYMENT_NOT_CONFIGURED' })
    process.env[key] = previous
  }
  assert.equal(calls.length, 0)
}))

test('production requires explicit live enablement and exposes only the public key', async () => fixture(async () => {
  Object.assign(process.env, { MERCADO_PAGO_MODE: 'production', MERCADO_PAGO_ACCESS_TOKEN: 'live-private-token', MERCADO_PAGO_PUBLIC_KEY: 'live-public-key', MERCADO_PAGO_WEBHOOK_SECRET: 'live-webhook-secret', APP_URL: 'https://galeo-store.netlify.app' })
  assert.equal(mercadoPagoOnlineConfigured(), false)
  process.env.MERCADO_PAGO_LIVE_PAYMENTS_ENABLED = 'true'
  const config = getMercadoPagoPublicConfig()
  assert.equal(config.available, true)
  assert.equal(config.public_key, 'live-public-key')
  assert.deepEqual(config.methods, ['pix', 'credit_card', 'debit_card'])
  assert.equal(config.max_installments, 1)
  assert.equal(getMercadoPagoWebhookSecret(), 'live-webhook-secret')
  assert.equal(JSON.stringify(config).includes('private-token'), false)
  assert.equal(JSON.stringify(config).includes('webhook-secret'), false)
}))

test('test mode checks the actual seller before attempting any payment POST', async () => fixture(async calls => {
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response({ id: 42, site_id: 'MLB', tags: [] }) }
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'TEST_SELLER_REQUIRED', outcomeUnknown: false })
  assert.deepEqual(calls.map(call => [call.url, call.options.method]), [['https://api.mercadopago.com/users/me', 'GET']])
}))

test('a different seller test account cannot be used even with the test_user tag', async () => fixture(async calls => {
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response({ id: 99, site_id: 'MLB', tags: ['test_user'] }) }
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'TEST_SELLER_REQUIRED' })
  assert.equal(calls.some(call => call.options.method === 'POST'), false)
}))

const staticCredentials = () => ({
  GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN: 'TEST-local-static-' + randomUUID(),
  GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY: 'TEST-local-static-public-' + randomUUID()
})

test('Orders rejects static TEST credentials before profile lookup or payment creation', async () => fixture(async calls => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: [] }) : response(rawOrder(), 201)
  }
  assert.equal(mercadoPagoOnlineConfigured(), false)
  assert.deepEqual(getMercadoPagoPublicConfig(), { configured: false, available: false, mode: 'test', public_key: '', methods: [], max_installments: 1 })
  for (const payment of [{ method: 'pix' }, card()]) {
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment }), { code: 'PAYMENT_NOT_CONFIGURED' })
  }
  const { verifyMercadoPagoTestSeller } = await import('./mercado-pago.js')
  await assert.rejects(verifyMercadoPagoTestSeller(), { code: 'PAYMENT_NOT_CONFIGURED' })
  await assert.rejects(getMercadoPagoOrder('ORDSTATICREJECTED'), { code: 'PAYMENT_NOT_CONFIGURED' })
  assert.equal(calls.length, 0)
}, staticCredentials()))

test('Orders test credentials cannot create a charge when authenticated profile lookup is denied', async () => fixture(async calls => {
  for (const status of [401, 403]) {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options })
      return response({ message: 'private-profile-token-and-data' }, status)
    }
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), error =>
      error.code === 'PAYMENT_PROVIDER_REJECTED' && error.outcomeUnknown === false && !error.message.includes('private-profile'))
  }
  assert.equal(calls.length, 2)
  assert.equal(calls.every(call => call.url.endsWith('/users/me') && call.options.method === 'GET'), true)
}))

test('Orders test credentials require the expected seller and Brazilian site in the authenticated profile', async () => fixture(async calls => {
  for (const profile of [
    { id: 99, site_id: 'MLB', tags: [] },
    { id: 42, site_id: 'MLA', tags: [] },
    { id: 42, tags: [] },
    { id: 42, site_id: 'MLB', tags: ['test_user'] }
  ]) {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options })
      return response(profile)
    }
    if (profile.site_id === 'MLB' && profile.id === 42) {
      // Verifying a profile does not need an Orders response or create a charge.
      const { verifyMercadoPagoTestSeller } = await import('./mercado-pago.js')
      assert.deepEqual(await verifyMercadoPagoTestSeller(), { verified: true, seller_id: '42' })
    } else await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'TEST_SELLER_REQUIRED' })
  }
  assert.equal(calls.length, 4)
  assert.equal(calls.some(call => call.options.method === 'POST'), false)
}))

test('test mode rejects mixed or unknown credential namespaces before contacting the provider', async () => fixture(async calls => {
  for (const [accessToken, publicKey] of [
    ['TEST-local-access', 'APP_USR-local-public'],
    ['APP_USR-local-access', 'TEST-local-public'],
    ['local-unknown-access', 'local-unknown-public']
  ]) {
    Object.assign(process.env, { GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN: accessToken, GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY: publicKey })
    assert.equal(mercadoPagoOnlineConfigured(), false)
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'PAYMENT_NOT_CONFIGURED' })
  }
  assert.equal(calls.length, 0)
}))

test('Orders test credentials retain every explicit environment and readiness guard', async () => fixture(async calls => {
  for (const [key, value] of [
    ['MERCADO_PAGO_MODE', 'disabled'], ['DB_NAME', 'galeo_store'],
    ['APP_URL', 'https://galeo-store.netlify.app'], ['APP_URL', 'https://galeo-store.onrender.com'],
    ['APP_URL', 'http://external.example.invalid'], ['MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED', 'false'],
    ['MERCADO_PAGO_TEST_SELLER_ID', ''], ['GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET', '']
  ]) {
    const previous = process.env[key]
    process.env[key] = value
    assert.equal(mercadoPagoOnlineConfigured(), false, key)
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'PAYMENT_NOT_CONFIGURED' })
    process.env[key] = previous
  }
  assert.equal(calls.length, 0)
}))

test('changing the APP_USR Public Key invalidates cached seller verification', async () => fixture(async calls => {
  let deny = false
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return url.endsWith('/users/me') ? response({ id: deny ? 99 : 42, site_id: 'MLB', tags: ['test_user'] }) : response(rawOrder(), 201)
  }
  await createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } })
  process.env.GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY = 'APP_USR-replaced-public-' + randomUUID()
  deny = true
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'TEST_SELLER_REQUIRED' })
  assert.equal(calls.filter(call => call.url.endsWith('/users/me')).length, 2)
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1)
}))

test('APP_USR virtual test credentials also require a Brazilian profile', async () => fixture(async calls => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return response({ id: 42, site_id: 'MLA', tags: ['test_user'] })
  }
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'TEST_SELLER_REQUIRED' })
  assert.equal(calls.some(call => call.options.method === 'POST'), false)
}))

test('Pix uses minimal Orders fields with transaction expiry and server-owned total including freight', async () => fixture(async calls => {
  const idempotencyKey = randomUUID()
  const result = await createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix', amount: '0.01', email: 'forged@example.invalid' }, idempotencyKey })
  assert.equal(result.id, 'ORDLOCAL123')
  assert.equal(calls[0].url, 'https://api.mercadopago.com/users/me')
  const post = calls[1]
  assert.equal(post.url, 'https://api.mercadopago.com/v1/orders')
  assert.equal(post.options.headers['X-Idempotency-Key'], idempotencyKey)
  assert.equal(post.options.redirect, 'error')
  assert.ok(post.options.signal instanceof AbortSignal)
  const body = JSON.parse(post.options.body)
  assert.equal(body.type, 'online')
  assert.equal(body.processing_mode, 'automatic')
  assert.equal(body.total_amount, '121.35')
  assert.deepEqual(body.payer, { email: order.customer_email })
  assert.deepEqual(body.transactions.payments, [{ amount: '121.35', expiration_time: 'PT30M', payment_method: { id: 'pix', type: 'bank_transfer' } }])
  assert.equal(body.expiration_time, undefined)
  assert.equal(body.config, undefined)
  assert.deepEqual(Object.keys(body).sort(), ['external_reference', 'payer', 'processing_mode', 'total_amount', 'transactions', 'type'])
  for (const key of ['items', 'shipment', 'capture_mode', 'description']) assert.equal(body[key], undefined)
}))

test('card payments use the documented minimal tokenized transaction and retain CPF input validation', async () => fixture(async calls => {
  const payment = card()
  await createMercadoPagoOnlineOrder({ order, items, payment: { ...payment, issuer_id: 'ignored', installments: 1 }, idempotencyKey: randomUUID() })
  const body = JSON.parse(calls.find(call => call.options.method === 'POST').options.body)
  assert.deepEqual(body.transactions.payments[0].payment_method, { id: 'visa', type: 'credit_card', token: payment.token, installments: 1 })
  assert.deepEqual(body, { type: 'online', processing_mode: 'automatic', total_amount: '121.35', external_reference: order.code,
    payer: { email: order.customer_email }, transactions: { payments: [{ amount: '121.35', payment_method: { id: 'visa', type: 'credit_card', token: payment.token, installments: 1 } }] } })
  assert.equal(JSON.stringify(body).includes('issuer_id'), false)
  assert.equal(JSON.stringify(body).includes('12345678909'), false)
  assert.deepEqual(normalizeMercadoPagoPayment(normalizeMercadoPagoPayment(payment)), normalizeMercadoPagoPayment(payment))
}))

test('payment validation rejects raw card data and malformed payment requests before any provider call', async () => fixture(async calls => {
  const inputs = [ null, [], { method: 'cash' }, { method: 'pix', card_number: '4235647728025682' }, { ...card(), nested: { cvv: '123' } }, { ...card(), token: '4235647728025682' }, { ...card(), payment_method_id: 'pix' }, { ...card(), installments: 12 }, { ...card(), identification: { type: 'CPF', number: '11111111111' } }, { ...card(), identification: undefined } ]
  for (const payment of inputs) await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment }), { code: 'PAYMENT_INVALID' })
  assert.equal(calls.length, 0)
}))

test('invalid internal total or idempotency headers never reach Mercado Pago', async () => fixture(async calls => {
  await assert.rejects(createMercadoPagoOnlineOrder({ order: { ...order, total: '0.01' }, items, payment: { method: 'pix' } }), { code: 'PAYMENT_INVALID' })
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items: [{ ...items[0], line_total: '99.00' }], payment: { method: 'pix' } }), { code: 'PAYMENT_INVALID' })
  await assert.rejects(createMercadoPagoOnlineOrder({ order: { ...order, shipping_fee: '0.00' }, items, payment: { method: 'pix' } }), { code: 'PAYMENT_INVALID' })
  await assert.rejects(createMercadoPagoOnlineOrder({ order: { ...order, shipping_fee: '-1.00' }, items, payment: { method: 'pix' } }), { code: 'PAYMENT_INVALID' })
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' }, idempotencyKey: 'unsafe\r\nAuthorization: secret' }), { code: 'PAYMENT_INVALID' })
  assert.equal(calls.length, 0)
}))

test('concurrent requests verify a seller once and reuse each caller-provided idempotency UUID', async () => fixture(async calls => {
  const idempotencyKey = randomUUID()
  await Promise.all([1, 2].map(() => createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' }, idempotencyKey })))
  assert.equal(calls.filter(call => call.url.endsWith('/users/me')).length, 1)
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 2)
  assert.equal(calls.filter(call => call.options.method === 'POST').every(call => call.options.headers['X-Idempotency-Key'] === idempotencyKey), true)
}))

test('provider rejection is definitive and does not leak provider payloads or credentials', async () => fixture(async () => {
  globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response({ message: 'secret-card-token-123 CPF12345678909', cause: ['private'] }, 422)
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: card() }), error => {
    assert.equal(error.code, 'PAYMENT_PROVIDER_REJECTED')
    assert.equal(error.outcomeUnknown, false)
    assert.equal(error.providerStatus, 422)
    assert.equal(error.message.includes('secret-card'), false)
    assert.equal(error.message.includes('12345678909'), false)
    return true
  })
}))

test('test rejection retains only private structured codes and removes request data or credentials', async () => fixture(async () => {
  const payment = card(), attempt = randomUUID()
  const rejectedValues = [payment.token, process.env.GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN,
    process.env.GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY, process.env.GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET,
    'prefix-' + payment.token, '12345678909', order.customer_email, 'Pessoa', order.code,
    'invalid 4235647728025682', 'a'.repeat(65), { nested: 'private' }]
  const noisy = { errorKey: 'invalid_order', error: 'bad_request', code: 3001,
    message: 'private-message ' + payment.token,
    cause: [{ code: 'invalid_order', description: 'private-description' }, ...rejectedValues.map(code => ({ code }))],
    errors: [{ code: 'missing_property', message: order.customer_email }] }
  globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response(noisy, 400)
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment, idempotencyKey: attempt }), error => {
    assert.equal(error.outcomeUnknown, false)
    assert.deepEqual(mercadoPagoTestFailureDiagnostic(error), { http_status: 400, codes: ['invalid_order', 'bad_request', '3001', 'missing_property'] })
    assert.equal(JSON.stringify(error).includes('invalid_order'), false, 'diagnostic must not appear in automatic exception logs')
    const copy = mercadoPagoTestFailureDiagnostic(error)
    copy.codes.push('mutated')
    assert.equal(mercadoPagoTestFailureDiagnostic(error).codes.includes('mutated'), false)
    process.env.MERCADO_PAGO_MODE = 'disabled'
    assert.equal(mercadoPagoTestFailureDiagnostic(error), null)
    return true
  })
}))

test('test diagnostics bound code count and malformed or oversized bodies never change definitive rejection', async () => fixture(async () => {
  const values = [
    () => response({ errors: Array.from({ length: 100 }, (_, i) => ({ code: 'error_' + i })) }, 422),
    () => new Response('not-json private body', { status: 422 }),
    () => response({ code: 'not_retained', message: 'a'.repeat(33000) }, 422),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private-stream-error')) } }), { status: 422 })
  ]
  for (const [index, providerResponse] of values.entries()) {
    globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : providerResponse()
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: card() }), error => {
      assert.equal(error.code, 'PAYMENT_PROVIDER_REJECTED')
      assert.equal(error.outcomeUnknown, false)
      assert.deepEqual(mercadoPagoTestFailureDiagnostic(error), { http_status: 422, codes: index === 0 ? Array.from({ length: 16 }, (_, i) => 'error_' + i) : [] })
      return true
    })
  }
}))

test('test diagnostics retain only outgoing schema paths mentioned by structured provider errors', async () => fixture(async () => {
  const payment = card()
  const noisy = { code: 'property_type', description: 'Wrong total_amount and transactions.payments[0].payment_method.type; expected type string. ' + payment.token,
    message: 'Private payer ' + order.customer_email + ' CPF 12345678909', errors: [
      { code: 'unsupported_properties', field: 'body.payer.email' },
      { path: '/transactions/payments/0/payment_method/id' },
      { instancePath: '#/transactions/payments/0/payment_method/token' },
      { json_path: '$.transactions.payments[0].amount' },
      { field: 'transactions.payments[99].payment_method.id' },
      { path: 'payer.email_extra' }, { field: 'city_extra' },
      { message: 'items[0].unit_price shipment.address payer.first_name nottotal_amount' },
      { field: payment.token, message: process.env.GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN },
      { description: 'Duplicate /transactions/payments/0/payment_method/id and transactions.payments.0.amount' }
    ] }
  globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response(noisy, 400)
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment }), error => {
    const diagnostic = mercadoPagoTestFailureDiagnostic(error)
    assert.deepEqual(diagnostic, { http_status: 400, codes: ['property_type', 'unsupported_properties'], fields: [
      'payer.email', 'transactions.payments.0.payment_method.id', 'transactions.payments.0.payment_method.token',
      'transactions.payments.0.amount', 'total_amount', 'transactions.payments.0.payment_method.type'
    ] })
    const serialized = JSON.stringify(diagnostic)
    for (const privateValue of [payment.token, order.customer_email, '12345678909', process.env.GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN]) assert.equal(serialized.includes(privateValue), false)
    assert.equal(JSON.stringify(error).includes('payer.email'), false)
    diagnostic.fields.push('mutated')
    assert.equal(mercadoPagoTestFailureDiagnostic(error).fields.includes('mutated'), false)
    return true
  })
}))

test('test diagnostic path matching ignores oversized prose and unquoted generic words', async () => fixture(async () => {
  for (const message of ['expected type string for unknown properties', 'x'.repeat(8200) + ' total_amount']) {
    globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response({ code: 'field_error', message }, 400)
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: card() }), error => {
      assert.deepEqual(mercadoPagoTestFailureDiagnostic(error), { http_status: 400, codes: ['field_error'] })
      return true
    })
  }
}))

test('production rejections never read or retain a test diagnostic body', async () => fixture(async () => {
  Object.assign(process.env, { MERCADO_PAGO_MODE: 'production', MERCADO_PAGO_LIVE_PAYMENTS_ENABLED: 'true',
    MERCADO_PAGO_ACCESS_TOKEN: 'production-private-token', MERCADO_PAGO_PUBLIC_KEY: 'production-public-key',
    MERCADO_PAGO_WEBHOOK_SECRET: 'production-webhook-secret', APP_URL: 'https://galeo-store.netlify.app' })
  let bodyReads = 0
  globalThis.fetch = async () => ({ ok: false, status: 400, get body() { bodyReads++; throw new Error('must not read production error body') } })
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: card() }), error => {
    assert.equal(error.code, 'PAYMENT_PROVIDER_REJECTED')
    assert.equal(error.outcomeUnknown, false)
    assert.equal(mercadoPagoTestFailureDiagnostic(error), null)
    process.env.MERCADO_PAGO_MODE = 'test'
    assert.equal(mercadoPagoTestFailureDiagnostic(error), null, 'production error must not populate the private diagnostic map')
    return true
  })
  assert.equal(bodyReads, 0)
}))

test('timeouts, throttling and provider failures preserve an ambiguous attempt for idempotent retry', async () => fixture(async () => {
  for (const status of [408, 409, 423, 429, 500, 503]) {
    globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response({}, status)
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), error => {
      assert.equal(error.code, 'MERCADO_PAGO_UNAVAILABLE')
      assert.equal(error.outcomeUnknown, true)
      assert.equal(mercadoPagoTestFailureDiagnostic(error), null)
      return true
    })
  }
  globalThis.fetch = async () => { throw new TypeError('network includes secret-token') }
  await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), error => error.outcomeUnknown === true && !error.message.includes('secret-token'))
}))

test('a stalled charge is aborted by the transport deadline and retains an unknown outcome', async t => fixture(async calls => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/users/me')) return response({ id: 42, site_id: 'MLB', tags: ['test_user'] })
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  }
  const result = assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), { code: 'MERCADO_PAGO_UNAVAILABLE', outcomeUnknown: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.some(call => call.options.method === 'POST'), true)
  t.mock.timers.tick(10001)
  await result
  assert.equal(calls.at(-1).options.signal.aborted, true)
  t.mock.timers.reset()
}))

test('Orders accepts Brazilian ISO country with string seller ID and retains legacy MLB compatibility', async () => fixture(async () => {
  for (const country of ['BRA', 'MLB']) {
    globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response(rawOrder({ country_code: country }), 201)
    const created = await createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } })
    assert.equal(created.country_code, country)
    assert.equal(created.user_id, '42')
    assert.equal((await getMercadoPagoOrder('ORDLOCAL123')).country_code, country)
  }
}))

test('lost-response lookup uses only authenticated GETs and rechecks a unique complete result', async () => fixture(async calls => {
  const attempt = { method: 'pix', created_at_ms: Date.now() - 1000 }
  const value = rawOrder({ type: 'online', created_date: new Date(attempt.created_at_ms + 200).toISOString() })
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/users/me')) return response({ id: 42, site_id: 'MLB', tags: ['test_user'] })
    if (new URL(url).pathname === '/v1/orders') return response({ data: [value], paging: { total: '1', total_pages: '1', offset: '0', limit: '50' } })
    return response(value)
  }
  assert.equal((await findMercadoPagoOrderForAttempt({ order, attempt })).id, value.id)
  assert.equal(calls.length, 3)
  assert.equal(calls.every(call => call.options.method === 'GET' && !call.options.body), true)
  const search = new URL(calls[1].url)
  assert.equal(search.searchParams.get('external_reference'), order.code)
  assert.equal(search.searchParams.get('page_size'), '50')
  assert.equal(calls[2].url, 'https://api.mercadopago.com/v1/orders/' + value.id)
}))

test('lost-response lookup never chooses from incomplete, ambiguous or contradictory results', async () => fixture(async () => {
  const attempt = { method: 'pix', created_at_ms: Date.now() - 1000 }
  const value = rawOrder({ type: 'online', created_date: new Date(attempt.created_at_ms + 200).toISOString() })
  const complete = data => ({ data, paging: { total: String(data.length), total_pages: data.length ? '1' : '0', offset: '0', limit: '50' } })
  const invalidResults = [
    { data: [value] }, { ...complete([value]), paging: { total: '2', total_pages: '2', offset: '0' } },
    complete([value, { ...value, id: 'OTHER' }]), complete([{ ...value, user_id: '99' }]),
    complete([{ ...value, type: 'point' }]), complete([{ ...value, created_date: new Date(attempt.created_at_ms - 300001).toISOString() }]),
    complete([{ ...value, status: 'processed', status_detail: 'accredited', total_paid_amount: '1.00' }])
  ]
  for (const result of invalidResults) {
    let gets = 0
    globalThis.fetch = async url => {
      if (url.endsWith('/users/me')) return response({ id: 42, site_id: 'MLB', tags: ['test_user'] })
      gets++
      assert.equal(new URL(url).pathname, '/v1/orders')
      return response(result)
    }
    await assert.rejects(findMercadoPagoOrderForAttempt({ order, attempt }))
    assert.equal(gets, 1, 'invalid search must not even fetch a candidate resource')
  }
  globalThis.fetch = async url => url.endsWith('/users/me')
    ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response(complete([]))
  assert.equal(await findMercadoPagoOrderForAttempt({ order, attempt }), null)
}))

test('lost-response lookup fails closed when the separately fetched resource changes', async () => fixture(async () => {
  const attempt = { method: 'pix', created_at_ms: Date.now() - 1000 }
  const value = rawOrder({ type: 'online', created_date: new Date(attempt.created_at_ms + 200).toISOString() })
  globalThis.fetch = async url => {
    if (url.endsWith('/users/me')) return response({ id: 42, site_id: 'MLB', tags: ['test_user'] })
    if (new URL(url).pathname === '/v1/orders') return response({ data: [value], paging: { total: '1', total_pages: '1' } })
    return response({ ...value, external_reference: 'DIFFERENT-ORDER' })
  }
  await assert.rejects(findMercadoPagoOrderForAttempt({ order, attempt }))
}))

test('invalid successful provider responses never become an accepted payment', async () => fixture(async () => {
  for (const value of [{}, rawOrder({ id: undefined }), rawOrder({ user_id: undefined }), rawOrder({ user_id: null }),
    rawOrder({ user_id: 99 }), ...['MLA', 'ARG', 'USA', 'BR', 'bra', ''].map(country_code => rawOrder({ country_code })),
    rawOrder({ total_amount: '1.00' }), rawOrder({ external_reference: 'DIFFERENT-ORDER' })]) {
    globalThis.fetch = async url => url.endsWith('/users/me') ? response({ id: 42, site_id: 'MLB', tags: ['test_user'] }) : response(value, 201)
    await assert.rejects(createMercadoPagoOnlineOrder({ order, items, payment: { method: 'pix' } }), error => error.outcomeUnknown === true)
  }
}))

test('GET Orders validates the requested ID and seller and does not support arbitrary provider paths', async () => fixture(async calls => {
  const result = await getMercadoPagoOrder('ORDLOCAL123')
  assert.equal(result.id, 'ORDLOCAL123')
  assert.equal(calls.at(-1).url, 'https://api.mercadopago.com/v1/orders/ORDLOCAL123')
  await assert.rejects(getMercadoPagoOrder('../users/me'), { code: 'PAYMENT_INVALID' })
  globalThis.fetch = async () => response(rawOrder({ id: 'ORDOTHER' }))
  await assert.rejects(getMercadoPagoOrder('ORDLOCAL123'), { code: 'MERCADO_PAGO_UNAVAILABLE' })
}))

test('status mapping does not mistake authorization, challenge or partial funding for approval', () => {
  const state = (status, status_detail, extra = {}) => mapMercadoPagoOrderStatus(rawOrder({ status, status_detail, transactions: { payments: [] }, ...extra }))
  assert.equal(state('processed', 'waiting_capture'), 'PENDING')
  assert.equal(state('action_required', 'pending_challenge'), 'PENDING')
  assert.equal(state('processed', 'accredited', { total_paid_amount: '100.00' }), 'PENDING')
  assert.equal(state('processed', 'accredited', { total_paid_amount: '122.00' }), 'PENDING')
  assert.equal(state('processed', 'accredited', { total_paid_amount: '121.35' }), 'APPROVED')
  assert.equal(state('processed', ''), 'PENDING')
  assert.equal(state('failed', 'rejected_by_issuer'), 'REJECTED')
  assert.equal(state('canceled', 'expired'), 'CANCELLED')
  assert.equal(state('refunded', 'refunded'), 'REFUNDED')
  assert.equal(state('unrecognized', ''), 'PENDING')
})

test('client payment view exposes only whitelisted Pix data, dates and status', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64')
  const raw = rawOrder()
  raw.payer = { email: 'private@example.invalid', identification: { number: '12345678909' } }
  raw.transactions.payments[0].payment_method.token = 'never-client-token'
  raw.transactions.payments[0].payment_method.qr_code_base64 = png
  const payment = mercadoPagoPaymentForClient(raw)
  assert.equal(payment.provider_reference, 'ORDLOCAL123')
  assert.equal(payment.qr_code, '000201PIX-LOCAL')
  assert.equal(payment.qr_code_base64, png)
  assert.equal(payment.expires_at, '2030-11-03T16:30:00.000Z')
  assert.equal(payment.status, 'PENDING')
  assert.equal(JSON.stringify(payment).includes('private@example.invalid'), false)
  assert.equal(JSON.stringify(payment).includes('never-client-token'), false)
  raw.transactions.payments[0].payment_method.qr_code_base64 = Buffer.from('<svg onload=alert(1)>').toString('base64')
  assert.equal(mercadoPagoPaymentForClient(raw).qr_code_base64, '')
})

test('3DS redirects only allow HTTPS Mercado Pago hosts without credentials or alternate ports', () => {
  const raw = rawOrder()
  const method = raw.transactions.payments[0].payment_method = { id: 'visa', type: 'credit_card', transaction_security: { status: 'pending', redirect_url: 'https://www.mercadopago.com.br/challenge' } }
  assert.equal(mercadoPagoPaymentForClient(raw).redirect_url, 'https://www.mercadopago.com.br/challenge')
  for (const url of ['javascript:alert(1)', 'http://mercadopago.com/challenge', 'https://mercadopago.com.evil.invalid/challenge', 'https://evil.invalid', 'https://user:pass@mercadopago.com/challenge', 'https://mercadopago.com:444/challenge']) {
    method.transaction_security.redirect_url = url
    assert.equal(mercadoPagoPaymentForClient(raw).redirect_url, '')
  }
})

test('webhook signature normalizes alphanumeric Orders IDs and rejects malformed signatures', () => {
  const secret = 'local-signature-secret', dataId = 'ORDLOCAL123', requestId = 'local-request', timestamp = '1793710000000'
  const hash = createHmac('sha256', secret).update('id:ordlocal123;request-id:' + requestId + ';ts:' + timestamp + ';').digest('hex')
  const signature = 'ts=' + timestamp + ',v1=' + hash
  assert.equal(validateMercadoPagoWebhookSignature({ signature, requestId, dataId, secret }), true)
  assert.equal(validateMercadoPagoWebhookSignature({ signature, requestId, dataId: 'ORDOTHER', secret }), false)
  assert.equal(validateMercadoPagoWebhookSignature({ signature: signature.slice(0, -1), requestId, dataId, secret }), false)
  assert.equal(validateMercadoPagoWebhookSignature({ signature, requestId: '', dataId, secret }), false)
})

test('Point configuration and token remain independent of online test credentials', async () => fixture(async calls => {
  assert.equal(mercadoPagoPointConfigured(), false)
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'local-point-only-token'
  process.env.MERCADO_PAGO_POINT_TERMINAL_ID = 'local-terminal'
  assert.equal(mercadoPagoPointConfigured(), true)
  await createMercadoPagoPointOrder({ externalReference: 'LOCAL-POINT', amount: 10, description: 'Local', idempotencyKey: 'local-point-key' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer local-point-only-token')
  assert.equal(JSON.parse(calls[0].options.body).type, 'point')
}))
