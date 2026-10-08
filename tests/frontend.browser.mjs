import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

// Use the environment's existing Playwright installation; no application dependency.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
let browser

before(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

const product = { id:31, name:'Camiseta Teste', brand:'GALEO', category:'Camisetas', category_id:301, price:129.9, stock:10, min_stock:1, cost:40, active:1, image:'/images/product-placeholder.svg' }
const utilitySection = { key:'utility', order:20, visible:true, content:{ items:['Compra segura'] } }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64')

async function fixture(t, { homeSections = [utilitySection], settings = [], cart, theme, reducedMotion = 'reduce', handle } = {}) {
  const context = await browser.newContext({ viewport:{ width:1280, height:900 }, reducedMotion })
  t.after(() => context.close())
  await context.addInitScript(({ cart, theme }) => {
    if (cart && localStorage.getItem('galeo-cart-v1') === null) localStorage.setItem('galeo-cart-v1', JSON.stringify(cart))
    if (theme && localStorage.getItem('galeo-theme') === null) localStorage.setItem('galeo-theme', theme)
  }, { cart, theme })
  const page = await context.newPage()
  const calls = []
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('dialog', (dialog) => dialog.dismiss())
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body, headers:request.headers() })
    const custom = await handle?.({ path, method, body, calls })
    const json = async (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (custom) return json(custom.data, custom.status || 200)
    if (path === '/api/store') return json({ products:[product], categories:[{ id:301, name:'Camisetas', sort_order:10 }] })
    if (path === '/api/store/home') return json({ sections:homeSections })
    if (path === '/api/store/home/settings' || path === '/api/admin/home/settings') return json({ settings })
    if (path === '/api/admin/home') return json({ sections:homeSections.map((section) => ({ ...section, draft:section.content })) })
    if (path === '/api/auth/me') return json({ user:{ id:1, email:'admin@example.test', role:'owner' }, csrfToken:'test-csrf' })
    if (path === '/api/customer/me') return json({ authenticated:true, user:{ id:7, name:'Cliente Teste', phone:'11999999999', email:'cliente@example.test' }, csrfToken:'test-csrf' })
    if (path === '/api/customer/orders') return json({ orders:[] })
    if (path === '/api/admin/products') return json([product])
    if (path === '/api/admin/finance/categories') return json([{ id:901, name:'Compra de mercadorias', type:'DESPESA' }])
    if (path === '/api/admin/dashboard') return json({ products:{ count:1, stock:10, low_stock:0 }, stock:{ entradas:0, saidas:0 }, sales:{ count:0, total:0 }, income:0, expense:0, payable:0, receivable:0 })
    if (path === '/api/admin/media-library') return json({ items:[] })
    if (path.startsWith('/api/admin/')) return json([])
    return json({ error:'Unhandled test API: ' + method + ' ' + path }, 404)
  })
  await page.route('**/images/test-*.svg', (route) => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#66513a"/></svg>' }))
  return { page, calls, pageErrors }
}

