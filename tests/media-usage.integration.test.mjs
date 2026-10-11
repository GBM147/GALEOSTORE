import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProductImage } from '../server/product-image-selection.js'
import { MediaApprovalRuntime } from './helpers/media-approval-runtime.mjs'

const runtime = new MediaApprovalRuntime()
const sections = new Set(), settings = new Set()
let homeBefore, settingsBefore

before(async () => {
  await runtime.initialize()
  homeBefore = await runtime.query('SELECT * FROM home_sections ORDER BY id')
  settingsBefore = await runtime.query('SELECT * FROM home_settings ORDER BY setting_key')
})
after(async () => {
  await runtime.stopApi()
  try {
    if (runtime.db && sections.size) await runtime.query('DELETE FROM home_sections WHERE id IN (' + [...sections].map(() => '?').join(',') + ')', [...sections])
    if (runtime.db && settings.size) await runtime.query('DELETE FROM home_settings WHERE setting_key IN (' + [...settings].map(() => '?').join(',') + ')', [...settings])
    if (homeBefore) assert.deepEqual(await runtime.query('SELECT * FROM home_sections ORDER BY id'), homeBefore, 'default Home sections must remain unchanged')
    if (settingsBefore) assert.deepEqual(await runtime.query('SELECT * FROM home_settings ORDER BY setting_key'), settingsBefore, 'default Home settings must remain unchanged')
  } finally {
    await runtime.close()
  }
})

async function usage(asset) {
  const response = await runtime.owner.request('/api/admin/media-library/' + asset.id + '/usage')
  assert.equal(response.status, 200)
  assert.equal(typeof response.data.in_use, 'boolean')
  assert.ok(Array.isArray(response.data.references))
  return response.data
}
async function rawAsset(asset) { return (await runtime.query('SELECT * FROM media_assets WHERE id=?', [asset.id]))[0] }
async function assetPublicId(asset) { return (await rawAsset(asset)).public_id }

async function assertBlocked(asset, expected) {
  const before = await rawAsset(asset)
  const references = expected || await usage(asset)
  assert.equal(references.in_use, true)
  const response = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'DELETE' })
  assert.equal(response.status, 409)
  assert.equal(response.data.code, 'MEDIA_IN_USE')
  assert.equal(response.data.in_use, true)
  assert.deepEqual(response.data.references, references.references)
  assert.deepEqual(await rawAsset(asset), before, 'a refused deletion must preserve the complete original and AI asset row')
  assert.deepEqual(await runtime.providerAttempts(), [], 'in-use media must never reach an external provider')
}

async function homeSection({ draft = {}, published = {}, visible = false, type = 'campaigns' } = {}) {
  const key = 'media_usage_' + runtime.suffix + '_' + sections.size
  const inserted = await runtime.query(
    'INSERT INTO home_sections(section_key,section_type,sort_order,visible,published_sort_order,published_visible,draft_content,published_content,updated_by,published_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [key, type, 9990 + sections.size, visible ? 1 : 0, 9990 + sections.size, visible ? 1 : 0, JSON.stringify(draft), JSON.stringify(published), runtime.ownerId, runtime.ownerId]
  )
  sections.add(inserted.insertId)
  return { id: inserted.insertId, key }
}
async function homeSetting({ draft = {}, published = {} } = {}) {
  const key = 'media_usage_' + runtime.suffix + '_' + settings.size
  await runtime.query('INSERT INTO home_settings(setting_key,setting_value,draft_value,updated_by) VALUES(?,?,?,?)', [key, JSON.stringify(published), JSON.stringify(draft), runtime.ownerId])
  settings.add(key)
  return key
}
function referencesFor(result, type, id) { return result.references.filter(reference => reference.type === type && String(reference.id) === String(id)) }
const waitForLock = () => new Promise(resolve => setTimeout(resolve, 100))

