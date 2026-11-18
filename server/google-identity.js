// Verifies the ID token that "Sign in with Google" (Google Identity Services)
// hands to the account page. Only Google's public keys and the store's public
// Client ID are needed; there is no client secret.
// https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
import { createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto'

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const SEGMENT = /^[A-Za-z0-9_-]+$/
const EXPIRY_SKEW_S = 60
const ISSUED_SKEW_S = 300
// An unknown key id may be a freshly rotated key; refetch at most this often.
const REFRESH_INTERVAL_MS = 60 * 1000

export class GoogleIdentityError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const invalid = () => new GoogleIdentityError('GOOGLE_TOKEN_INVALID', 'O login com o Google não pôde ser confirmado.')

export function googleClientId(env = process.env) {
  const value = String(env.GOOGLE_CLIENT_ID || '').trim()
  return /^[A-Za-z0-9._-]{1,200}\.apps\.googleusercontent\.com$/.test(value) ? value : ''
}

function decodeSegment(segment) {
  const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value
}

function sameText(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createGoogleIdentity({ clientId = '', fetchImpl = (...args) => fetch(...args), now = () => Date.now(), certsUrl = GOOGLE_CERTS_URL } = {}) {
  let keys = new Map()
  let expiresAt = 0
  let fetchedAt = 0
  let loading = null

  async function loadKeys() {
    fetchedAt = now()
    let response
    try { response = await fetchImpl(certsUrl, { headers: { Accept: 'application/json' } }) } catch { response = null }
    if (!response?.ok) throw new GoogleIdentityError('GOOGLE_KEYS_UNAVAILABLE', 'O Google não respondeu. Tente de novo em instantes.')
    const body = await response.json().catch(() => null)
    const next = new Map()
    for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
      if (jwk?.kty !== 'RSA' || typeof jwk.kid !== 'string' || (jwk.alg && jwk.alg !== 'RS256') || (jwk.use && jwk.use !== 'sig')) continue
      try { next.set(jwk.kid, createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })) } catch {}
    }
    if (!next.size) throw new GoogleIdentityError('GOOGLE_KEYS_UNAVAILABLE', 'O Google não respondeu. Tente de novo em instantes.')
    const maxAge = Number(/max-age=(\d+)/i.exec(response.headers?.get?.('cache-control') || '')?.[1])
    keys = next
    expiresAt = now() + (Number.isFinite(maxAge) && maxAge > 0 ? Math.min(maxAge, 86400) : 3600) * 1000
  }

  async function keyFor(kid) {
    const stale = now() >= expiresAt
    if (stale || (!keys.has(kid) && now() - fetchedAt >= REFRESH_INTERVAL_MS)) {
      loading ??= loadKeys().finally(() => { loading = null })
      await loading
    }
    return keys.get(kid)
  }

  // `nonce` may be a list: overlapping page loads can each have asked for one.
  async function verify(credential, { nonce } = {}) {
    if (!clientId) throw new GoogleIdentityError('GOOGLE_NOT_CONFIGURED', 'O login com o Google não está configurado.')
    const token = typeof credential === 'string' ? credential : ''
    const parts = token.split('.')
    if (token.length > 4096 || parts.length !== 3 || !parts.every(part => SEGMENT.test(part))) throw invalid()
    let header, payload
    try { header = decodeSegment(parts[0]); payload = decodeSegment(parts[1]) } catch { throw invalid() }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid()
    const key = await keyFor(header.kid)
    if (!key || !verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) throw invalid()

    const seconds = Math.floor(now() / 1000)
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!ISSUERS.has(payload.iss) || !audience.includes(clientId) || (payload.azp !== undefined && payload.azp !== clientId)) throw invalid()
    if (!Number.isFinite(payload.exp) || payload.exp + EXPIRY_SKEW_S < seconds) throw invalid()
    if (Number.isFinite(payload.iat) && payload.iat - ISSUED_SKEW_S > seconds) throw invalid()
    // The nonce is issued per page visit and kept in the session: a token
    // captured elsewhere cannot be replayed into another browser.
    const expected = (Array.isArray(nonce) ? nonce : [nonce]).filter(value => typeof value === 'string' && value)
    if (!expected.length || typeof payload.nonce !== 'string' || !expected.some(value => sameText(payload.nonce, value))) throw invalid()
    if (payload.email_verified !== true && payload.email_verified !== 'true') {
      throw new GoogleIdentityError('GOOGLE_EMAIL_UNVERIFIED', 'Este e-mail ainda não foi confirmado pelo Google. Use e-mail e senha para criar a conta.')
    }
    const email = String(payload.email || '').trim().toLowerCase()
    if (typeof payload.sub !== 'string' || !payload.sub || !/^\S+@\S+\.\S+$/.test(email) || email.length > 255) throw invalid()
    const name = String(payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' '))
      .replace(/\s+/g, ' ').trim().slice(0, 180)
    return { subject: payload.sub, email, name }
  }

  return Object.freeze({ clientId, verify })
}
