import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const origin = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const address = new URL(origin)
if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('Product wizard browser tests refuse production.')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

// A small in-memory Admin API: products, photos with library versions,
// photo order and background removal.
async function fixture(t, { width = 1280, products: initial = [] } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', ...(width <= 700 ? { isMobile: true, hasTouch: true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  const products = structuredClone(initial)
  const media = new Map()
  let nextProduct = 900, nextMedia = 1, token = 1
  const stored = body => ({
    ...body,
    variants: (body.variants || []).filter(row => row.active !== false).map((row, index) => ({ id: row.id || 7000 + index, size: row.size, stock: Number(row.stock), active: 1 })),
    inventory_token: 'local-' + (token++)
  })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, email: 'owner@example.test', role: 'owner' }, csrfToken: 'local-test-csrf' })
    if (path === '/api/store/categories') return json([{ id: 1, name: 'Camisetas' }, { id: 2, name: 'Calçados' }])
    if (path === '/api/admin/products' && method === 'GET') return json(products)
    if (path === '/api/admin/products' && method === 'POST') {
      const product = { id: nextProduct++, category: '', ...stored(body), stock: Number(body.stock || 0) }
      products.push(product)
      media.set(product.id, [])
      return json(product, 201)
    }
    let match = path.match(/^\/api\/admin\/products\/(\d+)$/)
    if (match && method === 'PUT') {
      const index = products.findIndex(item => item.id === Number(match[1]))
      const current = products[index]
      products[index] = { ...current, ...body, ...(body.variants ? { variants: stored(body).variants } : {}), stock: body.stock ?? current.stock, inventory_token: 'local-' + (token++) }
      return json(products[index])
    }
    match = path.match(/^\/api\/admin\/products\/(\d+)\/media$/)
    if (match && method === 'GET') return json(media.get(Number(match[1])) || [])
    if (match && method === 'POST') {
      const productId = Number(match[1]), id = nextMedia++
      const item = { id, product_id: productId, media_type: 'image', url: '/images/product-placeholder.svg?photo=' + id, public_id: 'local-' + id, sort_order: id }
      item.asset = { id: 500 + id, title: 'Foto ' + id, media_type: 'image', original_url: item.url, ai_url: null, galeo_url: null, ai_status: 'none', use_ai: false, presentation: 'original', url: item.url }
      media.set(productId, [...(media.get(productId) || []), item])
      const product = products.find(entry => entry.id === productId)
      if (!product.image) product.image = item.url
      return json({ success: true, media: [item] }, 201)
    }
    match = path.match(/^\/api\/admin\/products\/(\d+)\/media\/order$/)
    if (match && method === 'PUT') {
      const list = media.get(Number(match[1]))
      media.set(Number(match[1]), body.ids.map(id => list.find(item => item.id === id)))
      return json({ success: true, ids: body.ids })
    }
    match = path.match(/^\/api\/admin\/media-library\/(\d+)\/ai-background$/)
    if (match && method === 'POST') {
      for (const list of media.values()) for (const item of list) {
        if (item.asset?.id !== Number(match[1])) continue
        item.asset = { ...item.asset, ai_status: 'done', ai_url: item.url + '&background=none', galeo_url: item.url + '&background=galeo' }
        return json({ success: true, item: item.asset })
      }
    }
    return json({ error: 'API não prevista no teste: ' + method + ' ' + path }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  await page.goto(origin + '/admin?tab=products')
  await page.getByRole('heading', { name: 'Produtos e estoque', exact: true }).waitFor()
  return { page, calls, products, media }
}

const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
const posts = (calls, pattern, method) => calls.filter(call => pattern.test(call.path) && call.method === method)

