import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Controlled HTTP fixtures exercise browser interactions without paid image
// processing. Real MySQL/API authorization and persistence have a separate suite.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes visuais exigem servidor HTTP loopback; produção é recusada.')
}
const reportDirectory = process.env.MEDIA_BROWSER_REPORT_DIR || join(tmpdir(), 'galeo-media-approval-browser')
const originalUrl = 'https://res.cloudinary.com/galeo-fixture/image/upload/library-shirt.jpg'
const aiUrl = 'https://res.cloudinary.com/galeo-fixture/image/upload/library-shirt-no-background.png'
const oldCoverUrl = 'https://res.cloudinary.com/galeo-fixture/image/upload/product-old-cover.jpg'
const detailUrl = 'https://res.cloudinary.com/galeo-fixture/image/upload/product-detail.jpg'
const manualUrl = 'https://res.cloudinary.com/galeo-fixture/image/upload/manual-cover.jpg'
const shirtId = 91
const failedId = 93
const productTemplate = {
  id:31, name:'Camiseta Essential', brand:'GALEO', category:'Camisetas', category_id:301,
  price:129.9, cost:40, stock:10, min_stock:1, active:1,
  description:'Camiseta de algodão. Fotografia de teste para revisão de seleção da capa.',
  image:oldCoverUrl, image_asset_id:null, image_variant:null, video:''
}
const visualReports = []
let browser

before(async () => {
  await mkdir(reportDirectory, { recursive:true, mode:0o700 })
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => {
  await browser?.close()
  await writeFile(join(reportDirectory, 'report.json'), JSON.stringify({ source:'controlled-browser-fixtures', tests:visualReports }, null, 2))
})

function svgImage(url) {
  const transparent = url.includes('no-background')
  const background = transparent ? '' : '<rect width="640" height="740" fill="#d8cdb9"/><rect x="24" y="24" width="592" height="692" rx="2" fill="#e4dac9"/>'
  return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="740" viewBox="0 0 640 740">' + background + '<path d="M208 130 270 100 Q320 145 370 100 L432 130 536 234 463 302 415 248 415 601 225 601 225 248 177 302 104 234Z" fill="#b29a72" stroke="#7d6b4d" stroke-width="4"/><path d="M270 100 Q320 178 370 100 M225 248 225 601 M415 248 415 601" fill="none" stroke="#8d7651" stroke-width="3"/><text x="320" y="318" text-anchor="middle" font-family="sans-serif" font-size="25" letter-spacing="8" fill="#534b3e">GALEO</text></svg>'
}

async function fixture(t, { viewport, processingFirst = false, readyPhoto = false, aiPreviewFailsOnce = false, publicProduct } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion:'reduce' })
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const calls = [], pageErrors = [], unexpectedApi = []
  const product = structuredClone(publicProduct || productTemplate)
  const items = [
    { id:shirtId, title:'Camiseta areia', media_type:'image', original_url:originalUrl, ai_url:readyPhoto ? aiUrl : null, url:originalUrl, ai_status:readyPhoto ? 'done' : 'none', use_ai:false, width:640, height:740 },
    { id:failedId, title:'Foto com tratamento indisponível', media_type:'image', original_url:detailUrl, ai_url:null, url:detailUrl, ai_status:'failed', use_ai:false, width:640, height:740 }
  ]
  let aiAttempts = 0
  let aiPreviewFailures = 0
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss())
  await page.route('https://res.cloudinary.com/galeo-fixture/**', route => {
    const url = route.request().url()
    if (aiPreviewFailsOnce && url.startsWith(aiUrl) && aiPreviewFailures++ === 0) {
      return route.fulfill({ status:404, contentType:'text/plain', body:'Preview fixture unavailable' })
    }
    return route.fulfill({ contentType:'image/svg+xml', body:svgImage(url) })
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body, headers:request.headers() })
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ success:true, user:{ id:1, email:'owner@example.invalid', role:'owner' }, csrfToken:'fixture-csrf' })
    if (path === '/api/customer/me') return json({ authenticated:false }, 401)
    if (path === '/api/store') return json({ products:[product], categories:[{ id:301, name:'Camisetas', sort_order:10 }] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[] })
    if (path === '/api/store/products/31') return json({ product, related:[] })
    if (path === '/api/admin/products') return json([product])
    if (path === '/api/admin/products/31/media') return json(Array.isArray(product.media) ? product.media : [])
    if (path === '/api/admin/products/31' && method === 'PUT') {
      Object.assign(product, body)
      if (body.image_asset_id) {
        const asset = items.find(item => item.id === body.image_asset_id)
        product.image = body.image_variant === 'ai' ? asset.ai_url : asset.original_url
      }
      return json(product)
    }
    if (path === '/api/admin/media-library' && method === 'GET') return json({ items, total:items.length })
    if (/^\/api\/admin\/media-library\/\d+\/ai-background$/.test(path) && method === 'POST') {
      const item = items.find(asset => asset.id === Number(path.split('/')[4]))
      if (item.id === failedId) return json({ error:'Tratamento indisponível no teste. O original foi preservado.' }, 503)
      aiAttempts++
      if (processingFirst && aiAttempts === 1) {
        item.ai_status = 'processing'
        item.ai_url = aiUrl
        return json({ success:true, processing:true, message:'A IA ainda está processando. Verifique o resultado em instantes.', item }, 202)
      }
      item.ai_status = 'done'
      item.ai_url = aiUrl
      // Processing completion deliberately keeps the global original in use.
      return json({ success:true, processing:false, item })
    }
    if (/^\/api\/admin\/media-library\/\d+$/.test(path) && method === 'PATCH') {
      const item = items.find(asset => asset.id === Number(path.split('/')[4]))
      assert.equal(typeof body.use_ai, 'boolean', 'a escolha deve enviar um booleano explícito')
      if (body.use_ai && (item.ai_status !== 'done' || !item.ai_url)) return json({ error:'A versão sem fundo não está pronta.' }, 409)
      item.use_ai = body.use_ai
      item.url = item.use_ai ? item.ai_url : item.original_url
      return json({ success:true, item })
    }
    if (path === '/api/admin/dashboard') return json({ products:{ count:1, stock:10, low_stock:0 }, stock:{ entradas:0, saidas:0 }, sales:{ count:0, total:0 }, income:0, expense:0, payable:0, receivable:0 })
    if (['/api/admin/sales', '/api/admin/store-orders', '/api/admin/finance/entries', '/api/admin/finance/recurring', '/api/admin/stock/movements'].includes(path)) return json([])
    if (path === '/api/admin/finance/categories') return json([{ id:901, name:'Mercadorias', type:'DESPESA' }])
    if (path === '/api/admin/finance/accounts') return json([{ id:902, name:'Caixa da loja' }])
    unexpectedApi.push(method + ' ' + path)
    return json({ error:'API não prevista no teste: ' + method + ' ' + path }, 404)
  })
  if (typeof page.routeWebSocket === 'function') {
    await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send('{"type":"keepalive_ack"}')))
  }
  return { page, calls, items, product, pageErrors, unexpectedApi }
}