test('checkout retries payment for the registered order, including after reload', async (t) => {
  let paymentAttempts = 0
  const { page, calls, pageErrors } = await fixture(t, {
    cart:[{ ...product, quantity:1 }],
    handle:({ path, method }) => {
      if (path === '/api/store/orders' && method === 'POST') return { data:{ order:{ id:42, code:'GALEO-TEST' }, payment_configured:true } }
      if (path === '/api/store/orders/42/payment') {
        paymentAttempts++
        return paymentAttempts < 3
          ? { status:400, data:{ error:'Pagamento indisponível no teste' } }
          : { data:{ checkout_url:baseUrl + '/conta' } }
      }
    }
  })
  await page.goto(baseUrl + '/carrinho')
  await page.getByLabel('CEP', { exact:true }).fill('01001000')
  await page.getByLabel('Estado', { exact:true }).fill('SP')
  await page.getByLabel('Rua', { exact:true }).fill('Rua Teste')
  await page.getByLabel('Número', { exact:true }).fill('123')
  await page.getByLabel('Bairro', { exact:true }).fill('Centro')
  await page.getByLabel('Cidade', { exact:true }).fill('São Paulo')
  await page.getByRole('button', { name:'Solicitar pedido ↗', exact:true }).click()
  await page.getByRole('heading', { name:'Pedido recebido', exact:true }).waitFor()
  await page.getByText('Pagamento indisponível no teste', { exact:true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('pedido_pendente'), '42')
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('galeo-cart-v1'))), [])
  await page.getByRole('button', { name:'Continuar para pagamento ↗', exact:true }).click()
  await page.getByText('Pagamento indisponível no teste', { exact:true }).waitFor()
  await page.reload()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('galeo-cart-v1'))), [])
  await page.getByRole('button', { name:'Continuar para pagamento ↗', exact:true }).click()
  await page.waitForURL('**/conta')
  assert.equal(calls.filter((call) => call.path === '/api/store/orders' && call.method === 'POST').length, 1)
  assert.equal(calls.filter((call) => call.path === '/api/store/orders/42/payment').length, 3)
  assert.ok(calls.filter((call) => call.method === 'POST').every((call) => call.headers['x-csrf-token'] === 'test-csrf'))
  assert.deepEqual(pageErrors, [])
})

test('product upload retry updates the saved product and uses product categories', async (t) => {
  let uploads = 0
  const { page, calls, pageErrors } = await fixture(t, {
    handle:({ path, method }) => {
      if (path === '/api/admin/products' && method === 'POST') return { data:{ id:201 } }
      if (path === '/api/admin/products/201' && method === 'PUT') return { data:{ id:201 } }
      if (path === '/api/admin/products/201/media' && method === 'POST') {
        uploads++
        return uploads === 1
          ? { status:400, data:{ error:'Upload indisponível no teste' } }
          : { data:{ media:[{ id:3, product_id:201, media_type:'image', url:product.image }] } }
      }
    }
  })
  await page.goto(baseUrl + '/admin?tab=products')
  await page.getByRole('button', { name:'+ Cadastrar produto', exact:true }).click()
  const modal = page.locator('.admin-modal')
  await modal.getByLabel('Nome', { exact:true }).fill('Novo produto de teste')
  const category = modal.getByLabel('Categoria')
  await category.waitFor()
  assert.deepEqual(await category.locator('option').allTextContents(), ['Sem categoria', 'Camisetas'])
  await category.selectOption('301')
  await modal.getByLabel('Preço de venda', { exact:true }).fill('129.90')
  await modal.locator('input[type="file"]').first().setInputFiles({ name:'teste.png', mimeType:'image/png', buffer:png })
  await modal.getByRole('button', { name:'Salvar produto', exact:true }).click()
  await modal.getByText('Upload indisponível no teste', { exact:true }).first().waitFor()
  await modal.getByRole('heading', { name:'Editar produto', exact:true }).waitFor()
  await modal.getByRole('button', { name:'Salvar produto', exact:true }).click()
  await modal.waitFor({ state:'detached' })
  const creates = calls.filter((call) => call.path === '/api/admin/products' && call.method === 'POST')
  assert.equal(creates.length, 1)
  assert.equal(creates[0].body.category_id, 301)
  assert.equal(calls.filter((call) => call.path === '/api/admin/products/201' && call.method === 'PUT').length, 1)
  assert.equal(uploads, 2)
  assert.deepEqual(pageErrors, [])
})

test('cart navigation removes a pending order when the pending query is cleared', async (t) => {
  const { page, pageErrors } = await fixture(t)
  await page.goto(baseUrl + '/carrinho?pedido_pendente=42&codigo=GALEO-TEST&pagar=1')
  await page.getByRole('heading', { name:'Pedido recebido', exact:true }).waitFor()
  await page.getByRole('link', { name:/^Carrinho/ }).click()
  await page.getByRole('heading', { name:'Seu carrinho está vazio', exact:true }).waitFor()
  assert.equal(new URL(page.url()).search, '')
  assert.equal(await page.getByRole('button', { name:'Continuar para pagamento ↗', exact:true }).count(), 0)
  assert.deepEqual(pageErrors, [])
})

