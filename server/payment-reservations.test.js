import assert from 'node:assert/strict'
import test from 'node:test'
import { createPaymentReservationExpiry } from './payment-reservations.js'

const instant = Date.parse('2026-11-03T18:00:00Z')
const day = 24 * 60 * 60 * 1000
const order = (id = 1, patch = {}) => ({ id, code: 'GALEO-' + id, total: 100, payment_provider: 'MERCADO_PAGO', status: 'RECEIVED', payment_status: 'PENDING', sale_id: null, created_at: new Date(instant - day - 1), ...patch })
const attempt = (id, orderId, status = 'PENDING', reference = null) => ({ id, store_order_id: orderId, provider: 'MERCADO_PAGO', provider_reference: reference, status })

function fixture({ orders = [order()], attempts = [], beforeLock, onRestore, providerOrder, processOrder, zeroUpdate = false } = {}) {
  const state = { orders: structuredClone(orders), attempts: structuredClone(attempts), stock: 0, restores: 0, providerCalls: [], processed: [], connections: [], selection: null }
  const queries = async (sql, params) => {
    if (sql.startsWith('SELECT id,code,total')) {
      state.selection = { sql, params }
      return structuredClone(state.orders.filter(row => row.payment_provider === 'MERCADO_PAGO' && row.status === 'RECEIVED' && ['PENDING', 'REJECTED'].includes(row.payment_status) && row.sale_id == null && new Date(row.created_at) < params[0]).slice(0, 50))
    }
    if (sql.startsWith('SELECT id,provider,provider_reference,status FROM payments')) return structuredClone(state.attempts.filter(row => row.store_order_id === params[0]))
    throw new Error('Unexpected read')
  }
  const db = {
    async getConnection() {
      let snapshot, locked = false, attemptsLocked = false
      const connection = {
        committed: 0, rolledBack: 0, released: false,
        async beginTransaction() { snapshot = structuredClone({ orders: state.orders, attempts: state.attempts, stock: state.stock, restores: state.restores }) },
        async execute(sql, params) {
          if (sql.startsWith('SELECT * FROM store_orders')) {
            await beforeLock?.(state)
            locked = true
            return [structuredClone(state.orders.filter(row => row.id === params[0]))]
          }
          if (sql.startsWith('SELECT id,provider,provider_reference,status FROM payments')) {
            assert.equal(locked, true)
            assert.match(sql, /FOR UPDATE$/)
            attemptsLocked = true
            return [structuredClone(state.attempts.filter(row => row.store_order_id === params[0]))]
          }
          if (sql.startsWith('UPDATE store_orders')) {
            assert.equal(locked && attemptsLocked, true)
            if (zeroUpdate) return [{ affectedRows: 0 }]
            const row = state.orders.find(item => item.id === params[0])
            row.status = 'CANCELLED'; row.payment_status = 'CANCELLED'
            return [{ affectedRows: 1 }]
          }
          throw new Error('Unexpected transactional statement')
        },
        async commit() { this.committed += 1; snapshot = null },
        async rollback() { this.rolledBack += 1; if (snapshot) Object.assign(state, structuredClone(snapshot)); snapshot = null },
        release() { this.released = true },
        assertLocked() { assert.equal(locked && attemptsLocked, true) }
      }
      state.connections.push(connection)
      return connection
    }
  }
  const expiry = createPaymentReservationExpiry({
    db, query: queries, privacy: { decodeRow: (_table, row) => row }, now: () => instant,
    restoreReservation: async (connection, lockedOrder) => {
      connection.assertLocked()
      state.stock += 2; state.restores += 1
      await onRestore?.(state, lockedOrder)
    },
    getProviderOrder: async reference => {
      state.providerCalls.push(reference)
      if (providerOrder) return providerOrder(reference, state)
      return { id: reference, external_reference: 'GALEO-1', total_amount: '100.00', status: 'created', transactions: { payments: [{ date_of_expiration: '2020-01-01T00:00:00Z' }] } }
    },
    processProviderOrder: async payload => {
      state.processed.push(payload)
      await processOrder?.(payload, state)
    }
  })
  return { state, expiry }
}

