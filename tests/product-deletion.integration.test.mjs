import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { MediaApprovalRuntime } from './helpers/media-approval-runtime.mjs'

const runtime = new MediaApprovalRuntime()
const fixtures = { sales: [], orders: [], customers: [], payments: [], finances: [] }
const triggers = new Set()

before(async () => { await runtime.initialize() })
after(async () => {
  await runtime.stopApi()
  try {
    if (!runtime.db) return
    for (const name of triggers) await runtime.db.query('DROP TRIGGER IF EXISTS `' + name + '`')
    for (const [table, column, ids] of [
      ['payments', 'id', fixtures.payments],
      ['financial_entries', 'id', fixtures.finances],
      ['store_order_items', 'order_id', fixtures.orders],
      ['store_orders', 'id', fixtures.orders],
      ['sale_items', 'sale_id', fixtures.sales],
      ['sales', 'id', fixtures.sales],
      ['customers', 'id', fixtures.customers]
    ]) {
      if (ids.length) await runtime.query('DELETE FROM ' + table + ' WHERE ' + column + ' IN (' + ids.map(() => '?').join(',') + ')', ids)
    }
    assert.deepEqual(await runtime.providerAttempts(), [], 'product deletion must not destroy shared Cloudinary files')
  } finally { await runtime.close() }
})

const removeProduct = id => runtime.owner.request('/api/admin/products/' + id, { method: 'DELETE' })
async function productState(id) {
  return {
    product: await runtime.query('SELECT * FROM products WHERE id=?', [id]),
    gallery: await runtime.query('SELECT * FROM product_media WHERE product_id=? ORDER BY id', [id]),
    movements: await runtime.query('SELECT * FROM stock_movements WHERE product_id=? ORDER BY id', [id])
  }
}

async function productWithHistory(label, { inactive = false, asset } = {}) {
  const product = await runtime.createProduct(label, asset ? { image: asset.originalUrl } : {})
  await runtime.gallery(product.id)
  await runtime.query(
    "INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,user_id) VALUES(?,'AJUSTE',2,3,5,'Correção manual local',?),(?,'SAIDA',1,5,4,'Saída manual local',?)",
    [product.id, runtime.ownerId, product.id, runtime.ownerId]
  )
  await runtime.query('UPDATE products SET active=?,stock=4 WHERE id=?', [inactive ? 0 : 1, product.id])
  return product
}

async function saleFixture(product, status, snapshot = {}) {
  const sale = await runtime.query('INSERT INTO sales(code,customer_name,total,status,user_id) VALUES(?,?,?,?,?)', ['DEL-' + runtime.suffix + '-' + fixtures.sales.length, 'Cliente local', 50, status, runtime.ownerId])
  fixtures.sales.push(sale.insertId)
  await runtime.query('INSERT INTO sale_items(sale_id,product_id,product_name,brand,quantity,unit_price,unit_cost,line_total) VALUES(?,?,?,?,1,50,10,50)', [sale.insertId, product.id, snapshot.product_name || '', snapshot.brand || ''])
  const finance = await runtime.query("INSERT INTO financial_entries(type,description,amount,status,reference_type,reference_id,user_id) VALUES('RECEITA','Venda local',50,?,'VENDA',?,?)", [status === 'PAGA' ? 'PAGO' : 'CANCELADO', 'sale:' + sale.insertId, runtime.ownerId])
  fixtures.finances.push(finance.insertId)
  const payment = await runtime.query("INSERT INTO payments(channel,sale_id,provider,status,amount) VALUES('POINT',?,'local-fixture',?,50)", [sale.insertId, status === 'PAGA' ? 'APPROVED' : 'CANCELLED'])
  fixtures.payments.push(payment.insertId)
  return {
    id: sale.insertId,
    state: async () => ({
      sale: await runtime.query('SELECT * FROM sales WHERE id=?', [sale.insertId]),
      items: await runtime.query('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', [sale.insertId]),
      finance: await runtime.query('SELECT * FROM financial_entries WHERE id=?', [finance.insertId]),
      payment: await runtime.query('SELECT * FROM payments WHERE id=?', [payment.insertId])
    })
  }
}

