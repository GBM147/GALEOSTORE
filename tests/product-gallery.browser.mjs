import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

// All product data and product media are intercepted in the browser. Refuse a
// production target: these interaction checks never create inventory or orders.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes da galeria exigem servidor HTTP loopback; produção é recusada.')
}

const photos = ['/images/gallery-fixture-front.svg', '/images/gallery-fixture-back.svg', '/images/gallery-fixture-detail.svg']
const videoUrl = '/images/gallery-fixture-video.webm'
const productTemplate = {
  id:31, name:'Camiseta da galeria', brand:'GALEO', category:'Camisetas', category_id:301,
  description:'Fotos locais para testar ampliação e navegação.', price:129.9, stock:10,
  image:photos[0], video:'', media:photos.map((url, index) => ({ id:index + 1, media_type:'image', url }))
}
let browser

before(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280, product:changes = {}, failedImages = [], imageDimensions = {}, reducedMotion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion, hasTouch:width <= 700 })
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const calls = [], unexpectedApi = [], pageErrors = []
  const product = { ...structuredClone(productTemplate), ...changes }
  const nextProduct = { ...structuredClone(productTemplate), id:32, name:'Outra peça da galeria', image:photos[2], media:[] }
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    calls.push({ path, method:request.method() })
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/store') return json({ products:[product, nextProduct], categories:[{ id:301, name:'Camisetas', sort_order:10 }] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[] })
    if (path === '/api/store/products/31') return json({ product, related:[nextProduct] })
    if (path === '/api/store/products/32') return json({ product:nextProduct, related:[product] })
    if (path === '/api/customer/me' || path === '/api/auth/me') return json({ authenticated:false }, 401)
    unexpectedApi.push(request.method() + ' ' + path)
    return json({ error:'API não prevista no teste da galeria: ' + path }, 404)
  })
  await page.route('**/images/gallery-fixture-*', async route => {
    const path = new URL(route.request().url()).pathname
    if (failedImages.includes(path)) return route.fulfill({ status:404, contentType:'text/plain', body:'Foto indisponível no teste' })
    if (path.endsWith('.webm')) return route.fulfill({ contentType:'video/webm', body:Buffer.alloc(0) })
    const color = path.includes('back') ? '#8d7651' : path.includes('detail') ? '#534b3e' : '#b29a72'
    const dimensions = imageDimensions[path] || { width:800, height:900 }
    return route.fulfill({
      contentType:'image/svg+xml',
      body:'<svg xmlns="http://www.w3.org/2000/svg" width="' + dimensions.width + '" height="' + dimensions.height + '" viewBox="0 0 800 900"><rect width="800" height="900" fill="#e4dac9"/><path d="M260 170 340 130 Q400 170 460 130 L540 170 650 300 570 370 520 300 520 750 280 750 280 300 230 370 150 300Z" fill="' + color + '"/><text x="400" y="455" text-anchor="middle" font-size="42" font-family="sans-serif" fill="#fff">GALEO</text></svg>'
    })
  })
  if (typeof page.routeWebSocket === 'function') {
    await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send('{"type":"keepalive_ack"}')))
  }
  t.after(() => {
    assert.deepEqual(pageErrors, [], 'a interação não deve causar erros JavaScript')
    assert.deepEqual(unexpectedApi, [], 'as APIs devem permanecer nas fixtures locais')
    assert.ok(calls.every(call => call.method === 'GET'), 'abrir e ampliar fotos não deve alterar dados')
  })
  return { page, product, nextProduct }
}

const opener = (page, name = productTemplate.name) => page.getByRole('button', { name:'Ampliar foto de ' + name, exact:true })
const viewer = page => page.locator('dialog.product-lightbox')
const viewerImage = page => viewer(page).locator('.product-lightbox-transform img')

