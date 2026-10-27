import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('As regressões de carregamento exigem servidor local; produção é recusada.')
}
const products = Array.from({ length:24 }, (_, index) => ({
  id:index + 1, name:index ? 'Peça local ' + (index + 1) : 'Peça única', brand:'Marca local',
  category:'Camisetas', category_id:1, price:99.9, stock:4, image:'/images/loading-fixture.svg'
}))
const settings = [{ key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }]
const home = title => ({ sections:[{ key:'hero', visible:true, order:10, content:{ title, description:'Conteúdo publicado no servidor', button_label:'Ver peças', button_url:'/shop' } }] })
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { handle, width = 1280 } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce' })
  t.after(() => context.close())
  await context.addInitScript(() => {
    window.headingHistory = []
    new MutationObserver(() => document.querySelectorAll('h1').forEach(element => {
      if (element.textContent) window.headingHistory.push(element.textContent)
    })).observe(document, { childList:true, subtree:true, characterData:true })
  })
  const page = await context.newPage(), calls = [], scripts = [], errors = [], unexpected = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname) })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    calls.push(path)
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (request.method() !== 'GET') {
      unexpected.push(request.method() + ' ' + path)
      return json({ error:'A revisão local de carregamento não permite gravações.' }, 400)
    }
    const custom = await handle?.({ path, calls })
    if (custom) return json(custom.data, custom.status || 200)
    if (path === '/api/store') return json({ products, categories:[{ id:1, name:'Camisetas', sort_order:10 }] })
    if (path === '/api/store/home') return json(home('Nova frase da loja'))
    if (path === '/api/store/home/settings') return json({ settings })
    if (path === '/api/auth/me') return json({ authenticated:false }, 401)
    unexpected.push(request.method() + ' ' + path)
    return json({ error:'API não prevista na fixture de carregamento.' }, 404)
  })
  await page.route('**/images/loading-fixture.svg', route => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="700" height="900"><rect width="700" height="900" fill="#c9b18a"/></svg>' }))
  if (typeof page.routeWebSocket === 'function') await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send('{"type":"keepalive_ack"}')))
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []) })
  return { page, calls, scripts }
}

test('Home requests start in parallel and no previous phrase flashes while the published title loads', async t => {
  let releaseHome, releaseCatalog
  const waitingHome = new Promise(resolve => { releaseHome = resolve })
  const waitingCatalog = new Promise(resolve => { releaseCatalog = resolve })
  t.after(() => { releaseHome(); releaseCatalog() })
  const { page, calls } = await fixture(t, { handle:async ({ path }) => {
    if (path === '/api/store') await waitingCatalog
    if (path === '/api/store/home') await waitingHome
    return null
  } })
  await page.goto(baseUrl + '/', { waitUntil:'domcontentloaded' })
  await page.getByText('Carregando loja…', { exact:true }).waitFor()
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/api/store/home/settings')))
  assert.ok(calls.includes('/api/store') && calls.includes('/api/store/home') && calls.includes('/api/store/home/settings'))
  assert.equal(await page.locator('.hero-title').count(), 0)
  assert.equal(await page.getByText('Vista o que', { exact:true }).count(), 0)
  releaseHome()
  await page.getByRole('heading', { name:'Nova frase da loja', exact:true }).waitFor()
  assert.equal(await page.evaluate(() => window.headingHistory.some(text => text.includes('Vista o que'))), false)
  const catalogResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/store')
  releaseCatalog()
  await catalogResponse
  assert.equal(calls.filter(path => path === '/api/store').length, 1)
  assert.equal(calls.filter(path => path === '/api/store/home').length, 1)
  assert.equal(calls.filter(path => path === '/api/store/home/settings').length, 1)
})

test('an intentionally empty published title stays empty instead of bringing back the old phrase', async t => {
  const { page } = await fixture(t, { handle:({ path }) => path === '/api/store/home' ? { data:home('') } : null })
  await page.goto(baseUrl + '/')
  await page.locator('.hero-title').waitFor()
  assert.equal(await page.locator('.hero-title').innerText(), '')
  assert.equal(await page.getByText('Clique para escrever', { exact:true }).count(), 0)
  assert.equal(await page.evaluate(() => window.headingHistory.some(text => text.includes('Vista o que'))), false)
})

test('a new Home visit waits for fresh published content without showing the previous heading', async t => {
  let homeReads = 0, releaseReload
  const reload = new Promise(resolve => { releaseReload = resolve })
  t.after(() => releaseReload())
  const { page } = await fixture(t, { handle:async ({ path }) => {
    if (path !== '/api/store/home') return null
    if (++homeReads > 1) { await reload; return { data:home('Frase atualizada no servidor') } }
    return { data:home('Primeira publicação') }
  } })
  await page.goto(baseUrl + '/')
  await page.getByRole('heading', { name:'Primeira publicação', exact:true }).waitFor()
  await page.getByRole('navigation', { name:'Categorias principais', exact:true }).getByRole('link', { name:'Catálogo', exact:true }).click()
  await page.locator('.catalog-search').waitFor()
  await page.evaluate(() => { window.headingHistory = [] })
  await page.getByRole('link', { name:'Galeo Store', exact:true }).click()
  await page.getByText('Carregando loja…', { exact:true }).waitFor()
  assert.equal(await page.locator('.hero-title').count(), 0)
  releaseReload()
  await page.getByRole('heading', { name:'Frase atualizada no servidor', exact:true }).waitFor()
  assert.equal(await page.evaluate(() => window.headingHistory.includes('Primeira publicação')), false)
  assert.equal(homeReads, 2)
})

test('the public page does not download the Admin screen and the Admin route does not request storefront data', async t => {
  const { page, scripts, calls } = await fixture(t)
  await page.goto(baseUrl + '/')
  await page.getByRole('heading', { name:'Nova frase da loja', exact:true }).waitFor()
  assert.equal(scripts.some(path => /\/src\/(?:Admin|PointOfSale)\.jsx$/.test(path)), false)
  const seen = calls.length
  await page.goto(baseUrl + '/admin')
  await page.getByRole('heading', { name:/Painel administrativo/ }).waitFor()
  assert.equal(calls.slice(seen).some(path => path.startsWith('/api/store')), false)
})

test('searching from the sticky header starts the new results at the top, not the page end', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/shop')
  await page.locator('.product-card').nth(23).waitFor()
  await page.evaluate(() => window.scrollTo({ top:1500, behavior:'instant' }))
  await page.getByRole('button', { name:'Abrir busca', exact:true }).click()
  await page.getByRole('textbox', { name:'Buscar produtos', exact:true }).fill('Peça única')
  await page.locator('.header-search').getByRole('button', { name:'Buscar ↗', exact:true }).click()
  await page.waitForURL('**/shop?q=Pe%C3%A7a%20%C3%BAnica')
  // Router updates the URL before React commits the filtered results.
  await page.locator('.catalog-summary').getByText('1 produto(s)', { exact:true }).waitFor()
  assert.equal(await page.locator('.product-card').count(), 1)
  assert.ok(await page.evaluate(() => window.scrollY) < 5)
})

test('header catalog navigation resets scroll even when only its query string changes', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/shop?category=Camisetas')
  await page.locator('.product-card').nth(23).waitFor()
  await page.evaluate(() => window.scrollTo({ top:1500, behavior:'instant' }))
  await page.getByRole('navigation', { name:'Categorias principais', exact:true }).getByRole('link', { name:'Catálogo', exact:true }).click()
  await page.waitForURL('**/shop')
  assert.equal(await page.locator('.product-card').count(), 24)
  assert.ok(await page.evaluate(() => window.scrollY) < 5)
})
