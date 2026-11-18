// Imported only by the isolated local test API. Serves "Google's" public keys
// from a local file, so tests can sign ID tokens with their own key. Never
// contacts Google.
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const keysPath = process.env.GALEO_TEST_GOOGLE_JWKS
const loopback = new Set(['localhost', '127.0.0.1', '::1'])
if (!loopback.has(process.env.DB_HOST) || process.env.DB_NAME !== 'galeo_store_test' || !keysPath || !isAbsolute(keysPath)) {
  throw new Error('Google fixtures require the isolated loopback test database and a local key file.')
}

const previousFetch = globalThis.fetch
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname !== 'www.googleapis.com') return previousFetch(input, options)
  if (url.pathname !== '/oauth2/v3/certs' || !existsSync(keysPath)) return new Response('{}', { status: 503 })
  return new Response(readFileSync(keysPath, 'utf8'), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } })
}
