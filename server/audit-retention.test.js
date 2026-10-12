import assert from 'node:assert/strict'
import test from 'node:test'
import { AUDIT_DETAILS_MAX_BYTES, compactAuditDetails, pruneAuditLogs } from './audit-retention.js'

test('small audit context retains its original meaning', () => {
  assert.equal(compactAuditDetails(null), null)
  assert.deepEqual(compactAuditDetails({ version: 9, sections: 7 }), { version: 9, sections: 7 })
  assert.deepEqual(compactAuditDetails({ count: 2, use_ai: false }), { count: 2, use_ai: false })
})
test('audit context is bounded in UTF-8 even with large multibyte fields, arrays and cyclic objects', () => {
  const value = Object.fromEntries(Array.from({ length: 64 }, (_, index) => ['字段'.repeat(40) + index, '🙂'.repeat(4000)]))
  value.huge = Array.from({ length: 5000 }, () => ({ content: 'a'.repeat(5000) }))
  value.cycle = value
  const compact = compactAuditDetails(value)
  assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') <= AUDIT_DETAILS_MAX_BYTES)
  assert.notEqual(compact, value)
  assert.equal(value.cycle, value)
})
test('retention removes expired events and then events outside the most recent 5000', async () => {
  const statements = []
  const report = await pruneAuditLogs(async statement => { statements.push(statement); return { affectedRows: statements.length } })
  assert.match(statements[0], /created_at < DATE_SUB\(NOW\(\), INTERVAL 90 DAY\)/)
  assert.match(statements[1], /ORDER BY id DESC LIMIT 5000/)
  assert.deepEqual(report, { expired: 1, overflow: 2 })
})
