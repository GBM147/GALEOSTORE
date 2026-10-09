import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { MediaApprovalRuntime } from './helpers/media-approval-runtime.mjs'

const runtime = new MediaApprovalRuntime()
before(async () => { await runtime.initialize() })
after(async () => { await runtime.close() })

async function storedAsset(id) { return (await runtime.query('SELECT * FROM media_assets WHERE id=?', [id]))[0] }
async function storedProduct(id) { return (await runtime.query('SELECT * FROM products WHERE id=?', [id]))[0] }
async function publicProduct(id) {
  const response = await runtime.client().request('/api/store/products/' + id)
  assert.equal(response.status, 200)
  return response.data.product
}
async function auditCount() { return Number((await runtime.query('SELECT COUNT(*) AS total FROM audit_logs WHERE user_id=?', [runtime.ownerId]))[0].total) }

test('library and product mutations require a real OWNER session and CSRF token', async () => {
  const asset = await runtime.asset()
  assert.equal((await runtime.client().request('/api/admin/media-library')).status, 401)
  const deniedProduct = await runtime.owner.request('/api/admin/products', {
    method: 'POST', csrf: false, body: runtime.productBody('csrf-denied', { image_asset_id: asset.id, image_variant: 'ai' })
  })
  assert.equal(deniedProduct.status, 403)
  assert.match(deniedProduct.data.error, /CSRF/)
  assert.deepEqual(await runtime.query('SELECT id FROM products WHERE name=?', [runtime.prefix + 'csrf-denied']), [])
  const before = await storedAsset(asset.id)
  const deniedVersion = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'PATCH', csrf: false, body: { use_ai: true } })
  assert.equal(deniedVersion.status, 403)
  assert.deepEqual(await storedAsset(asset.id), before)
  const accepted = await runtime.owner.request('/api/admin/media-library')
  assert.equal(accepted.status, 200)
  assert.ok(accepted.data.items.some(item => item.id === asset.id))
})

test('creating an original product cover ignores the library AI default and the submitted manual URL', async () => {
  const asset = await runtime.asset({ use_ai: true })
  const before = await storedAsset(asset.id)
  const product = await runtime.createProduct('original-cover', {
    image_asset_id: asset.id, image_variant: 'original', image: 'https://example.invalid/ignored-manual.png'
  })
  assert.equal(product.image, asset.originalUrl)
  assert.equal(product.image_asset_id, undefined)
  assert.equal(product.image_variant, undefined)
  const publicItem = await publicProduct(product.id)
  assert.equal(publicItem.image, asset.originalUrl)
  assert.equal(publicItem.cost, undefined)
  assert.deepEqual(await storedAsset(asset.id), before, 'choosing a product cover must never approve or alter the shared library asset')
})

test('creating an AI product cover works while the shared library still uses the original', async () => {
  const asset = await runtime.asset({ use_ai: false })
  const before = await storedAsset(asset.id)
  const product = await runtime.createProduct('ai-cover', { image_asset_id: String(asset.id), image_variant: 'ai' })
  assert.equal(product.image, asset.aiUrl)
  assert.equal((await publicProduct(product.id)).image, asset.aiUrl)
  const listed = await runtime.owner.request('/api/admin/media-library')
  const item = listed.data.items.find(item => item.id === asset.id)
  assert.equal(item.use_ai, false)
  assert.equal(item.url, asset.originalUrl)
  assert.deepEqual(await storedAsset(asset.id), before)
})

