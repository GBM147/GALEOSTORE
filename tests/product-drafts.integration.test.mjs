import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'

// The harness refuses production and creates/removes its own random local DB.
const runtime = new HomeWorkflowRuntime()
const baseProduct = { name: 'Peça em revisão local', brand: '', price: 0, cost: 0, stock: 0, min_stock: 0 }

before(async () => { await runtime.initialize({ port: 10136 }) })
after(async () => {
  try {
    if (runtime.db) assert.deepEqual(await runtime.providerAttempts(), [], 'draft creation must not contact external providers')
  } finally { await runtime.close() }
})

async function publicCatalog() {
  const response = await runtime.request('/api/store', { auth: false })
  assert.equal(response.status, 200)
  return response.data.products
}

test('an explicitly inactive new product is saved privately with unknown price and zero inventory', async () => {
  const response = await runtime.request('/api/admin/products', { method: 'POST', body: { ...baseProduct, active: false } })
  assert.equal(response.status, 201)
  const product = response.data
  assert.equal(Number(product.active), 0)
  assert.equal(Number(product.price), 0)
  assert.equal(Number(product.stock), 0)
  assert.equal((await runtime.query('SELECT active FROM products WHERE id=?', [product.id]))[0].active, 0)
  assert.equal((await runtime.query('SELECT COUNT(*) AS total FROM stock_movements WHERE product_id=?', [product.id]))[0].total, 0)
  assert.equal((await publicCatalog()).some(item => item.id === product.id), false)
  assert.equal((await runtime.request('/api/store/products/' + product.id, { auth: false })).status, 404)
  const adminProducts = await runtime.request('/api/admin/products')
  assert.equal(adminProducts.status, 200)
  assert.equal(Number(adminProducts.data.find(item => item.id === product.id).active), 0)
})

test('existing clients that omit active still create active products', async () => {
  const response = await runtime.request('/api/admin/products', { method: 'POST', body: { ...baseProduct, name: 'Produto legado local', price: 25, stock: 2 } })
  assert.equal(response.status, 201)
  assert.equal(Number(response.data.active), 1)
  assert.equal((await publicCatalog()).some(item => item.id === response.data.id), true)
  const detail = await runtime.request('/api/store/products/' + response.data.id, { auth: false })
  assert.equal(detail.status, 200)
  assert.equal(Number(detail.data.product.stock), 2)
})

test('completing and publishing a draft exposes that same product without creating a duplicate', async () => {
  const draft = await runtime.request('/api/admin/products', { method: 'POST', body: { ...baseProduct, name: 'Rascunho para publicar local', active: false } })
  assert.equal(draft.status, 201)
  const id = draft.data.id
  assert.equal((await publicCatalog()).some(item => item.id === id), false)

  const published = await runtime.request('/api/admin/products/' + id, { method: 'PUT', body: { ...baseProduct, name: draft.data.name, price: 89.9, stock: 3, active: true } })
  assert.equal(published.status, 200)
  assert.equal(published.data.id, id)
  assert.equal(Number(published.data.active), 1)
  const catalog = await publicCatalog()
  assert.equal(catalog.filter(item => item.id === id).length, 1)
  assert.equal(Number(catalog.find(item => item.id === id).price), 89.9)
  assert.equal(Number(catalog.find(item => item.id === id).stock), 3)
  const detail = await runtime.request('/api/store/products/' + id, { auth: false })
  assert.equal(detail.status, 200)
  assert.equal(detail.data.product.name, draft.data.name)
  const movements = await runtime.query('SELECT quantity,stock_before,stock_after FROM stock_movements WHERE product_id=?', [id])
  assert.deepEqual(movements.map(item => [Number(item.quantity), Number(item.stock_before), Number(item.stock_after)]), [[3, 0, 3]])
})
