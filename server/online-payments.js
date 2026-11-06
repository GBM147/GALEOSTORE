import { createHash } from 'node:crypto'
import { paymentBuyerContext } from './payment-buyer-context.js'
import {
  createMercadoPagoOnlineOrder,
  findMercadoPagoOrderForAttempt,
  getMercadoPagoOrder,
  getMercadoPagoPublicConfig,
  mercadoPagoPaymentForClient,
  mercadoPagoTestFailureDiagnostic,
  normalizeMercadoPagoPayment
} from './mercado-pago.js'

const provider = 'MERCADO_PAGO'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const terminal = new Set(['APPROVED', 'REFUNDED'])
const problem = (status, code, message, extra = null) => Object.assign(new Error(message), { safe: true, status, code, ...(extra ? { extra } : {}) })
// Homologation only (test database and Mercado Pago test mode): the sanitized
// diagnostic holds HTTP status, provider codes and field names, never values.
const homologationDiagnostics = () => getMercadoPagoPublicConfig().mode === 'test' && /_test$/.test(String(process.env.DB_NAME || ''))
const rawOrder = payment => {
  const value = payment?.raw_payload
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch {}
  }
  return null
}
const publicOrder = order => ({
  id: Number(order.id), code: String(order.code), total: Number(order.total),
  status: order.status, payment_status: order.payment_status,
  customer_email: String(order.customer_email || '')
})

// The event key includes state/content, not only the provider order ID: the
// same order may legitimately move from pending to approved and then refunded.
const eventKey = value => 'reconcile-' + createHash('sha256').update(JSON.stringify(value)).digest('hex')

function assertBoundOrder(value, order, reference) {
  if (!value || typeof value !== 'object' || !value.id ||
      (reference && String(value.id) !== String(reference)) ||
      String(value.external_reference || '') !== String(order.code) ||
      !Number.isFinite(Number(value.total_amount)) ||
      Math.round(Number(value.total_amount) * 100) !== Math.round(Number(order.total) * 100)) {
    throw problem(503, 'PAYMENT_CONFIRMATION_UNAVAILABLE', 'Não foi possível conferir este pagamento. Tente consultar novamente.')
  }
}

