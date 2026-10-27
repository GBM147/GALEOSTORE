import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { businessDate, businessMonthStart } from '../server/expense-management.js'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'

// The harness refuses production, creates a random loopback MySQL schema and
// drops only that schema. No payment, email or media provider may be contacted.
const runtime = new HomeWorkflowRuntime()
const today = businessDate()
let expenseId, recurringId

before(async () => { await runtime.initialize({ port: 10134 }) })
after(async () => {
  try { if (runtime.db) assert.deepEqual(await runtime.providerAttempts(), []) }
  finally { await runtime.close() }
})

async function financialCount() {
  return Number((await runtime.query('SELECT COUNT(*) AS total FROM financial_entries'))[0].total)
}

async function createRecurring(description = 'Aluguel local', amount = 900) {
  const result = await runtime.request('/api/admin/finance/recurring', {
    method: 'POST', body: { description, amount, due_day: 31 }
  })
  assert.equal(result.status, 201)
  return result.data.id
}

test('business calendar uses São Paulo rather than the UTC date at night', () => {
  assert.equal(businessDate(new Date('2026-10-27T01:00:00Z')), '2026-10-26')
  assert.equal(businessMonthStart(new Date('2026-11-01T01:00:00Z')), '2026-10-01')
  assert.equal(businessMonthStart(new Date('2026-11-01T04:00:00Z')), '2026-11-01')
})

test('expense routes require an owner session and CSRF before writing', async () => {
  const before = await financialCount()
  assert.equal((await runtime.request('/api/admin/expenses', { auth: false })).status, 401)
  const denied = await runtime.request('/api/admin/expenses', {
    method: 'POST', csrf: false, body: { description: 'Sem token', amount: 10, date: today }
  })
  assert.equal(denied.status, 403)
  assert.equal(await financialCount(), before)
})

test('a simple expense is recorded as paid with its actual date without account, category or income choices', async () => {
  const created = await runtime.request('/api/admin/expenses', {
    method: 'POST', body: {
      description: ' Água e material de limpeza ', amount: 34.9, date: today,
      type: 'RECEITA', status: 'PENDENTE', account_id: 2147483647, category_id: 2147483647
    }
  })
  assert.equal(created.status, 201)
  expenseId = created.data.id
  assert.equal(created.data.description, 'Água e material de limpeza')
  assert.equal(created.data.date, today)
  assert.equal(Number(created.data.amount), 34.9)
  assert.equal(created.data.recurring, false)
  assert.deepEqual(Object.keys(created.data).sort(), ['amount', 'date', 'description', 'id', 'recurring', 'reference_id'])
  const [entry] = await runtime.query("SELECT *,DATE_FORMAT(paid_at,'%Y-%m-%d') AS paid_date FROM financial_entries WHERE id=?", [expenseId])
  assert.equal(entry.type, 'DESPESA')
  assert.equal(entry.status, 'PAGO')
  assert.equal(entry.paid_date, today)
  assert.equal(entry.account_id, null)
  assert.equal(entry.category_id, null)
})

test('the spending list includes completed expenses and preserves unrelated sales receipts and planned records', async () => {
  const receipt = await runtime.query("INSERT INTO financial_entries(type,description,amount,status,reference_type,reference_id) VALUES('RECEITA','Venda preservada',100,'PAGO','VENDA','sale:expense-fixture')")
  const planned = await runtime.query("INSERT INTO financial_entries(type,description,amount,status) VALUES('DESPESA','Planejamento legado',10,'PENDENTE')")
  const listed = await runtime.request('/api/admin/expenses')
  assert.equal(listed.status, 200)
  assert.ok(listed.data.some(row => row.id === expenseId))
  assert.ok(!listed.data.some(row => [receipt.insertId, planned.insertId].includes(row.id)))
  const removal = await runtime.request('/api/admin/expenses/' + receipt.insertId, { method: 'DELETE' })
  assert.equal(removal.status, 404)
  const [preserved] = await runtime.query('SELECT type,status,amount FROM financial_entries WHERE id=?', [receipt.insertId])
  assert.deepEqual([preserved.type, preserved.status, Number(preserved.amount)], ['RECEITA', 'PAGO', 100])
})

