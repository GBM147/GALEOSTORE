import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

const BASE_URL = 'https://api.mercadopago.com'
const REQUEST_TIMEOUT_MS = 10000
const PRODUCTION_HOSTS = new Set(['galeo-store.netlify.app', 'galeo-store.onrender.com'])
const testSellerCache = new Map()
const testSellerRequests = new Map()
const testFailureDiagnostics = new WeakMap()
const text = value => typeof value === 'string' ? value.trim() : ''

export class MercadoPagoError extends Error {
  constructor(code, status, message, { outcomeUnknown = false } = {}) { super(message); this.name = 'MercadoPagoError'; this.code = code; this.status = status; this.outcomeUnknown = outcomeUnknown }
}
const invalid = message => new MercadoPagoError('PAYMENT_INVALID', 400, message || 'Confira os dados do pagamento.')
const unavailable = (outcomeUnknown = true) => new MercadoPagoError('MERCADO_PAGO_UNAVAILABLE', 503, 'Não foi possível acessar o Mercado Pago agora. Tente novamente para este pedido.', { outcomeUnknown })
const notConfigured = () => new MercadoPagoError('PAYMENT_NOT_CONFIGURED', 503, 'O pagamento ainda não está disponível para este ambiente.')

function validAppUrl(value, mode) {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return false
    if (mode === 'test' && PRODUCTION_HOSTS.has(url.hostname)) return false
    return url.protocol === 'https:' || (mode === 'test' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch { return false }
}

function onlineConfiguration() {
  const mode = text(process.env.MERCADO_PAGO_MODE).toLowerCase()
  const enabledMode = ['test', 'production'].includes(mode) ? mode : 'disabled'
  const testing = enabledMode === 'test'
  const accessToken = text(testing ? process.env.GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN : process.env.MERCADO_PAGO_ACCESS_TOKEN)
  const publicKey = text(testing ? process.env.GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY : process.env.MERCADO_PAGO_PUBLIC_KEY)
  const webhookSecret = text(testing ? process.env.GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET : process.env.MERCADO_PAGO_WEBHOOK_SECRET)
  const sellerId = text(testing ? process.env.MERCADO_PAGO_TEST_SELLER_ID : process.env.MERCADO_PAGO_SELLER_ID)
  const testCredentialKind = accessToken.startsWith('TEST-') && publicKey.startsWith('TEST-')
    ? 'static'
    : accessToken.startsWith('APP_USR-') && publicKey.startsWith('APP_USR-') ? 'test-user' : ''
  const testEnvironment = /^[A-Za-z0-9_]+_test$/.test(text(process.env.DB_NAME)) && validAppUrl(text(process.env.APP_URL), 'test')
  const allowed = testing
    ? testEnvironment && Boolean(testCredentialKind) && process.env.MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED === 'true' && /^\d{1,20}$/.test(sellerId)
    : enabledMode === 'production' && process.env.MERCADO_PAGO_LIVE_PAYMENTS_ENABLED === 'true' && validAppUrl(text(process.env.APP_URL), 'production')
  return { mode: enabledMode, accessToken, publicKey, webhookSecret, sellerId, testCredentialKind, available: Boolean(allowed && accessToken && publicKey && webhookSecret) }
}

export function getMercadoPagoPublicConfig() {
  const config = onlineConfiguration()
  return { configured: config.available, available: config.available, mode: config.mode, public_key: config.available ? config.publicKey : '', methods: config.available ? ['pix', 'credit_card', 'debit_card'] : [], max_installments: 1 }
}
export function mercadoPagoOnlineConfigured() { return onlineConfiguration().available }
export function getMercadoPagoWebhookSecret() { const config = onlineConfiguration(); return config.available ? config.webhookSecret : '' }
export function mercadoPagoPointConfigured() { return Boolean(text(process.env.MERCADO_PAGO_ACCESS_TOKEN) && text(process.env.MERCADO_PAGO_POINT_TERMINAL_ID)) }

async function testFailureDiagnostic(response, config, body, idempotencyKey) {
  const diagnostic = { http_status: response.status, codes: [] }
  // Error messages and descriptions may echo private request data. Only
  // bounded machine codes are useful for this private test diagnostic.
  const privateValues = [config.accessToken, config.publicKey, config.webhookSecret, idempotencyKey]
  const collect = value => {
    if (typeof value === 'string' && value) privateValues.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(body)
  const forbidden = new Set(privateValues.map(value => value.toLowerCase()))
  const secrets = [config.accessToken, config.publicKey, config.webhookSecret,
    body?.transactions?.payments?.[0]?.payment_method?.token, body?.payer?.identification?.number]
    .filter(value => typeof value === 'string' && value.length >= 6).map(value => value.toLowerCase())
  const add = value => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) value = String(value)
    if (typeof value !== 'string' || value.length > 64 ||
        !/^(?:[A-Za-z][A-Za-z0-9_.-]{0,63}|\d{1,10})$/.test(value) || /\d{11,}/.test(value) ||
        /^[a-f0-9]{24,}$/i.test(value)) return
    const lower = value.toLowerCase()
    if (forbidden.has(lower) || secrets.some(secret => lower.includes(secret)) || diagnostic.codes.includes(value)) return
    if (diagnostic.codes.length < 16) diagnostic.codes.push(value)
  }
  try {
    // Streaming prevents an unexpectedly large provider error from being
    // retained. Failure to read diagnostics never changes the known 4xx.
    const reader = response.body?.getReader()
    if (!reader) return diagnostic
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 32768) { await reader.cancel().catch(() => {}); return diagnostic }
        chunks.push(Buffer.from(value))
      }
    } finally { reader.releaseLock() }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) return diagnostic
    for (const key of ['errorKey', 'error', 'code']) add(data[key])
    for (const list of [data.cause, data.errors]) {
      if (!Array.isArray(list)) continue
      for (const item of list.slice(0, 32)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        for (const key of ['errorKey', 'error', 'code']) add(item[key])
      }
    }
  } catch { /* Keep only the HTTP status if the private diagnostic is unreadable. */ }
  return diagnostic
}

