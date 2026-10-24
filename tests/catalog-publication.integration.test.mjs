import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'

// This fixture refuses production and creates/removes only its random local DB.
const runtime = new HomeWorkflowRuntime()
const shipping = { name: 'Cliente de teste local', phone: '11999999999', postal_code: '01001000', street: 'Rua local', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' }

before(async () => {
  await runtime.initialize({ port: 10137 })
  const [owner] = await runtime.query('SELECT password_hash FROM admin_users WHERE id=?', [runtime.ownerId])
  const email = 'catalog-buyer-' + runtime.suffix + '@example.invalid'
  await runtime.query('INSERT INTO customers(name,email,password_hash,phone,email_verified_at) VALUES(?,?,?,?,NOW())', [shipping.name, email, owner.password_hash, shipping.phone])
  const login = await runtime.request('/api/customer/login', { method: 'POST', body: { email, password: runtime.password }, auth: false })
  assert.equal(login.status, 200)
})

after(async () => {
  try {
    if (runtime.db) assert.deepEqual(await runtime.providerAttempts(), [], 'catalog checkout tests must not contact external providers')
  } finally { await runtime.close() }
})

async function product(name, price, stock = 4) {
  const created = await runtime.query("INSERT INTO products(name,description,price,stock,active) VALUES(?,'Fixture local',?,?,1)", [name, price, stock])
  return created.insertId
}

async function orderState(ids) {
  const [orders] = await runtime.query('SELECT COUNT(*) AS total FROM store_orders')
  const [items] = await runtime.query('SELECT COUNT(*) AS total FROM store_order_items')
  const [movements] = await runtime.query('SELECT COUNT(*) AS total FROM stock_movements')
  const products = await runtime.query('SELECT id,stock FROM products WHERE id IN (' + ids.map(() => '?').join(',') + ') ORDER BY id', ids)
  return { orders: Number(orders.total), items: Number(items.total), movements: Number(movements.total), products }
}

test('published products without a positive price cannot create an order or reserve stock, even with positive inventory', async () => {
  for (const price of [0, -1]) {
    const id = await product('Produto local com preço pendente ' + price, price)
    const before = await orderState([id])
    const response = await runtime.request('/api/store/orders', { method: 'POST', body: { items: [{ product_id: id, quantity: 1, price: 100 }], shipping } })
    assert.equal(response.status, 400)
    assert.match(response.data.error, /preço.*ainda não foi definido/i)
    assert.deepEqual(await orderState([id]), before)
  }
})

test('a pending-price item rejects the whole cart without reserving any correctly priced item', async () => {
  const ready = await product('Produto local pronto no carrinho misto', 59.9)
  const pending = await product('Produto local pendente no carrinho misto', 0)
  const before = await orderState([ready, pending])
  const response = await runtime.request('/api/store/orders', { method: 'POST', body: { items: [{ product_id: ready, quantity: 2 }, { product_id: pending, quantity: 1 }], shipping } })
  assert.equal(response.status, 400)
  assert.match(response.data.error, /preço.*ainda não foi definido/i)
  assert.deepEqual(await orderState([ready, pending]), before)
})

test('a correctly priced product still records the server price and reserves exactly the ordered quantity', async () => {
  const id = await product('Produto local pronto para venda', 59.9)
  const before = await orderState([id])
  const response = await runtime.request('/api/store/orders', { method: 'POST', body: { items: [{ product_id: id, quantity: 2, price: 0 }], shipping } })
  assert.equal(response.status, 200)
  assert.equal(Number(response.data.order.subtotal), 119.8)
  assert.equal(Number(response.data.order.total), 119.8)
  const after = await orderState([id])
  assert.equal(after.orders, before.orders + 1)
  assert.equal(after.items, before.items + 1)
  assert.equal(after.movements, before.movements + 1)
  assert.deepEqual(after.products.map(row => [Number(row.id), Number(row.stock)]), [[id, 2]])
  const [item] = await runtime.query('SELECT quantity,unit_price,line_total FROM store_order_items WHERE order_id=?', [response.data.order.id])
  assert.deepEqual([Number(item.quantity), Number(item.unit_price), Number(item.line_total)], [2, 59.9, 119.8])
  const [movement] = await runtime.query('SELECT type,quantity,stock_before,stock_after FROM stock_movements WHERE product_id=?', [id])
  assert.deepEqual([movement.type, Number(movement.quantity), Number(movement.stock_before), Number(movement.stock_after)], ['SAIDA', 2, 4, 2])
})
