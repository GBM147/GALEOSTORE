import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addScriptNonce, injectScriptNonce, isPaymentShellPath, paymentShellResponse } from './payment-shell.mjs'

const policy = "default-src 'self'; script-src 'self' https://sdk.mercadopago.com; object-src 'none'"
const html = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>'
const staticShell = (headers = {}, body = html, status = 200) => async () => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy, 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Set-Cookie': 'leak=1', ETag: '"static"', ...headers }
})

test('somente a rota de pagamento recebe o shell com nonce', () => {
  assert.equal(isPaymentShellPath('/pagamento/42'), true)
  assert.equal(isPaymentShellPath('/pagamento/42/'), true)
  for (const path of ['/pagamento', '/pagamento/', '/pagamento/42/extra', '/api/store/orders/42/payment', '/conta', '/']) assert.equal(isPaymentShellPath(path), false)
})

test('nonce entra somente em script-src e preserva as demais diretivas', () => {
  assert.equal(addScriptNonce(policy, 'N0nceValue1234567890'), "default-src 'self'; script-src 'self' https://sdk.mercadopago.com 'nonce-N0nceValue1234567890'; object-src 'none'")
  assert.equal(addScriptNonce("default-src 'self' https://cdn.test; img-src 'self'", 'abc'), "default-src 'self' https://cdn.test; img-src 'self'; script-src 'self' https://cdn.test 'nonce-abc'")
})

test('scripts do build recebem o nonce sem duplicar atributos existentes', () => {
  assert.equal(injectScriptNonce('<script src="/a.js"></script><SCRIPT>1</SCRIPT><script nonce="x" src="/b.js"></script>', 'n'), '<script nonce="n" src="/a.js"></script><script nonce="n">1</SCRIPT><script nonce="x" src="/b.js"></script>')
})

test('shell copia o index estático com CSP do nonce e sem cache', async () => {
  const requested = []
  const fetchShell = async (url, options) => { requested.push([String(url), options.redirect]); return staticShell()() }
  const response = await paymentShellResponse(new Request('https://galeo.test/pagamento/42?retorno=1'), { fetchShell, nonce: 'TestNonce1234567890ab' })
  assert.deepEqual(requested, [['https://galeo.test/', 'manual']])
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('etag'), null)
  assert.match(response.headers.get('content-security-policy'), /script-src 'self' https:\/\/sdk\.mercadopago\.com 'nonce-TestNonce1234567890ab'/)
  assert.match(await response.text(), /<script nonce="TestNonce1234567890ab" type="module" crossorigin src="\/assets\/index-abc\.js">/)
})

test('cada carregamento usa um nonce diferente', async () => {
  const first = await paymentShellResponse(new Request('https://galeo.test/pagamento/1'), { fetchShell: staticShell() })
  const second = await paymentShellResponse(new Request('https://galeo.test/pagamento/1'), { fetchShell: staticShell() })
  const nonce = response => response.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1]
  const [a, b] = [nonce(first), nonce(second)]
  assert.notEqual(a, b)
  assert.match(a, /^[A-Za-z0-9+/]{24}$/)
})

test('falha, redirecionamento ou conteúdo inesperado não expõem uma página sem proteção', async () => {
  for (const fetchShell of [async () => { throw new Error('offline') }, staticShell({}, '', 301), staticShell({ 'Content-Type': 'application/json' }, '{}')]) {
    const response = await paymentShellResponse(new Request('https://galeo.test/pagamento/9'), { fetchShell })
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const post = await paymentShellResponse(new Request('https://galeo.test/pagamento/9', { method: 'POST' }), { fetchShell: staticShell() })
  assert.equal(post.status, 405)
  const head = await paymentShellResponse(new Request('https://galeo.test/pagamento/9', { method: 'HEAD' }), { fetchShell: staticShell(), nonce: 'HeadNonce1234567890abc' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.match(head.headers.get('content-security-policy'), /'nonce-HeadNonce1234567890abc'/)
})
