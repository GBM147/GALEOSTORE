import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { PRIVATE_FIELD_MAP, createDatabasePrivacy } from './database-privacy.js'
import { createDataProtection } from './data-protection.js'
import { REQUIRED_RUNTIME_COLUMNS, validateRuntimeSchema } from './runtime-schema.js'

const key = () => randomBytes(32).toString('base64')

function fixture({ samples = {}, plaintext = [], protectedSession, plaintextSession = false, missing } = {}) {
  const calls = []
  const columns = Object.entries(REQUIRED_RUNTIME_COLUMNS).flatMap(([table_name, fields]) =>
    [...new Set([...fields, ...(PRIVATE_FIELD_MAP[table_name] ? ['private_data', ...PRIVATE_FIELD_MAP[table_name]] : [])])]
      .filter(column_name => missing !== table_name + '.' + column_name)
      .map(column_name => ({ table_name, column_name })))
  const db = { async execute(sql) {
    calls.push(sql)
    assert.match(sql, /^SELECT\b/, 'runtime initialization must remain read-only')
    if (sql.includes('information_schema.COLUMNS')) return [columns]
    const table = /FROM `([^`]+)`/.exec(sql)?.[1]
    if (table && sql.includes('private_data IS NOT NULL')) return [samples[table] ? [samples[table]] : []]
    if (table && sql.includes('private_data IS NULL')) return [plaintext.includes(table) ? [{ id: 1 }] : []]
    if (sql.includes('protected_session') && sql.includes('=1')) return [protectedSession ? [protectedSession] : []]
    if (sql.includes('protected_session') && sql.includes('=0')) return [plaintextSession ? [{ session_id: 'local-session' }] : []]
    assert.fail('Unexpected runtime query')
  } }
  return { db, calls }
}

test('runtime checks all required tables while keeping unencrypted initialization read-only', async () => {
  const { db, calls } = fixture()
  const privacy = createDatabasePrivacy({ db, enabled: false })
  assert.deepEqual(await validateRuntimeSchema({ db, privacy }), { schema: 'ready' })
  for (const table of Object.keys(PRIVATE_FIELD_MAP)) {
    assert.ok(calls.some(sql => sql.includes('FROM `' + table + '`')), 'each protected table must still be checked')
  }
})

test('missing variant schema rejects startup before any operational table is read', async () => {
  const { db, calls } = fixture({ missing: 'product_variants.stock' })
  await assert.rejects(validateRuntimeSchema({ db, privacy: createDatabasePrivacy({ db, enabled: false }) }), { code: 'SCHEMA_MIGRATION_REQUIRED' })
  assert.equal(calls.length, 1)
})

test('encrypted data cannot be opened after protection is disabled', async () => {
  const protection = createDataProtection({ key: key() })
  const payload = protection.encryptJSON({ name: 'Cliente local' }, { table: 'customers', field: 'private_data', rowId: '1' })
  const { db } = fixture({ samples: { customers: { id: 1, private_data: payload } } })
  await assert.rejects(validateRuntimeSchema({ db, privacy: createDatabasePrivacy({ db, enabled: false }) }), { code: 'DATA_ENCRYPTION_DOWNGRADE' })
})

test('the correct key authenticates private rows and protected sessions during startup', async () => {
  const secret = key(), protection = createDataProtection({ key: secret })
  const payload = protection.encryptJSON({ name: 'Cliente local' }, { table: 'customers', field: 'private_data', rowId: '1' })
  const session = protection.encryptJSON({ userId: 1 }, { table: 'sessions', field: 'data', rowId: 'local-session' })
  const { db } = fixture({ samples: { customers: { id: 1, private_data: payload } }, protectedSession: { session_id: 'local-session', data: JSON.stringify({ protected_session: session }) } })
  const privacy = createDatabasePrivacy({ db, enabled: true, key: secret })
  assert.deepEqual(await validateRuntimeSchema({ db, privacy, protection }), { schema: 'ready' })
})

test('a changed key still rejects encrypted rows when continuity reads run together', async () => {
  const protection = createDataProtection({ key: key() })
  const payload = protection.encryptJSON({ name: 'Cliente local' }, { table: 'customers', field: 'private_data', rowId: '1' })
  const secret = key(), { db } = fixture({ samples: { customers: { id: 1, private_data: payload } } })
  await assert.rejects(validateRuntimeSchema({ db, privacy: createDatabasePrivacy({ db, enabled: true, key: secret }), protection: createDataProtection({ key: secret }) }), { code: 'DATA_DECRYPTION_FAILED' })
})

test('enabling protection requires both private rows and sessions to be migrated', async () => {
  for (const options of [{ plaintext: ['financial_entries'] }, { plaintextSession: true }]) {
    const secret = key(), { db } = fixture(options)
    await assert.rejects(validateRuntimeSchema({ db, privacy: createDatabasePrivacy({ db, enabled: true, key: secret }), protection: createDataProtection({ key: secret }) }), { code: 'SCHEMA_MIGRATION_REQUIRED' })
  }
})