test('usage requires OWNER authentication and deletion requires its real CSRF token', async () => {
  const asset = await runtime.asset()
  assert.equal((await runtime.client().request('/api/admin/media-library/' + asset.id + '/usage')).status, 401)
  const before = await rawAsset(asset)
  const csrf = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'DELETE', csrf: false })
  assert.equal(csrf.status, 403)
  assert.match(csrf.data.error, /CSRF/)
  assert.deepEqual(await rawAsset(asset), before)
  await runtime.query("UPDATE admin_users SET role='staff' WHERE id=?", [runtime.ownerId])
  try {
    const denied = await runtime.owner.request('/api/admin/media-library/' + asset.id + '/usage')
    assert.equal(denied.status, 403)
    assert.equal(denied.data.code, 'ADMIN_OWNER_REQUIRED')
    assert.deepEqual(await rawAsset(asset), before)
  } finally {
    await runtime.query("UPDATE admin_users SET role='owner' WHERE id=?", [runtime.ownerId])
    runtime.owner = runtime.client()
    assert.equal((await runtime.owner.request('/api/auth/login', { method: 'POST', body: { email: runtime.email, password: runtime.password } })).status, 200)
  }
})

test('original and AI product covers are reported even when a product is inactive', async () => {
  const asset = await runtime.asset()
  const original = await runtime.createProduct('usage-original', { image: asset.originalUrl })
  const ai = await runtime.createProduct('usage-ai-inactive', { image: asset.aiUrl })
  await runtime.query('UPDATE products SET active=0 WHERE id=?', [ai.id])
  const result = await usage(asset)
  assert.equal(result.in_use, true)
  const originalRef = referencesFor(result, 'product', original.id)
  const aiRef = referencesFor(result, 'product', ai.id)
  assert.equal(originalRef.length, 1)
  assert.equal(aiRef.length, 1)
  assert.equal(originalRef[0].name, original.name)
  assert.equal(originalRef[0].active, true)
  assert.equal(aiRef[0].active, false)
  assert.ok(originalRef[0].fields.includes('image'))
  assert.ok(aiRef[0].fields.includes('image'))
  assert.equal((await runtime.client().request('/api/store/products/' + ai.id)).status, 404)
  await assertBlocked(asset, result)
})

test('video references in products are protected independently of image covers', async () => {
  const asset = await runtime.asset({ media_type: 'video', ai_status: 'none', ai_url: null, url: 'https://example.invalid/video-' + runtime.suffix + '.mp4' })
  const product = await runtime.createProduct('usage-video', { video: asset.originalUrl })
  const result = await usage(asset)
  const reference = referencesFor(result, 'product', product.id)
  assert.equal(reference.length, 1)
  assert.ok(reference[0].fields.includes('video'))
  await assertBlocked(asset, result)
})

test('gallery media is protected by original URL, AI URL or Cloudinary public_id', async () => {
  const asset = await runtime.asset()
  const publicId = await assetPublicId(asset)
  const product = await runtime.createProduct('usage-gallery')
  const ids = []
  for (const [url, public_id] of [[asset.originalUrl, 'other-original-' + runtime.suffix], [asset.aiUrl, 'other-ai-' + runtime.suffix], ['https://example.invalid/moved-gallery.png', publicId]]) {
    const inserted = await runtime.query('INSERT INTO product_media(product_id,media_type,url,public_id) VALUES(?,?,?,?)', [product.id, 'image', url, public_id])
    ids.push(inserted.insertId)
  }
  const result = await usage(asset)
  for (const id of ids) {
    const reference = referencesFor(result, 'product_media', id)
    assert.equal(reference.length, 1)
    assert.equal(reference[0].product_id, product.id)
  }
  assert.ok(referencesFor(result, 'product_media', ids[0])[0].fields.includes('url'))
  assert.ok(referencesFor(result, 'product_media', ids[1])[0].fields.includes('url'))
  assert.ok(referencesFor(result, 'product_media', ids[2])[0].fields.includes('public_id'))
  const beforeGallery = await runtime.query('SELECT * FROM product_media WHERE product_id=? ORDER BY id', [product.id])
  await assertBlocked(asset, result)
  assert.deepEqual(await runtime.query('SELECT * FROM product_media WHERE product_id=? ORDER BY id', [product.id]), beforeGallery)
})

