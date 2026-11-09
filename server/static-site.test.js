import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { paymentShell, siteHeaders } from './static-site.js'

const config = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8')

test('fora do Netlify valem os mesmos cabeçalhos do netlify.toml', () => {
  const production = siteHeaders(config, { MERCADO_PAGO_MODE: 'production', DB_NAME: 'galeo_store' })
  assert.match(production.all['Content-Security-Policy'], /script-src 'self' https:\/\/sdk\.mercadopago\.com/)
  assert.equal(production.all['X-Frame-Options'], 'DENY')
  assert.equal(production.all['X-Robots-Tag'], undefined)
  assert.equal(production.assets['Cache-Control'], 'public, max-age=31536000, immutable')
  // Homologation never shows up in search engines.
  for (const env of [{ MERCADO_PAGO_MODE: 'test', DB_NAME: 'galeo_store' }, { DB_NAME: 'galeo_render_test' }]) {
    assert.equal(siteHeaders(config, env).all['X-Robots-Tag'], 'noindex, nofollow, noarchive')
  }
})

test('a página de pagamento recebe um nonce novo em cada resposta', () => {
  const html = '<!doctype html><head><script type="module" crossorigin src="/assets/index.js"></script></head>'
  const policy = "default-src 'self'; script-src 'self' https://sdk.mercadopago.com; object-src 'none'"
  const first = paymentShell(html, policy, 'abc123'), second = paymentShell(html, policy)
  assert.equal(first.html, '<!doctype html><head><script nonce="abc123" type="module" crossorigin src="/assets/index.js"></script></head>')
  assert.equal(first.policy, "default-src 'self'; script-src 'self' https://sdk.mercadopago.com 'nonce-abc123'; object-src 'none'")
  assert.notEqual(second.policy, first.policy)
  assert.equal(paymentShell(html, '', 'x').policy, '')
})
