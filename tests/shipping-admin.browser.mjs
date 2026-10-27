import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const origin = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
if (new URL(origin).protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Os testes de entregas administrativas recusam produção.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

async function fixture(t, { viewport = { width: 1366, height: 900 }, status = {}, product = {}, role = 'owner', authorizationUrl = 'https://melhorenvio.com.br/oauth/authorize?state=local-state', failStatus = false, details = {} } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  t.after(() => context.close())
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  const savedProduct = { id: 123, name: 'Peça local', brand: 'Marca local', category_id: 1, price: 80, cost: 20, stock: 4, min_stock: 0, active: 1, description: '', image: '', video: '', variants: [], ...product }
  const order = { id: 71, code: 'LOCAL-ORDER', status: 'RECEIVED', customer_name: 'Cliente local', customer_email: 'buyer@example.invalid', total: 94.8, subtotal: 80, shipping_fee: 14.8, postal_code: '01001000', street: 'Rua local', number: '1', city: 'São Paulo', state: 'SP', neighborhood: 'Centro', items: [], shipping_details: details }
  const shippingStatus = { configured: true, connected: false, available: false, origin_postal_code: '08285130', environment: 'production', ...status }
  await page.route('https://melhorenvio.com.br/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Autorização simulada local</h1>' }))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body, headers: request.headers() })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, email: 'owner@example.invalid', role }, csrfToken: 'local-shipping-csrf' })
    if (path === '/api/admin/shipping') {
      if (failStatus) { failStatus = false; return json({ error: 'Falha temporária de conexão.' }, 503) }
      return json(shippingStatus)
    }
    if (path === '/api/admin/shipping/connect') return json({ authorization_url: authorizationUrl })
    if (path === '/api/admin/products') return json([savedProduct])
    if (path === '/api/admin/products/123' && method === 'PUT') { Object.assign(savedProduct, body); return json(savedProduct) }
    if (path === '/api/admin/products/123/media') return json([])
    if (path === '/api/admin/store-orders') return json([order])
    if (path === '/api/admin/store-orders/71') return json(order)
    if (path === '/api/store/categories') return json([{ id: 1, name: 'Camisetas' }])
    if (path === '/api/store') return json({ products: [savedProduct], categories: [] })
    if (path === '/api/store/home' || path === '/api/admin/home') return json({ sections: [] })
    if (path === '/api/store/home/settings') return json({ settings: [] })
    if (path === '/api/admin/dashboard') return json({ products: { count: 1, active_count: 1, stock: 4, low_stock: 0 }, sales: { count: 0, total: 0 }, income: 0, expense: 0 })
    return json([])
  })
  t.after(() => assert.deepEqual(errors, [], 'não deve haver erros de React nos fluxos de entrega'))
  return { page, calls }
}

test('owner connects through CSRF-protected action and the exact provider HTTPS domain', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin?tab=shipping')
  await page.getByText('08285-130', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Entregas', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Conectar Melhor Envio ↗', exact: true }).click()
  await page.waitForURL('https://melhorenvio.com.br/oauth/authorize?state=local-state')
  const request = calls.find(call => call.path === '/api/admin/shipping/connect')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers['x-csrf-token'], 'local-shipping-csrf')
})

test('unconfigured connection explains the pending credentials and does not offer authorization', async t => {
  const { page } = await fixture(t, { status: { configured: false, connected: false } })
  await page.goto(origin + '/admin?tab=shipping')
  await page.getByText('As credenciais do Melhor Envio precisam ser configuradas na hospedagem para conectar a conta.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Conectar Melhor Envio ↗', exact: true }).count(), 0)
})

test('callback success requires confirmed connected status and the mobile settings remain in bounds', async t => {
  const { page } = await fixture(t, { viewport: { width: 390, height: 844 }, status: { connected: true, available: true } })
  await page.goto(origin + '/admin?tab=shipping&shipping=connected')
  await page.getByText('Conta conectada com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Reconectar Melhor Envio', exact: true }).count(), 1)
  const bounds = await page.locator('.admin-shipping-settings').boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390)
})

