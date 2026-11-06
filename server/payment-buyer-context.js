// Provider-only context. Identity comes from the authenticated customer's
// stored profile; the order's recipient must never replace that identity.
export function paymentBuyerContext({ customer, customerId, order, history }) {
  const id = Number(customer?.id)
  const registered = Number(customer?.registered_at_ms)
  const previous = Number(history?.previous_purchases)
  if (!Number.isSafeInteger(id) || id < 1 || id !== Number(customerId) ||
      id !== Number(order?.customer_id) || Number(customer.active) !== 1 || !customer.email_verified_at ||
      !['name', 'email', 'phone'].every(key => typeof customer[key] === 'string') ||
      !Number.isSafeInteger(registered) || registered <= 0 ||
      history?.previous_purchases == null || history.previous_purchases === '' ||
      !Number.isSafeInteger(previous) || previous < 0) {
    throw Object.assign(new Error('Não foi possível conferir os dados do comprador.'), { code: 'PAYMENT_BUYER_UNAVAILABLE' })
  }
  const last = Number(history?.last_purchase_at_ms)
  return {
    id, name: customer.name, email: customer.email, phone: customer.phone,
    registered_at_ms: registered, previous_purchases: previous,
    ...(previous > 0 && Number.isSafeInteger(last) && last > 0 ? { last_purchase_at_ms: last } : {}),
    // Customer sessions are granted only by the password-login endpoint.
    authentication_type: 'password',
    // This is not implicitly a billing address. The adapter may use it only
    // after the buyer explicitly selects the same-address option at payment.
    checkout_address: Object.fromEntries(['postal_code', 'street', 'number', 'complement', 'neighborhood', 'city', 'state']
      .map(key => [key, typeof order[key] === 'string' ? order[key] : ''])),
    address_source: 'checkout_delivery'
  }
}
