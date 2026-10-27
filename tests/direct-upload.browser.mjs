import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'

// Run against Vite with VITE_DIRECT_UPLOADS=true. All uploads and API writes are
// intercepted browser fixtures: neither a database nor Cloudinary is contacted.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5174'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Os testes exigem HTTP loopback; produção é recusada.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

async function fixture(t) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const apiCalls = [], providerCalls = [], errors = [], unexpected = [], productMedia = []
  const items = [{ id: 91, title: 'Original de teste', media_type: 'image', ai_status: 'none', use_ai: false, public_id: 'galeo-store/library/original', url: 'https://res.cloudinary.com/fixture/image/upload/original.jpg' }]
  const product = { id: 31, name: 'Camiseta de teste', brand: 'GALEO', category: 'Camisetas', category_id: 301, price: 89.9, cost: 30, stock: 2, min_stock: 0, active: 1, image: '', video: '', description: '' }
  let sequence = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://res.cloudinary.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ad9872"/></svg>' }))
  await page.route('https://api.cloudinary.com/**', async route => {
    const req = route.request(), body = req.postDataBuffer()
    providerCalls.push({ size: body?.length, headers: req.headers() })
    assert.equal(req.headers()['x-csrf-token'], undefined)
    assert.ok(body.length > 8 * 1024 * 1024, 'real file bytes must travel to the provider')
    const text = body.toString('latin1'), nonce = text.match(/name="public_id"\r\n\r\n([^\r]+)/)?.[1]
    assert.ok(nonce)
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ public_id: 'galeo-store/library/' + nonce, version: 1, signature: 'confirmation-' + nonce }) })
  })
  await page.route('**/api/**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname, method = req.method()
    const raw = req.postData() || '', body = req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null
    apiCalls.push({ pathname, method, body, bytes: Buffer.byteLength(raw), headers: req.headers() })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (pathname === '/api/auth/me') return json({ success: true, user: { id: 1, role: 'owner', email: 'owner@example.invalid' }, csrfToken: 'fixture-csrf' })
    if (pathname === '/api/customer/me') return json({ authenticated: false }, 401)
    if (pathname === '/api/store') return json({ products: [product], categories: [{ id: 301, name: 'Camisetas' }] })
    if (pathname === '/api/store/categories') return json([{ id:301, name:'Camisetas' }])
    if (pathname === '/api/store/home') return json({ sections: [] })
    if (pathname === '/api/store/home/settings') return json({ settings: [] })
    if (pathname === '/api/admin/dashboard') return json({ products: { count: 1, stock: 2, low_stock: 0 }, stock: {}, sales: {} })
    if (pathname === '/api/admin/products' && method === 'GET') return json([product])
    if (pathname === '/api/admin/media-library-preferences') return json({ auto_prepare: false })
    if (pathname === '/api/admin/media-library' && method === 'GET') return json({ items, total: items.length })
    if (pathname === '/api/admin/products/31/media' && method === 'GET') return json(productMedia)
    if (pathname === '/api/admin/media-upload/sign' && method === 'POST') {
      assert.equal(req.headers()['x-csrf-token'], 'fixture-csrf')
      assert.ok(raw.length < 2000)
      assert.equal(body.files[0].size, 8 * 1024 * 1024)
      return json({ uploads: body.files.map(() => ({ ticket: 'ticket-' + (++sequence), upload_url: 'https://api.cloudinary.com/v1_1/fixture/image/upload', api_key: 'public-key', signature: 'test-signature', params: { timestamp: 1, folder: 'galeo-store/library', public_id: 'nonce-' + sequence, overwrite: false } })) })
    }
    if ((pathname === '/api/admin/media-library' || pathname === '/api/admin/media-library/91/replacement' || pathname === '/api/admin/products/31/media') && method === 'POST') {
      assert.equal(req.headers()['x-csrf-token'], 'fixture-csrf')
      assert.ok(raw.length < 2000)
      const uploaded = body.uploads[0]
      const item = { id: 100 + sequence, title: 'Upload ' + sequence, media_type: 'image', ai_status: 'none', use_ai: false, public_id: uploaded.public_id, url: 'https://res.cloudinary.com/fixture/image/upload/nonce-' + sequence + '.jpg' }
      if (pathname === '/api/admin/products/31/media') { productMedia.push({ ...item, product_id: 31 }); return json({ success: true, media: productMedia }) }
      items.push(item)
      return json(pathname.endsWith('/replacement') ? { success: true, item, message: 'Nova versão salva separadamente.' } : { success: true, items: [item] })
    }
    if (method === 'GET' && ['/api/admin/finance/entries', '/api/admin/finance/categories', '/api/admin/finance/accounts', '/api/admin/finance/recurring', '/api/admin/stock/movements', '/api/admin/sales', '/api/admin/store-orders'].includes(pathname)) return json([])
    unexpected.push({ pathname, method })
    return json({ error: 'Unexpected fixture API' }, 500)
  })
  return { page, apiCalls, providerCalls, errors, unexpected, productMedia }
}

const file = { name: 'foto-8mb.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(8 * 1024 * 1024, 1) }
test('the library and replacement UI send real 8 MB files directly and confirm with small CSRF-protected JSON', async t => {
  const f = await fixture(t), { page } = f
  await page.goto(baseUrl + '/admin?tab=library')
  await page.getByLabel('Enviar fotos ou vídeos à biblioteca').setInputFiles(file)
  await page.getByText('Mídia enviada para a biblioteca.', { exact: true }).waitFor()
  assert.equal(f.providerCalls.length, 1)
  await page.getByRole('button', { name: 'Editar mídia: Original de teste', exact: true }).click()
  await page.getByTestId('media-management').locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: 'Enviar nova versão', exact: true }).click()
  await page.getByText('Nova versão salva separadamente.', { exact: true }).waitFor()
  assert.equal(f.providerCalls.length, 2)
  const signs = f.apiCalls.filter(call => call.pathname.endsWith('/sign'))
  assert.deepEqual(signs.map(call => call.body.purpose), ['library', 'replacement'])
  assert.equal(signs[1].body.target_id, 91)
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.unexpected, [])
})

test('the product UI keeps its gallery and queue while uploading directly to Cloudinary', async t => {
  const f = await fixture(t), { page } = f
  await page.goto(baseUrl + '/admin?tab=products')
  await page.getByRole('button', { name: 'Editar', exact: true }).first().click()
  const modal = page.getByRole('dialog', { name: 'Editar produto' })
  await modal.locator('input[type=file]').first().setInputFiles(file)
  await modal.getByRole('button', { name: 'Enviar 1 arquivo(s) agora ↗', exact: true }).click()
  await modal.getByText('Nenhuma mídia enviada ainda.', { exact: true }).waitFor({ state: 'hidden' })
  await modal.locator('.media-gallery img').waitFor()
  assert.equal(f.providerCalls.length, 1)
  assert.equal(f.productMedia.length, 1)
  const signed = f.apiCalls.find(call => call.pathname.endsWith('/sign'))
  assert.equal(signed.body.purpose, 'product')
  assert.equal(signed.body.target_id, 31)
  assert.equal(await modal.getByText('1 foto(s) na fila', { exact: true }).count(), 0)
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.unexpected, [])
})