test('CMS visibility, order, categories and responsive media preserve typography', async (t) => {
  const homeSections = [
    { key:'hero', order:30, visible:true, content:{ title:'Vista o que representa você', desktop_media_url:'/images/test-hero-desktop.svg', mobile_media_url:'/images/test-hero-mobile.svg' } },
    { key:'categories', order:10, visible:true, content:{ title:'Categorias publicadas', items:[{ title:'Calças', url:'/shop?category=Cal%C3%A7as', media_url:'/images/test-category.svg' }] } },
    { key:'manifesto', order:5, visible:false, content:{ text:'Manifesto oculto' } },
    { key:'campaigns', order:20, visible:true, content:{ items:[{ title:'Campanha publicada', media_url:'/images/test-campaign-desktop.svg', mobile_media_url:'/images/test-campaign-mobile.svg' }, { title:'Campanha vídeo', media_url:'https://example.test/video/upload/campaign.mp4', mobile_media_url:'/images/test-video-mobile.svg' }] } },
    { ...utilitySection, order:40 }
  ]
  const { page, pageErrors } = await fixture(t, { homeSections })
  await page.goto(baseUrl)
  await page.getByRole('heading', { name:'Categorias publicadas', exact:true }).waitFor()
  assert.deepEqual(await page.locator('main > [data-home-section]').evaluateAll((sections) => sections.map((section) => section.dataset.homeSection)), ['categories','campaigns','hero','utility'])
  assert.equal(await page.locator('.newsletter, .manifesto').count(), 0)
  assert.equal(await page.locator('.category-card').getAttribute('href'), '/shop?category=Cal%C3%A7as')
  await page.locator('.hero-full').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.hero-full picture img')?.currentSrc.endsWith('test-hero-desktop.svg'))
  const typography = await page.locator('.hero-title').evaluate((title) => {
    const normal = getComputedStyle(title)
    const italic = getComputedStyle(title.querySelector('em'))
    return { family:normal.fontFamily, weight:Number(normal.fontWeight), editorialFamily:italic.fontFamily, editorialStyle:italic.fontStyle }
  })
  assert.ok(typography.family.includes('Inter'))
  assert.ok(typography.weight >= 800)
  assert.ok(typography.editorialFamily.includes('Georgia'))
  assert.equal(typography.editorialStyle, 'italic')
  await page.setViewportSize({ width:390, height:844 })
  await page.waitForFunction(() => document.querySelector('.hero-full picture img')?.currentSrc.endsWith('test-hero-mobile.svg'))
  await page.locator('.campaign-card').first().scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.campaign-card picture img')?.currentSrc.endsWith('test-campaign-mobile.svg'))
  assert.equal(await page.locator('.campaign-desktop-video').isVisible(), false)
  assert.equal(await page.locator('.campaign-mobile-image').isVisible(), true)
  assert.deepEqual(pageErrors, [])
})