test('invalid descriptions, amounts and future or impossible dates are rejected without a financial record', async () => {
  const before = await financialCount()
  for (const body of [
    { description: '   ', amount: 10, date: today },
    { description: 'Inválido', amount: 0, date: today },
    { description: 'Inválido', amount: 0.000001, date: today },
    { description: 'Inválido', amount: -1, date: today },
    { description: 'Inválido', amount: 1.234, date: today },
    { description: 'Inválido', amount: [], date: today },
    { description: 'Inválido', amount: 10, date: '9999-01-01' },
    { description: 'Inválido', amount: 10, date: '2025-02-30' }
  ]) {
    const response = await runtime.request('/api/admin/expenses', { method: 'POST', body })
    assert.equal(response.status, 400)
  }
  assert.equal(await financialCount(), before)
})

test('removing an expense hides it from spending while preserving its record and payment date', async () => {
  const original = (await runtime.query('SELECT * FROM financial_entries WHERE id=?', [expenseId]))[0]
  const removed = await runtime.request('/api/admin/expenses/' + expenseId, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  const [retained] = await runtime.query('SELECT * FROM financial_entries WHERE id=?', [expenseId])
  assert.equal(retained.status, 'CANCELADO')
  assert.equal(retained.description, original.description)
  assert.equal(retained.amount, original.amount)
  assert.deepEqual(retained.paid_at, original.paid_at)
  assert.ok(!(await runtime.request('/api/admin/expenses')).data.some(row => row.id === expenseId))
  assert.equal((await runtime.request('/api/admin/expenses/' + expenseId, { method: 'DELETE' })).status, 200)
})

test('recurring costs remain reminders until the owner records spending, including concurrent dashboard reads', async () => {
  const before = await financialCount()
  recurringId = await createRecurring()
  const dashboards = await Promise.all(Array.from({ length: 4 }, () => runtime.request('/api/admin/dashboard')))
  for (const response of dashboards) assert.equal(response.status, 200)
  const list = await runtime.request('/api/admin/finance/recurring')
  assert.equal(list.status, 200)
  const row = list.data.find(item => item.id === recurringId)
  assert.equal(row.current_month_recorded, false)
  assert.equal(row.last_recorded_at, null)
  const [year, month] = today.slice(0, 7).split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  assert.equal(row.next_due_date, today.slice(0, 7) + '-' + String(lastDay).padStart(2, '0'))
  assert.equal(await financialCount(), before)
})

test('concurrent confirmations record a recurring expense once and report its paid month', async () => {
  const responses = await Promise.all(Array.from({ length: 4 }, () => runtime.request('/api/admin/finance/recurring/' + recurringId + '/record', {
    method: 'POST', body: { date: today }
  })))
  assert.equal(responses.filter(row => row.status === 201).length, 1)
  assert.equal(responses.filter(row => row.status === 200 && row.data.already_recorded).length, 3)
  const entries = await runtime.query('SELECT * FROM financial_entries WHERE reference_id=?', [`recurring:${recurringId}:${today.slice(0, 7)}`])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].type, 'DESPESA')
  assert.equal(entries[0].status, 'PAGO')
  assert.equal(Number(entries[0].amount), 900)
  const current = (await runtime.request('/api/admin/finance/recurring')).data.find(row => row.id === recurringId)
  assert.equal(current.current_month_recorded, true)
  assert.equal(current.last_recorded_at, today)
})

test('confirming a legacy planned expense preserves its id, description and amount instead of duplicating it', async () => {
  const template = await createRecurring('Modelo com planejamento legado', 27)
  const inserted = await runtime.query(`INSERT INTO financial_entries(type,description,amount,due_date,status,recurring,recurrence,reference_type,reference_id)
    VALUES('DESPESA','Valor originalmente planejado',19,?,'PENDENTE',1,'MENSAL','RECURRING',?)`, [today.slice(0, 7) + '-01', `recurring:${template}:${today.slice(0, 7)}`])
  const before = await financialCount()
  const response = await runtime.request('/api/admin/finance/recurring/' + template + '/record', { method: 'POST', body: { date: today } })
  assert.equal(response.status, 201)
  assert.equal(response.data.entry.id, inserted.insertId)
  assert.equal(response.data.entry.description, 'Valor originalmente planejado')
  assert.equal(Number(response.data.entry.amount), 19)
  assert.equal(response.data.entry.date, today)
  assert.equal(await financialCount(), before)
})