async function openPhoto(page, name = productTemplate.name) {
  await opener(page, name).click()
  await viewer(page).waitFor({ state:'visible' })
  await page.waitForFunction(() => document.querySelector('dialog.product-lightbox')?.matches(':modal'))
  assert.equal(await viewer(page).evaluate(dialog => dialog.contains(document.activeElement)), true, 'o foco deve ficar dentro do diálogo')
}

async function assertPhoto(page, url) {
  await page.waitForFunction(expected => {
    const image = document.querySelector('dialog.product-lightbox .product-lightbox-transform img')
    return image && new URL(image.getAttribute('src'), location.href).pathname === expected
  }, url)
}

async function matrix(page) {
  return viewer(page).locator('.product-lightbox-transform').evaluate(node => {
    const value = new DOMMatrixReadOnly(getComputedStyle(node).transform)
    return { scale:value.a, x:value.e, y:value.f }
  })
}

async function dragStage(page, { dx, dy = 0 }) {
  const bounds = await viewer(page).locator('.product-lightbox-stage').boundingBox()
  assert.ok(bounds?.width > 0 && bounds?.height > 0)
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps:8 })
  await page.mouse.up()
}

// Chromium creates trusted pointer events for these touches, exercising the
// same multi-pointer path as a real touchscreen rather than dispatching DOM events.
async function touchGesture(page, frames) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:2 })
    await session.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:frames[0] })
    for (const touchPoints of frames.slice(1)) {
      await session.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints })
    }
    await session.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] })
  } finally {
    await session.detach()
  }
}