async function orderFixture(product, status) {
  const customer = await runtime.query('INSERT INTO customers(name,email,password_hash) VALUES(?,?,?)', ['Cliente local', 'delete-' + runtime.suffix + '-' + fixtures.customers.length + '@example.invalid', 'local-unused-password-hash'])
  fixtures.customers.push(customer.insertId)
  const order = await runtime.query('INSERT INTO store_orders(code,customer_id,customer_name,customer_email,status,subtotal,total) VALUES(?,?,?,?,?,50,50)', ['DEL-' + runtime.suffix + '-' + fixtures.orders.length, customer.insertId, 'Cliente local', 'fixture@example.invalid', status])
  fixtures.orders.push(order.insertId)
  await runtime.query('INSERT INTO store_order_items(order_id,product_id,product_name,brand,quantity,unit_price,line_total) VALUES(?,?,?,?,1,50,50)', [order.insertId, product.id, 'Nome original do pedido', 'Marca original do pedido'])
  const payment = await runtime.query("INSERT INTO payments(channel,store_order_id,provider,status,amount) VALUES('ONLINE',?,'local-fixture',?,50)", [order.insertId, status === 'CANCELLED' ? 'CANCELLED' : 'PENDING'])
  fixtures.payments.push(payment.insertId)
  return {
    id: order.insertId,
    state: async () => ({
      order: await runtime.query('SELECT * FROM store_orders WHERE id=?', [order.insertId]),
      items: await runtime.query('SELECT * FROM store_order_items WHERE order_id=? ORDER BY id', [order.insertId]),
      payment: await runtime.query('SELECT * FROM payments WHERE id=?', [payment.insertId])
    })
  }
}

function detachedState(before, product, { sale = false } = {}) {
  return {
    ...before,
    items: before.items.map(item => ({
      ...item,
      product_id: null,
      ...(sale && !item.product_name ? { product_name: product.name, brand: product.brand } : {})
    }))
  }
}

async function assertSaleDetail(sale, snapshot) {
  const response = await runtime.owner.request('/api/admin/sales/' + sale.id)
  assert.equal(response.status, 200)
  assert.equal(response.data.items.length, 1, 'detached sale items must remain visible in the administrative detail')
  assert.equal(response.data.items[0].product, snapshot.product_name)
  assert.equal(response.data.items[0].brand, snapshot.brand)
  assert.equal(Number(response.data.items[0].quantity), Number(snapshot.quantity))
  assert.equal(Number(response.data.items[0].line_total), Number(snapshot.line_total))
}

test('deletion requires an OWNER session and valid CSRF without changing the product', async () => {
  const product = await productWithHistory('auth-delete')
  const before = await productState(product.id)
  const path = '/api/admin/products/' + product.id
  assert.equal((await runtime.client().request(path, { method: 'DELETE' })).status, 403, 'CSRF validation precedes authentication for an anonymous mutation')
  const unauthenticated = runtime.client()
  assert.equal((await unauthenticated.request('/api/auth/login', { method: 'POST', body: { email: runtime.email, password: runtime.password } })).status, 200)
  const signed = decodeURIComponent(unauthenticated.cookie.slice('galeo_sid='.length))
  const sessionId = signed.slice(2, signed.lastIndexOf('.'))
  await runtime.query("UPDATE sessions SET data=JSON_REMOVE(data,'$.userId') WHERE session_id=?", [sessionId])
  assert.equal((await unauthenticated.request(path, { method: 'DELETE' })).status, 401, 'a valid CSRF token cannot authorize a session without an administrator')
  const csrf = await runtime.owner.request(path, { method: 'DELETE', csrf: false })
  assert.equal(csrf.status, 403)
  assert.match(csrf.data.error, /CSRF/)
  await runtime.query("UPDATE admin_users SET role='staff' WHERE id=?", [runtime.ownerId])
  try {
    const denied = await removeProduct(product.id)
    assert.equal(denied.status, 403)
    assert.equal(denied.data.code, 'ADMIN_OWNER_REQUIRED')
  } finally {
    await runtime.query("UPDATE admin_users SET role='owner' WHERE id=?", [runtime.ownerId])
    runtime.owner = runtime.client()
    assert.equal((await runtime.owner.request('/api/auth/login', { method: 'POST', body: { email: runtime.email, password: runtime.password } })).status, 200)
  }
  assert.deepEqual(await productState(product.id), before)
})

test('invalid and missing product IDs return 400 and 404', async () => {
  for (const id of ['not-a-product', '0', '-1', '1.5']) assert.equal((await removeProduct(id)).status, 400)
  assert.equal((await removeProduct(2147483647)).status, 404)
})

