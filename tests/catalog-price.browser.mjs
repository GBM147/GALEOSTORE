import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

// Exercise the real React screens against local HTTP fixtures. No products,
// customers or orders are created in a database or in production.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes de preço pendente exigem servidor HTTP loopback; produção é recusada.')
}

const pending = {
  id: 731, name: 'Regata com preço pendente', brand: 'Marca local', category: 'Camisetas', category_id: 301,
  description: 'Peça publicada apenas como vitrine.', price: '0.00', stock: 5,
  image: '/images/catalog-price-fixture.svg', video: '', media: []
}
const ready = { ...pending, id: 732, name: 'Camiseta com preço definido', price: 129.9, stock: 4 }
let browser

before(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { cart = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  await context.addInitScript(cart => {
    if (localStorage.getItem('galeo-cart-v2') === null) localStorage.setItem('galeo-cart-v2', JSON.stringify(cart))
  }, cart)
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const calls = [], unexpectedApi = [], pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    calls.push({ path, method: request.method() })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (request.method() !== 'GET') {
      unexpectedApi.push(request.method() + ' ' + path)
      return json({ error: 'O teste de vitrine não permite gravar pedidos.' }, 400)
    }
    if (path === '/api/store') return json({ products: [pending, ready], categories: [{ id: 301, name: 'Camisetas', sort_order: 10 }] })
    if (path === '/api/store/home') return json({ sections: [{
      key: 'featured_products', order: 40, visible: true,
      content: { title: 'Peças em destaque', source: 'manual', product_ids: [pending.id, ready.id] }
    }] })
    if (path === '/api/store/home/settings') return json({ settings: [] })
    if (path === '/api/store/products/' + pending.id) return json({ product: pending, related: [ready] })
    if (path === '/api/store/products/' + ready.id) return json({ product: ready, related: [pending] })
    if (path === '/api/store/shipping/config') return json({ configured:false, connected:false, available:false })
    if (path === '/api/customer/me') return json({ authenticated: true, user: { id: 71, name: 'Cliente local', phone: '11999999999', email: 'cliente@example.test' }, csrfToken: 'local-test-csrf' })
    if (path === '/api/auth/me') return json({ authenticated: false }, 401)
    unexpectedApi.push(request.method() + ' ' + path)
    return json({ error: 'API não prevista no teste de vitrine.' }, 404)
  })
  await page.route('**/images/catalog-price-fixture.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><rect width="800" height="900" fill="#c9b18a"/></svg>'
  }))
  if (typeof page.routeWebSocket === 'function') {
    await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send('{"type":"keepalive_ack"}')))
  }
  t.after(() => {
    assert.deepEqual(pageErrors, [], 'a vitrine deve funcionar sem erros JavaScript')
    assert.deepEqual(unexpectedApi, [], 'os testes devem usar somente as APIs locais previstas')
    assert.ok(calls.every(call => call.method === 'GET'), 'visualizar ou adicionar localmente não deve registrar pedidos')
  })
  return { page, calls }
}

const card = (page, name) => page.locator('.product-card').filter({ hasText: name })

test('Home, catálogo e relacionados identificam preço pendente sem anunciar valor zero', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/')
  await card(page, pending.name).getByText('Preço a definir', { exact: true }).waitFor()
  assert.match(await card(page, ready.name).locator('b').innerText(), /129,90/)
  assert.doesNotMatch(await card(page, pending.name).innerText(), /R\$\s*0,00/)

  await page.goto(baseUrl + '/shop')
  await card(page, pending.name).getByText('Preço a definir', { exact: true }).waitFor()
  assert.match(await card(page, ready.name).locator('b').innerText(), /129,90/)

  await page.goto(baseUrl + '/produto/' + ready.id)
  await page.getByRole('heading', { name: ready.name, exact: true }).waitFor()
  await card(page, pending.name).getByText('Preço a definir', { exact: true }).waitFor()
})

test('produto sem preço fica indisponível para compra mesmo que tenha estoque', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/produto/' + pending.id)
  await page.getByRole('heading', { name: pending.name, exact: true }).waitFor()
  assert.equal(await page.locator('.product-detail-price').innerText(), 'Preço a definir')
  const add = page.getByRole('button', { name: /Adicionar ao carrinho/ })
  assert.equal(await add.isDisabled(), true)
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('galeo-cart-v2'))), [])
})

test('produto com preço e saldo mantém a adição ao carrinho', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/produto/' + ready.id)
  await page.getByRole('heading', { name: ready.name, exact: true }).waitFor()
  assert.match(await page.locator('.product-detail-price').innerText(), /129,90/)
  const add = page.getByRole('button', { name: /Adicionar ao carrinho/ })
  assert.equal(await add.isEnabled(), true)
  await add.click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('galeo-cart-v2')))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, ready.id)
  assert.equal(saved[0].quantity, 1)
  assert.equal(saved[0].price, ready.price)
})

test('carrinho antigo com preço pendente não oferece checkout nem valor gratuito', async t => {
  const { page, calls } = await fixture(t, { cart: [{ ...pending, quantity: 1 }] })
  await page.goto(baseUrl + '/carrinho')
  await page.getByRole('heading', { name: 'Seu carrinho', exact: true }).waitFor()
  await page.getByText('Preço a definir', { exact: true }).first().waitFor()
  assert.equal(await page.locator('.checkout-form').count(), 0)
  assert.equal(await page.getByRole('button', { name: /Solicitar pedido/ }).count(), 0)
  assert.match(await page.locator('.cart-summary').innerText(), /preço.*(?:defin|pendent)|(?:defin|pendent).*preço/i)
  assert.equal(calls.some(call => call.method === 'POST' && call.path === '/api/store/orders'), false)
})