for (const width of [1280, 390]) {
  test('product photo viewer is modal, keyboard navigable and restores focus at ' + width + 'px', async t => {
    const { page } = await fixture(t, { width })
    await page.goto(baseUrl + '/produto/31')
    await opener(page).waitFor()
    await page.evaluate(() => { document.body.style.overflow = 'auto' })
    const previousOverflow = await page.evaluate(() => document.body.style.overflow)
    await openPhoto(page)
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await assertPhoto(page, photos[0])
    assert.equal(await viewer(page).getAttribute('aria-label'), 'Fotos de ' + productTemplate.name)
    await viewer(page).getByRole('button', { name:'Próxima foto', exact:true }).click()
    await assertPhoto(page, photos[1])
    await page.keyboard.press('ArrowRight')
    await assertPhoto(page, photos[2])
    await page.keyboard.press('ArrowLeft')
    await assertPhoto(page, photos[1])
    await viewer(page).getByRole('button', { name:'Foto anterior', exact:true }).click()
    await assertPhoto(page, photos[0])
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press('Tab')
      const focus = await viewer(page).evaluate(dialog => ({ inside:dialog.contains(document.activeElement), tag:document.activeElement?.tagName, label:document.activeElement?.getAttribute('aria-label'), hasFocus:document.hasFocus() }))
      // Native modal dialogs may let Tab reach the browser chrome after their
      // last control. Background page controls must remain unreachable.
      assert.ok(focus.inside || (!focus.hasFocus && focus.tag === 'BODY'), 'Tab não deve alcançar a página atrás do modal: ' + JSON.stringify(focus))
    }
    await page.keyboard.press('Escape')
    await viewer(page).waitFor({ state:'hidden' })
    assert.equal(await opener(page).evaluate(button => button === document.activeElement), true)
    assert.equal(await page.evaluate(() => document.body.style.overflow), previousOverflow)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
  })

  test('product photo zoom and drag work without changing the photograph at ' + width + 'px', async t => {
    const { page } = await fixture(t, { width })
    await page.goto(baseUrl + '/produto/31')
    await openPhoto(page)
    await viewer(page).getByRole('button', { name:'Zoom 2x', exact:true }).click()
    assert.equal(await viewer(page).getByRole('button', { name:'Zoom 2x', exact:true }).getAttribute('aria-pressed'), 'true')
    await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform).a > 1.95)
    const before = await matrix(page)
    await dragStage(page, { dx:64, dy:38 })
    await page.waitForFunction(previous => {
      const current = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform)
      return Math.abs(current.e - previous.x) > 10 || Math.abs(current.f - previous.y) > 10
    }, before)
    const after = await matrix(page)
    assert.ok(Math.abs(after.x - before.x) > 10 || Math.abs(after.y - before.y) > 10, 'arrastar a foto ampliada deve mover sua área visível')
    await assertPhoto(page, photos[0])
    await viewer(page).getByRole('button', { name:'Zoom 3x', exact:true }).click()
    await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform).a > 2.95)
    await viewer(page).getByRole('button', { name:'Próxima foto', exact:true }).click()
    await assertPhoto(page, photos[1])
    assert.equal(await viewer(page).getByRole('button', { name:'Zoom 1x', exact:true }).getAttribute('aria-pressed'), 'true')
    await page.waitForFunction(() => {
      const current = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform)
      return Math.abs(current.a - 1) < 0.01 && Math.abs(current.e) < 1 && Math.abs(current.f) < 1
    })
    const reset = await matrix(page)
    assert.ok(Math.abs(reset.scale - 1) < 0.01 && Math.abs(reset.x) < 1 && Math.abs(reset.y) < 1, 'trocar de foto deve reiniciar zoom e deslocamento: ' + JSON.stringify(reset))
    await viewer(page).getByRole('button', { name:'Fechar galeria', exact:true }).click()
    assert.equal(await opener(page).evaluate(button => button === document.activeElement), true)
    assert.equal(await page.locator('.product-main-media img').getAttribute('src'), photos[1], 'a foto escolhida deve continuar selecionada ao fechar')
  })

  test('zoomed portrait and landscape photos stay inside their real image bounds at ' + width + 'px', async t => {
    const { page } = await fixture(t, { width, imageDimensions:{
      [photos[0]]:{ width:240, height:1200 },
      [photos[1]]:{ width:1200, height:240 }
    } })
    await page.goto(baseUrl + '/produto/31')
    await openPhoto(page)
    for (const [photoIndex, expectedFixedAxis] of [[0, 'x'], [1, 'y']]) {
      if (photoIndex > 0) await viewer(page).getByRole('button', { name:'Próxima foto', exact:true }).click()
      await assertPhoto(page, photos[photoIndex])
      await page.waitForFunction(() => {
        const image = document.querySelector('.product-lightbox-transform img')
        return image?.complete && image.naturalWidth > 0
      })
      await viewer(page).getByRole('button', { name:'Zoom 2x', exact:true }).click()
      await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform).a > 1.95)
      await dragStage(page, { dx:1600, dy:1600 })
      const bounds = await viewerImage(page).evaluate(image => {
        const rect = image.closest('.product-lightbox-stage').getBoundingClientRect()
        const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
        return { x:Math.max(0, (image.naturalWidth * scale * 2 - rect.width) / 2), y:Math.max(0, (image.naturalHeight * scale * 2 - rect.height) / 2) }
      })
      const moved = await matrix(page)
      assert.ok(Math.abs(moved[expectedFixedAxis]) < 1, 'letterboxing should not let the photograph drift across empty space: ' + JSON.stringify({ bounds, moved }))
      for (const axis of ['x', 'y']) {
        assert.ok(Math.abs(moved[axis]) <= bounds[axis] + 1, 'drag must stop at the actual contained photograph edge on ' + axis)
        assert.ok(Math.abs(moved[axis] - bounds[axis]) <= 1, 'long drag must reach the photograph edge on ' + axis)
      }
      await assertPhoto(page, photos[photoIndex])
    }
    await page.keyboard.press('Escape')
  })
}