test('CMS theme applies as default while URL and user choice take precedence', async (t) => {
  const settings = [{ key:'storefront_visual_defaults', value:{ theme:'light' } }]
  const { page } = await fixture(t, { settings })
  await page.goto(baseUrl)
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  assert.equal(await page.evaluate(() => localStorage.getItem('galeo-theme')), null)
  await page.getByRole('button', { name:'Ativar modo escuro', exact:true }).click()
  assert.equal(await page.evaluate(() => localStorage.getItem('galeo-theme')), 'dark')
  await page.reload()
  await page.getByText('Compra segura', { exact:true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await page.goto(baseUrl + '/?theme=light')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
})

test('editor saves categories with visibility and order', async (t) => {
  const homeSections = [{ key:'categories', order:30, visible:true, content:{ items:[{ title:'Camisetas', url:'/shop', media_url:'' }] } }]
  const { page, calls, pageErrors } = await fixture(t, {
    homeSections,
    handle:({ path, method, body }) => {
      if (path === '/api/admin/home/categories' && method === 'PUT') {
        homeSections[0] = { ...homeSections[0], order:body.order, visible:body.visible, content:body.content }
        return { data:{ success:true } }
      }
    }
  })
  await page.goto(baseUrl + '/admin?tab=editor')
  await page.getByLabel('Visibilidade').selectOption('0')
  await page.getByLabel('Ordem', { exact:true }).fill('5')
  await page.locator('.home-editor-card-grid').getByLabel('Nome', { exact:true }).fill('Moletons')
  await page.getByRole('button', { name:'Salvar rascunho', exact:true }).click()
  await page.getByText('Rascunho salvo', { exact:true }).waitFor()
  const saved = calls.find((call) => call.path === '/api/admin/home/categories' && call.method === 'PUT')
  assert.equal(saved.body.visible, false)
  assert.equal(saved.body.order, 5)
  assert.equal(saved.body.content.items[0].title, 'Moletons')
  assert.deepEqual(pageErrors, [])
})

test('static campaign setting disables decorative motion', async (t) => {
  const { page, pageErrors } = await fixture(t, {
    reducedMotion:'no-preference',
    homeSections:[{ key:'hero', order:10, visible:true, content:{ title:'Vista o que representa você' } }],
    settings:[{ key:'campaign_defaults', value:{ effect:'static', speed:'slow', duration_seconds:6 } }, { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }]
  })
  await page.goto(baseUrl)
  await page.locator('.campaign-visual[data-campaign-effect="static"]').waitFor()
  assert.equal(await page.locator('.campaign-brand-image').evaluate((image) => getComputedStyle(image).animationName), 'none')
  assert.equal(await page.locator('.campaign-visual').evaluate((visual) => getComputedStyle(visual, '::before').animationName), 'none')
  assert.deepEqual(pageErrors, [])
})

async function openPointOfSale(page) {
  await page.getByRole('button', { name:'PDV — loja física', exact:true }).click()
  await page.getByRole('heading', { name:'Caixa da loja', exact:true }).waitFor()
}

async function preparePhysicalSale(page) {
  await page.getByRole('button', { name:'Adicionar Camiseta Teste à venda', exact:true }).click()
  await page.getByLabel('3. Forma de pagamento').selectOption('PIX')
}

test('PDV guards double submission and preserves confirmed sale if receipt fetch fails', async (t) => {
  const sale = { id:71, code:'VDA-000071', status:'PAGA', total:129.9, payment_method:'PIX', customer_name:'Cliente físico' }
  const { page, calls, pageErrors } = await fixture(t, {
    handle:async ({ path, method }) => {
      if (path === '/api/admin/sales' && method === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { data:sale }
      }
      if (path === '/api/admin/sales/71') return { status:503, data:{ error:'Comprovante temporariamente indisponível' } }
    }
  })
  await page.goto(baseUrl + '/admin')
  await openPointOfSale(page)
  await preparePhysicalSale(page)
  await page.locator('.pdv-checkout').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }))
    form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }))
  })
  await page.getByRole('heading', { name:'Venda VDA-000071', exact:true }).waitFor()
  await page.getByText(/Os itens do comprovante não puderam ser carregados/).waitFor()
  await page.waitForFunction(() => document.querySelector('.pdv-receipt button')?.disabled === false)
  assert.equal(calls.filter((call) => call.path === '/api/admin/sales' && call.method === 'POST').length, 1)
  assert.equal(await page.getByRole('heading', { name:'Venda VDA-000071', exact:true }).count(), 1)
  assert.equal(await page.evaluate(() => sessionStorage.getItem('galeo.pdv.pending-sale.1')), null)
  assert.deepEqual(pageErrors, [])
})