test('editing the cover preserves the gallery and snapshots remain stable when the library choice changes', async () => {
  const asset = await runtime.asset({ use_ai: false })
  const product = await runtime.createProduct('gallery-preserved', { image: 'https://example.invalid/old-cover.png' })
  const gallery = await runtime.gallery(product.id)
  const changed = await runtime.owner.request('/api/admin/products/' + product.id, {
    method: 'PUT', body: { ...product.requestBody, image_asset_id: asset.id, image_variant: 'ai', image: 'https://example.invalid/ignored-cover.png' }
  })
  assert.equal(changed.status, 200)
  assert.equal(changed.data.image, asset.aiUrl)
  assert.equal((await storedAsset(asset.id)).use_ai, 0)
  assert.deepEqual(await runtime.query('SELECT * FROM product_media WHERE product_id=?', [product.id]), [gallery])
  let detail = await publicProduct(product.id)
  assert.equal(detail.image, asset.aiUrl)
  assert.equal(detail.media[0].url, gallery.url)
  assert.equal(detail.media[0].sort_order, 7)
  const catalog = await runtime.client().request('/api/store')
  assert.equal(catalog.status, 200)
  assert.equal(catalog.data.products.find(item => item.id === product.id).image, asset.aiUrl)
  for (const use_ai of [true, false]) {
    assert.equal((await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'PATCH', body: { use_ai } })).status, 200)
    assert.equal((await publicProduct(product.id)).image, asset.aiUrl)
  }
  await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'PATCH', body: { use_ai: true } })
  const original = await runtime.owner.request('/api/admin/products/' + product.id, {
    method: 'PUT', body: { ...product.requestBody, image_asset_id: asset.id, image_variant: 'original' }
  })
  assert.equal(original.status, 200)
  assert.equal(original.data.image, asset.originalUrl)
  detail = await publicProduct(product.id)
  assert.equal(detail.image, asset.originalUrl)
  assert.equal(detail.media[0].url, gallery.url)
  assert.equal((await storedAsset(asset.id)).use_ai, 1)
  assert.deepEqual(await runtime.query('SELECT * FROM product_media WHERE product_id=?', [product.id]), [gallery])
})

test('legacy manual image URLs still work when no library selector is supplied', async () => {
  const product = await runtime.createProduct('manual-cover', { image: 'https://example.invalid/manual-original.png' })
  const gallery = await runtime.gallery(product.id)
  assert.equal((await publicProduct(product.id)).image, 'https://example.invalid/manual-original.png')
  const updated = await runtime.owner.request('/api/admin/products/' + product.id, {
    method: 'PUT', body: { ...product.requestBody, image: 'https://example.invalid/manual-updated.png' }
  })
  assert.equal(updated.status, 200)
  assert.equal((await publicProduct(product.id)).image, 'https://example.invalid/manual-updated.png')
  assert.deepEqual(await runtime.query('SELECT * FROM product_media WHERE product_id=?', [product.id]), [gallery])
})

test('invalid IDs, variants, missing assets, videos and unfinished AI refuse creation without partial writes', async () => {
  const ready = await runtime.asset()
  const pending = await runtime.asset({ ai_status: 'processing' })
  const noAiUrl = await runtime.asset({ ai_url: null })
  const video = await runtime.asset({ media_type: 'video' })
  const cases = [
    [{ image_asset_id: 0, image_variant: 'original' }, 400],
    [{ image_asset_id: -1, image_variant: 'original' }, 400],
    [{ image_asset_id: 1.2, image_variant: 'original' }, 400],
    [{ image_asset_id: true, image_variant: 'original' }, 400],
    [{ image_asset_id: 'invalid', image_variant: 'original' }, 400],
    [{ image_asset_id: ready.id, image_variant: 'unknown' }, 400],
    [{ image_asset_id: ready.id }, 400],
    [{ image_asset_id: 2147483647, image_variant: 'original' }, 404],
    [{ image_asset_id: video.id, image_variant: 'original' }, 400],
    [{ image_asset_id: pending.id, image_variant: 'ai' }, 409],
    [{ image_asset_id: noAiUrl.id, image_variant: 'ai' }, 409]
  ]
  const beforeProducts = await runtime.query('SELECT id FROM products WHERE name LIKE ? ORDER BY id', [runtime.prefix + '%'])
  const beforeAudit = await auditCount()
  for (const [choice, status] of cases) {
    const response = await runtime.owner.request('/api/admin/products', { method: 'POST', body: runtime.productBody('invalid-create', choice) })
    assert.equal(response.status, status)
    assert.ok(response.data.error)
  }
  assert.deepEqual(await runtime.query('SELECT id FROM products WHERE name LIKE ? ORDER BY id', [runtime.prefix + '%']), beforeProducts)
  assert.equal(await auditCount(), beforeAudit)
})

