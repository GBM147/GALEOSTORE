import { randomBytes } from 'node:crypto'

// Only the SPA payment route needs a per-request nonce: the Mercado Pago SDK
// injects its device-profile collector as an inline script and accepts the
// nonce through `deviceProfileCspNonce`. Every other page stays static.
const paymentPath = /^\/pagamento\/[^/]+\/?$/
// Netlify applies _headers to static files only, so copy them from the shell.
const forwardedHeaders = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'strict-transport-security', 'x-robots-tag']

export const isPaymentShellPath = pathname => paymentPath.test(pathname)

export function createNonce() {
  return randomBytes(18).toString('base64')
}

export function addScriptNonce(policy, nonce) {
  const token = `'nonce-${nonce}'`
  const directives = String(policy).split(';').map(directive => directive.trim()).filter(Boolean)
  const index = directives.findIndex(directive => /^script-src(\s|$)/i.test(directive))
  if (index >= 0) directives[index] += ' ' + token
  else {
    // Without script-src the browser falls back to default-src; keep its sources.
    const fallback = directives.find(directive => /^default-src(\s|$)/i.test(directive))
    directives.push((fallback ? fallback.replace(/^default-src/i, 'script-src') : "script-src 'self'") + ' ' + token)
  }
  return directives.join('; ')
}

export function injectScriptNonce(html, nonce) {
  return String(html).replace(/<script\b(?![^>]*\snonce=)/gi, `<script nonce="${nonce}"`)
}

export function unavailable() {
  return new Response('<!doctype html><meta charset="utf-8"><title>Galeo Store</title><p>A página de pagamento está temporariamente indisponível. Atualize em instantes.</p>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '5' }
  })
}

// The built index.html with the security headers Netlify applied to it.
// Returns null when the static shell cannot be read safely.
export async function fetchStaticShell(request, fetchShell = fetch) {
  let shell
  try {
    shell = await fetchShell(new URL('/', request.url), { headers: { Accept: 'text/html' }, redirect: 'manual' })
  } catch {
    return null
  }
  if (!shell.ok || !String(shell.headers.get('content-type') || '').includes('text/html')) return null
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  for (const name of forwardedHeaders) {
    const value = shell.headers.get(name)
    if (value) headers.set(name, value)
  }
  return { html: await shell.text(), policy: shell.headers.get('content-security-policy'), headers }
}

export async function paymentShellResponse(request, { fetchShell = fetch, nonce = createNonce() } = {}) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } })
  }
  const shell = await fetchStaticShell(request, fetchShell)
  if (!shell) return unavailable()
  const { html, policy, headers } = shell
  if (!policy) return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers })
  headers.set('Content-Security-Policy', addScriptNonce(policy, nonce))
  return new Response(request.method === 'HEAD' ? null : injectScriptNonce(html, nonce), { status: 200, headers })
}