test('a recurring template can be deleted without removing any already recorded or legacy financial rows', async () => {
  await runtime.query(`INSERT INTO financial_entries(type,description,amount,status,recurring,reference_type,reference_id)
    VALUES('DESPESA','Planejamento anterior preservado',900,'PENDENTE',1,'RECURRING',?)`, [`recurring:${recurringId}:2000-01`])
  const before = await runtime.query('SELECT * FROM financial_entries WHERE reference_id LIKE ? ORDER BY id', [`recurring:${recurringId}:%`])
  const removed = await runtime.request('/api/admin/finance/recurring/' + recurringId, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal(removed.data.expenses_preserved, true)
  assert.deepEqual(await runtime.query('SELECT * FROM recurring_expenses WHERE id=?', [recurringId]), [])
  assert.deepEqual(await runtime.query('SELECT * FROM financial_entries WHERE reference_id LIKE ? ORDER BY id', [`recurring:${recurringId}:%`]), before)
  assert.ok(!(await runtime.request('/api/admin/finance/recurring')).data.some(row => row.id === recurringId))
  assert.equal((await runtime.request('/api/admin/finance/recurring/' + recurringId + '/record', { method: 'POST', body: { date: today } })).status, 404)
})

test('an audit failure rolls back a new expense and a recurring-template deletion', async () => {
  const template = await createRecurring('Modelo para auditoria local', 12)
  const before = await financialCount()
  await runtime.adminDb.query(`CREATE TRIGGER \`${runtime.database}\`.reject_expense_audit BEFORE INSERT ON \`${runtime.database}\`.audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Local audit fixture failure'`)
  try {
    const created = await runtime.request('/api/admin/expenses', { method: 'POST', body: { description: 'Não deve persistir', amount: 10, date: today } })
    assert.equal(created.status, 500)
    assert.equal(await financialCount(), before)
    const removed = await runtime.request('/api/admin/finance/recurring/' + template, { method: 'DELETE' })
    assert.equal(removed.status, 500)
    assert.equal((await runtime.query('SELECT id FROM recurring_expenses WHERE id=?', [template])).length, 1)
  } finally {
    await runtime.adminDb.query(`DROP TRIGGER \`${runtime.database}\`.reject_expense_audit`)
  }
})

test('dashboard preserves legacy financial totals while distinguishing products published in the catalog', async () => {
  const baseline = await runtime.request('/api/admin/dashboard')
  assert.equal(baseline.status, 200)
  const before = baseline.data
  await runtime.query("INSERT INTO products(name,description,price,stock,active) VALUES('Produto público local','Fixture local',10,2,1),('Rascunho privado local','Fixture local',10,7,0)")
  const lastMonth = new Date(businessMonthStart() + 'T12:00:00Z')
  lastMonth.setUTCDate(0)
  const oldDate = lastMonth.toISOString().slice(0, 10)
  for (const [type, status, value, date, reference] of [
    ['RECEITA', 'PAGO', 61, today, null],
    ['RECEITA', 'PAGO', 999, today, 'VENDA'],
    ['DESPESA', 'PAGO', 23, today, null],
    ['DESPESA', 'PENDENTE', 17, oldDate, null],
    ['RECEITA', 'PENDENTE', 19, oldDate, null],
    ['RECEITA', 'PAGO', 13, oldDate, null],
    ['DESPESA', 'PAGO', 11, oldDate, null]
  ]) {
    await runtime.query('INSERT INTO financial_entries(type,description,amount,status,paid_at,reference_type) VALUES(?,?,?,?,?,?)',
      [type, 'Resumo financeiro local', value, status, date + ' 12:00:00', reference])
  }
  const count = await financialCount()
  const result = await runtime.request('/api/admin/dashboard')
  assert.equal(result.status, 200)
  const after = result.data
  assert.equal(after.products.count, before.products.count + 2, 'legacy total product count is preserved')
  assert.equal(after.products.active_count, before.products.active_count + 1, 'drafts are excluded only from the published count')
  assert.equal(after.products.stock, before.products.stock + 9)
  for (const [field, increase] of [['income', 61], ['expense', 23], ['payable', 17], ['receivable', 19]]) {
    assert.equal(Math.round(after[field] * 100), Math.round(before[field] * 100) + increase * 100, field)
  }
  assert.equal(await financialCount(), count, 'dashboard must not write financial entries')
})