test('PDV restores an uncertain sale and reuses its reference and original total after reload', async (t) => {
  let attempts = 0
  const sale = { id:72, code:'VDA-000072', status:'PAGA', total:129.9, payment_method:'PIX' }
  const { page, calls, pageErrors } = await fixture(t, {
    handle:({ path, method }) => {
      if (path === '/api/admin/sales' && method === 'POST') {
        attempts++
        return attempts === 1 ? { status:500, data:{ error:'Confirmação indisponível no teste' } } : { data:sale }
      }
      if (path === '/api/admin/products' && attempts > 0) return { data:[{ ...product, price:159.9, stock:0 }] }
      if (path === '/api/admin/sales/72') return { data:{ ...sale, items:[{ id:1, product_id:31, product:product.name, quantity:1, unit_price:129.9, line_total:129.9 }] } }
    }
  })
  await page.goto(baseUrl + '/admin')
  await openPointOfSale(page)
  await preparePhysicalSale(page)
  await page.getByRole('button', { name:'Confirmar pagamento e registrar venda', exact:true }).click()
  await page.getByRole('button', { name:'Verificar registro da venda', exact:true }).waitFor()
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('galeo.pdv.pending-sale.1')))
  assert.equal(stored.expected_total, 129.9)
  assert.equal(stored.payment_method, 'PIX')
  await page.reload()
  await openPointOfSale(page)
  await page.getByRole('button', { name:'Verificar registro da venda', exact:true }).click()
  await page.getByRole('heading', { name:'Venda VDA-000072', exact:true }).waitFor()
  await page.locator('.pdv-receipt-items').getByText('Camiseta Teste', { exact:true }).waitFor()
  const submits = calls.filter((call) => call.path === '/api/admin/sales' && call.method === 'POST')
  assert.equal(submits.length, 2)
  assert.equal(submits[0].body.client_reference, stored.client_reference)
  assert.equal(submits[1].body.client_reference, stored.client_reference)
  assert.equal(submits[1].body.expected_total, 129.9)
  assert.deepEqual(submits[1].body.items, submits[0].body.items)
  assert.equal(await page.evaluate(() => sessionStorage.getItem('galeo.pdv.pending-sale.1')), null)
  assert.deepEqual(pageErrors, [])
})

test('PDV recovered cancelled receipt clearly displays cancellation', async (t) => {
  const sale = { id:73, code:'VDA-000073', status:'CANCELADA', total:129.9, payment_method:'PIX', items:[{ id:1, product_id:31, product:product.name, quantity:1, unit_price:129.9, line_total:129.9 }] }
  const { page, pageErrors } = await fixture(t, {
    handle:({ path, method }) => {
      if (path === '/api/admin/sales' && method === 'POST') return { data:sale }
      if (path === '/api/admin/sales/73') return { data:sale }
    }
  })
  await page.goto(baseUrl + '/admin')
  await page.evaluate(() => sessionStorage.setItem('galeo.pdv.pending-sale.1', JSON.stringify({ client_reference:'783c3a6d-38aa-43a2-8fb9-dc560ec58d0a', payment_method:'PIX', expected_total:129.9, total:129.9, customer_name:'Cliente de teste', items:[{ product_id:31, quantity:1 }] })))
  await openPointOfSale(page)
  await page.getByRole('button', { name:'Verificar registro da venda', exact:true }).click()
  await page.getByRole('heading', { name:'Venda cancelada: VDA-000073', exact:true }).waitFor()
  await page.getByText('Total da venda', { exact:true }).waitFor()
  assert.equal(await page.getByText('Total pago', { exact:true }).count(), 0)
  assert.equal(await page.getByText('Pagamento confirmado pelo operador. Estoque e financeiro atualizados.', { exact:true }).count(), 0)
  assert.deepEqual(pageErrors, [])
})