test('untrusted redirect is rejected before external navigation', async t => {
  const { page } = await fixture(t, { authorizationUrl: 'https://melhorenvio.com.br.evil.invalid/oauth/authorize' })
  await page.goto(origin + '/admin?tab=shipping')
  await page.getByRole('button', { name: 'Conectar Melhor Envio ↗', exact: true }).click()
  await page.getByText('O servidor não confirmou um endereço seguro para conectar o Melhor Envio.').waitFor()
  assert.equal(new URL(page.url()).origin, origin)
})

test('failed status can be retried without reloading the page', async t => {
  const { page, calls } = await fixture(t, { failStatus: true })
  await page.goto(origin + '/admin?tab=shipping')
  await page.getByText('Falha temporária de conexão.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Verificar novamente', exact: true }).click()
  await page.getByText('08285-130', { exact: true }).waitFor()
  assert.equal(calls.filter(call => call.path === '/api/admin/shipping').length, 2)
})

test('editing only product packaging saves real numeric dimensions without replaying stock', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin?tab=products')
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByText('Dados para entrega', { exact: true }).click()
  await page.getByLabel('Peso embalado (kg)', { exact: true }).fill('0.350')
  await page.getByLabel('Largura da embalagem (cm)', { exact: true }).fill('20')
  await page.getByLabel('Altura da embalagem (cm)', { exact: true }).fill('5')
  await page.getByLabel('Comprimento da embalagem (cm)', { exact: true }).fill('30')
  await page.getByRole('button', { name: 'Salvar produto', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  const saved = calls.find(call => call.path === '/api/admin/products/123' && call.method === 'PUT').body
  assert.deepEqual([saved.shipping_weight, saved.shipping_width, saved.shipping_height, saved.shipping_length], [0.35, 20, 5, 30])
  assert.equal(Object.hasOwn(saved, 'stock'), false)
  assert.equal(Object.hasOwn(saved, 'variants'), false)
})

test('incomplete packaging cannot be saved and an existing product can keep all fields empty', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin?tab=products')
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByText('Dados para entrega', { exact: true }).click()
  await page.getByLabel('Peso embalado (kg)', { exact: true }).fill('0.350')
  await page.getByRole('button', { name: 'Salvar produto', exact: true }).click()
  await page.getByText('Preencha o peso e as três medidas para entrega, ou deixe todos esses campos vazios.', { exact: true }).waitFor()
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0)
  await page.getByLabel('Peso embalado (kg)', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Salvar produto', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  const saved = calls.find(call => call.method === 'PUT').body
  assert.deepEqual([saved.shipping_weight, saved.shipping_width, saved.shipping_height, saved.shipping_length], [null, null, null, null])
})

test('site orders display the saved freight service and price', async t => {
  const { page } = await fixture(t, { details: JSON.stringify({ company: 'Correios', name: 'PAC', delivery_days: 5 }) })
  await page.goto(origin + '/admin?tab=online-orders')
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await page.getByRole('heading', { name: 'Frete escolhido', exact: true }).waitFor()
  const summary = page.locator('.online-order-address').filter({ hasText: 'Frete escolhido' })
  assert.match(await summary.innerText(), /Correios · PAC/)
  assert.match(await summary.innerText(), /14,80/)
  assert.match(await summary.innerText(), /5 dias úteis/)
})

test('a non-owner cannot open delivery settings from its direct URL', async t => {
  const { page, calls } = await fixture(t, { role: 'staff' })
  await page.goto(origin + '/admin?tab=shipping')
  await page.getByRole('heading', { name: 'Painel administrativo.', exact: true }).waitFor()
  assert.equal(calls.filter(call => call.path === '/api/admin/shipping').length, 0)
  assert.equal(await page.getByRole('button', { name: 'Entregas', exact: true }).count(), 0)
})
