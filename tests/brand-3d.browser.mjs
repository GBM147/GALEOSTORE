import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes do logo 3D exigem servidor local; produção é recusada.')
}
const hero = { key: 'hero', visible: true, order: 10, content: { title: 'Vista o que representa você', description: 'Curadoria local', button_label: 'Explorar coleção', button_url: '/shop' } }
const quietMotion = { key: 'storefront_visual_defaults', value: { interaction: { smooth_scroll: { enabled: false }, scroll_reveal: { enabled: false }, hero_text_reveal: { enabled: false } } } }
// The 3D scene and three.js are a separate download; these must never load
// where only the image is shown.
const runtimeRequest = /medallionRuntime|galeoScene|three/i
let browser

before(async () => {
  // Software WebGL, so the live medallion also runs on machines without a GPU.
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1366, height = 820, reducedMotion = 'no-preference', query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion, ...(width <= 700 ? { isMobile: true, hasTouch: true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), errors = [], requests = []
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/store') return json({ products: [], categories: [] })
    if (path === '/api/store/home') return json({ sections: [hero] })
    if (path === '/api/store/home/settings') return json({ settings: [quietMotion] })
    if (path === '/api/customer/me') return json({ authenticated: false }, 401)
    return json({ error: 'API não prevista.' }, 404)
  })
  t.after(() => assert.deepEqual(errors.filter(text => !/401|Unauthorized/.test(text)), []))
  await page.goto(baseUrl + '/' + query)
  await page.locator('.hero-full .brand-medallion-image').waitFor()
  return { page, requests }
}

const tilt = page => page.locator('canvas[data-brand3d]').evaluate(canvas => Number(canvas.dataset.tilt))

test('no computador, a medalha 3D entra no lugar da imagem e inclina com o mouse', async t => {
  const { page, requests } = await fixture(t)
  const webgl = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')))
  if (!webgl) return t.skip('este navegador não tem WebGL')
  await page.locator('.hero-full .brand-medallion[data-live="true"] canvas[data-brand3d]').waitFor()
  assert.ok(requests.some(path => runtimeRequest.test(path)), 'a cena 3D é baixada à parte')
  const area = await page.locator('.hero-full').boundingBox()
  const middle = area.y + area.height / 2
  await page.mouse.move(area.x + 8, middle)
  await page.waitForTimeout(2500)
  const left = await tilt(page)
  await page.mouse.move(area.x + area.width - 8, middle)
  await page.waitForFunction(start => Number(document.querySelector('canvas[data-brand3d]').dataset.tilt) > start + 0.35, left)
  assert.equal(await page.locator('.brand-medallion-image').evaluate(image => getComputedStyle(image).opacity), '0', 'a imagem fixa some atrás da cena 3D')
})

for (const [name, options] of [
  ['no celular', { width: 390, height: 844 }],
  ['no Modo leve', { query: '?lite=1' }],
  ['com movimento reduzido', { reducedMotion: 'reduce' }]
]) {
  test(`${name}, fica só a imagem 3D fixa e o three.js não é baixado`, async t => {
    const { page, requests } = await fixture(t, options)
    await page.waitForTimeout(3500)
    assert.equal(await page.locator('canvas[data-brand3d]').count(), 0)
    assert.equal(await page.locator('.brand-medallion').getAttribute('data-live'), 'false')
    const image = page.locator('.hero-full .brand-medallion-image')
    assert.ok(await image.isVisible())
    assert.ok(await image.evaluate(img => img.complete && img.naturalWidth === 1100), 'a imagem fixa carregou')
    assert.deepEqual(requests.filter(path => runtimeRequest.test(path)), [])
  })
}

test('topo e rodapé mostram a medalha sem distorcer', async t => {
  const { page } = await fixture(t, { width: 390, height: 844 })
  for (const selector of ['.site-header .brand-logo', '.site-footer-about img']) {
    const logo = page.locator(selector).first()
    await logo.scrollIntoViewIfNeeded()
    const info = await logo.evaluate(img => new Promise(resolve => {
      const done = () => resolve({ src: img.currentSrc || img.src, natural: [img.naturalWidth, img.naturalHeight], box: [img.clientWidth, img.clientHeight], fit: getComputedStyle(img).objectFit })
      img.complete ? done() : img.addEventListener('load', done, { once: true })
    }))
    assert.match(info.src, /galeo-logo-128\.webp/)
    assert.deepEqual(info.natural, [128, 128])
    assert.equal(info.box[0], info.box[1], selector + ' fica quadrado')
    assert.equal(info.fit, 'contain')
  }
})