for (const inactive of [false, true]) {
  test('permanently deletes an ' + (inactive ? 'inactive' : 'active') + ' product and every manual stock movement while preserving shared media', async () => {
    const asset = await runtime.asset()
    const shared = await runtime.createProduct('shared-media-' + inactive, { image: asset.originalUrl })
    const product = await productWithHistory('permanent-delete-' + inactive, { inactive, asset })
    const originalAsset = await runtime.query('SELECT * FROM media_assets WHERE id=?', [asset.id])
    const sharedBefore = await productState(shared.id)
    const original = await productState(product.id)
    assert.deepEqual(original.movements.map(row => row.type), ['ENTRADA', 'AJUSTE', 'SAIDA'])
    assert.equal(original.gallery.length, 1)

    const response = await removeProduct(product.id)
    assert.equal(response.status, 200)
    assert.deepEqual(response.data, { success: true, mode: 'deleted' })
    assert.deepEqual(await productState(product.id), { product: [], gallery: [], movements: [] })
    assert.deepEqual(await runtime.query('SELECT * FROM media_assets WHERE id=?', [asset.id]), originalAsset)
    assert.deepEqual(await productState(shared.id), sharedBefore)
    assert.equal((await runtime.client().request('/api/store/products/' + product.id)).status, 404)
    assert.equal((await removeProduct(product.id)).status, 404, 'the removed row cannot be hidden or deleted twice')
    const audit = await runtime.query("SELECT action FROM audit_logs WHERE user_id=? AND entity='produto' AND entity_id=? ORDER BY id", [runtime.ownerId, String(product.id)])
    assert.equal(audit.at(-1)?.action, 'EXCLUIR')
    assert.equal(audit.some(row => row.action === 'OCULTAR'), false)
  })
}

for (const status of ['PAGA', 'CANCELADA']) {
  test((status === 'PAGA' ? 'rejects' : 'allows') + ' deletion with a ' + status + ' sale while preserving its financial records', async () => {
    const product = await productWithHistory('sale-' + status, { inactive: status === 'CANCELADA' })
    const sale = await saleFixture(product, status)
    const state = await productState(product.id)
    const before = await sale.state()
    const response = await removeProduct(product.id)
    if (status === 'PAGA') {
      assert.equal(response.status, 409)
      assert.equal(response.data.code, 'PRODUCT_HAS_TRANSACTIONS')
      assert.deepEqual(await productState(product.id), state, 'a conflict must preserve active state, images and stock history')
      assert.deepEqual(await sale.state(), before)
    } else {
      assert.equal(response.status, 200)
      assert.deepEqual(response.data, { success: true, mode: 'deleted' })
      assert.deepEqual(await productState(product.id), { product: [], gallery: [], movements: [] })
      const expected = detachedState(before, product, { sale: true })
      assert.deepEqual(await sale.state(), expected)
      await assertSaleDetail(sale, expected.items[0])
      const repeated = await runtime.owner.request('/api/admin/sales/' + sale.id + '/cancel', { method: 'PATCH' })
      assert.ok([400, 409].includes(repeated.status))
      assert.deepEqual(await productState(product.id), { product: [], gallery: [], movements: [] })
      assert.deepEqual(await sale.state(), expected, 'a repeated cancellation cannot restore stock or change financial records')
    }
  })
}

for (const status of ['RECEIVED', 'CANCELLED']) {
  test((status === 'RECEIVED' ? 'rejects' : 'allows') + ' deletion with a ' + status + ' online order without a sale', async () => {
    const product = await productWithHistory('order-' + status)
    const order = await orderFixture(product, status)
    const state = await productState(product.id)
    const before = await order.state()
    assert.equal(before.order[0].sale_id, null)
    const response = await removeProduct(product.id)
    if (status === 'RECEIVED') {
      assert.equal(response.status, 409)
      assert.equal(response.data.code, 'PRODUCT_HAS_TRANSACTIONS')
      assert.deepEqual(await productState(product.id), state)
      assert.deepEqual(await order.state(), before)
    } else {
      assert.equal(response.status, 200)
      assert.deepEqual(response.data, { success: true, mode: 'deleted' })
      assert.deepEqual(await productState(product.id), { product: [], gallery: [], movements: [] })
      assert.deepEqual(await order.state(), detachedState(before, product))
    }
  })
}

test('deletes a product linked only to cancelled sale and order without overwriting their original snapshots', async () => {
  const product = await productWithHistory('both-cancelled')
  const sale = await saleFixture(product, 'CANCELADA', { product_name: 'Nome original da venda', brand: 'Marca original da venda' })
  const order = await orderFixture(product, 'CANCELLED')
  const saleBefore = await sale.state(), orderBefore = await order.state()
  const response = await removeProduct(product.id)
  assert.equal(response.status, 200)
  assert.deepEqual(await productState(product.id), { product: [], gallery: [], movements: [] })
  assert.deepEqual(await sale.state(), detachedState(saleBefore, product, { sale: true }))
  assert.deepEqual(await order.state(), detachedState(orderBefore, product))
  await assertSaleDetail(sale, saleBefore.items[0])
})

