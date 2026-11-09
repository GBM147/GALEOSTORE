import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductMediaOrderError, productMediaOrder } from './product-media-order.js'

test('accepts every current media id once, in the new order', () => {
  assert.deepEqual(productMediaOrder([4, 7, 9], [9, 4, 7]), [9, 4, 7])
  assert.deepEqual(productMediaOrder([4, 7], ['7', '4']), [7, 4])
})

test('refuses empty, invalid or repeated ids', () => {
  for (const ids of [undefined, [], [4, 'x'], [4, 0], [4, 4]]) {
    assert.throws(() => productMediaOrder([4, 7], ids), error => error instanceof ProductMediaOrderError && error.status === 400)
  }
})

test('refuses an order made from an outdated gallery', () => {
  for (const ids of [[4], [4, 7, 8], [4, 8]]) {
    assert.throws(() => productMediaOrder([4, 7], ids), error => error instanceof ProductMediaOrderError && error.status === 409)
  }
})
