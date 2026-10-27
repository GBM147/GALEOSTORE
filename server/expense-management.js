// Store owners record a cost after spending; recurring rows are reusable
// reminders, not proof that a payment happened.
class ExpenseError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now)
  const get = type => parts.find(part => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function businessMonthStart(now = new Date()) {
  return businessDate(now).slice(0, 7) + '-01'
}

function expenseDate(input, today) {
  const value = input === undefined || input === '' ? today : input
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ExpenseError('Informe uma data válida para o gasto.')
  const parsed = new Date(value + 'T12:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1000) {
    throw new ExpenseError('Informe uma data válida para o gasto.')
  }
  if (value > today) throw new ExpenseError('Registre o gasto depois de realizá-lo. A data não pode estar no futuro.')
  return value
}

function description(input) {
  if (typeof input !== 'string' || !input.trim() || Array.from(input.trim()).length > 255) {
    throw new ExpenseError('Descreva o gasto em até 255 caracteres.')
  }
  return input.trim()
}

function amount(input) {
  if (!['string', 'number'].includes(typeof input) || (typeof input === 'string' && !input.trim())) throw new ExpenseError('Informe um valor válido para o gasto.')
  const value = Number(input), scaled = value * 100, cents = Math.round(scaled)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4
  if (!Number.isFinite(value) || cents < 1 || value > 9999999999.99 || Math.abs(scaled - cents) > tolerance) {
    throw new ExpenseError('O valor do gasto deve ser positivo e ter até duas casas decimais.')
  }
  return cents / 100
}

function id(input) {
  const value = Number(input)
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new ExpenseError('Registro inválido.')
  return value
}

function expenseView(row) {
  return {
    id: row.id, description: row.description, amount: row.amount,
    date: row.expense_date, recurring: Boolean(row.recurring), reference_id: row.reference_id || null
  }
}

export function registerExpenseManagement(app, { db, query, audit, exigirLogin, insertPrivateBusiness, now = () => new Date() }) {
  const today = () => businessDate(now())
  const readExpense = async (entryId, conn) => {
    const rows = await query(`SELECT e.*, DATE_FORMAT(COALESCE(e.paid_at,e.due_date,e.created_at),'%Y-%m-%d') AS expense_date
      FROM financial_entries e WHERE e.id=?`, [entryId], conn)
    return rows[0] ? expenseView(rows[0]) : null
  }
  const failure = (res, error, message) => {
    if (error instanceof ExpenseError) return res.status(error.status).json({ error: error.message })
    console.error(message, error?.code || 'EXPENSE_OPERATION_FAILED')
    return res.status(500).json({ error: message })
  }
  const transaction = async work => {
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const result = await work(conn)
      await conn.commit()
      return result
    } catch (error) {
      await conn.rollback().catch(() => {})
      throw error
    } finally { conn.release() }
  }

  app.get('/api/admin/expenses', exigirLogin, async (req, res) => {
    try {
      const rows = await query(`SELECT e.*, DATE_FORMAT(COALESCE(e.paid_at,e.due_date,e.created_at),'%Y-%m-%d') AS expense_date
        FROM financial_entries e WHERE e.type='DESPESA' AND e.status='PAGO'
        ORDER BY COALESCE(e.paid_at,e.due_date,e.created_at) DESC,e.id DESC LIMIT 500`)
      res.json(rows.map(expenseView))
    } catch (error) { failure(res, error, 'Não foi possível carregar os gastos da loja.') }
  })

  app.post('/api/admin/expenses', exigirLogin, async (req, res) => {
    try {
      const text = description(req.body?.description), value = amount(req.body?.amount)
      const date = expenseDate(req.body?.date, today())
      const result = await transaction(async conn => {
        const created = await insertPrivateBusiness(conn, 'financial_entries',
          `INSERT INTO financial_entries(type,description,amount,due_date,paid_at,status,recurring,user_id)
           VALUES('DESPESA',?,?,?,?,'PAGO',0,?)`,
          [text, value, date, date + ' 00:00:00', req.admin.id], { description: 0 })
        await audit(req.admin.id, 'CRIAR', 'gasto', created.insertId, { amount: value, date }, conn)
        return readExpense(created.insertId, conn)
      })
      res.status(201).json(result)
    } catch (error) { failure(res, error, 'Não foi possível registrar o gasto.') }
  })

  app.delete('/api/admin/expenses/:id', exigirLogin, async (req, res) => {
    try {
      const entryId = id(req.params.id)
      await transaction(async conn => {
        const [entry] = await query('SELECT * FROM financial_entries WHERE id=? FOR UPDATE', [entryId], conn)
        if (!entry || entry.type !== 'DESPESA' || entry.reference_type === 'VENDA') throw new ExpenseError('Gasto não encontrado.', 404)
        if (entry.status === 'CANCELADO') return
        await conn.execute("UPDATE financial_entries SET status='CANCELADO' WHERE id=?", [entryId])
        await audit(req.admin.id, 'EXCLUIR', 'gasto', entryId, { amount: Number(entry.amount) }, conn)
      })
      res.json({ success: true, mode: 'cancelled' })
    } catch (error) { failure(res, error, 'Não foi possível remover o gasto.') }
  })

  app.get('/api/admin/finance/recurring', exigirLogin, async (req, res) => {
    try {
      const currentDate = today(), month = currentDate.slice(0, 7)
      // Separate table reads preserve authenticated field decoding and avoid
      // repeated queries for each template.
      const [templates, recorded] = await Promise.all([
        query('SELECT * FROM recurring_expenses WHERE active=1 ORDER BY due_day,id'),
        query(`SELECT reference_id, DATE_FORMAT(paid_at,'%Y-%m-%d') AS recorded_date
          FROM financial_entries WHERE type='DESPESA' AND status='PAGO' AND reference_type='RECURRING'`)
      ])
      const paidByReference = new Map(recorded.map(row => [row.reference_id, row.recorded_date]))
      const latest = new Map()
      for (const row of recorded) {
        const match = /^recurring:(\d+):\d{4}-\d{2}$/.exec(row.reference_id || '')
        if (match && row.recorded_date && (!latest.has(match[1]) || latest.get(match[1]) < row.recorded_date)) latest.set(match[1], row.recorded_date)
      }
      const [year, monthNumber] = month.split('-').map(Number)
      const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
      res.json(templates.map(row => ({
        id: row.id, description: row.description, amount: row.amount, due_day: row.due_day,
        current_month: month, current_month_recorded: paidByReference.has(`recurring:${row.id}:${month}`),
        last_recorded_at: latest.get(String(row.id)) || null,
        next_due_date: `${month}-${String(Math.min(Number(row.due_day), lastDay)).padStart(2, '0')}`
      })))
    } catch (error) { failure(res, error, 'Não foi possível carregar os gastos recorrentes.') }
  })

  app.post('/api/admin/finance/recurring', exigirLogin, async (req, res) => {
    try {
      const text = description(req.body?.description), value = amount(req.body?.amount), dueDay = Number(req.body?.due_day)
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new ExpenseError('Informe um dia entre 1 e 31 para o gasto recorrente.')
      const result = await transaction(async conn => {
        const created = await insertPrivateBusiness(conn, 'recurring_expenses',
          'INSERT INTO recurring_expenses(description,amount,due_day) VALUES(?,?,?)', [text, value, dueDay], { description: 0 })
        await audit(req.admin.id, 'CRIAR', 'despesa_recorrente', created.insertId, null, conn)
        return { id: created.insertId, description: text, amount: value, due_day: dueDay, current_month_recorded: false, last_recorded_at: null }
      })
      res.status(201).json(result)
    } catch (error) { failure(res, error, 'Não foi possível criar o gasto recorrente.') }
  })

  app.post('/api/admin/finance/recurring/:id/record', exigirLogin, async (req, res) => {
    try {
      const recurringId = id(req.params.id), date = expenseDate(req.body?.date, today())
      const reference = `recurring:${recurringId}:${date.slice(0, 7)}`
      const result = await transaction(async conn => {
        // A template lock serializes confirmations and deletion, including two
        // clicks or a retry after the first response was lost.
        const [template] = await query('SELECT * FROM recurring_expenses WHERE id=? AND active=1 FOR UPDATE', [recurringId], conn)
        if (!template) throw new ExpenseError('Gasto recorrente não encontrado.', 404)
        const [existing] = await query('SELECT * FROM financial_entries WHERE reference_id=? FOR UPDATE', [reference], conn)
        if (existing && (existing.type !== 'DESPESA' || existing.reference_type !== 'RECURRING')) throw new ExpenseError('Já existe outro lançamento para esta referência.', 409)
        if (existing?.status === 'PAGO') return { entry: await readExpense(existing.id, conn), already_recorded: true }
        let entryId
        if (existing) {
          // Preserve the description and amount of a legacy planned expense;
          // confirmation changes its payment state, not the old commercial data.
          await conn.execute("UPDATE financial_entries SET status='PAGO',paid_at=?,user_id=COALESCE(user_id,?) WHERE id=?", [date + ' 00:00:00', req.admin.id, existing.id])
          entryId = existing.id
        } else {
          const created = await insertPrivateBusiness(conn, 'financial_entries',
            `INSERT INTO financial_entries(account_id,category_id,type,description,amount,due_date,paid_at,status,recurring,recurrence,reference_type,reference_id,user_id)
             VALUES(?,?,'DESPESA',?,?,?,?,'PAGO',1,'MENSAL','RECURRING',?,?)`,
            [template.account_id, template.category_id, template.description, Number(template.amount), date, date + ' 00:00:00', reference, req.admin.id], { description: 2 })
          entryId = created.insertId
        }
        await audit(req.admin.id, 'REGISTRAR', 'gasto_recorrente', recurringId, { expense_id: entryId, month: date.slice(0, 7) }, conn)
        return { entry: await readExpense(entryId, conn), already_recorded: false }
      })
      res.status(result.already_recorded ? 200 : 201).json({ success: true, ...result })
    } catch (error) { failure(res, error, 'Não foi possível registrar o gasto recorrente.') }
  })

  app.delete('/api/admin/finance/recurring/:id', exigirLogin, async (req, res) => {
    try {
      const recurringId = id(req.params.id)
      await transaction(async conn => {
        const [template] = await query('SELECT * FROM recurring_expenses WHERE id=? FOR UPDATE', [recurringId], conn)
        if (!template) throw new ExpenseError('Gasto recorrente não encontrado.', 404)
        await conn.execute('DELETE FROM recurring_expenses WHERE id=?', [recurringId])
        await audit(req.admin.id, 'EXCLUIR', 'despesa_recorrente', recurringId, { recorded_expenses_preserved: true }, conn)
      })
      res.json({ success: true, expenses_preserved: true })
    } catch (error) { failure(res, error, 'Não foi possível remover o gasto recorrente.') }
  })
}