function version(comparison, name) { return comparison.getByTestId('media-version-' + name) }
function useVersion(comparison, name) { return comparison.getByRole('button', { name:'Usar esta versão: ' + name, exact:true }) }
function mutationCalls(calls, method = 'PATCH') { return calls.filter(call => /^\/api\/admin\/media-library\/\d+$/.test(call.path) && call.method === method) }

async function checkLayout(page, element, label) {
  const dimensions = await page.evaluate(() => ({ viewport:window.innerWidth, document:document.documentElement.scrollWidth }))
  assert.ok(dimensions.document <= dimensions.viewport + 2, label + ': a página não deve transbordar horizontalmente')
  const bounds = await element.evaluate(node => {
    const rectangle = node.getBoundingClientRect()
    return { left:rectangle.left, right:rectangle.right, scroll:node.scrollWidth, width:node.clientWidth }
  })
  assert.ok(bounds.left >= -2 && bounds.right <= dimensions.viewport + 2, label + ': o comparador deve caber na tela')
  assert.ok(bounds.scroll <= bounds.width + 2, label + ': conteúdo do comparador não deve transbordar')
  visualReports.push({ label, ...dimensions, bounds })
}

async function captureComparison(page, comparison, device, scope) {
  if (device === 'mobile') {
    // A stacked comparator is taller than a phone viewport. Capture each card
    // after scrolling it into view; a tall locator capture would paint fixed
    // navigation or clip the ancestor modal over off-screen content.
    for (const [name, filename] of [['original','original'], ['ai','sem-fundo']]) {
      const card = version(comparison, name)
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({ path:join(reportDirectory, device + '-' + scope + '-' + filename + '.png') })
    }
    await version(comparison, 'original').scrollIntoViewIfNeeded()
    await page.screenshot({ path:join(reportDirectory, device + '-' + scope + '-comparacao.png') })
  } else {
    await comparison.screenshot({ path:join(reportDirectory, device + '-' + scope + '-comparacao.png') })
  }
}