test('a cancelled order with a payment still approved prevents deletion', async () => {
  const product = await productWithHistory('approved-cancelled-order')
  const order = await orderFixture(product, 'CANCELLED')
  await runtime.query("UPDATE store_orders SET payment_status='APPROVED' WHERE id=?", [order.id])
  const before = { product: await productState(product.id), order: await order.state() }
  const response = await removeProduct(product.id)
  assert.equal(response.status, 409)
  assert.equal(response.data.code, 'PRODUCT_HAS_TRANSACTIONS')
  assert.deepEqual({ product: await productState(product.id), order: await order.state() }, before)
})

test('migration backfills old sale items once and keeps snapshots after a product is renamed', async () => {
  const product = await productWithHistory('legacy-sale-snapshot')
  const sale = await saleFixture(product, 'CANCELADA')
  const before = await sale.state()
  await runtime.stopApi()
  await runtime.startApi()
  const migrated = await sale.state()
  assert.equal(migrated.items[0].product_name, product.name)
  assert.equal(migrated.items[0].brand, product.brand)
  assert.deepEqual(migrated.sale, before.sale)
  assert.deepEqual(migrated.finance, before.finance)
  assert.deepEqual(migrated.payment, before.payment)
  await runtime.query('UPDATE products SET name=?,brand=? WHERE id=?', ['Nome atualizado', 'Marca atualizada', product.id])
  await runtime.stopApi()
  await runtime.startApi()
  assert.deepEqual(await sale.state(), migrated, 'repeating the migration must not rewrite transaction snapshots')
  const response = await removeProduct(product.id)
  assert.equal(response.status, 200)
  await assertSaleDetail(sale, migrated.items[0])
})

for (const [saleStatus, orderStatus] of [['PAGA', 'CANCELLED'], ['CANCELADA', 'RECEIVED']]) {
  test('keeps all links intact when a ' + saleStatus + ' sale and ' + orderStatus + ' order share one product', async () => {
    const product = await productWithHistory('mixed-' + saleStatus)
    const sale = await saleFixture(product, saleStatus)
    const order = await orderFixture(product, orderStatus)
    const before = { product: await productState(product.id), sale: await sale.state(), order: await order.state() }
    const response = await removeProduct(product.id)
    assert.equal(response.status, 409)
    assert.equal(response.data.code, 'PRODUCT_HAS_TRANSACTIONS')
    assert.deepEqual({ product: await productState(product.id), sale: await sale.state(), order: await order.state() }, before, 'a live reference must prevent even partial detachment of cancelled records')
  })
}

test('an audit failure rolls back deletion of the product, gallery and all stock movements', async t => {
  const product = await productWithHistory('delete-rollback')
  const sale = await saleFixture(product, 'CANCELADA')
  const order = await orderFixture(product, 'CANCELLED')
  const before = await productState(product.id)
  const saleBefore = await sale.state(), orderBefore = await order.state()
  const name = 'product_delete_audit_' + runtime.suffix
  try {
    await runtime.db.query('CREATE TRIGGER `' + name + '` BEFORE INSERT ON audit_logs FOR EACH ROW BEGIN IF NEW.user_id=' + runtime.ownerId + " AND NEW.action='EXCLUIR' AND NEW.entity='produto' AND NEW.entity_id='" + product.id + "' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fixture product deletion audit failure'; END IF; END")
    triggers.add(name)
  } catch (error) {
    if (['ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_TRG_CANT_CREATE', 'ER_BINLOG_CREATE_ROUTINE_NEED_SUPER'].includes(error.code)) return t.skip('The isolated local MySQL account cannot create a fixture trigger.')
    throw error
  }
  try {
    const response = await removeProduct(product.id)
    assert.ok(response.status >= 400 && response.status < 600)
    assert.deepEqual(await productState(product.id), before, 'all dependent deletions must be rolled back with a failed audit')
    assert.deepEqual(await sale.state(), saleBefore, 'snapshot backfill and detachment must roll back together')
    assert.deepEqual(await order.state(), orderBefore)
  } finally {
    await runtime.db.query('DROP TRIGGER IF EXISTS `' + name + '`')
    triggers.delete(name)
  }
  assert.equal((await removeProduct(product.id)).status, 200, 'the rolled-back transaction must release its locks')
  assert.deepEqual(await productState(product.id), { product: [], gallery: [], movements: [] })
})
