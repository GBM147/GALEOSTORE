import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
if (new URL(baseUrl).protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname)) throw new Error('Os testes de tamanhos recusam produção; use HTTP loopback.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

const shirt = { id: 31, name: 'Camiseta da grade local', brand: 'Marca A', category: 'Camisetas', category_id: 301, price: 80, cost: 20, stock: 5, min_stock: 0, active: 1, image: '/images/size-fixture.svg', video: '', description: 'Produto local com tamanhos.', has_variants: true, sizes: ['P', 'M', 'G'], variants: [{ id: 101, product_id: 31, size: 'P', stock: 0, active: 1 }, { id: 102, product_id: 31, size: 'M', stock: 2, active: 1 }, { id: 103, product_id: 31, size: 'G', stock: 3, active: 1 }] }
const legacy = { ...shirt, id: 32, name: 'Produto local sem grade', brand: 'Marca B', stock: 4, has_variants: false, sizes: [], variants: [] }
const numbered = { ...shirt, id: 33, name: 'Peça local tamanho numérico', brand: 'Marca C', stock: 1, sizes: ['42'], variants: [{ id: 105, product_id: 33, size: '42', stock: 1, active: 1 }] }
const categories = [{ id: 301, name: 'Camisetas', sort_order: 10 }]

async function fixture(t, { cart = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  await context.addInitScript(cart => { if (!localStorage.getItem('galeo-cart-v2')) localStorage.setItem('galeo-cart-v2', JSON.stringify(cart)) }, cart)
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const products = structuredClone([shirt, legacy, numbered]), calls = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.dismiss())
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, email: 'owner@example.test', role: 'owner' }, csrfToken: 'size-local-csrf' })
    if (path === '/api/customer/me') return json({ authenticated: true, user: { id: 7, name: 'Cliente local', phone: '11999999999', email: 'buyer@example.test' }, csrfToken: 'size-local-csrf' })
    if (path === '/api/store' || path === '/api/store/categories') return json(path.endsWith('/categories') ? categories : { products, categories })
    if (path === '/api/store/home') return json({ sections: [] })
    if (path === '/api/store/home/settings') return json({ settings: [] })
    if (path.startsWith('/api/store/products/')) return json({ product: products.find(product => product.id === Number(path.split('/').at(-1))), related: [] })
    if (path === '/api/store/orders' && method === 'POST') return json({ success: true, order: { id: 71, code: 'LOCAL-GRADE' }, payment_configured: false })
    if (path === '/api/admin/products') return json(products)
    if (/^\/api\/admin\/products\/\d+\/media$/.test(path)) return json([])
    if (/^\/api\/admin\/products\/\d+$/.test(path) && method === 'PUT') {
      const index = products.findIndex(product => product.id === Number(path.split('/').at(-1)))
      const variants = body.variants === undefined ? products[index].variants : body.variants.map((variant, variantIndex) => ({ ...variant, id: variant.id || 201 + variantIndex, product_id: products[index].id }))
      products[index] = { ...products[index], ...body, variants, has_variants: variants.length > 0, stock: variants.length ? variants.filter(variant => variant.active !== false).reduce((sum, variant) => sum + variant.stock, 0) : body.stock ?? products[index].stock }
      return json(products[index])
    }
    if (path === '/api/admin/stock' && method === 'POST') return json({ success: true })
    if (path === '/api/admin/sales' && method === 'POST') return json({ id: 81, code: 'VDA-LOCAL-GRADE', status: 'PAGA', total: 160, payment_method: 'PIX' })
    if (path === '/api/admin/sales/81') return json({ id: 81, code: 'VDA-LOCAL-GRADE', status: 'PAGA', total: 160, items: [{ id: 1, product_id: 31, variant_id: 102, product: shirt.name, size_label: 'M', quantity: 1, unit_price: 80, line_total: 80 }, { id: 2, product_id: 31, variant_id: 103, product: shirt.name, size_label: 'G', quantity: 1, unit_price: 80, line_total: 80 }] })
    if (path === '/api/admin/dashboard') return json({ products: { count: 3, stock: 10, low_stock: 0 }, stock: {}, sales: {} })
    if (path.startsWith('/api/admin/')) return json([])
    return json({ error: 'API local não prevista: ' + path }, 404)
  })
  await page.route('**/images/size-fixture.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><rect width="800" height="900" fill="#b69b72"/></svg>' }))
  t.after(() => assert.deepEqual(errors, [], 'não deve haver erros JavaScript no fluxo de tamanhos'))
  return { page, calls }
}

async function chooseSize(page, label) {
  const radio = page.getByRole('radio', { name: 'Tamanho ' + label, exact: true })
  await radio.focus()
  await radio.press('Space')
  assert.equal(await radio.isChecked(), true)
}

test('produto exige tamanho explícito e M e G permanecem separados no carrinho e no pedido', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(baseUrl + '/produto/31')
  await page.getByRole('heading', { name: shirt.name, exact: true }).waitFor()
  assert.equal(await page.getByRole('radio', { checked: true }).count(), 0)
  assert.equal(await page.getByRole('radio', { name: 'Tamanho P', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: /Adicionar ao carrinho/ }).isDisabled(), true)
  await chooseSize(page, 'M')
  await page.getByRole('button', { name: /Adicionar ao carrinho/ }).click()
  await chooseSize(page, 'G')
  await page.getByRole('button', { name: /Adicionar ao carrinho/ }).click()
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('galeo-cart-v2')))
  assert.deepEqual(cart.map(item => [item.id, item.variant_id, item.size_label, item.quantity]), [[31, 102, 'M', 1], [31, 103, 'G', 1]])
  await page.goto(baseUrl + '/carrinho')
  await page.getByText('Tamanho: M', { exact: true }).waitFor()
  await page.getByText('Tamanho: G', { exact: true }).waitFor()
  assert.equal(await page.locator('.cart-item').count(), 2)
  for (const [label, value] of [['CEP', '01001000'], ['Estado', 'SP'], ['Rua', 'Rua local'], ['Número', '1'], ['Bairro', 'Centro'], ['Cidade', 'São Paulo']]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByRole('button', { name: 'Solicitar pedido ↗', exact: true }).click()
  await page.getByRole('heading', { name: 'Pedido recebido', exact: true }).waitFor()
  assert.deepEqual(calls.find(call => call.path === '/api/store/orders' && call.method === 'POST').body.items, [{ product_id: 31, variant_id: 102, quantity: 1 }, { product_id: 31, variant_id: 103, quantity: 1 }])
})