for (const [device, viewport] of [['desktop', { width:1366, height:950 }], ['mobile', { width:390, height:844 }]]) {
  test(device + ': biblioteca exige aprovação explícita e preserva original durante processamento e erro', async t => {
    const { page, calls, items, pageErrors, unexpectedApi } = await fixture(t, { viewport, processingFirst:true, aiPreviewFailsOnce:true })
    await page.goto(baseUrl + '/admin?tab=library')
    await page.getByTestId('media-compare-' + shirtId).waitFor()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path:join(reportDirectory, device + '-biblioteca.png'), fullPage:true })
    await page.getByTestId('media-compare-' + shirtId).click()
    const comparison = page.getByTestId('media-comparison')
    const photoTile = page.locator('.media-tile').filter({ has:page.getByTestId('media-compare-' + shirtId) })
    await comparison.waitFor()
    await version(comparison, 'original').getByText('Em uso', { exact:true }).waitFor()
    assert.equal(await useVersion(comparison, 'Sem fundo').isEnabled(), false)
    assert.equal(mutationCalls(calls).length, 0)
    await photoTile.getByRole('button', { name:/Remover fundo.*IA/ }).click()
    await photoTile.getByRole('button', { name:'Verificar resultado', exact:true }).waitFor()
    assert.equal(await useVersion(comparison, 'Sem fundo').isEnabled(), false)
    assert.equal(items[0].use_ai, false)
    assert.equal(mutationCalls(calls).length, 0)
    await photoTile.getByRole('button', { name:'Verificar resultado', exact:true }).click()
    const retryPreview = version(comparison, 'ai').getByRole('button', { name:'Tentar carregar novamente', exact:true })
    await retryPreview.waitFor()
    assert.equal(await useVersion(comparison, 'Sem fundo').isEnabled(), false, 'prévia quebrada não deve permitir aprovar uma imagem invisível')
    assert.equal(mutationCalls(calls).length, 0)
    await retryPreview.click()
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="media-version-ai"] button')
      return Boolean(button && !button.disabled)
    })
    assert.equal(items[0].use_ai, false, 'concluir a IA não deve escolher automaticamente a versão')
    assert.equal(mutationCalls(calls).length, 0)
    await version(comparison, 'original').getByText('Em uso', { exact:true }).waitFor()
    await checkLayout(page, comparison, device + '-library-comparison')
    await captureComparison(page, comparison, device, 'biblioteca')
    await useVersion(comparison, 'Sem fundo').click()
    await version(comparison, 'ai').getByText('Em uso', { exact:true }).waitFor()
    assert.deepEqual(mutationCalls(calls).map(call => call.body), [{ use_ai:true }])
    assert.equal(mutationCalls(calls)[0].headers['x-csrf-token'], 'fixture-csrf')
    await useVersion(comparison, 'Original').click()
    await version(comparison, 'original').getByText('Em uso', { exact:true }).waitFor()
    assert.deepEqual(mutationCalls(calls).map(call => call.body), [{ use_ai:true }, { use_ai:false }])
    assert.ok(calls.filter(call => call.path.endsWith('/ai-background') && call.method === 'POST').every(call => call.headers['x-csrf-token'] === 'fixture-csrf'))
    await page.getByTestId('media-compare-' + failedId).click()
    const failedTile = page.locator('.media-tile').filter({ has:page.getByTestId('media-compare-' + failedId) })
    await failedTile.getByRole('button', { name:/Remover fundo.*IA/ }).click()
    await page.getByText('Tratamento indisponível no teste. O original foi preservado.', { exact:true }).waitFor()
    assert.equal(await useVersion(comparison, 'Sem fundo').isEnabled(), false)
    assert.equal(items[1].use_ai, false)
    assert.equal(mutationCalls(calls).length, 2, 'erro de processamento não deve trocar a versão em uso')
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(unexpectedApi, [])
  })

  test(device + ': seleção da biblioteca só altera a capa do formulário ao aprovar e salvar', async t => {
    const { page, calls, pageErrors, unexpectedApi } = await fixture(t, { viewport, readyPhoto:true })
    await page.goto(baseUrl + '/admin?tab=products')
    await page.getByRole('row').filter({ hasText:productTemplate.name }).getByRole('button', { name:'Editar', exact:true }).click()
    const modal = page.locator('.admin-modal')
    const modalCloseIsClickable = await modal.locator('.modal-close').evaluate(button => {
      const rect = button.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return hit === button || button.contains(hit)
    })
    assert.equal(modalCloseIsClickable, true, 'o cabeçalho da loja não deve cobrir os controles do modal')
    const coverInput = modal.getByLabel('URL da foto principal', { exact:true })
    assert.equal(await coverInput.inputValue(), oldCoverUrl)
    await modal.getByRole('button', { name:'Escolher da biblioteca', exact:true }).click()
    const picker = page.getByTestId('product-library-picker')
    await picker.getByRole('button', { name:'Comparar versões: Camiseta areia', exact:true }).click()
    const comparison = picker.getByTestId('media-comparison')
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="media-version-ai"] button')
      return Boolean(button && !button.disabled)
    })
    assert.equal(await coverInput.inputValue(), oldCoverUrl, 'o resultado da IA não deve mudar a capa antes da aprovação')
    assert.equal(mutationCalls(calls).length, 0)
    await checkLayout(page, comparison, device + '-product-comparison')
    await captureComparison(page, comparison, device, 'produto')
    await useVersion(comparison, 'Sem fundo').click()
    await picker.waitFor({ state:'detached' })
    assert.equal(await coverInput.inputValue(), aiUrl)
    assert.equal(await modal.getByTestId('product-cover-preview').locator('img').getAttribute('src'), aiUrl)
    assert.equal(mutationCalls(calls).length, 0, 'a escolha da capa não deve trocar a versão global da biblioteca')
    assert.equal(calls.some(call => call.path.endsWith('/ai-background') && call.method === 'POST'), false, 'escolher uma versão existente não deve gastar créditos de processamento')
    assert.equal(calls.filter(call => call.method === 'PUT').length, 0, 'aprovar só modifica o formulário até salvar')
    await modal.getByRole('button', { name:'Salvar produto', exact:true }).click()
    await modal.waitFor({ state:'detached' })
    const saved = calls.filter(call => call.path === '/api/admin/products/31' && call.method === 'PUT')
    assert.equal(saved.length, 1)
    assert.equal(saved[0].body.image_asset_id, shirtId)
    assert.equal(saved[0].body.image_variant, 'ai')
    assert.equal(saved[0].headers['x-csrf-token'], 'fixture-csrf')
    await page.getByRole('row').filter({ hasText:productTemplate.name }).getByRole('button', { name:'Editar', exact:true }).click()
    await modal.getByRole('button', { name:'Escolher da biblioteca', exact:true }).click()
    await picker.getByRole('button', { name:'Comparar versões: Camiseta areia', exact:true }).click()
    await picker.getByRole('button', { name:'Cancelar seleção', exact:true }).click()
    await picker.waitFor({ state:'detached' })
    assert.equal(await coverInput.inputValue(), aiUrl, 'cancelar a seleção deve manter a capa anterior')
    await coverInput.fill(manualUrl)
    await modal.getByRole('button', { name:'Salvar produto', exact:true }).click()
    await modal.waitFor({ state:'detached' })
    const manualSave = calls.filter(call => call.path === '/api/admin/products/31' && call.method === 'PUT').at(-1)
    assert.equal(manualSave.body.image, manualUrl)
    assert.equal(manualSave.body.image_asset_id, null)
    assert.equal(manualSave.body.image_variant, null)
    assert.equal(mutationCalls(calls).length, 0)
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(unexpectedApi, [])
  })

  test(device + ': página pública prioriza a capa escolhida e mantém a galeria sem duplicar a foto', async t => {
    const publicProduct = { ...productTemplate, image:aiUrl, media:[
      { id:201, media_type:'image', url:oldCoverUrl },
      { id:202, media_type:'image', url:aiUrl },
      { id:203, media_type:'image', url:detailUrl }
    ] }
    const { page, calls, pageErrors, unexpectedApi } = await fixture(t, { viewport, publicProduct })
    await page.goto(baseUrl + '/produto/31')
    const mainImage = page.locator('.product-main-media img')
    await mainImage.waitFor()
    assert.equal(await mainImage.getAttribute('src'), aiUrl)
    const thumbnails = page.locator('.product-thumb-grid button')
    assert.equal(await thumbnails.count(), 3, 'capa repetida na galeria deve aparecer uma única vez')
    const urls = await thumbnails.locator('img').evaluateAll(images => images.map(image => image.src))
    assert.deepEqual(urls, [aiUrl, oldCoverUrl, detailUrl])
    assert.equal(new Set(urls).size, urls.length)
    await thumbnails.nth(1).click()
    assert.equal(await mainImage.getAttribute('src'), oldCoverUrl)
    await thumbnails.nth(2).click()
    assert.equal(await mainImage.getAttribute('src'), detailUrl)
    await thumbnails.first().click()
    assert.equal(await mainImage.getAttribute('src'), aiUrl)
    await checkLayout(page, page.locator('.product-gallery'), device + '-public-gallery')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path:join(reportDirectory, device + '-produto-publico.png'), fullPage:true })
    assert.equal(calls.some(call => ['PATCH','POST','PUT'].includes(call.method)), false, 'navegar pela galeria não deve escrever dados')
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(unexpectedApi, [])
  })
}
