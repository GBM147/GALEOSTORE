import { createHash } from 'node:crypto'

const provider = 'MERCADO_PAGO'
const expiredPaymentStatuses = new Set(['REJECTED', 'CANCELLED'])
const candidateStatuses = new Set(['PENDING', 'REJECTED'])

function eligible(order, cutoff) {
  const created = order?.created_at instanceof Date ? order.created_at.getTime() : new Date(order?.created_at).getTime()
  return order?.payment_provider === provider && order.status === 'RECEIVED' &&
    candidateStatuses.has(order.payment_status) && order.sale_id == null &&
    Number.isFinite(created) && created < cutoff.getTime()
}

function boundResponse(value, order, reference) {
  return value && typeof value === 'object' &&
    String(value.id || '') === String(reference) &&
    String(value.external_reference || '') === String(order.code) &&
    Number.isFinite(Number(value.total_amount)) &&
    Number.isFinite(Number(order.total)) &&
    Math.round(Number(value.total_amount) * 100) === Math.round(Number(order.total) * 100)
}

// A provider order can change several times. Deduplicate an observed state,
// never the resource ID alone, so a later approval or refund is not lost.
const eventKey = value => 'reservation-reconcile-' + createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function createPaymentReservationExpiry({ db, query, privacy, restoreReservation, getProviderOrder, processProviderOrder, now = Date.now, ttlMs = 24 * 60 * 60 * 1000 }) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('A validade da reserva deve ser positiva.')
  const decodeOrder = row => privacy?.decodeRow ? privacy.decodeRow('store_orders', row) : row

  async function expire() {
    const instant = Number(typeof now === 'function' ? now() : now)
    if (!Number.isFinite(instant)) throw new TypeError('Data de manutenção inválida.')
    const cutoff = new Date(instant - ttlMs)
    const candidates = await query(
      "SELECT id,code,total,payment_provider,status,payment_status,sale_id,created_at FROM store_orders WHERE payment_provider='MERCADO_PAGO' AND status='RECEIVED' AND payment_status IN ('PENDING','REJECTED') AND sale_id IS NULL AND created_at<? AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.store_order_id=store_orders.id AND (p.status IN ('APPROVED','REFUNDED') OR (p.status='PENDING' AND p.provider_reference IS NULL))) ORDER BY EXISTS (SELECT 1 FROM payments p WHERE p.store_order_id=store_orders.id AND p.status='PENDING'),id LIMIT 50",
      [cutoff]
    )
    const report = { examined: 0, reconciled: 0, expired: 0, skipped: 0, failed: 0 }

    for (const candidate of candidates.slice(0, 50)) {
      report.examined += 1
      let connection
      try {
        if (!eligible(candidate, cutoff)) { report.skipped += 1; continue }
        const attempts = await query('SELECT id,provider,provider_reference,status FROM payments WHERE store_order_id=? ORDER BY id', [candidate.id])
        // Reconcile outside the order transaction: the shared reconciler
        // owns its own locks and may already approve or cancel this order.
        for (const attempt of attempts) {
          if (attempt.status !== 'PENDING' || attempt.provider !== provider || !attempt.provider_reference) continue
          const value = await getProviderOrder(attempt.provider_reference)
          if (!boundResponse(value, candidate, attempt.provider_reference)) throw new Error('PAYMENT_RESERVATION_RECONCILIATION_MISMATCH')
          await processProviderOrder({ eventId: eventKey(value), eventType: 'orders', mpOrder: value })
          report.reconciled += 1
        }

        connection = await db.getConnection()
        await connection.beginTransaction()
        const [rows] = await connection.execute('SELECT * FROM store_orders WHERE id=? FOR UPDATE', [candidate.id])
        const order = rows[0] ? decodeOrder(rows[0]) : null
        if (!eligible(order, cutoff)) {
          await connection.commit()
          report.skipped += 1
          continue
        }
        const [lockedAttempts] = await connection.execute('SELECT id,provider,provider_reference,status FROM payments WHERE store_order_id=? ORDER BY id FOR UPDATE', [order.id])
        // A timed-out creation without a reference can still be a real charge.
        // Age alone is never evidence that a pending provider payment failed.
        if (!lockedAttempts.every(attempt => expiredPaymentStatuses.has(attempt.status))) {
          await connection.commit()
          report.skipped += 1
          continue
        }

        await restoreReservation(connection, order)
        const [updated] = await connection.execute(
          "UPDATE store_orders SET status='CANCELLED',payment_status='CANCELLED' WHERE id=? AND payment_provider='MERCADO_PAGO' AND status='RECEIVED' AND payment_status IN ('PENDING','REJECTED') AND sale_id IS NULL AND created_at<?",
          [order.id, cutoff]
        )
        if (Number(updated.affectedRows) !== 1) {
          await connection.rollback()
          report.skipped += 1
          continue
        }
        await connection.commit()
        report.expired += 1
      } catch {
        if (connection) await connection.rollback().catch(() => {})
        report.failed += 1
      } finally {
        connection?.release()
      }
    }
    return report
  }

  return Object.freeze({ expire })
}
