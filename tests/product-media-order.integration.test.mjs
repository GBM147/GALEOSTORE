import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'

// The harness refuses production and creates/removes its own random local DB.
const runtime = new HomeWorkflowRuntime()

before(async () => { await runtime.initialize({ port: 10137 }) })
after(async () => { await runtime.close() })

async function productWithPhotos() {
  const created = await runtime.request('/api/admin/products', { method: 'POST', body: { name: 'Produto com fotos local', brand: '', price: 0, cost: 0, stock: 0, min_stock: 0, active: false } })
  assert.equal(created.status, 201)
  const id = created.data.id
  for (const [index, name] of ['frente', 'costas', 'detalhe'].entries()) {
    await runtime.query('INSERT INTO product_media(product_id,media_type,url,public_id,sort_order) VALUES(?,?,?,?,?)', [id, 'image', 'https://res.cloudinary.com/demo/image/upload/local-' + id + '-' + name + '.jpg', 'local-' + id + '-' + name, index])
  }
  await runtime.query('INSERT INTO media_assets(public_id,url,media_type,title) VALUES(?,?,?,?)', ['local-' + id + '-frente', 'https://res.cloudinary.com/demo/image/upload/local-' + id + '-frente.jpg', 'image', 'Frente'])
  const media = await runtime.request('/api/admin/products/' + id + '/media')
  assert.equal(media.status, 200)
  return { id, media: media.data }
}

test('a product photo carries its library versions for the cover picker', async () => {
  const { media } = await productWithPhotos()
  assert.equal(media.length, 3)
  assert.equal(media[0].asset.title, 'Frente')
  assert.equal(media[0].asset.original_url, media[0].url)
  assert.equal(media[0].asset.ai_status, 'none')
  assert.equal(media[1].asset, null)
})

test('the photo order is saved and a stale order is refused', async () => {
  const { id, media } = await productWithPhotos()
  const reversed = media.map(item => item.id).reverse()
  const saved = await runtime.request('/api/admin/products/' + id + '/media/order', { method: 'PUT', body: { ids: reversed } })
  assert.equal(saved.status, 200)
  assert.deepEqual((await runtime.request('/api/admin/products/' + id + '/media')).data.map(item => item.id), reversed)
  const stale = await runtime.request('/api/admin/products/' + id + '/media/order', { method: 'PUT', body: { ids: reversed.slice(1) } })
  assert.equal(stale.status, 409)
  const invalid = await runtime.request('/api/admin/products/' + id + '/media/order', { method: 'PUT', body: { ids: [reversed[0], reversed[0], reversed[1]] } })
  assert.equal(invalid.status, 400)
  assert.equal((await runtime.request('/api/admin/products/999999/media/order', { method: 'PUT', body: { ids: [1] } })).status, 404)
})