test('an invalid cover update rolls back product fields, inventory, gallery and audit', async () => {
  const pending = await runtime.asset({ ai_status: 'processing' })
  const product = await runtime.createProduct('rollback-update', { image: 'https://example.invalid/before-invalid-update.png' })
  const gallery = await runtime.gallery(product.id)
  const beforeProduct = await storedProduct(product.id)
  const beforeStock = await runtime.query('SELECT * FROM stock_movements WHERE product_id=? ORDER BY id', [product.id])
  const beforeAudit = await auditCount()
  for (const [image_asset_id, image_variant, status] of [[pending.id, 'ai', 409], [2147483647, 'original', 404], [pending.id, 'unknown', 400]]) {
    const response = await runtime.owner.request('/api/admin/products/' + product.id, {
      method: 'PUT', body: { ...product.requestBody, name: runtime.prefix + 'unauthorized-partial-change', stock: 8, image_asset_id, image_variant }
    })
    assert.equal(response.status, status)
    assert.deepEqual(await storedProduct(product.id), beforeProduct)
    assert.deepEqual(await runtime.query('SELECT * FROM stock_movements WHERE product_id=? ORDER BY id', [product.id]), beforeStock)
    assert.deepEqual(await runtime.query('SELECT * FROM product_media WHERE product_id=?', [product.id]), [gallery])
    assert.equal(await auditCount(), beforeAudit)
  }
})

test('global library approval is explicit, reversible and never replaces the original', async () => {
  const asset = await runtime.asset({ use_ai: false })
  const approved = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'PATCH', body: { use_ai: true } })
  assert.equal(approved.status, 200)
  assert.equal(approved.data.item.use_ai, true)
  assert.equal(approved.data.item.url, asset.aiUrl)
  assert.equal(approved.data.item.original_url, asset.originalUrl)
  const renamed = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'PATCH', body: { title: 'Título escolhido' } })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.data.item.use_ai, true)
  const original = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'PATCH', body: { use_ai: false } })
  assert.equal(original.status, 200)
  assert.equal(original.data.item.use_ai, false)
  assert.equal(original.data.item.url, asset.originalUrl)
  assert.equal(original.data.item.ai_url, asset.aiUrl)
  assert.equal(original.data.item.title, 'Título escolhido')
  const stored = await storedAsset(asset.id)
  assert.equal(stored.url, asset.originalUrl)
  assert.equal(stored.ai_url, asset.aiUrl)
})

test('string or numeric approval values, pending AI and video approval cannot mutate the library', async () => {
  const ready = await runtime.asset({ use_ai: false })
  const pending = await runtime.asset({ ai_status: 'processing' })
  const video = await runtime.asset({ media_type: 'video' })
  const before = await storedAsset(ready.id)
  const beforeAudit = await auditCount()
  for (const use_ai of ['false', 'true', 0, 1, null, {}]) {
    const response = await runtime.owner.request('/api/admin/media-library/' + ready.id, { method: 'PATCH', body: { use_ai, title: 'Must not be saved' } })
    assert.equal(response.status, 400)
    assert.deepEqual(await storedAsset(ready.id), before)
  }
  for (const [asset, status] of [[pending, 409], [video, 400]]) {
    const saved = await storedAsset(asset.id)
    const response = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'PATCH', body: { use_ai: true } })
    assert.equal(response.status, status)
    assert.deepEqual(await storedAsset(asset.id), saved)
  }
  assert.equal(await auditCount(), beforeAudit)
})

test('reusing ready AI previews never activates them, edits the original or calls a provider', async () => {
  for (const use_ai of [false, true]) {
    const asset = await runtime.asset({ use_ai })
    const before = await storedAsset(asset.id)
    const beforeAudit = await auditCount()
    const response = await runtime.owner.request('/api/admin/media-library/' + asset.id + '/ai-background', { method: 'POST', body: {} })
    assert.equal(response.status, 200)
    assert.equal(response.data.reused, true)
    assert.equal(response.data.item.use_ai, use_ai)
    assert.equal(response.data.item.url, use_ai ? asset.aiUrl : asset.originalUrl)
    assert.equal(response.data.item.original_url, asset.originalUrl)
    assert.deepEqual(await storedAsset(asset.id), before)
    assert.equal(await auditCount(), beforeAudit)
  }
  assert.deepEqual(await runtime.providerAttempts(), [], 'no email, media transformation, media fetch or deletion may reach an external provider')
})