test('carrinho anterior à grade pede nova seleção e não permite registrar pedido sem tamanho', async t => {
  const { page, calls } = await fixture(t, { cart: [{ ...legacy, id: 31, quantity: 1 }] })
  await page.goto(baseUrl + '/carrinho')
  await page.getByRole('alert').filter({ hasText: /Escolha novamente o tamanho/ }).waitFor()
  assert.equal(await page.locator('.checkout-form').count(), 0)
  assert.equal(calls.some(call => call.path === '/api/store/orders' && call.method === 'POST'), false)
})

test('catálogo filtra tamanhos realmente disponíveis e ordena grade antes de produtos sem tamanho', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/shop')
  await page.locator('.product-card').first().waitFor()
  await page.getByRole('combobox', { name: 'Ordenar produtos' }).selectOption('size-asc')
  await page.waitForFunction(() => document.querySelector('.product-card')?.getAttribute('href') === '/produto/31')
  assert.deepEqual(await page.locator('.product-meta strong').allTextContents(), [shirt.name, numbered.name, legacy.name])
  await page.getByRole('combobox', { name: 'Filtrar por tamanho' }).selectOption('42')
  await page.locator('.product-card').filter({ hasText: shirt.name }).waitFor({ state: 'hidden' })
  assert.deepEqual(await page.locator('.product-meta strong').allTextContents(), [numbered.name])
  assert.equal(new URL(page.url()).searchParams.get('size'), '42')
  const options = await page.getByRole('combobox', { name: 'Filtrar por tamanho' }).locator('option').allTextContents()
  assert.equal(options.includes('P'), false, 'P sem saldo não pode ser anunciado como tamanho disponível')
})

test('cadastro legado continua sem grade até o dono informar tamanho e quantidade reais', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(baseUrl + '/admin?tab=products')
  await page.locator('tr').filter({ hasText: legacy.name }).getByRole('button', { name: 'Editar', exact: true }).click()
  const modal = page.getByRole('dialog')
  const enable = modal.getByRole('checkbox', { name: 'Controlar estoque por tamanho' })
  assert.equal(await enable.isChecked(), false)
  await enable.check()
  await modal.getByRole('textbox', { name: 'Tamanho 1', exact: true }).fill('42')
  await modal.getByRole('spinbutton', { name: 'Quantidade do tamanho 1', exact: true }).fill('5')
  await modal.getByRole('button', { name: /Salvar produto|Cadastrar produto/, exact: false }).click()
  await modal.waitFor({ state: 'hidden' })
  const saved = calls.find(call => call.path === '/api/admin/products/32' && call.method === 'PUT')
  assert.deepEqual(saved.body.variants, [{ size: '42', stock: 5, active: true }])
  assert.equal(saved.body.stock, 5)
})

test('movimentação de estoque envia exatamente o tamanho escolhido', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(baseUrl + '/admin?tab=products')
  await page.getByRole('row').filter({ hasText: shirt.name }).getByRole('button', { name: 'Estoque', exact: true }).click()
  await page.getByRole('combobox', { name: 'Produto', exact: true }).fill('grade local')
  await page.getByRole('option').filter({ hasText: shirt.name }).click()
  await page.getByLabel('Tamanho', { exact: true }).selectOption('103')
  await page.getByPlaceholder('Quantidade', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  const saved = calls.find(call => call.path === '/api/admin/stock' && call.method === 'POST')
  assert.equal(saved.body.product_id, 31)
  assert.equal(saved.body.variant_id, 103)
  assert.equal(saved.body.quantity, 2)
})

test('Frente de caixa identifica M e G separadamente e mantém o tamanho no comprovante', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(baseUrl + '/admin?tab=pdv')
  await page.getByRole('heading', { name: 'Frente de caixa', exact: true }).last().waitFor()
  assert.equal(await page.getByRole('button', { name: 'Adicionar ' + shirt.name + ' tamanho P à venda', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Adicionar ' + shirt.name + ' tamanho M à venda', exact: true }).click()
  await page.getByRole('button', { name: 'Adicionar ' + shirt.name + ' tamanho G à venda', exact: true }).click()
  assert.equal(await page.locator('.pdv-cart-items li').count(), 2)
  await page.getByLabel('3. Forma de pagamento').selectOption('PIX')
  await page.getByRole('button', { name: 'Confirmar pagamento e registrar venda', exact: true }).click()
  await page.getByRole('heading', { name: 'Venda VDA-LOCAL-GRADE', exact: true }).waitFor()
  assert.deepEqual(calls.find(call => call.path === '/api/admin/sales' && call.method === 'POST').body.items, [{ product_id: 31, variant_id: 102, quantity: 1 }, { product_id: 31, variant_id: 103, quantity: 1 }])
  await page.locator('.pdv-receipt-items').getByText('Tamanho: M', { exact: true }).waitFor()
  await page.locator('.pdv-receipt-items').getByText('Tamanho: G', { exact: true }).waitFor()
})