export function mercadoPagoTestFailureDiagnostic(error) {
  const config = onlineConfiguration()
  if (config.mode !== 'test' || !config.available) return null
  const value = error && typeof error === 'object' ? testFailureDiagnostics.get(error) : null
  return value ? { http_status: value.http_status, codes: [...value.codes] } : null
}

async function request(path, { accessToken, method = 'GET', body = null, idempotencyKey = '', diagnosticConfig = null } = {}) {
  if (!accessToken) throw notConfigured()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(BASE_URL + path, {
      method, redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + accessToken, ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!response.ok) {
      // Provider bodies never enter exceptions, logs or customer responses.
      if (response.status >= 400 && response.status < 500 && ![408, 409, 423, 429].includes(response.status)) {
        const error = new MercadoPagoError('PAYMENT_PROVIDER_REJECTED', [400, 422].includes(response.status) ? 400 : 503, 'O Mercado Pago não aceitou os dados deste pagamento. Confira os dados ou escolha outra forma de pagamento.')
        error.providerStatus = response.status
        if (diagnosticConfig?.mode === 'test' && diagnosticConfig.available && method === 'POST' && path === '/v1/orders') {
          testFailureDiagnostics.set(error, await testFailureDiagnostic(response, diagnosticConfig, body, idempotencyKey))
        }
        throw error
      }
      throw unavailable()
    }
    const raw = await response.text()
    let data
    try { data = JSON.parse(raw) } catch { throw unavailable() }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable()
    return data
  } catch (error) {
    if (error instanceof MercadoPagoError) throw error
    throw unavailable()
  } finally { clearTimeout(timer) }
}

async function assertTestSeller(config) {
  if (config.mode !== 'test') return
  const key = createHash('sha256').update(JSON.stringify([config.mode, config.testCredentialKind, config.accessToken, config.publicKey, config.sellerId])).digest('hex')
  if ((testSellerCache.get(key) || 0) > Date.now()) return
  if (!testSellerRequests.has(key)) testSellerRequests.set(key, (async () => {
    // A credential prefix alone never skips authenticated seller verification.
    // Static TEST credentials belong to the application owner's normal profile;
    // APP_USR credentials must belong to an actual virtual test-user profile.
    const seller = await request('/users/me', { accessToken: config.accessToken })
    const sellerMatches = String(seller.id) === config.sellerId && seller.site_id === 'MLB'
    const permittedProfile = config.testCredentialKind === 'static' ||
      (config.testCredentialKind === 'test-user' && Array.isArray(seller.tags) && seller.tags.includes('test_user'))
    if (!sellerMatches || !permittedProfile) throw new MercadoPagoError('TEST_SELLER_REQUIRED', 503, 'As credenciais de teste precisam corresponder ao vendedor brasileiro configurado.')
    if (testSellerCache.size >= 8) testSellerCache.delete(testSellerCache.keys().next().value)
    testSellerCache.set(key, Date.now() + 300000)
  })().finally(() => testSellerRequests.delete(key)))
  await testSellerRequests.get(key)
}
export async function verifyMercadoPagoTestSeller() {
  const config = onlineConfiguration()
  if (!config.available || config.mode !== 'test') throw notConfigured()
  await assertTestSeller(config)
  return { verified: true, seller_id: config.sellerId }
}