test('no celular, um produto novo é cadastrado em 4 passos e publicado com fotos e tamanhos', async t => {
  const { page, calls } = await fixture(t, { width: 390 })
  await page.getByRole('button', { name: '+ Novo produto', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Cadastrar produto', exact: true })
  const steps = dialog.getByRole('navigation', { name: 'Etapas do cadastro' })
  assert.equal(await steps.locator('[aria-current="step"]').textContent(), '1O básico')

  await dialog.getByLabel('Nome', { exact: true }).fill('Camiseta local passo a passo')
  await dialog.getByRole('button', { name: 'Camisetas', exact: true }).click()
  await dialog.getByLabel('Preço de venda', { exact: true }).fill('129.90')
  assert.ok(await noSideScroll(page))
  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
  await dialog.getByRole('heading', { name: 'Fotos', exact: true }).waitFor()
  const created = posts(calls, /^\/api\/admin\/products$/, 'POST')
  assert.equal(created.length, 1)
  assert.equal(created[0].body.active, false, 'o primeiro passo guarda um rascunho fora da loja')
  assert.deepEqual([created[0].body.shipping_weight, created[0].body.shipping_width, created[0].body.shipping_height, created[0].body.shipping_length], [0.3, 25, 5, 30])

  await dialog.getByLabel('Escolher fotos do produto').setInputFiles([
    { name: 'frente.png', mimeType: 'image/png', buffer: png },
    { name: 'costas.png', mimeType: 'image/png', buffer: png }
  ])
  const tiles = dialog.getByRole('list', { name: 'Fotos e vídeos do produto' }).locator('li')
  await dialog.getByRole('img', { name: 'Foto 2', exact: true }).waitFor()
  assert.equal(await tiles.count(), 2)
  assert.equal(posts(calls, /\/media$/, 'POST').length, 2, 'cada foto sobe assim que é escolhida')
  assert.equal(await tiles.first().locator('.photo-badge').textContent(), 'Capa')
  const cover = dialog.getByTestId('product-cover-preview').locator('img')
  assert.match(await cover.getAttribute('src'), /photo=1$/)

  await tiles.nth(1).getByRole('button', { name: 'Usar como capa', exact: true }).click()
  assert.match(await cover.getAttribute('src'), /photo=2$/)
  await dialog.getByRole('button', { name: 'Mover foto 2 para trás', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.photo-grid li .photo-badge'))
  assert.deepEqual(posts(calls, /\/media\/order$/, 'PUT').at(-1).body.ids, [2, 1])
  await dialog.getByRole('button', { name: 'Sem fundo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="product-cover-preview"] img')?.getAttribute('src').endsWith('background=none'))
  assert.equal(await dialog.getByRole('button', { name: 'Sem fundo', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.ok(await noSideScroll(page))

  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
  await dialog.getByRole('heading', { name: 'Tamanhos e estoque', exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Sim, tem tamanhos', exact: true }).click()
  for (const size of ['P', 'M']) await dialog.getByRole('group', { name: 'Tamanhos mais comuns' }).getByRole('button', { name: size, exact: true }).click()
  await dialog.getByRole('button', { name: 'Aumentar quantidade do tamanho m', exact: true }).click()
  await dialog.getByRole('button', { name: 'Aumentar quantidade do tamanho m', exact: true }).click()
  assert.equal(await dialog.getByLabel('Quantidade do tamanho M', { exact: true }).inputValue(), '2')
  assert.match(await dialog.locator('.wizard-package-line').textContent(), /Camiseta padrão — 0,3 kg · 25×5×30 cm/)
  assert.ok(await noSideScroll(page))

  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
  await dialog.getByRole('heading', { name: 'Revisar e publicar', exact: true }).waitFor()
  const inventory = posts(calls, /^\/api\/admin\/products\/\d+$/, 'PUT').at(-1).body
  assert.deepEqual(inventory.variants.map(row => [row.size, row.stock]), [['P', 0], ['M', 2]])
  assert.equal(inventory.image_variant, 'ai')
  // Prices use a non-breaking space after R$.
  const checks = (await dialog.getByRole('list', { name: 'Conferência' }).locator('li').allTextContents()).map(text => text.replace(/\s/g, ' '))
  assert.ok(checks.includes('✓Preço: R$ 129,90'), checks.join(' | '))
  assert.ok(checks.includes('✓2 unidades em estoque'), checks.join(' | '))
  assert.equal(await dialog.locator('.wizard-preview .product-meta strong').textContent(), 'Camiseta local passo a passo')

  await dialog.getByRole('button', { name: 'Publicar na loja', exact: true }).click()
  await page.getByRole('heading', { name: 'Produto publicado!', exact: true }).waitFor()
  assert.equal(posts(calls, /^\/api\/admin\/products\/\d+$/, 'PUT').at(-1).body.active, true)
  assert.equal(await page.getByRole('link', { name: 'Ver na loja ↗', exact: true }).getAttribute('href'), '/produto/900')
  await page.getByRole('button', { name: 'Voltar para a lista', exact: true }).click()
  await page.getByRole('article', { name: 'Camiseta local passo a passo' }).getByText('Na loja', { exact: true }).waitFor()
})

test('publicar pede o preço; sem preço o produto pode ficar como rascunho', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('button', { name: '+ Novo produto', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Cadastrar produto', exact: true })
  await dialog.getByLabel('Nome', { exact: true }).fill('Peça local sem preço')
  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
  await dialog.getByRole('heading', { name: 'Fotos', exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
  await dialog.getByRole('heading', { name: 'Tamanhos e estoque', exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
  await dialog.getByRole('button', { name: 'Publicar na loja', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Para publicar, falta o preço de venda.' }).waitFor()
  assert.equal(posts(calls, /^\/api\/admin\/products\/\d+$/, 'PUT').some(call => call.body.active === true), false)
  await dialog.getByRole('button', { name: 'Deixar como rascunho', exact: true }).click()
  await page.getByRole('heading', { name: 'Rascunho salvo', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cadastrar outro', exact: true }).click()
  await page.getByRole('dialog', { name: 'Cadastrar produto', exact: true }).getByLabel('Nome', { exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog').getByLabel('Nome', { exact: true }).inputValue(), '')
})

test('a lista em cartões filtra, busca e abre a edição direto nas fotos', async t => {
  const base = { brand: '', category_id: 1, category: 'Camisetas', description: '', cost: 0, image: '', video: '', variants: [], inventory_token: 'local-0' }
  const { page, calls } = await fixture(t, { products: [
    { ...base, id: 31, name: 'Moletom local na loja', price: 199.9, stock: 4, min_stock: 1, active: 1, image: '/images/product-placeholder.svg?cover=31' },
    { ...base, id: 32, name: 'Boné local rascunho', price: 0, stock: 0, min_stock: 0, active: 0 },
    { ...base, id: 33, name: 'Camiseta local acabando', price: 89.9, stock: 1, min_stock: 2, active: 1, image: '/images/product-placeholder.svg?cover=33' }
  ] })
  const cards = page.locator('.admin-product-card')
  assert.equal(await cards.count(), 3)
  const filters = page.getByRole('group', { name: 'Mostrar produtos' })
  assert.deepEqual(await filters.getByRole('button').allTextContents(), ['Todos (3)', 'Na loja (2)', 'Rascunhos (1)', 'Estoque baixo (2)', 'Sem foto (1)'])
  await filters.getByRole('button', { name: 'Rascunhos (1)', exact: true }).click()
  assert.deepEqual(await cards.locator('strong').allTextContents(), ['Boné local rascunho'])
  await filters.getByRole('button', { name: 'Todos (3)', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Buscar produto' }).fill('moletom')
  assert.deepEqual(await cards.locator('.admin-product-info strong').allTextContents(), ['Moletom local na loja'])
  await page.getByRole('searchbox', { name: 'Buscar produto' }).fill('')

  await page.getByRole('article', { name: 'Moletom local na loja' }).getByRole('button', { name: 'Fotos', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Editar produto', exact: true })
  await dialog.getByRole('heading', { name: 'Fotos', exact: true }).waitFor()
  await dialog.getByRole('button', { name: /Na loja/ }).first().click()
  await dialog.getByRole('button', { name: 'Rascunho', exact: true }).click()
  await dialog.getByRole('button', { name: 'Salvar produto', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  const saved = posts(calls, /^\/api\/admin\/products\/31$/, 'PUT').at(-1).body
  assert.equal(saved.active, false)
  assert.equal(Object.hasOwn(saved, 'stock'), false, 'sem mexer no estoque, a edição não reenvia quantidades')
  await page.getByRole('article', { name: 'Moletom local na loja' }).getByText('Rascunho', { exact: true }).waitFor()

  await page.getByRole('article', { name: 'Boné local rascunho' }).getByRole('button', { name: 'Editar', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Editar produto', exact: true })
  await edit.getByRole('button', { name: /Tamanhos e estoque/ }).click()
  await edit.getByRole('button', { name: /Usar medidas sugeridas/ }).click()
  assert.match(await edit.locator('.wizard-package-line').textContent(), /Camiseta padrão/)
  assert.ok(await noSideScroll(page))
})
