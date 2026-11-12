// Promo video (model), vertical 1080×1920 and horizontal 1920×1080, built frame
// by frame: the 3D medallion (tools/video/medallion.html), the store on a phone
// and the brand messages (tools/video/promo.html). Usage (Vite on :5173):
//   node tools/video/promo.mjs <output folder>
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDemoApi, images, imageUrl } from './demo-store.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const out = process.argv[2]
if (!out) throw new Error('Informe a pasta de saída.')
const base = 'http://127.0.0.1:5173'
const dir = join(out, 'promo')
const FPS = 30, SECONDS = 26, INTRO = 120, SWAY = 60
const easeOut = t => 1 - Math.pow(1 - t, 3)
mkdirSync(join(dir, 'medallion'), { recursive: true })
mkdirSync(join(dir, 'screens'), { recursive: true })

async function demoContext(browser, options) {
  const context = await browser.newContext(options)
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : getContext.call(this, type, ...rest) }
  })
  const api = createDemoApi({ motion: false })
  await context.route('**/video-demo/*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: images[new URL(route.request().url()).pathname.split('/').pop().replace('.svg', '')] || images['101'] }))
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    let body = null
    try { body = request.postDataJSON() } catch {}
    const result = await api.handle({ path: url.pathname, method: request.method(), body })
    return route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result.data ?? {}) })
  })
  return context
}

// 1. The 3D medallion: a spin that settles on the brand pose, then a slow sway.
if (!process.env.SKIP_MEDALLION) {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
  await page.goto(base + '/tools/video/medallion.html')
  await page.waitForFunction(() => window.medallionReady === true)
  await page.evaluate(() => window.setupMedallion({ width: 1080, height: 1080, includeName: true }))
  const poses = [
    ...Array.from({ length: INTRO }, (_, i) => { const k = easeOut(i / (INTRO - 1)); return { x: 0.35 - 0.3 * k, y: -2.9 + 2.6 * k, zoom: 0.94 + 0.06 * k } }),
    ...Array.from({ length: SWAY }, (_, i) => { const a = (i / SWAY) * Math.PI * 2; return { x: 0.05 + 0.05 * Math.sin(a), y: -0.3 + 0.2 * Math.sin(a), zoom: 1 } })
  ]
  for (const [index, pose] of poses.entries()) {
    const url = await page.evaluate(pose => window.renderMedallion(pose), pose)
    writeFileSync(join(dir, 'medallion', String(index).padStart(3, '0') + '.png'), Buffer.from(url.split(',')[1], 'base64'))
    if (index % 30 === 0) console.log('medalha', index, '/', poses.length)
  }
  await browser.close()
}

// 2. The store on a phone: Home, product with size, cart and Pix.
const taps = {}
const screens = {}
if (!process.env.SKIP_SCREENS) {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--hide-scrollbars'] })
  const context = await demoContext(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const shot = async (name, full = false) => {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(dir, 'screens', name + '.png'), fullPage: full })
  }
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await shot('home', true)
  await page.goto(base + '/produto/101', { waitUntil: 'networkidle' })
  const size = page.locator('.product-size-option').nth(1)
  await size.click()
  const add = page.getByRole('button', { name: /Adicionar ao carrinho/ }).first()
  const sizeBox = await size.boundingBox(), addBox = await add.boundingBox()
  await shot('product')
  await add.click()
  await page.waitForTimeout(500)
  await page.goto(base + '/carrinho', { waitUntil: 'networkidle' })
  await page.locator('#shipping-postal-code').fill('01310100')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Calcular frete', exact: true }).click()
  await page.waitForTimeout(800)
  await page.locator('.shipping-option').nth(1).click().catch(() => {})
  await shot('cart', true)
  await page.goto(base + '/pagamento/504', { waitUntil: 'networkidle' })
  await page.getByLabel('CPF do comprador').fill('123.456.789-09').catch(() => {})
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click().catch(() => {})
  await page.waitForTimeout(900)
  await shot('pix')
  Object.assign(taps, { size: sizeBox && { x: (sizeBox.x + sizeBox.width / 2) * 3, y: (sizeBox.y + sizeBox.height / 2) * 3 }, add: addBox && { x: (addBox.x + addBox.width / 2) * 3, y: (addBox.y + addBox.height / 2) * 3 } })
  writeFileSync(join(dir, 'taps.json'), JSON.stringify(taps))
  await browser.close()
} else Object.assign(taps, JSON.parse(readFileSync(join(dir, 'taps.json'), 'utf8')))

const pngSize = file => { const data = readFileSync(file); return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } }
for (const name of ['home', 'product', 'cart', 'pix']) screens[name] = { src: '/promo-assets/screens/' + name + '.png', ...pngSize(join(dir, 'screens', name + '.png')) }

// 3. The two formats, frame by frame.
for (const [format, width, height] of [['v', 1080, 1920], ['h', 1920, 1080]]) {
  const frames = join(dir, 'frames-' + format)
  rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames, { recursive: true })
  const browser = await chromium.launch({ args: ['--no-sandbox', '--hide-scrollbars'] })
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  await context.route('**/promo-assets/**', route => {
    const file = join(dir, decodeURIComponent(new URL(route.request().url()).pathname.replace('/promo-assets/', '')))
    return route.fulfill({ contentType: file.endsWith('.png') ? 'image/png' : 'application/octet-stream', body: readFileSync(file) })
  })
  await context.route('**/video-demo/*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: images[new URL(route.request().url()).pathname.split('/').pop().replace('.svg', '')] }))
  const page = await context.newPage()
  await page.goto(base + '/tools/video/promo.html')
  await page.evaluate(config => window.setupPromo(config), {
    format, introFrames: INTRO, taps,
    medallionFrames: Array.from({ length: INTRO + SWAY }, (_, i) => '/promo-assets/medallion/' + String(i).padStart(3, '0') + '.png'),
    garments: [imageUrl(101), imageUrl(103), imageUrl(104)],
    screens
  })
  const cdp = await context.newCDPSession(page)
  for (let frame = 0; frame < FPS * SECONDS; frame++) {
    await page.evaluate(t => window.setTime(t), frame / FPS)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
    writeFileSync(join(frames, String(frame).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64'))
    if (frame % 150 === 0) console.log(format, 'quadro', frame)
  }
  await browser.close()
  const file = join(out, format === 'v' ? 'galeo-divulgacao-vertical.mp4' : 'galeo-divulgacao-horizontal.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file])
  console.log('ok', file)
}
