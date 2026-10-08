export const STORE_API_BASE = String(import.meta.env?.VITE_STORE_API_URL || '').trim().replace(/\/+$/, '')
export const CART_STORAGE_KEY = 'galeo-cart-v1'
let customerCsrfToken = ''

export function readCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY)
    const data = raw ? JSON.parse(raw) : []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export function cartCount(items = readCart()) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0)
}

export function writeCart(items) {
  const safe = Array.isArray(items) ? items : []
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(safe))
  window.dispatchEvent(new CustomEvent('galeo-cart-updated', { detail: safe }))
  return safe
}

export function addToCart(product, quantity = 1) {
  const amount = Math.max(1, Number(quantity || 1))
  const current = readCart()
  const existing = current.find((item) => Number(item.id) === Number(product.id))
  const next = existing
    ? current.map((item) => Number(item.id) === Number(product.id) ? { ...item, quantity: Number(item.quantity || 0) + amount } : item)
    : [...current, {
        id: Number(product.id),
        name: String(product.name || 'Produto'),
        brand: String(product.brand || ''),
        category: String(product.category || ''),
        price: Number(product.price || 0),
        image: String(product.image || ''),
        quantity: amount
      }]
  return writeCart(next)
}

export async function customerApi(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  if (options.body && typeof options.body !== 'string') {
    headers.set('Content-Type', 'application/json')
    options = { ...options, body: JSON.stringify(options.body) }
  }
  if (method !== 'GET' && customerCsrfToken) headers.set('X-CSRF-Token', customerCsrfToken)
  if (path === '/api/customer/logout') customerCsrfToken = ''
  const response = await fetch(path, { ...options, headers, credentials: 'include', cache: 'no-store' })
  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}
  if (path === '/api/customer/logout' || (path === '/api/customer/verify-email' && response.ok) || response.status === 401 || data?.authenticated === false || data?.verification_required) {
    customerCsrfToken = ''
  } else if (data?.csrfToken) customerCsrfToken = data.csrfToken
  if (!response.ok) {
    const error = new Error(data?.error || 'Não foi possível concluir a operação.')
    error.status = response.status
    error.code = data?.code
    error.data = data
    error.verification_required = Boolean(data?.verification_required)
    const retryHeader = response.headers.get('Retry-After')
    const retrySeconds = retryHeader && !Number.isNaN(Number(retryHeader))
      ? Number(retryHeader)
      : Math.ceil((Date.parse(retryHeader || '') - Date.now()) / 1000)
    error.retryAfter = Math.max(0, Number(data?.retry_after) || 0, Number.isFinite(retrySeconds) ? retrySeconds : 0)
    throw error
  }
  return data
}