test('touchscreen pinch enlarges the photograph, supports dragging and returns to photo swiping', async t => {
  const { page } = await fixture(t, { width:390 })
  await page.goto(baseUrl + '/produto/31')
  await openPhoto(page)
  await page.waitForFunction(() => document.querySelector('.product-lightbox-transform img')?.naturalWidth > 0)
  const bounds = await viewer(page).locator('.product-lightbox-stage').boundingBox()
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  const points = halfDistance => [{ id:1, x:x - halfDistance, y }, { id:2, x:x + halfDistance, y }]
  await touchGesture(page, [points(30), points(45), points(60), points(75)])
  await page.waitForFunction(() => {
    const scale = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform).a
    return scale > 2.35 && scale < 2.65
  })
  const enlarged = await matrix(page)
  assert.ok(enlarged.scale > 2.35 && enlarged.scale < 2.65, 'two-finger pinch must control the image scale: ' + JSON.stringify(enlarged))
  await assertPhoto(page, photos[0])
  await touchGesture(page, [[{ id:1, x, y }], [{ id:1, x:x + 24, y:y + 20 }], [{ id:1, x:x + 48, y:y + 40 }]])
  await page.waitForFunction(previous => {
    const current = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform)
    return Math.abs(current.e - previous.x) > 10 || Math.abs(current.f - previous.y) > 10
  }, enlarged)
  const moved = await matrix(page)
  assert.ok(Math.abs(moved.x - enlarged.x) > 10 || Math.abs(moved.y - enlarged.y) > 10, 'one finger should move the image after pinch zoom')
  await assertPhoto(page, photos[0])
  await viewer(page).getByRole('button', { name:'Zoom 1x', exact:true }).click()
  await touchGesture(page, [[{ id:1, x:x + 60, y }], [{ id:1, x:x + 20, y }], [{ id:1, x:x - 30, y }], [{ id:1, x:x - 80, y }]])
  await assertPhoto(page, photos[1])
  assert.equal((await matrix(page)).scale, 1)
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')
})

test('mobile horizontal swipe changes photographs while a single photo remains stable', async t => {
  const { page } = await fixture(t, { width:390 })
  await page.goto(baseUrl + '/produto/31')
  await openPhoto(page)
  await dragStage(page, { dx:-110 })
  await assertPhoto(page, photos[1])
  await dragStage(page, { dx:110 })
  await assertPhoto(page, photos[0])
  await page.keyboard.press('Escape')
  await page.goto(baseUrl + '/produto/32')
  await openPhoto(page, 'Outra peça da galeria')
  await assertPhoto(page, photos[2])
  for (const name of ['Foto anterior', 'Próxima foto']) {
    const button = viewer(page).getByRole('button', { name, exact:true })
    assert.ok(await button.count() === 0 || await button.isDisabled(), 'uma foto só não deve oferecer navegação ativa')
  }
  await dragStage(page, { dx:-110 })
  await page.keyboard.press('ArrowRight')
  await assertPhoto(page, photos[2])
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')
})

test('mixed video gallery preserves playback controls and enlarges only the selected photographs', async t => {
  const { page } = await fixture(t, { product:{
    video:videoUrl,
    media:[{ id:11, media_type:'image', url:photos[0] }, { id:12, media_type:'video', url:videoUrl }, { id:13, media_type:'image', url:photos[1] }]
  } })
  await page.goto(baseUrl + '/produto/31')
  await page.getByRole('button', { name:'Ver vídeo 2', exact:true }).click()
  const video = page.locator('.product-main-media video')
  await video.waitFor({ state:'visible' })
  assert.equal(await video.getAttribute('src'), videoUrl)
  assert.equal(await video.evaluate(node => node.controls), true)
  assert.equal(await opener(page).count(), 0, 'o vídeo não deve ser apresentado como foto ampliável')
  assert.equal(await viewer(page).isVisible(), false)
  await page.getByRole('button', { name:'Ver foto 3', exact:true }).click()
  await openPhoto(page)
  await assertPhoto(page, photos[1])
  assert.equal(await viewer(page).locator('video').count(), 0)
  await viewer(page).getByRole('button', { name:'Foto anterior', exact:true }).click()
  await assertPhoto(page, photos[0])
  await viewer(page).getByRole('button', { name:'Fechar galeria', exact:true }).click()
})