test('video gallery entries count as usage even without a product video cover', async () => {
  const asset = await runtime.asset({ media_type: 'video', ai_status: 'none', ai_url: null })
  const product = await runtime.createProduct('usage-video-gallery')
  const inserted = await runtime.query('INSERT INTO product_media(product_id,media_type,url,public_id) VALUES(?,?,?,?)', [product.id, 'video', asset.originalUrl, await assetPublicId(asset)])
  const result = await usage(asset)
  assert.equal(referencesFor(result, 'product_media', inserted.insertId).length, 1)
  await assertBlocked(asset, result)
})

test('nested IDs and original/AI URLs in hidden Home drafts and publications are all protected', async () => {
  const asset = await runtime.asset()
  const section = await homeSection({
    draft: { heading: 'Rascunho próprio', blocks: [{ mobile_media_url: asset.aiUrl }, { media: { image_asset_id: asset.id } }] },
    published: { heading: 'Publicado próprio', hero: { desktop_media_id: String(asset.id) }, campaigns: [{ media_url: asset.originalUrl }] }
  })
  const result = await usage(asset)
  const references = referencesFor(result, 'home_section', section.key)
  assert.deepEqual(references.map(reference => reference.state).sort(), ['draft', 'published'])
  assert.ok(references.find(reference => reference.state === 'draft').fields.some(field => field.includes('mobile_media_url')))
  assert.ok(references.find(reference => reference.state === 'published').fields.some(field => field.includes('desktop_media_id')))
  const publicHome = await runtime.client().request('/api/store/home')
  assert.equal(publicHome.data.sections.some(item => item.key === section.key), false)
  await assertBlocked(asset, result)
})

test('video IDs, poster URLs and public IDs inside Home content are protected', async () => {
  const video = await runtime.asset({ media_type: 'video', ai_status: 'none', ai_url: null })
  const poster = await runtime.asset()
  const videoSection = await homeSection({
    draft: { campaigns: [{ video_media_id: video.id }] },
    published: { campaigns: [{ video_media_url: video.originalUrl, video_public_id: await assetPublicId(video) }] }
  })
  const posterSection = await homeSection({ draft: { background: { poster: poster.aiUrl } }, published: { background: { poster_url: poster.originalUrl } } })
  const videoUsage = await usage(video)
  assert.equal(referencesFor(videoUsage, 'home_section', videoSection.key).length, 2)
  await assertBlocked(video, videoUsage)
  const posterUsage = await usage(poster)
  assert.equal(referencesFor(posterUsage, 'home_section', posterSection.key).length, 2)
  await assertBlocked(poster, posterUsage)
})

test('Home settings references are checked in their published and draft JSON', async () => {
  const asset = await runtime.asset()
  const key = await homeSetting({ draft: { banner: { mobile_media_id: asset.id } }, published: { background: { image_url: asset.originalUrl } } })
  const result = await usage(asset)
  const references = referencesFor(result, 'home_setting', key)
  assert.deepEqual(references.map(reference => reference.state).sort(), ['draft', 'published'])
  await assertBlocked(asset, result)
})

test('Cloudinary derivative URLs for the same public ID are recognized without contacting Cloudinary', async () => {
  const asset = await runtime.asset()
  const publicId = await assetPublicId(asset)
  const originalUrl = 'https://res.cloudinary.com/local-usage-fixture/image/upload/v123/' + publicId + '.jpg'
  await runtime.query('UPDATE media_assets SET url=? WHERE id=?', [originalUrl, asset.id])
  const derivativeUrl = 'https://res.cloudinary.com/local-usage-fixture/image/upload/c_fill,w_640,f_auto,q_auto/v124/' + publicId + '.jpg'
  const product = await runtime.createProduct('usage-cloudinary-derivative', { image: derivativeUrl })
  const result = await usage(asset)
  assert.equal(referencesFor(result, 'product', product.id).length, 1)
  await assertBlocked(asset, result)
})