function assertNoCardData(value, depth = 0) {
  if (depth > 5) throw invalid()
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (/^(pan|cardnumber|securitycode|cvv|cvc|expirationdate|expirationmonth|expirationyear|cardexpirationmonth|cardexpirationyear)$/i.test(key.replace(/[_\s-]/g, ''))) throw invalid('Use os campos seguros do Mercado Pago para informar o cartão.')
    if (nested && typeof nested === 'object') assertNoCardData(nested, depth + 1)
  }
}
function cpf(value) {
  const number = text(value).replace(/[.\-\s]/g, '')
  if (!/^\d{11}$/.test(number) || /^(\d)\1{10}$/.test(number)) throw invalid('Informe um CPF válido para o pagamento.')
  for (let size = 9; size <= 10; size++) {
    const sum = [...number.slice(0, size)].reduce((total, digit, index) => total + Number(digit) * (size + 1 - index), 0)
    const digit = (sum * 10) % 11
    if (Number(number[size]) !== (digit === 10 ? 0 : digit)) throw invalid('Informe um CPF válido para o pagamento.')
  }
  return number
}
export function normalizeMercadoPagoPayment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Escolha a forma de pagamento.')
  assertNoCardData(input)
  const method = text(input.method)
  if (!['pix', 'credit_card', 'debit_card'].includes(method)) throw invalid('Escolha Pix ou cartão para pagar.')
  let identification
  if (input.identification != null) {
    if (input.identification.type !== 'CPF') throw invalid('Informe o CPF do titular.')
    identification = { type: 'CPF', number: cpf(input.identification.number) }
  }
  if (method === 'pix') return { method, ...(identification ? { identification } : {}) }
  const token = text(input.token)
  const paymentMethodId = text(input.payment_method_id)
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(token) || /^\d{13,19}$/.test(token)) throw invalid('Preencha novamente os campos seguros do cartão.')
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(paymentMethodId) || ['pix', 'bolbradesco'].includes(paymentMethodId)) throw invalid('Não foi possível identificar a bandeira do cartão.')
  if (!identification) throw invalid('Informe o CPF do titular.')
  if (input.installments != null && Number(input.installments) !== 1) throw invalid('O pagamento com cartão está disponível em uma parcela.')
  return { method, payment_method_id: paymentMethodId, token, installments: 1, identification }
}

function moneyCents(value, { allowZero = false } = {}) {
  const number = Number(value)
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(number) || number < 0 || (!allowZero && number === 0) || number > 10000000) throw invalid('O valor do pedido é inválido.')
  return Math.round(number * 100)
}
function idempotency(value = randomUUID()) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw invalid('A tentativa de pagamento é inválida. Reabra o pedido para continuar.')
  return value
}
function string(value, limit) {
  const result = text(value)
  if (!result || result.length > limit || /[\x00-\x1f\x7f]/.test(result)) throw invalid('Os dados do pedido estão incompletos.')
  return result
}
function validateProviderOrder(order, config) {
  if (!order || !/^[A-Za-z0-9_-]{1,160}$/.test(String(order.id || ''))) throw unavailable()
  if (config.sellerId && String(order.user_id) !== config.sellerId) throw new MercadoPagoError('PAYMENT_SELLER_MISMATCH', 503, 'Não foi possível confirmar o vendedor deste pagamento.', { outcomeUnknown: true })
  if (order.country_code != null && order.country_code !== 'MLB') throw unavailable()
  return order
}