test('a product without a cover starts on its first photograph even when a video was uploaded first', async t => {
  const { page } = await fixture(t, { product:{
    image:'', video:videoUrl,
    media:[{ id:12, media_type:'video', url:videoUrl }, { id:13, media_type:'image', url:photos[1] }, { id:14, media_type:'image', url:photos[2] }]
  } })
  await page.goto(baseUrl + '/produto/31')
  await opener(page).waitFor()
  assert.equal(await page.locator('.product-main-media img').getAttribute('src'), photos[1])
  await openPhoto(page)
  await assertPhoto(page, photos[1])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name:'Ver vídeo 1', exact:true }).click()
  assert.equal(await page.locator('.product-main-media video').evaluate(video => video.controls), true)
  assert.equal(await opener(page).count(), 0)
})

test('a failed product image does not trap the customer inside the photo viewer', async t => {
  const { page } = await fixture(t, { width:390, failedImages:[photos[0]] })
  await page.goto(baseUrl + '/produto/31')
  await page.locator('.product-main-media').getByRole('status').waitFor({ state:'visible' })
  await openPhoto(page)
  await viewer(page).getByRole('status').waitFor({ state:'visible' })
  assert.match(await viewer(page).getByRole('status').textContent(), /Não foi possível carregar esta foto/)
  await viewer(page).getByRole('button', { name:'Próxima foto', exact:true }).click()
  await assertPhoto(page, photos[1])
  await viewer(page).getByRole('status').waitFor({ state:'hidden' })
  assert.equal(await viewerImage(page).evaluate(image => image.complete && image.naturalWidth > 0), true)
  await viewer(page).getByRole('button', { name:'Foto anterior', exact:true }).click()
  await viewer(page).getByRole('status').waitFor({ state:'visible' })
  await page.keyboard.press('Escape')
  await viewer(page).waitFor({ state:'hidden' })
  assert.equal(await opener(page).evaluate(button => button === document.activeElement), true)
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')
})

test('product changes and route unmount close the viewer and release scroll locking', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/shop')
  await page.locator('a.product-card[href="/produto/31"]').click()
  await page.evaluate(() => { document.body.style.overflow = 'auto' })
  await openPhoto(page)
  await page.goBack()
  await page.waitForURL('**/shop')
  await page.waitForFunction(() => !document.querySelector('dialog.product-lightbox[open]') && document.body.style.overflow === 'auto')
  await page.locator('a.product-card[href="/produto/31"]').click()
  await openPhoto(page)
  await page.evaluate(() => {
    history.pushState({}, '', '/produto/32')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await opener(page, 'Outra peça da galeria').waitFor()
  await page.waitForFunction(() => !document.querySelector('dialog.product-lightbox[open]') && document.body.style.overflow === 'auto')
  await openPhoto(page, 'Outra peça da galeria')
  await assertPhoto(page, photos[2])
  await page.keyboard.press('Escape')
  assert.equal(await opener(page, 'Outra peça da galeria').evaluate(button => button === document.activeElement), true)
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'auto')
})

test('reduced motion keeps zoom and photo navigation usable without ongoing movement', async t => {
  const { page } = await fixture(t, { width:390, reducedMotion:'no-preference' })
  await page.goto(baseUrl + '/produto/31')
  await openPhoto(page)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await viewer(page).getByRole('button', { name:'Zoom 2x', exact:true }).click()
  await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.product-lightbox-transform')).transform).a > 1.95)
  const state = await viewer(page).locator('.product-lightbox-transform').evaluate(async node => {
    const style = getComputedStyle(node)
    const first = style.transform
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return { transition:style.transitionDuration.split(',').map(value => Number.parseFloat(value)), first, last:getComputedStyle(node).transform }
  })
  assert.ok(state.transition.every(duration => duration <= 0.02), 'movimento reduzido não deve manter transições longas na foto')
  assert.equal(state.first, state.last, 'a foto deve ficar estável sem interação')
  await viewer(page).getByRole('button', { name:'Próxima foto', exact:true }).click()
  await assertPhoto(page, photos[1])
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')
})
