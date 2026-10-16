export const AUDIT_RETENTION_DAYS = 90
export const AUDIT_EVENT_LIMIT = 5000
export const AUDIT_DETAILS_MAX_BYTES = 4096

function compactValue(value, depth, seen) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return [...value].slice(0, 256).join('')
  if (typeof value !== 'object' || seen.has(value)) return null
  if (depth >= 4) return '[resumo]'
  seen.add(value)
  const result = Array.isArray(value)
    ? value.slice(0, 12).map(child => compactValue(child, depth + 1, seen))
    : Object.fromEntries(Object.entries(value).slice(0, 16).map(([key, child]) => [key.slice(0, 80), compactValue(child, depth + 1, seen)]))
  seen.delete(value)
  return result
}

// Audit stores the action and small context, never full Home snapshots or files.
export function compactAuditDetails(value) {
  if (value === null || value === undefined) return null
  const compact = compactValue(value, 0, new Set())
  if (Buffer.byteLength(JSON.stringify(compact), 'utf8') <= AUDIT_DETAILS_MAX_BYTES) return compact
  const summary = typeof compact === 'object' && compact !== null
    ? Object.fromEntries(Object.entries(compact).slice(0, 8).map(([key, item]) => [key, typeof item === 'object' && item !== null ? '[resumo]' : item]))
    : '[resumo]'
  const result = { truncated: true, summary }
  while (Buffer.byteLength(JSON.stringify(result), 'utf8') > AUDIT_DETAILS_MAX_BYTES && typeof summary === 'object' && summary !== null) {
    delete summary[Object.keys(summary).at(-1)]
  }
  return result
}

export async function pruneAuditLogs(query) {
  const expired = await query('DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)')
  // The derived subquery permits a bounded delete from the same MySQL table.
  const overflow = await query('DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM (SELECT id FROM audit_logs ORDER BY id DESC LIMIT 5000) retained_audit_events)')
  return { expired: Number(expired.affectedRows || 0), overflow: Number(overflow.affectedRows || 0) }
}

export function createAuditRetentionQueue(query, { delayMs = 2000, onError = () => {}, defer } = {}) {
  let timer, running = false, queued = false
  const run = async () => {
    timer = undefined
    if (running) { queued = true; return }
    running = true
    try { await pruneAuditLogs(query) } catch (error) { onError(error) }
    finally {
      running = false
      if (queued) { queued = false; schedule() }
    }
  }
  function schedule() {
    if (defer) {
      // Serverless invocations must own this work; an unref'ed timer can be
      // frozen as soon as the HTTP response is ready. Do not await here: audit
      // can be part of an open transaction that must commit before pruning.
      defer(() => pruneAuditLogs(query).catch(onError))
      return
    }
    if (timer || running) { queued = true; return }
    timer = setTimeout(run, delayMs)
    timer.unref?.()
  }
  return { schedule, run, close() { if (timer) clearTimeout(timer); timer = undefined } }
}
