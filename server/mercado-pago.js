import { createHmac, randomBytes } from 'node:crypto'

const MERCADO_PAGO_BASE_URL = 'https://api.mercadopago.com'

function getAccessToken() {
  return String(process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim()
}

export function mercadoPagoOnlineConfigured() {
  return Boolean(getAccessToken() && String(process.env.APP_URL || '').trim())
}

export function mercadoPagoPointConfigured() {
  return Boolean(getAccessToken() && String(process.env.MERCADO_PAGO_POINT_TERMINAL_ID || '').trim())
}

async function mercadoPagoRequest(path, { method = 'GET', body = null, idempotencyKey = '' } = {}) {
  const accessToken = getAccessToken()
  if (!accessToken) throw new Error('Mercado Pago ainda não está configurado no servidor.')

  const response = await fetch(MERCADO_PAGO_BASE_URL + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: 'Bearer ' + accessToken,
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })

  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}

  if (!response.ok) {
    const message = data?.message || data?.error || ('Mercado Pago HTTP ' + response.status)
    throw new Error(message)
  }

  return data || {}
}

export async function createMercadoPagoOnlineOrder({ order, items, idempotencyKey }) {
  if (!mercadoPagoOnlineConfigured()) {
    throw new Error('Pagamento online ainda não está configurado no GALEO.')
  }

  const baseUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '')
  const firstName = String(order.customer_name || '').trim().split(/\s+/)[0] || 'Cliente'
  const lastName = String(order.customer_name || '').trim().split(/\s+/).slice(1).join(' ') || ''

  const payload = {
    type: 'online',
    total_amount: Number(order.total).toFixed(2),
    external_reference: String(order.code),
    processing_mode: 'manual',
    capture_mode: 'automatic_async',
    expiration_time: 'P1D',
    payer: {
      email: String(order.customer_email || ''),
      first_name: firstName,
      ...(lastName ? { last_name: lastName } : {}),
      phone: {
        area_code: String(order.customer_phone || '').replace(/\D/g, '').slice(0, 2),
        number: String(order.customer_phone || '').replace(/\D/g, '').slice(2, 13)
      },
      address: {
        zip_code: String(order.postal_code || ''),
        street_name: String(order.street || ''),
        street_number: String(order.number || ''),
        neighborhood: String(order.neighborhood || ''),
        city: String(order.city || ''),
        state: String(order.state || '')
      }
    },
    config: {
      online: {
        success_url: baseUrl + '/carrinho?pagamento=sucesso&pedido=' + encodeURIComponent(order.code),
        failure_url: baseUrl + '/carrinho?pagamento=falha&pedido=' + encodeURIComponent(order.code),
        pending_url: baseUrl + '/carrinho?pagamento=pendente&pedido=' + encodeURIComponent(order.code),
        auto_return: 'approved',
        allowed_user_type: 'all'
      }
    },
    items: items.map((item) => ({
      external_code: 'P' + String(item.product_id),
      title: String(item.product_name),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price).toFixed(2)
    })),
    description: 'Pedido ' + String(order.code) + ' — GALEO Store'
  }

  return mercadoPagoRequest('/v1/orders', {
    method: 'POST',
    body: payload,
    idempotencyKey: idempotencyKey || randomBytes(16).toString('hex')
  })
}

export async function createMercadoPagoPointOrder({ externalReference, amount, description, terminalId, idempotencyKey }) {
  if (!mercadoPagoPointConfigured()) {
    throw new Error('Mercado Pago Point ainda não está configurado no GALEO.')
  }

  const payload = {
    type: 'point',
    external_reference: String(externalReference),
    expiration_time: 'PT16M',
    transactions: {
      payments: [{ amount: Number(amount).toFixed(2) }]
    },
    config: {
      point: {
        terminal_id: String(terminalId || process.env.MERCADO_PAGO_POINT_TERMINAL_ID),
        print_on_terminal: 'no_ticket'
      }
    },
    description: String(description || 'Venda GALEO')
  }

  return mercadoPagoRequest('/v1/orders', {
    method: 'POST',
    body: payload,
    idempotencyKey: idempotencyKey || randomBytes(16).toString('hex')
  })
}

export async function getMercadoPagoOrder(orderId) {
  return mercadoPagoRequest('/v1/orders/' + encodeURIComponent(String(orderId)))
}

export function validateMercadoPagoWebhookSignature({ signature, requestId, dataId, secret }) {
  if (!signature || !secret) return false

  let timestamp = ''
  let receivedHash = ''
  for (const part of String(signature).split(',')) {
    const [key, ...rest] = part.split('=')
    const value = rest.join('=').trim()
    if (key?.trim() === 'ts') timestamp = value
    if (key?.trim() === 'v1') receivedHash = value
  }

  if (!timestamp || !receivedHash) return false

  const manifest = 'id:' + String(dataId || '') + ';request-id:' + String(requestId || '') + ';ts:' + timestamp + ';'
  const expectedHash = createHmac('sha256', secret).update(manifest).digest('hex')

  const received = Buffer.from(receivedHash, 'utf8')
  const expected = Buffer.from(expectedHash, 'utf8')
  return received.length === expected.length && received.length > 0 && received.equals(expected)
}
