// Customer self-service: password reset links, the session password mark and
// account anonymization helpers. No database table is needed.
//
// A reset token is "<id>.<expires>.<signature>". The signature covers the
// customer's current password hash and e-mail, so the link works only once:
// after the password changes, the signature no longer matches.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const RESET_TTL_MS = 60 * 60 * 1000
const TOKEN_PATTERN = /^(\d{1,12})\.(\d{10})\.([A-Za-z0-9_-]{43})$/

function hmac(secret, value) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('SESSION_SECRET inválido para links de senha.')
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function sameText(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

function signature(secret, id, expires, passwordHash, email) {
  return hmac(secret, ['customer-password-reset', id, expires, passwordHash, String(email || '').toLowerCase()].join('|'))
}

export function createResetToken({ customerId, passwordHash, email, secret, now = Date.now(), ttlMs = RESET_TTL_MS }) {
  const id = Number(customerId)
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Cliente inválido para o link de senha.')
  const expires = Math.floor((now + ttlMs) / 1000)
  return id + '.' + expires + '.' + signature(secret, id, expires, passwordHash, email)
}

// Requests for the same account in the same 10-minute window build the same
// link, so the e-mail provider's idempotency key sends only one e-mail per
// window. The link then stays valid for 60 to 70 minutes.
export const RESET_RESEND_MS = 10 * 60 * 1000
export function resetWindow(now = Date.now()) {
  return { now: Math.floor(now / RESET_RESEND_MS) * RESET_RESEND_MS, ttlMs: RESET_TTL_MS + RESET_RESEND_MS }
}

export function parseResetToken(token) {
  const match = TOKEN_PATTERN.exec(String(token || ''))
  return match ? { customerId: Number(match[1]), expires: Number(match[2]), signature: match[3] } : null
}

export function verifyResetToken(token, { passwordHash, email, secret, now = Date.now() }) {
  const parsed = parseResetToken(token)
  if (!parsed || parsed.expires * 1000 < now || !passwordHash) return false
  return sameText(parsed.signature, signature(secret, parsed.customerId, parsed.expires, passwordHash, email))
}

// Stored in the session at login. When the password changes, the mark changes
// and every other session of that customer is signed out on its next request.
export function passwordMark(passwordHash, secret) {
  return hmac(secret, 'customer-session|' + String(passwordHash || '')).slice(0, 32)
}

export function resetLink(appUrl, token) {
  const url = new URL('/conta', appUrl)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && url.protocol === 'http:')) {
    throw new Error('APP_URL precisa ser HTTPS para enviar o link de senha.')
  }
  // A fragment never reaches servers or normal access logs.
  url.hash = 'redefinir=' + token
  return url.toString()
}

export function removedCustomerEmail(customerId) {
  return 'removido-' + Number(customerId) + '@excluido.invalid'
}