test('abandoned orders without any attempt release inventory once, in a locked transaction', async () => {
  const { state, expiry } = fixture()
  assert.deepEqual(await expiry.expire(), { examined: 1, reconciled: 0, expired: 1, skipped: 0, failed: 0 })
  assert.equal(state.stock, 2)
  assert.equal(state.orders[0].status, 'CANCELLED')
  assert.equal(state.orders[0].payment_status, 'CANCELLED')
  assert.equal(state.connections[0].committed, 1)
  assert.equal(state.connections[0].released, true)
  assert.deepEqual(await expiry.expire(), { examined: 0, reconciled: 0, expired: 0, skipped: 0, failed: 0 })
  assert.equal(state.restores, 1)
  assert.equal(state.providerCalls.length, 0)
})

test('only old received unpaid Mercado Pago orders are candidates', async () => {
  const { state, expiry } = fixture({ orders: [
    order(1, { payment_provider: null }), order(2, { payment_provider: 'OTHER' }),
    order(3, { status: 'CONFIRMED' }), order(4, { payment_status: 'APPROVED' }),
    order(5, { payment_status: 'REFUNDED' }), order(6, { sale_id: 1 }),
    order(7, { created_at: new Date(instant - day) }), order(8, { created_at: new Date(instant) }), order(9)
  ] })
  const report = await expiry.expire()
  assert.equal(report.examined, 1)
  assert.equal(report.expired, 1)
  assert.deepEqual(state.orders.filter(row => row.status === 'CANCELLED').map(row => row.id), [9])
  assert.match(state.selection.sql, /LIMIT 50$/)
  assert.equal(state.selection.params[0].getTime(), instant - day)
})

test('all rejected or cancelled attempts can expire an old rejected order', async () => {
  const { state, expiry } = fixture({ orders: [order(1, { payment_status: 'REJECTED' })], attempts: [attempt(1, 1, 'REJECTED', 'ORD1'), attempt(2, 1, 'CANCELLED', 'ORD2')] })
  assert.equal((await expiry.expire()).expired, 1)
  assert.equal(state.stock, 2)
  assert.equal(state.providerCalls.length, 0)
})

test('an ambiguous pending attempt without reference never releases inventory', async () => {
  const { state, expiry } = fixture({ attempts: [attempt(1, 1), attempt(2, 1, 'REJECTED', 'ORD1')] })
  assert.equal((await expiry.expire()).skipped, 1)
  assert.equal(state.stock, 0)
  assert.equal(state.orders[0].status, 'RECEIVED')
  assert.equal(state.providerCalls.length, 0)
})

test('a known pending provider payment is reconciled but its apparent expiration is not proof of failure', async () => {
  const { state, expiry } = fixture({ attempts: [attempt(1, 1, 'PENDING', 'ORD1')] })
  assert.deepEqual(await expiry.expire(), { examined: 1, reconciled: 1, expired: 0, skipped: 1, failed: 0 })
  assert.deepEqual(state.providerCalls, ['ORD1'])
  assert.equal(state.processed[0].eventType, 'orders')
  assert.equal(state.stock, 0)
  assert.equal(state.orders[0].status, 'RECEIVED')
})

test('approval during reconciliation preserves the sale and its inventory reservation', async () => {
  const { state, expiry } = fixture({
    attempts: [attempt(1, 1, 'PENDING', 'ORD1')],
    providerOrder: reference => ({ id: reference, external_reference: 'GALEO-1', total_amount: '100.00', status: 'processed', status_detail: 'accredited' }),
    processOrder: (_value, data) => {
      data.orders[0].status = 'CONFIRMED'; data.orders[0].payment_status = 'APPROVED'; data.orders[0].sale_id = 42
      data.attempts[0].status = 'APPROVED'
    }
  })
  assert.deepEqual(await expiry.expire(), { examined: 1, reconciled: 1, expired: 0, skipped: 1, failed: 0 })
  assert.equal(state.stock, 0)
  assert.equal(state.orders[0].sale_id, 42)
})

test('confirmed rejection can expire, but cancellation already handled by reconciler does not restore twice', async () => {
  for (const terminal of ['REJECTED', 'CANCELLED']) {
    const { state, expiry } = fixture({
      attempts: [attempt(1, 1, 'PENDING', 'ORD1')],
      processOrder: (_value, data) => {
        data.attempts[0].status = terminal
        data.orders[0].payment_status = terminal
        if (terminal === 'CANCELLED') { data.orders[0].status = 'CANCELLED'; data.stock += 2; data.restores += 1 }
      }
    })
    const report = await expiry.expire()
    assert.equal(report.expired, terminal === 'REJECTED' ? 1 : 0)
    assert.equal(state.stock, 2)
    assert.equal(state.restores, 1)
  }
})