export function registerOnlinePayments(app, { db, query, privacy, exigirCliente, processProviderOrder, limiter = (_req, _res, next) => next(), statusLimiter = limiter }) {
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store, max-age=0'); next() }
  const idFrom = req => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) throw problem(400, 'ORDER_INVALID', 'Pedido inválido.')
    return id
  }
  async function owned(id, customerId, connection) {
    const suffix = connection ? ' FOR UPDATE' : ''
    const rows = await query('SELECT * FROM store_orders WHERE id=? AND customer_id=? LIMIT 1' + suffix, [id, customerId], connection)
    if (!rows.length) throw problem(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    return rows[0]
  }
  async function payments(id, connection, lock = false) {
    return query("SELECT *,UNIX_TIMESTAMP(created_at)*1000 AS created_at_ms FROM payments WHERE store_order_id=? AND provider='MERCADO_PAGO' ORDER BY id DESC" + (lock ? ' FOR UPDATE' : ''), [id], connection)
  }
  async function buyerForPayment(order, customerId, connection) {
    const customers = await query('SELECT id,name,email,phone,active,email_verified_at,private_data,UNIX_TIMESTAMP(created_at)*1000 AS registered_at_ms FROM customers WHERE id=? LIMIT 1', [customerId], connection)
    // Refunding a past purchase does not make the buyer a first-time customer.
    // Its cleared paid_at remains unknown; do not substitute another date.
    const history = await query("SELECT COUNT(*) AS previous_purchases,UNIX_TIMESTAMP(MAX(paid_at))*1000 AS last_purchase_at_ms FROM store_orders WHERE customer_id=? AND id<>? AND payment_status IN ('APPROVED','REFUNDED')", [customerId, order.id], connection)
    return paymentBuyerContext({ customer: customers[0], customerId, order, history: history[0] })
  }
  function view(order, payment) {
    const config = getMercadoPagoPublicConfig()
    const raw = rawOrder(payment)
    let safePayment = null
    if (raw?.id) safePayment = mercadoPagoPaymentForClient(raw)
    else if (payment) safePayment = { provider_reference: payment.provider_reference || '', status: payment.status, method: payment.method, awaiting_confirmation: payment.status === 'PENDING' }
    if (safePayment && uuid.test(payment?.idempotency_key || '')) safePayment.attempt_id = payment.idempotency_key
    return { success: true, payment_configured: config.available, paid: order.payment_status === 'APPROVED', order: publicOrder(order), payment: safePayment }
  }
  async function reconcile(order, reference) {
    const value = await getMercadoPagoOrder(reference)
    assertBoundOrder(value, order, reference)
    await processProviderOrder({ eventId: eventKey(value), eventType: 'orders', mpOrder: value })
    return value
  }
  function failure(res, error, fallback = 'Não foi possível consultar o pagamento. Tente novamente.') {
    if (error?.safe) return res.status(error.status).json({ error: error.message, code: error.code, ...(error.extra || {}) })
    return res.status(503).json({ error: fallback, code: 'PAYMENT_UNAVAILABLE' })
  }

  app.get('/api/store/payments/config', noStore, (_req, res) => res.json(getMercadoPagoPublicConfig()))

  app.get('/api/store/orders/:id/payment', noStore, exigirCliente, statusLimiter, async (req, res) => {
    try {
      const id = idFrom(req)
      let order = await owned(id, req.customer.id)
      let rows = await payments(id)
      let recoveredByLookup = false
      const unresolved = rows.filter(row => row.status === 'PENDING')
      if (getMercadoPagoPublicConfig().available && unresolved.length === 1 && !unresolved[0].provider_reference && rows[0]?.id === unresolved[0].id &&
          uuid.test(unresolved[0].idempotency_key || '') && !order.sale_id &&
          !terminal.has(order.payment_status) && order.status !== 'CANCELLED') {
        const attempt = unresolved[0]
        const value = await findMercadoPagoOrderForAttempt({ order, attempt })
        if (value) {
          assertBoundOrder(value, order)
          // The processor locks and rechecks this exact committed attempt.
          // Provider GETs above never hold a database lock.
          await processProviderOrder({ eventId: eventKey(value), eventType: 'orders', mpOrder: value,
            recoverPendingAttempt: { id: Number(attempt.id), idempotency_key: attempt.idempotency_key,
              created_at_ms: Number(attempt.created_at_ms), method: attempt.method, order_id: id } })
          recoveredByLookup = true
          order = await owned(id, req.customer.id)
          rows = await payments(id)
        }
      }
      const payment = rows.find(row => row.status === 'PENDING' && row.provider_reference) || rows[0]
      if (!recoveredByLookup && getMercadoPagoPublicConfig().available && payment?.provider_reference &&
          ['PENDING', 'APPROVED'].includes(payment.status) && order.payment_status !== 'REFUNDED') {
        try { await reconcile(order, payment.provider_reference) }
        catch (error) {
          // A provider outage cannot erase an approval already committed.
          // Pending payments still require a successful reconciliation.
          if (order.payment_status !== 'APPROVED') throw error
        }
        order = await owned(id, req.customer.id)
        rows = await payments(id)
      }
      return res.json(view(order, rows[0]))
    } catch (error) { return failure(res, error) }
  })

  app.post('/api/store/orders/:id/payment', noStore, exigirCliente, limiter, async (req, res) => {
    let attempt, orderId, transaction, stubId, lockName, lockHeld = false, createdHere = false
    async function closeConnection() {
      if (!transaction) return
      const connection = transaction
      transaction = null
      if (lockHeld) {
        lockHeld = false
        try { await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]) }
        catch { connection.destroy(); return }
      }
      connection.release()
    }
    try {
      orderId = idFrom(req)
      const available = getMercadoPagoPublicConfig().available
      // Ownership is checked even while disabled so this endpoint does not
      // disclose that a different customer's order exists.
      await owned(orderId, req.customer.id)
      if (!available) throw problem(503, 'PAYMENT_NOT_CONFIGURED', 'O pagamento online ainda não está disponível. Entre em contato com a loja.')
      attempt = String(req.body?.attempt_id || '').toLowerCase()
      if (!uuid.test(attempt)) throw problem(400, 'PAYMENT_ATTEMPT_INVALID', 'Não foi possível identificar a tentativa de pagamento. Atualize a página.')
      let paymentInput
      try { paymentInput = normalizeMercadoPagoPayment(req.body) }
      catch { throw problem(400, 'PAYMENT_DATA_INVALID', 'Confira os dados e a forma de pagamento.') }

      transaction = await db.getConnection()
      // A named lock survives the commit that makes the UUID durable. It
      // prevents two HTTP requests from racing across that commit boundary.
      // No waiting clients consume a pooled connection: contention is a 409.
      lockName = 'galeo-pay-' + createHash('sha256').update(String(process.env.DB_NAME || '') + ':' + orderId).digest('hex').slice(0, 48)
      const [locks] = await transaction.execute('SELECT GET_LOCK(?,0) AS acquired', [lockName])
      if (Number(locks[0]?.acquired) !== 1) throw problem(409, 'PAYMENT_IN_PROGRESS', 'Esta tentativa está sendo enviada. Aguarde e consulte o pagamento.')
      lockHeld = true
      await transaction.beginTransaction()
      const order = await owned(orderId, req.customer.id, transaction)
      if (terminal.has(order.payment_status) || order.sale_id) {
        const rows = await payments(orderId, transaction)
        await transaction.commit()
        await closeConnection()
        return res.json(view(order, rows[0]))
      }
      if (order.status === 'CANCELLED') throw problem(409, 'ORDER_CANCELLED', 'Este pedido está cancelado.')
      const existing = await payments(orderId, transaction, true)
      const sameAttempt = existing.find(row => row.idempotency_key === attempt)
      const pending = existing.find(row => row.status === 'PENDING')
      if (pending?.provider_reference) {
        await transaction.commit()
        await closeConnection()
        await reconcile(order, pending.provider_reference)
        return res.json(view(await owned(orderId, req.customer.id), (await payments(orderId))[0]))
      }
      if (pending && pending.idempotency_key !== attempt) {
        throw problem(409, 'PAYMENT_ATTEMPT_PENDING', 'Uma tentativa anterior ainda está em confirmação. Consulte o pagamento antes de tentar novamente.')
      }
      if (sameAttempt && sameAttempt.status !== 'PENDING') {
        await transaction.commit()
        await closeConnection()
        return res.json(view(order, sameAttempt))
      }
      if (sameAttempt && sameAttempt.method !== paymentInput.method) {
        throw problem(409, 'PAYMENT_ATTEMPT_CHANGED', 'Mantenha a forma de pagamento desta tentativa até a confirmação.')
      }
      if (sameAttempt) stubId = sameAttempt.id
      else {
        const initialPrivate = privacy.pendingFields('payments', { raw_payload: '{}' })
        const [created] = await transaction.execute(
          "INSERT INTO payments(channel,store_order_id,method,provider,provider_reference,status,amount,idempotency_key,raw_payload) VALUES('ONLINE',?,?,?,NULL,'PENDING',?,?,?)",
          [orderId, paymentInput.method, provider, Number(order.total), attempt, initialPrivate.raw_payload]
        )
        stubId = created.insertId
        createdHere = true
        await privacy.updateFields('payments', stubId, { raw_payload: '{}' }, transaction)
      }
      const items = await query('SELECT product_id,variant_id,size_label,product_name,quantity,unit_price,line_total FROM store_order_items WHERE order_id=? ORDER BY id', [orderId], transaction)
      const buyerContext = await buyerForPayment(order, req.customer.id, transaction)
      await transaction.commit()

      // The stub is committed before the external operation. Lock the order
      // again while submitting so a simultaneous request with the same UUID
      // and a differently tokenized card cannot reject the shared attempt
      // while the first request is still creating a charge. Provider requests
      // have a fixed timeout; this lock never spans client interaction.
      await transaction.beginTransaction()
      const currentOrder = await owned(orderId, req.customer.id, transaction)
      const currentPayments = await payments(orderId, transaction, true)
      const attemptNow = currentPayments.find(row => row.idempotency_key === attempt)
      if (terminal.has(currentOrder.payment_status) || currentOrder.sale_id || attemptNow?.provider_reference || attemptNow?.status !== 'PENDING') {
        await transaction.commit()
        await closeConnection()
        if (attemptNow?.provider_reference && !terminal.has(currentOrder.payment_status)) await reconcile(currentOrder, attemptNow.provider_reference)
        return res.json(view(await owned(orderId, req.customer.id), (await payments(orderId))[0]))
      }
      if (currentOrder.status === 'CANCELLED') throw problem(409, 'ORDER_CANCELLED', 'Este pedido está cancelado.')

      // No card token or CPF is saved in our database. If this request times
      // out, the pending UUID remains durable and must be reused on retry.
      let result
      try { result = await createMercadoPagoOnlineOrder({ order, items, payment: paymentInput, idempotencyKey: attempt, buyerContext }) }
      catch (error) {
        // A retry may receive a definitive 4xx only because the original
        // ambiguous call already created an order with a different token.
        // It must never unlock a new attempt/second possible charge.
        if (error?.outcomeUnknown === false && createdHere) {
          const diagnostic = mercadoPagoTestFailureDiagnostic(error)
          if (diagnostic) await privacy.updateFields('payments', stubId, { raw_payload: JSON.stringify({ test_provider_error: diagnostic }) }, transaction)
          await transaction.execute("UPDATE payments SET status='REJECTED' WHERE id=? AND provider_reference IS NULL AND status='PENDING'", [stubId])
          await transaction.commit()
          throw problem(400, 'PAYMENT_NOT_CREATED', 'Não foi possível iniciar o pagamento. Confira os dados e tente novamente.',
            diagnostic && homologationDiagnostics() ? { test_provider_error: diagnostic } : null)
        }
        throw problem(503, 'PAYMENT_RESULT_PENDING', 'A confirmação desta tentativa ainda não chegou. Tente consultar ou repetir esta mesma tentativa.')
      }
      assertBoundOrder(result, order)
      const [providerRows] = await transaction.execute('SELECT * FROM payments WHERE provider=? AND provider_reference=? FOR UPDATE', [provider, String(result.id)])
      const currentPayment = privacy.decodeRow('payments', providerRows[0])
      let paymentId = stubId
      if (currentPayment) {
        if (Number(currentPayment.store_order_id) !== orderId) throw problem(503, 'PAYMENT_CONFIRMATION_UNAVAILABLE', 'Não foi possível conferir este pagamento.')
        paymentId = currentPayment.id
        if (Number(paymentId) !== Number(stubId)) {
          await transaction.execute("DELETE FROM payments WHERE id=? AND provider_reference IS NULL AND status='PENDING'", [stubId])
          await transaction.execute('UPDATE payments SET idempotency_key=COALESCE(idempotency_key,?) WHERE id=?', [attempt, paymentId])
        }
      } else {
        await transaction.execute('UPDATE payments SET provider_reference=? WHERE id=? AND provider_reference IS NULL', [String(result.id), stubId])
      }
      // A webhook may already have approved this payment. Preserve its newer
      // raw state; the shared reconciler also protects status regressions.
      if (!currentPayment || !terminal.has(currentPayment.status)) await privacy.updateFields('payments', paymentId, { raw_payload: JSON.stringify(result) }, transaction)
      if (!terminal.has(currentOrder.payment_status) && !currentOrder.sale_id && currentOrder.status !== 'CANCELLED') {
        await transaction.execute("UPDATE store_orders SET payment_provider=?,payment_method=?,payment_reference=? WHERE id=?", [provider, paymentInput.method, String(result.id), orderId])
      }
      await transaction.commit()
      await closeConnection()
      await processProviderOrder({ eventId: eventKey(result), eventType: 'orders', mpOrder: result })
      const latest = await owned(orderId, req.customer.id)
      if (latest.status === 'CANCELLED') throw problem(409, 'ORDER_CANCELLED', 'Este pedido está cancelado. Se houve cobrança, entre em contato com a loja.')
      return res.json(view(latest, (await payments(orderId))[0]))
    } catch (error) {
      if (transaction) await transaction.rollback().catch(() => {})
      // Netlify may finish the invocation when res.json emits "finish".
      // Connection-scoped locks must be released before any response.
      await closeConnection()
      return failure(res, error, 'Não foi possível iniciar o pagamento. Tente consultar o pedido antes de repetir.')
    } finally { await closeConnection() }
  })
}