export async function createMercadoPagoOnlineOrder({ order, items, payment, idempotencyKey }) {
  const config = onlineConfiguration()
  if (!config.available) throw notConfigured()
  const selection = normalizeMercadoPagoPayment(payment)
  const key = idempotency(idempotencyKey)
  const total = moneyCents(order?.total)
  const shipping = order.shipping_fee == null ? 0 : moneyCents(order.shipping_fee, { allowZero: true })
  const reference = string(order.code, 128)
  const email = string(order.customer_email, 254)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('O e-mail do comprador é inválido.')
  if (!Array.isArray(items) || !items.length || items.length > 50) throw invalid('O pedido não possui itens válidos.')
  let itemTotal = 0
  const payloadItems = items.map(item => {
    const quantity = Number(item.quantity)
    const unit = moneyCents(item.unit_price)
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50 || moneyCents(item.line_total) !== unit * quantity) throw invalid('O valor dos itens do pedido é inválido.')
    itemTotal += unit * quantity
    return { id: 'P' + String(item.product_id) + (item.variant_id ? '-V' + String(item.variant_id) : ''), title: string(item.product_name, 180) + (item.size_label ? ' — ' + string(item.size_label, 40) : ''), quantity, unit_price: unit / 100 }
  })
  if (itemTotal + shipping !== total) throw invalid('O total do pedido não corresponde aos itens e ao frete.')
  if (shipping) payloadItems.push({ id: 'GALEO-SHIPPING', title: 'Frete', quantity: 1, unit_price: shipping / 100 })
  const name = text(order.customer_name).split(/\s+/)
  const address = { zip_code: text(order.postal_code).replace(/\D/g, ''), street_name: text(order.street), street_number: text(order.number), neighborhood: text(order.neighborhood), city: text(order.city), state: text(order.state) }
  const paymentMethod = selection.method === 'pix'
    ? { id: 'pix', type: 'bank_transfer' }
    : { id: selection.payment_method_id, type: selection.method, token: selection.token, installments: 1 }
  const payload = {
    type: 'online', processing_mode: 'automatic', capture_mode: 'automatic_async', total_amount: (total / 100).toFixed(2), external_reference: reference,
    payer: { email, ...(name[0] ? { first_name: name[0], ...(name.length > 1 ? { last_name: name.slice(1).join(' ') } : {}) } : {}), ...(selection.identification ? { identification: selection.identification } : {}) },
    transactions: { payments: [{ amount: (total / 100).toFixed(2), ...(selection.method === 'pix' ? { expiration_time: 'PT30M' } : {}), payment_method: paymentMethod }] },
    items: payloadItems, description: 'Pedido ' + reference + ' — GALEO Store',
    ...(address.zip_code && address.street_name ? { shipment: { address } } : {}),
    ...(selection.method !== 'pix' ? { config: { online: { transaction_security: { validation: 'supported', liability_shift: 'not_required' } } } } : {})
  }
  await assertTestSeller(config)
  const result = validateProviderOrder(await request('/v1/orders', { accessToken: config.accessToken, method: 'POST', body: payload, idempotencyKey: key, diagnosticConfig: config }), config)
  if (result.external_reference !== reference || moneyCents(result.total_amount) !== total) throw unavailable()
  return result
}

export async function getMercadoPagoOrder(orderId) {
  const config = onlineConfiguration()
  if (!config.available) throw notConfigured()
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(String(orderId))) throw invalid('O pagamento informado é inválido.')
  await assertTestSeller(config)
  const result = validateProviderOrder(await request('/v1/orders/' + encodeURIComponent(String(orderId)), { accessToken: config.accessToken }), config)
  if (String(result.id) !== String(orderId)) throw unavailable()
  return result
}

export function mapMercadoPagoOrderStatus(order) {
  const payment = order?.transactions?.payments?.[0] || {}
  const statuses = [order?.status, payment.status].map(value => String(value || '').toLowerCase())
  const details = [order?.status_detail, payment.status_detail].map(value => String(value || '').toLowerCase())
  if (statuses.some(value => ['refunded', 'refund'].includes(value)) || details.includes('refunded')) return 'REFUNDED'
  if (statuses.some(value => ['cancelled', 'canceled', 'expired'].includes(value)) || details.includes('expired')) return 'CANCELLED'
  if (statuses.some(value => ['failed', 'rejected'].includes(value)) || details.some(value => /^rejected(?:_|$)/.test(value))) return 'REJECTED'
  if (details.some(value => ['waiting_capture', 'pending_challenge', 'pending_review_manual', 'in_review', 'waiting_payment', 'waiting_transfer'].includes(value))) return 'PENDING'
  if ((statuses.includes('processed') || statuses.includes('approved')) && details.includes('accredited')) {
    const paid = order?.total_paid_amount ?? payment.paid_amount
    if (paid != null && (!Number.isFinite(Number(paid)) || !Number.isFinite(Number(order?.total_amount)) || Number(order.total_amount) <= 0 || Math.round(Number(paid) * 100) !== Math.round(Number(order.total_amount) * 100))) return 'PENDING'
    return 'APPROVED'
  }
  return 'PENDING'
}

