import assert from 'node:assert/strict'
import test from 'node:test'
import { paymentBuyerContext } from './payment-buyer-context.js'

const fixture = () => ({
  customerId: 7,
  customer: { id: 7, name: 'Compradora da conta', email: 'buyer@example.invalid', phone: '11999999999',
    active: 1, email_verified_at: '2030-01-01', registered_at_ms: '1893456000000' },
  order: { id: 11, customer_id: 7, customer_name: 'Outro destinatário', customer_phone: '11888888888',
    customer_email: 'order@example.invalid', postal_code: '01001000', street: 'Praça da entrega', number: '1',
    complement: '', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' },
  history: { previous_purchases: '0', last_purchase_at_ms: null }
})

test('buyer context uses account identity and labels delivery address without assuming billing', () => {
  const input = fixture()
  const value = paymentBuyerContext(input)
  assert.equal(value.name, input.customer.name)
  assert.equal(value.email, input.customer.email)
  assert.equal(value.phone, input.customer.phone)
  assert.equal(value.authentication_type, 'password')
  assert.equal(value.registered_at_ms, 1893456000000)
  assert.equal(value.previous_purchases, 0)
  assert.equal(value.address_source, 'checkout_delivery')
  assert.deepEqual(value.checkout_address, { postal_code: '01001000', street: 'Praça da entrega', number: '1',
    complement: '', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' })
  assert.equal(Object.hasOwn(value, 'address'), false)
  assert.equal(Object.hasOwn(value, 'last_purchase_at_ms'), false)
  assert.equal(JSON.stringify(value).includes('Outro destinatário'), false)
})

test('a previous purchase remains a previous purchase when its paid date is unknown after refund', () => {
  const input = fixture()
  input.history = { previous_purchases: '2', last_purchase_at_ms: '1893542400000' }
  assert.equal(paymentBuyerContext(input).last_purchase_at_ms, 1893542400000)
  input.history.last_purchase_at_ms = null
  const refunded = paymentBuyerContext(input)
  assert.equal(refunded.previous_purchases, 2)
  assert.equal(Object.hasOwn(refunded, 'last_purchase_at_ms'), false)
  input.history = { previous_purchases: '0', last_purchase_at_ms: '1893542400000' }
  assert.equal(Object.hasOwn(paymentBuyerContext(input), 'last_purchase_at_ms'), false)
})

test('changed ownership, inactive/unverified account and unavailable history block buyer context', () => {
  for (const change of [
    input => { input.customerId = 8 },
    input => { input.order.customer_id = 8 },
    input => { input.customer.active = 0 },
    input => { input.customer.email_verified_at = null },
    input => { input.customer.registered_at_ms = null },
    input => { input.history.previous_purchases = -1 },
    input => { input.history.previous_purchases = null },
    input => { input.history.previous_purchases = '' },
    input => { delete input.history.previous_purchases },
    input => { input.customer.email = {} }
  ]) {
    const input = fixture(); change(input)
    assert.throws(() => paymentBuyerContext(input), { code: 'PAYMENT_BUYER_UNAVAILABLE' })
  }
})
