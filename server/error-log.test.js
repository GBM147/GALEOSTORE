import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { captureConsoleErrors, createErrorLog, ERROR_EVENTS_DDL, routeLabel, safeCode, safeContext } from './error-log.js'

function fakeQuery({ missing = false, failDdl = 0 } = {}) {
  const calls = []
  const query = async (sql, params) => {
    calls.push({ sql, params })
    if (sql === ERROR_EVENTS_DDL && failDdl > 0) { failDdl--; throw Object.assign(new Error('denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' }) }
    if (missing && /error_events/.test(sql) && !sql.startsWith('CREATE')) throw Object.assign(new Error('missing'), { code: 'ER_NO_SUCH_TABLE' })
    return sql.startsWith('DELETE') ? { affectedRows: 2 } : []
  }
  return { query, calls }
}
const response = status => Object.assign(new EventEmitter(), { statusCode: status })

test('rota guarda o modelo, sem números, tokens ou query string', () => {
  assert.equal(routeLabel({ baseUrl: '', route: { path: '/api/store/orders/:id/payment' }, originalUrl: '/api/store/orders/42/payment?x=1' }), '/api/store/orders/:id/payment')
  assert.equal(routeLabel({ originalUrl: '/api/store/orders/42/payment?email=a@b.com' }), '/api/store/orders/:id/payment')
  assert.equal(routeLabel({ originalUrl: '/api/customer/verify/abcdefghijklmnopqrstuvwxyz123456' }), '/api/customer/verify/:token')
})

test('mensagem e código não carregam dados pessoais', () => {
  assert.equal(safeContext('Erro ao avisar ana.maria@example.com sobre o pedido 123456:\n'), 'Erro ao avisar [email] sobre o pedido [n]:')
  assert.equal(safeContext({ message: 'x' }), '')
  assert.equal(safeCode({ code: 'ER_LOCK_DEADLOCK' }), 'ER_LOCK_DEADLOCK')
  assert.equal(safeCode({ code: 'texto com espaço e cpf 123' }), '')
  assert.equal(safeCode(new TypeError('x')), 'TypeError')
})

test('só respostas 5xx viram registro, com código e mensagem fixa do console', async () => {
  const { query, calls } = fakeQuery(), deferred = []
  const log = createErrorLog({ query, defer: promise => deferred.push(promise) })
  const target = { error: () => {} }
  captureConsoleErrors(target)
  captureConsoleErrors(target)
  const req = { method: 'GET', baseUrl: '', route: { path: '/api/store' }, originalUrl: '/api/store', get: name => name === 'x-nf-request-id' ? '01HXREQ' : '' }
  const failing = response(500)
  log.middleware(req, failing, () => target.error('Erro no catálogo:', Object.assign(new Error('Table x.products for cliente@example.com'), { code: 'ER_NO_SUCH_TABLE' })))
  failing.emit('finish')
  const fine = response(404)
  log.middleware(req, fine, () => {})
  fine.emit('finish')
  await Promise.all(deferred)
  const inserts = calls.filter(call => call.sql.startsWith('INSERT'))
  assert.deepEqual(inserts.map(call => call.params), [['GET', '/api/store', 500, 'ER_NO_SUCH_TABLE', 'Erro no catálogo:', '01HXREQ']])
  assert.equal(JSON.stringify(calls).includes('cliente@example.com'), false)
  assert.equal(calls.filter(call => call.sql === ERROR_EVENTS_DDL).length, 1)
})

test('resposta 5xx planejada guarda o código seguro que ela mesma devolve', async () => {
  const { query, calls } = fakeQuery(), deferred = []
  const log = createErrorLog({ query, defer: promise => deferred.push(promise) })
  const res = Object.assign(response(200), { json(body) { this.body = body; return this } })
  log.middleware({ method: 'POST', originalUrl: '/api/store/orders/42/payment', get: () => '' }, res, () => { res.statusCode = 503; res.json({ error: 'A confirmação ainda não chegou.', code: 'PAYMENT_RESULT_PENDING' }) })
  assert.deepEqual(res.body, { error: 'A confirmação ainda não chegou.', code: 'PAYMENT_RESULT_PENDING' })
  res.emit('finish')
  await Promise.all(deferred)
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT')).params, ['POST', '/api/store/orders/:id/payment', 503, 'PAYMENT_RESULT_PENDING', null, null])
})

test('limite por minuto evita inundar o banco durante uma queda', async () => {
  let time = 0
  const { query, calls } = fakeQuery()
  const log = createErrorLog({ query, now: () => time })
  for (let index = 0; index < 40; index++) await log.record({ method: 'GET', route: '/api/store', status: 503 })
  assert.equal(calls.filter(call => call.sql.startsWith('INSERT')).length, 30)
  time = 60001
  assert.equal(await log.record({ method: 'GET', route: '/api/store', status: 503 }), true)
})

test('sem permissão para criar a tabela o registro só fica desligado e tenta de novo depois', async () => {
  const { query, calls } = fakeQuery({ failDdl: 1 })
  const log = createErrorLog({ query })
  assert.equal(await log.record({ method: 'GET', route: '/x', status: 500 }), false)
  assert.equal(await log.record({ method: 'GET', route: '/x', status: 500 }), true)
  assert.equal(calls.filter(call => call.sql === ERROR_EVENTS_DDL).length, 2)
})

test('lista e limpeza toleram a tabela ainda não criada', async () => {
  const missing = createErrorLog({ query: fakeQuery({ missing: true }).query })
  assert.deepEqual(await missing.list(), { available: true, retention_days: 30, events: [] })
  assert.deepEqual(await missing.prune(), { expired: 0, overflow: 0 })
  const { query, calls } = fakeQuery()
  const log = createErrorLog({ query })
  await log.list(9999)
  assert.match(calls.at(-1).sql, /ORDER BY id DESC LIMIT 200$/)
  assert.deepEqual(await log.prune(), { expired: 2, overflow: 2 })
  assert.match(calls.at(-2).sql, /INTERVAL 30 DAY/)
  assert.match(calls.at(-1).sql, /LIMIT 2000\)/)
})
