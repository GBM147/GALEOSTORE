import { createDataProtection, DataProtectionError, normalizeEmail } from './data-protection.js'

export const PRIVATE_FIELD_MAP = Object.freeze({
  customers: Object.freeze(['name', 'email', 'phone']),
  admin_users: Object.freeze(['email']),
  store_orders: Object.freeze(['customer_name', 'customer_email', 'customer_phone', 'postal_code', 'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'notes', 'payment_url']),
  sales: Object.freeze(['customer_name', 'notes']),
  financial_entries: Object.freeze(['description']),
  recurring_expenses: Object.freeze(['description']),
  stock_movements: Object.freeze(['reason']),
  payments: Object.freeze(['raw_payload', 'payment_url']),
  integration_events: Object.freeze(['payload']),
  audit_logs: Object.freeze(['details'])
})

const JSON_FIELDS = new Set(['payments.raw_payload', 'integration_events.payload', 'audit_logs.details'])
const NULL_FIELDS = new Set(['store_orders.notes', 'store_orders.payment_url', 'sales.notes', 'payments.raw_payload', 'payments.payment_url', 'audit_logs.details'])
const FIELD_LIMITS = Object.freeze({
  'customers.name': 180, 'customers.email': 255, 'customers.phone': 40,
  'admin_users.email': 255,
  'store_orders.customer_name': 180, 'store_orders.customer_email': 255, 'store_orders.customer_phone': 40,
  'store_orders.postal_code': 20, 'store_orders.street': 180, 'store_orders.number': 40,
  'store_orders.complement': 120, 'store_orders.neighborhood': 120, 'store_orders.city': 120,
  'store_orders.state': 2, 'store_orders.payment_url': 1200,
  'sales.customer_name': 180, 'financial_entries.description': 255,
  'recurring_expenses.description': 255, 'stock_movements.reason': 255, 'payments.payment_url': 1200
})
const TABLES = Object.keys(PRIVATE_FIELD_MAP)

export function isProtectedTable(table) {
  return Object.hasOwn(PRIVATE_FIELD_MAP, table)
}

function fail(code, message) {
  throw new DataProtectionError(code, message)
}

function fieldsFor(table) {
  if (!Object.hasOwn(PRIVATE_FIELD_MAP, table)) fail('DATA_TABLE_INVALID', 'Tabela não autorizada para proteção de dados.')
  return PRIVATE_FIELD_MAP[table]
}

function rowContext(table, id) {
  fieldsFor(table)
  if (!['string', 'number'].includes(typeof id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) fail('DATA_ROW_INVALID', 'Identificador da linha protegida inválido.')
  return { table, field: 'private_data', rowId: String(Number(id)) }
}

function jsonValue(table, field, value) {
  if (value === undefined) fail('DATA_VALUE_INVALID', 'Campo privado sem valor definido.')
  if (!JSON_FIELDS.has(table + '.' + field) || value === null || typeof value !== 'string') return value
  try { return JSON.parse(value) }
  catch { fail('DATA_VALUE_INVALID', 'Campo privado JSON inválido.') }
}

function validateField(table, field, value) {
  const name = table + '.' + field
  if (value === null && NULL_FIELDS.has(name)) return value
  if (JSON_FIELDS.has(name)) {
    try {
      const serialized = JSON.stringify(value)
      if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) throw new Error('invalid')
    } catch {
      fail('DATA_VALUE_INVALID', 'O campo privado JSON é inválido ou excede 1 MB.')
    }
    return value
  }
  if (typeof value !== 'string') fail('DATA_VALUE_INVALID', 'O campo privado deve conter texto.')
  if (FIELD_LIMITS[name] && Array.from(value).length > FIELD_LIMITS[name]) {
    fail('DATA_VALUE_INVALID', 'O campo privado excede o limite permitido.')
  }
  if (field === 'notes' && Buffer.byteLength(value, 'utf8') > 65535) {
    fail('DATA_VALUE_INVALID', 'As observações privadas excedem o limite permitido.')
  }
  return value
}

function originalFields(table, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('DATA_VALUE_INVALID', 'Informe os campos privados em um objeto.')
  return Object.fromEntries(fieldsFor(table)
    .filter(field => Object.hasOwn(record, field))
    .map(field => [field, validateField(table, field, jsonValue(table, field, record[field]))]))
}

function sqlValue(table, field, value) {
  return JSON_FIELDS.has(table + '.' + field) && value !== null ? JSON.stringify(value) : value
}

async function execute(executor, sql, parameters = []) {
  if (!executor || typeof executor.execute !== 'function') fail('DATA_DATABASE_INVALID', 'Conexão MySQL não configurada para proteção de dados.')
  const [result] = await executor.execute(sql, parameters)
  return result
}

/**
 * Writes belong to the caller's transaction: pass its MySQL connection to
 * completeInsert/updateFields, and commit only after all protected writes pass.
 */
export function createDatabasePrivacy({
  db,
  enabled = process.env.DATA_ENCRYPTION_ENABLED === 'true',
  key = process.env.DATA_ENCRYPTION_KEY,
  keyId = process.env.DATA_ENCRYPTION_KEY_ID || 'primary'
} = {}) {
  if (typeof enabled !== 'boolean') fail('DATA_CONFIG_INVALID', 'DATA_ENCRYPTION_ENABLED deve ser true ou false.')
  const protection = enabled ? createDataProtection({ key, keyId }) : null

  function emailForLookup(table, email) {
    fieldsFor(table)
    if (!['customers', 'admin_users'].includes(table)) fail('DATA_TABLE_INVALID', 'Esta tabela não usa consulta protegida de e-mail.')
    const normalized = normalizeEmail(email)
    return enabled ? 'private-' + protection.emailLookup(normalized, table + '.email') + '@galeo.invalid' : normalized
  }

  function blankField(table, field, value) {
    if (field === 'email' && ['customers', 'admin_users'].includes(table)) return emailForLookup(table, value)
    if (table === 'integration_events' && field === 'payload') return '{}'
    return NULL_FIELDS.has(table + '.' + field) ? null : ''
  }

  function pendingFields(table, record) {
    const originals = originalFields(table, record)
    return Object.fromEntries(Object.entries(originals).map(([field, value]) => [
      field, enabled ? blankField(table, field, value) : sqlValue(table, field, value)
    ]))
  }

  function privateFields(table, row) {
    fieldsFor(table)
    if (row.private_data == null) {
      fail('DATA_PLAINTEXT_FOUND', 'Uma linha privada ainda não foi protegida; a operação foi bloqueada.')
    }
    if (!enabled) fail('DATA_ENCRYPTION_DOWNGRADE', 'Há dados protegidos no banco; configure a chave e mantenha a proteção habilitada.')
    const restored = protection.decryptJSON(row.private_data, rowContext(table, row.id))
    if (!restored || typeof restored !== 'object' || Array.isArray(restored)) fail('DATA_VALUE_INVALID', 'O payload privado da linha deve ser um objeto.')
    return originalFields(table, restored)
  }

  function decodeRow(table, row) {
    if (!isProtectedTable(table)) return row
    const fields = fieldsFor(table)
    if (row == null) return row
    const result = { ...row }
    delete result.private_data
    if (!enabled) {
      if (row.private_data != null) fail('DATA_ENCRYPTION_DOWNGRADE', 'Há dados protegidos no banco; configure a chave e mantenha a proteção habilitada.')
      return result
    }
    if (!fields.some(field => Object.hasOwn(row, field))) {
      if (row.private_data != null) privateFields(table, row)
      return result
    }
    const restored = privateFields(table, row)
    for (const field of fields) {
      if (Object.hasOwn(row, field) && Object.hasOwn(restored, field)) result[field] = restored[field]
    }
    return result
  }

  function decodeRows(table, rows) {
    if (!Array.isArray(rows)) fail('DATA_VALUE_INVALID', 'O resultado protegido deve ser uma lista de linhas.')
    if (!isProtectedTable(table)) return rows
    return rows.map(row => decodeRow(table, row))
  }

  async function completeInsert(table, id, record, executor = db) {
    rowContext(table, id)
    const originals = originalFields(table, record)
    if (!enabled) return
    const blanks = pendingFields(table, originals)
    const assignments = [...Object.keys(blanks).map(field => '`' + field + '`=?'), '`private_data`=?']
    const payload = protection.encryptJSON(originals, rowContext(table, id))
    const result = await execute(executor,
      'UPDATE `' + table + '` SET ' + assignments.join(',') + ' WHERE id=? AND private_data IS NULL',
      [...Object.values(blanks), JSON.stringify(payload), id])
    if (result.affectedRows !== 1) fail('DATA_INSERT_INVALID', 'A linha nova não existe ou já possui dados protegidos.')
  }

  async function updateFields(table, id, partialRecord, executor = db) {
    rowContext(table, id)
    const partial = originalFields(table, partialRecord)
    if (!Object.keys(partial).length) return
    const rows = await execute(executor, 'SELECT * FROM `' + table + '` WHERE id=? FOR UPDATE', [id])
    if (!rows.length) fail('DATA_ROW_MISSING', 'A linha privada não foi encontrada.')
    const current = rows[0]
    if (!enabled) {
      if (current.private_data != null) fail('DATA_ENCRYPTION_DOWNGRADE', 'Há dados protegidos no banco; configure a chave e mantenha a proteção habilitada.')
      const assignments = Object.keys(partial).map(field => '`' + field + '`=?')
      await execute(executor, 'UPDATE `' + table + '` SET ' + assignments.join(',') + ' WHERE id=?',
        [...Object.entries(partial).map(([field, value]) => sqlValue(table, field, value)), id])
      return
    }
    const originals = { ...(current.private_data == null ? originalFields(table, current) : privateFields(table, current)), ...partial }
    const blanks = pendingFields(table, originals)
    const assignments = [...Object.keys(blanks).map(field => '`' + field + '`=?'), '`private_data`=?']
    const payload = protection.encryptJSON(originals, rowContext(table, id))
    await execute(executor, 'UPDATE `' + table + '` SET ' + assignments.join(',') + ' WHERE id=?',
      [...Object.values(blanks), JSON.stringify(payload), id])
  }

  async function ensureSchemaAndMigrate({ batchSize = 100 } = {}) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) fail('DATA_CONFIG_INVALID', 'Tamanho de lote da migração inválido.')
    if (!db || typeof db.getConnection !== 'function') fail('DATA_DATABASE_INVALID', 'Pool MySQL não configurado para migração.')
    for (const table of TABLES) {
      const columns = await execute(db,
        'SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1', [table, 'private_data'])
      if (!columns.length) await execute(db, 'ALTER TABLE `' + table + '` ADD COLUMN private_data JSON NULL')
    }
    let validated = 0
    for (const table of TABLES) {
      let lastId = 0
      while (true) {
        const rows = await execute(db, 'SELECT id,private_data FROM `' + table + '` WHERE private_data IS NOT NULL AND id>? ORDER BY id LIMIT ' + batchSize, [lastId])
        if (!rows.length) break
        if (!enabled) fail('DATA_ENCRYPTION_DOWNGRADE', 'Há dados protegidos no banco; configure a chave e mantenha a proteção habilitada.')
        for (const row of rows) privateFields(table, row)
        validated += rows.length
        lastId = Number(rows.at(-1).id)
      }
    }
    if (!enabled) return { enabled: false, migrated: 0, validated }
    let migrated = 0
    for (const table of TABLES) {
      let lastId = 0
      while (true) {
        const candidates = await execute(db, 'SELECT id FROM `' + table + '` WHERE private_data IS NULL AND id>? ORDER BY id LIMIT ' + batchSize, [lastId])
        if (!candidates.length) break
        for (const candidate of candidates) {
          const conn = await db.getConnection()
          try {
            await conn.beginTransaction()
            const rows = await execute(conn, 'SELECT * FROM `' + table + '` WHERE id=? FOR UPDATE', [candidate.id])
            if (rows.length && rows[0].private_data == null) {
              const originals = originalFields(table, rows[0])
              const context = rowContext(table, candidate.id)
              const check = protection.encryptJSON(originals, context)
              if (JSON.stringify(protection.decryptJSON(check, context)) !== JSON.stringify(originals)) {
                fail('DATA_MIGRATION_INVALID', 'Não foi possível verificar a migração privada da linha.')
              }
              await completeInsert(table, candidate.id, originals, conn)
              migrated++
            }
            await conn.commit()
          } catch (error) {
            await conn.rollback().catch(() => {})
            throw error
          } finally {
            conn.release()
          }
        }
        lastId = Number(candidates.at(-1).id)
      }
    }
    return { enabled: true, migrated, validated }
  }

  const protectJsonValue = (value, context) => enabled ? protection.encryptJSON(value, context) : value
  const unprotectJsonValue = (value, context) => enabled ? protection.decryptJSON(value, context) : value
  return Object.freeze({ enabled, protection, emailForLookup, pendingFields, completeInsert, updateFields, decodeRow, decodeRows, protectJsonValue, unprotectJsonValue, ensureSchemaAndMigrate })
}