function safeRedirect(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !/(^|\.)mercadopago\.(com|com\.br)$/.test(url.hostname)) return ''
    return url.href.length <= 4096 ? url.href : ''
  } catch { return '' }
}
function safeQrImage(value) {
  if (typeof value !== 'string' || value.length > 524288) return ''
  const raw = value.replace(/^data:image\/png;base64,/, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return ''
  const bytes = Buffer.from(raw, 'base64')
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? raw : ''
}
const boundedProviderText = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : ''
export function mercadoPagoPaymentForClient(order) {
  const payment = order?.transactions?.payments?.[0] || {}
  const method = payment.payment_method || {}
  const expires = typeof payment.date_of_expiration === 'string' ? Date.parse(payment.date_of_expiration) : NaN
  return {
    provider_reference: /^[A-Za-z0-9_-]{1,160}$/.test(String(order?.id || '')) ? String(order.id) : '',
    status: mapMercadoPagoOrderStatus(order),
    provider_status: boundedProviderText(order?.status, 60), status_detail: boundedProviderText(order?.status_detail || payment.status_detail, 80),
    method: method.id === 'pix' ? 'pix' : ['credit_card', 'debit_card'].includes(method.type) ? method.type : '',
    qr_code: method.id === 'pix' ? boundedProviderText(method.qr_code, 8192) : '',
    qr_code_base64: method.id === 'pix' ? safeQrImage(method.qr_code_base64) : '',
    redirect_url: method.transaction_security?.status === 'pending' ? safeRedirect(method.transaction_security.redirect_url) : '',
    expires_at: Number.isFinite(expires) ? new Date(expires).toISOString() : null
  }
}

export function validateMercadoPagoWebhookSignature({ signature, requestId, dataId, secret }) {
  if (typeof signature !== 'string' || typeof secret !== 'string' || !secret || typeof requestId !== 'string' || !requestId || !/^[A-Za-z0-9_-]{1,160}$/.test(String(dataId || ''))) return false
  const fields = Object.fromEntries(signature.split(',').map(part => { const [key, ...rest] = part.split('='); return [key.trim(), rest.join('=').trim()] }))
  if (!/^\d{1,16}$/.test(fields.ts || '') || !/^[0-9a-f]{64}$/i.test(fields.v1 || '')) return false
  // MP signs alphanumeric notification IDs in lowercase, even when the
  // supplied Order ID contains uppercase letters.
  const manifest = 'id:' + String(dataId).toLowerCase() + ';request-id:' + requestId + ';ts:' + fields.ts + ';'
  const expected = createHmac('sha256', secret).update(manifest).digest()
  const received = Buffer.from(fields.v1, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

// Point remains an independent integration. Online test mode never selects
// a production Point terminal or its access token.
export async function createMercadoPagoPointOrder({ externalReference, amount, description, terminalId, idempotencyKey }) {
  if (!mercadoPagoPointConfigured()) throw notConfigured()
  const payload = { type: 'point', external_reference: String(externalReference), expiration_time: 'PT16M', transactions: { payments: [{ amount: Number(amount).toFixed(2) }] }, config: { point: { terminal_id: String(terminalId || process.env.MERCADO_PAGO_POINT_TERMINAL_ID), print_on_terminal: 'no_ticket' } }, description: String(description || 'Venda GALEO') }
  return request('/v1/orders', { accessToken: text(process.env.MERCADO_PAGO_ACCESS_TOKEN), method: 'POST', body: payload, idempotencyKey: idempotencyKey || randomUUID() })
}
export async function listMercadoPagoTerminals({ storeId = '', posId = '' } = {}) {
  const params = new URLSearchParams({ limit: '50', offset: '0' })
  if (storeId) params.set('store_id', String(storeId))
  if (posId) params.set('pos_id', String(posId))
  return request('/terminals/v1/list?' + params, { accessToken: text(process.env.MERCADO_PAGO_ACCESS_TOKEN) })
}
export async function configureMercadoPagoTerminal(terminalId, operatingMode = 'PDV') {
  if (!text(process.env.MERCADO_PAGO_ACCESS_TOKEN)) throw notConfigured()
  return request('/terminals/v1/setup', { accessToken: text(process.env.MERCADO_PAGO_ACCESS_TOKEN), method: 'PATCH', body: { terminals: [{ id: String(terminalId), operating_mode: String(operatingMode).toUpperCase() }] } })
}