test('a provider timeout preserves the first order and does not prevent expiry of the next safe order', async () => {
  const { state, expiry } = fixture({ orders: [order(1), order(2)], attempts: [attempt(1, 1, 'PENDING', 'ORD1')], providerOrder: async () => { throw new Error('timeout') } })
  assert.deepEqual(await expiry.expire(), { examined: 2, reconciled: 0, expired: 1, skipped: 0, failed: 1 })
  assert.equal(state.orders[0].status, 'RECEIVED')
  assert.equal(state.orders[1].status, 'CANCELLED')
  assert.equal(state.restores, 1)
})

test('provider response must match resource, external order and amount before processing', async () => {
  for (const patch of [{ id: 'ORD2' }, { external_reference: 'OTHER' }, { total_amount: '99.99' }, { total_amount: 'invalid' }]) {
    const { state, expiry } = fixture({ attempts: [attempt(1, 1, 'PENDING', 'ORD1')], providerOrder: () => ({ id: 'ORD1', external_reference: 'GALEO-1', total_amount: '100.00', ...patch }) })
    assert.equal((await expiry.expire()).failed, 1)
    assert.equal(state.processed.length, 0)
    assert.equal(state.stock, 0)
    assert.equal(state.orders[0].status, 'RECEIVED')
  }
})

test('concurrent approval before order lock prevents releasing inventory', async () => {
  const { state, expiry } = fixture({ attempts: [attempt(1, 1, 'REJECTED', 'ORD1')], beforeLock: data => {
    data.orders[0].payment_status = 'APPROVED'; data.orders[0].sale_id = 52
    data.attempts[0].status = 'APPROVED'
  } })
  assert.equal((await expiry.expire()).skipped, 1)
  assert.equal(state.stock, 0)
  assert.equal(state.orders[0].sale_id, 52)
})

test('a newly inserted pending attempt is rechecked under the order lock', async () => {
  const { state, expiry } = fixture({ attempts: [attempt(1, 1, 'REJECTED', 'ORD1')], beforeLock: data => { data.attempts.push(attempt(2, 1)) } })
  assert.equal((await expiry.expire()).skipped, 1)
  assert.equal(state.stock, 0)
  assert.equal(state.orders[0].status, 'RECEIVED')
})

test('an approved, refunded, or unknown attempt prevents expiry despite stale order status', async () => {
  for (const status of ['APPROVED', 'REFUNDED', 'UNKNOWN']) {
    const { state, expiry } = fixture({ attempts: [attempt(1, 1, status, 'ORD1')] })
    assert.equal((await expiry.expire()).skipped, 1)
    assert.equal(state.stock, 0)
    assert.equal(state.orders[0].status, 'RECEIVED')
  }
})

test('inventory restoration failure rolls back both inventory and order changes', async () => {
  const { state, expiry } = fixture({ onRestore: () => { throw new Error('inventory failed') } })
  assert.equal((await expiry.expire()).failed, 1)
  assert.equal(state.stock, 0)
  assert.equal(state.orders[0].status, 'RECEIVED')
  assert.equal(state.connections[0].rolledBack, 1)
  assert.equal(state.connections[0].released, true)
})

test('a failed conditional cancellation rolls back restoration rather than losing inventory', async () => {
  const { state, expiry } = fixture({ zeroUpdate: true })
  assert.equal((await expiry.expire()).skipped, 1)
  assert.equal(state.stock, 0)
  assert.equal(state.orders[0].status, 'RECEIVED')
  assert.equal(state.connections[0].rolledBack, 1)
})

test('one maintenance run handles at most fifty orders', async () => {
  const { state, expiry } = fixture({ orders: Array.from({ length: 55 }, (_value, index) => order(index + 1)) })
  const report = await expiry.expire()
  assert.equal(report.examined, 50)
  assert.equal(report.expired, 50)
  assert.equal(state.orders.filter(row => row.status === 'RECEIVED').length, 5)
})

test('reconciliation event keys preserve later state changes of the same provider order', async () => {
  let status = 'created'
  const { state, expiry } = fixture({ attempts: [attempt(1, 1, 'PENDING', 'ORD1')], providerOrder: () => ({ id: 'ORD1', external_reference: 'GALEO-1', total_amount: '100.00', status }) })
  await expiry.expire()
  const first = state.processed[0].eventId
  await expiry.expire()
  assert.equal(state.processed[1].eventId, first)
  status = 'processing'
  await expiry.expire()
  assert.notEqual(state.processed[2].eventId, first)
})
