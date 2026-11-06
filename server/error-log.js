import { AsyncLocalStorage } from 'node:async_hooks'

// Server errors (HTTP 5xx) kept in the store's own MySQL for the owners' Admin.
// Only technical data is stored: method, route template, status, error code, the
// constant log message and the request id. Never bodies, query strings or names.
export const ERROR_RETENTION_DAYS = 30
export const ERROR_EVENT_LIMIT = 2000
export const ERROR_EVENTS_PER_MINUTE = 30

export const ERROR_EVENTS_DDL = `CREATE TABLE IF NOT EXISTS error_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  method VARCHAR(8) NOT NULL,
  route VARCHAR(160) NOT NULL,
  status SMALLINT UNSIGNED NOT NULL,
  code VARCHAR(64) NULL,
  context VARCHAR(120) NULL,
  request_id VARCHAR(80) NULL,
  KEY idx_error_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

const requests = new AsyncLocalStorage()
const missingTable = error => error?.code === 'ER_NO_SUCH_TABLE'

export function routeLabel(req) {
  const template = req?.route?.path && typeof req.route.path === 'string' ? String(req.baseUrl || '') + req.route.path : ''
  const path = template || String(req?.originalUrl || req?.url || '').split('?')[0]
  return path.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:token').replace(/[^\x20-\x7e]/g, '').slice(0, 160) || '/'
}

export function safeContext(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]').replace(/\d{4,}/g, '[n]').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function safeCode(error) {
  const code = error && typeof error === 'object' ? (error.code || error.name) : ''
  return typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : ''
}

const requestIdOf = req => {
  const value = String(req?.get?.('x-nf-request-id') || req?.requestContext?.requestId || '')
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : ''
}

export function createErrorLog({ query, now = () => Date.now(), defer = promise => promise }) {
  let tableReady = null, windowStart = 0, written = 0

  // The explicit migration creates the table; this covers a deploy that has
  // not been migrated yet. A failure only disables the log, never the request.
  function ensureTable() {
    tableReady ??= query(ERROR_EVENTS_DDL).then(() => true, () => { tableReady = null; return false })
    return tableReady
  }

  async function record(event) {
    const time = now()
    if (time - windowStart >= 60000) { windowStart = time; written = 0 }
    if (written >= ERROR_EVENTS_PER_MINUTE) return false
    written++
    if (!(await ensureTable())) return false
    await query('INSERT INTO error_events(method,route,status,code,context,request_id) VALUES(?,?,?,?,?,?)',
      [String(event.method || 'GET').slice(0, 8), event.route, event.status, event.code || null, event.context || null, event.requestId || null])
    return true
  }

  function middleware(req, res, next) {
    const store = { code: '', context: '' }
    // Designed 5xx responses already carry a safe machine code, e.g. PAYMENT_RESULT_PENDING.
    const json = typeof res.json === 'function' ? res.json.bind(res) : null
    if (json) res.json = body => {
      if (res.statusCode >= 500 && !store.code && body && typeof body === 'object') store.code = safeCode({ code: body.code })
      return json(body)
    }
    res.on('finish', () => {
      if (res.statusCode < 500) return
      const event = { method: req.method, route: routeLabel(req), status: res.statusCode, code: store.code, context: store.context, requestId: requestIdOf(req) }
      defer(record(event).catch(() => false))
    })
    requests.run(store, next)
  }

  async function list(limit = 100) {
    const size = Math.min(200, Math.max(1, Math.trunc(Number(limit)) || 100))
    try {
      const rows = await query('SELECT id,created_at,method,route,status,code,context,request_id FROM error_events ORDER BY id DESC LIMIT ' + size)
      return { available: true, retention_days: ERROR_RETENTION_DAYS, events: rows }
    } catch (error) {
      if (missingTable(error)) return { available: true, retention_days: ERROR_RETENTION_DAYS, events: [] }
      throw error
    }
  }

  async function prune() {
    try {
      const expired = await query('DELETE FROM error_events WHERE created_at < DATE_SUB(NOW(3), INTERVAL ' + ERROR_RETENTION_DAYS + ' DAY)')
      // The derived subquery permits a bounded delete from the same MySQL table.
      const overflow = await query('DELETE FROM error_events WHERE id NOT IN (SELECT id FROM (SELECT id FROM error_events ORDER BY id DESC LIMIT ' + ERROR_EVENT_LIMIT + ') kept_error_events)')
      return { expired: Number(expired.affectedRows || 0), overflow: Number(overflow.affectedRows || 0) }
    } catch (error) {
      if (missingTable(error)) return { expired: 0, overflow: 0 }
      throw error
    }
  }

  return { middleware, record, list, prune, ensureTable }
}

// While a request is handled, console.error calls leave the constant message
// and the error code for that request's error event. Output is unchanged.
export function captureConsoleErrors(target = console) {
  if (target.error?.__galeoErrorCapture) return
  const original = target.error.bind(target)
  const wrapped = (...args) => {
    const store = requests.getStore()
    if (store) {
      if (!store.context) store.context = safeContext(args.find(arg => typeof arg === 'string') || '')
      if (!store.code) store.code = safeCode(args.find(arg => arg && typeof arg === 'object')) || safeCode({ code: args.find(arg => typeof arg === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(arg)) })
    }
    return original(...args)
  }
  wrapped.__galeoErrorCapture = true
  target.error = wrapped
}
