import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const origin = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const address = new URL(origin)
if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('Inventory editing browser tests refuse production.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

async function fixture(t, withSizes) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  let product = { id: 141, name: 'Peça local aberta para edição', brand: 'Marca local', category_id: 1, category: 'Camisetas', description: 'Descrição original', price: 50, cost: 20, stock: 5, min_stock: 0, image: '', video: '', active: 1, inventory_token: 'local-inventory-1', has_variants: withSizes, variants: withSizes ? [{ id: 241, product_id: 141, size: 'M', stock: 5, active: true, sort_order: 0 }] : [] }
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, email: 'owner@example.test', role: 'owner' }, csrfToken: 'local-test-csrf' })
    if (path === '/api/store/categories') return json([{ id: 1, name: 'Camisetas' }])
    if (path === '/api/admin/products') return json([product])
    if (path === '/api/admin/products/141/media') return json([])
    if (path === '/api/admin/products/141' && method === 'PUT') {
      if (body.inventory_token && body.inventory_token !== product.inventory_token) return json({ error: 'O estoque mudou enquanto o produto estava aberto. Atualize as quantidades.', code: 'INVENTORY_CHANGED' }, 409)
      product = { ...product, ...body,
        variants: body.variants === undefined ? product.variants : body.variants,
        stock: body.stock === undefined ? product.stock : body.stock,
        inventory_token: 'local-inventory-3' }
      return json(product)
    }
    assert.fail('Unexpected local inventory API: ' + method + ' ' + path)
  })
  t.after(() => assert.deepEqual(errors, []))
  await page.goto(origin + '/admin?tab=products')
  await page.getByRole('row').filter({ hasText: product.name }).getByRole('button', { name: 'Editar', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Editar produto', exact: true })
  await modal.waitFor()
  return { page, modal, calls, current: () => product, reserve() {
    product = { ...product, stock: 3, inventory_token: 'local-inventory-2', variants: product.variants.map(row => ({ ...row, stock: 3 })) }
  } }
}

for (const withSizes of [false, true]) {
  const label = withSizes ? 'grade por tamanho' : 'estoque sem grade'
  test('salvar descrição com ' + label + ' não repõe estoque vendido durante a edição', async t => {
    const { modal, calls, reserve, current } = await fixture(t, withSizes)
    await modal.getByRole('textbox', { name: /^Descrição/ }).fill('Texto novo sem alterar estoque')
    reserve()
    await modal.getByRole('button', { name: 'Salvar produto', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    const saved = calls.find(call => call.method === 'PUT')
    assert.equal(Object.hasOwn(saved.body, 'stock'), false)
    assert.equal(Object.hasOwn(saved.body, 'variants'), false)
    assert.equal(Object.hasOwn(saved.body, 'inventory_token'), false)
    assert.equal(current().stock, 3)
    assert.equal(current().description, 'Texto novo sem alterar estoque')
  })

  test('conflito em ' + label + ' atualiza quantidades sem perder outros campos editados', async t => {
    const { modal, calls, reserve, current } = await fixture(t, withSizes)
    await modal.getByRole('textbox', { name: /^Descrição/ }).fill('Minha descrição deve permanecer')
    const quantity = () => withSizes ? modal.getByRole('spinbutton', { name: 'Quantidade do tamanho 1', exact: true }) : modal.getByLabel('Estoque inicial / atual', { exact: true })
    await quantity().fill('6')
    reserve()
    await modal.getByRole('button', { name: 'Salvar produto', exact: true }).click()
    await modal.getByRole('button', { name: 'Atualizar quantidades', exact: true }).waitFor()
    assert.equal(calls.find(call => call.method === 'PUT').body.inventory_token, 'local-inventory-1')
    assert.equal(current().stock, 3)
    assert.equal(current().description, 'Descrição original')
    await modal.getByRole('button', { name: 'Atualizar quantidades', exact: true }).click()
    await quantity().waitFor()
    await modal.getByText(/Quantidades atualizadas/).waitFor()
    assert.equal(await quantity().inputValue(), '3')
    assert.equal(await modal.getByRole('textbox', { name: /^Descrição/ }).inputValue(), 'Minha descrição deve permanecer')
    await quantity().fill('4')
    await modal.getByRole('button', { name: 'Salvar produto', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    const saved = calls.filter(call => call.method === 'PUT').at(-1)
    assert.equal(saved.body.inventory_token, 'local-inventory-2')
    assert.equal(current().stock, 4)
    assert.equal(current().description, 'Minha descrição deve permanecer')
  })
}