test('mere text, unrelated record IDs and similar URLs do not falsely count as media usage', async () => {
  const asset = await runtime.asset()
  const publicId = await assetPublicId(asset)
  await runtime.createProduct('usage-text-only', { description: asset.originalUrl + ' ' + asset.aiUrl + ' ' + publicId, image: asset.originalUrl + '-different-image' })
  await homeSection({
    draft: { title: asset.originalUrl, description: asset.aiUrl, text: publicId, id: asset.id, product_ids: [asset.id], category_id: asset.id },
    published: { heading: asset.aiUrl, label: publicId, image_url: asset.originalUrl + '-different-image', items: [{ id: asset.id, text: asset.originalUrl }] }
  })
  await homeSetting({ draft: { text: asset.originalUrl, product_ids: [asset.id] }, published: { title: publicId } })
  const result = await usage(asset)
  assert.equal(result.in_use, false)
  assert.deepEqual(result.references, [])
  const before = await rawAsset(asset)
  const deleted = await runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'DELETE' })
  assert.equal(deleted.status, 503, 'an unused real asset must still be preserved if Cloudinary is not configured')
  assert.deepEqual(await rawAsset(asset), before)
  assert.deepEqual(await runtime.providerAttempts(), [])
})

test('missing or invalid media IDs return clear errors without provider activity', async () => {
  assert.equal((await runtime.owner.request('/api/admin/media-library/2147483647/usage')).status, 404)
  assert.equal((await runtime.owner.request('/api/admin/media-library/not-a-number/usage')).status, 400)
  assert.equal((await runtime.owner.request('/api/admin/media-library/0/usage')).status, 400)
  assert.deepEqual(await runtime.providerAttempts(), [])
})

test('when deletion wins the asset lock, product creation waits and refuses the removed asset', async () => {
  const asset = await runtime.asset()
  const connection = await runtime.db.getConnection()
  let request, settled = false
  const name = runtime.prefix + 'concurrent-deletion-wins'
  const auditBefore = Number((await runtime.query('SELECT COUNT(*) AS total FROM audit_logs WHERE user_id=?', [runtime.ownerId]))[0].total)
  try {
    await connection.beginTransaction()
    await connection.execute('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [asset.id])
    request = runtime.owner.request('/api/admin/products', { method: 'POST', body: runtime.productBody('concurrent-deletion-wins', { image_asset_id: asset.id, image_variant: 'original' }) }).then(response => { settled = true; return response })
    await waitForLock()
    assert.equal(settled, false, 'the product API must wait for the media asset writer lock')
    await connection.execute('DELETE FROM media_assets WHERE id=?', [asset.id])
    await connection.commit()
    const response = await request
    assert.equal(response.status, 404)
    assert.deepEqual(await runtime.query('SELECT id FROM products WHERE name=?', [name]), [])
    assert.equal(Number((await runtime.query('SELECT COUNT(*) AS total FROM audit_logs WHERE user_id=?', [runtime.ownerId]))[0].total), auditBefore)
  } finally {
    await connection.rollback().catch(() => {})
    connection.release()
    await request?.catch(() => {})
  }
})

test('a product media share lock makes deletion wait and detect the newly committed product', async () => {
  const asset = await runtime.asset()
  const before = await rawAsset(asset)
  const connection = await runtime.db.getConnection()
  let request, settled = false, productId
  try {
    await connection.beginTransaction()
    const selected = await resolveProductImage({ image_asset_id: asset.id, image_variant: 'original' }, async (statement, values) => {
      const [rows] = await connection.execute(statement, values)
      return rows
    })
    request = runtime.owner.request('/api/admin/media-library/' + asset.id, { method: 'DELETE' }).then(response => { settled = true; return response })
    await waitForLock()
    assert.equal(settled, false, 'deletion must wait for the product media share lock')
    const [inserted] = await connection.execute('INSERT INTO products(name,description,price,cost,stock,image) VALUES(?,?,?,?,?,?)', [runtime.prefix + 'concurrent-product-wins', 'Produto próprio para corrida de locks', 50, 10, 3, selected])
    productId = inserted.insertId
    runtime.products.add(productId)
    await connection.commit()
    const response = await request
    assert.equal(response.status, 409)
    assert.equal(response.data.code, 'MEDIA_IN_USE')
    assert.equal(referencesFor(response.data, 'product', productId).length, 1)
    assert.deepEqual(await rawAsset(asset), before)
    assert.deepEqual(await runtime.providerAttempts(), [])
  } finally {
    await connection.rollback().catch(() => {})
    connection.release()
    await request?.catch(() => {})
  }
})
