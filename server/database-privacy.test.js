import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createDatabasePrivacy, PRIVATE_FIELD_MAP } from './database-privacy.js'
import { DataProtectionError } from './data-protection.js'

const key = randomBytes(32).toString('base64')
const fixture = { id: 7, name: 'Cliente real', email: 'cliente@galeo.test', phone: '11987654321', active: 1, password_hash: 'hash-fixture', private_data: null }
const errorCode = expected => error => error instanceof DataProtectionError && error.code === expected

// A deterministic store exercises confidentiality, merge and rollback semantics;
// real MySQL/application coverage runs separately on the isolated local database.
function memoryDatabase() {
  let tables = Object.fromEntries(Object.keys(PRIVATE_FIELD_MAP).map(table => [table, []]))
  tables.customers = [structuredClone(fixture)]
  let snapshot
  const stats = { commits: 0, rollbacks: 0, failCommit: false }
  const db = {
    stats,
    row: (table = 'customers') => tables[table][0],
    async execute(sql, params = []) {
      if (sql.includes('information_schema.columns')) return [[{ exists: 1 }]]
      const table = sql.match(/(?:FROM|UPDATE) `([a-z_]+)`/)?.[1]
      assert.ok(table, 'fixture expects a whitelisted table')
      if (sql.startsWith('SELECT *')) return [[...tables[table].filter(row => row.id === Number(params[0])).map(row => structuredClone(row))]]
      if (sql.startsWith('SELECT id')) {
        const encrypted = sql.includes('IS NOT NULL')
        const matches = tables[table].filter(row => (row.private_data != null) === encrypted && row.id > params[0])
        return [[...matches.map(row => sql.includes('id,private_data') ? { id: row.id, private_data: structuredClone(row.private_data) } : { id: row.id })]]
      }
      if (sql.startsWith('UPDATE')) {
        const id = Number(params.at(-1))
        const row = tables[table].find(item => item.id === id)
        if (!row || (sql.includes('private_data IS NULL') && row.private_data != null)) return [{ affectedRows: 0 }]
        const fields = [...sql.matchAll(/`([a-z_]+)`=\?/g)].map(match => match[1])
        fields.forEach((field, index) => {
          row[field] = field === 'private_data' ? JSON.parse(params[index]) : params[index]
        })
        return [{ affectedRows: 1 }]
      }
      throw new Error('Unsupported fixture SQL')
    },
    async getConnection() {
      return {
        execute: db.execute,
        async beginTransaction() { snapshot = structuredClone(tables) },
        async commit() { if (stats.failCommit) throw new Error('commit fixture failure'); stats.commits++; snapshot = undefined },
        async rollback() { stats.rollbacks++; if (snapshot) tables = snapshot; snapshot = undefined },
        release() {}
      }
    }
  }
  return db
}

test('proteção habilitada exige chave antes de tocar o banco', () => {
  assert.throws(() => createDatabasePrivacy({ enabled: true, key: '' }), errorCode('DATA_KEY_MISSING'))
  assert.throws(() => createDatabasePrivacy({ enabled: 'false' }), errorCode('DATA_CONFIG_INVALID'))
})

test('lookup e INSERT pendente eliminam e-mail e demais valores privados do SQL', () => {
  const privacy = createDatabasePrivacy({ enabled: true, key })
  const lookup = privacy.emailForLookup('customers', fixture.email)
  assert.match(lookup, /^private-[a-f0-9]{64}@galeo\.invalid$/)
  assert.equal(lookup, privacy.emailForLookup('customers', ' CLIENTE@GALEO.TEST '))
  assert.notEqual(lookup, privacy.emailForLookup('admin_users', fixture.email))
  assert.deepEqual(privacy.pendingFields('customers', fixture), { name: '', email: lookup, phone: '' })
  assert.deepEqual(privacy.pendingFields('store_orders', { notes: 'Dado particular', payment_url: 'https://private.test/token' }), { notes: null, payment_url: null })
  assert.deepEqual(privacy.pendingFields('integration_events', { payload: { email: fixture.email } }), { payload: '{}' })
})

test('proteção conserva os limites e os tipos das colunas originais', () => {
  const privacy = createDatabasePrivacy({ enabled: true, key })
  for (const [table, record] of [
    ['customers', { name: 'a'.repeat(181) }], ['customers', { phone: '1'.repeat(41) }],
    ['sales', { customer_name: 'a'.repeat(181) }], ['financial_entries', { description: 'a'.repeat(256) }],
    ['stock_movements', { reason: 'a'.repeat(256) }], ['store_orders', { state: 'SPX' }],
    ['sales', { notes: 'ç'.repeat(32768) }], ['payments', { payment_url: 'a'.repeat(1201) }],
    ['customers', { name: null }], ['customers', { phone: 123 }]
  ]) assert.throws(() => privacy.pendingFields(table, record), errorCode('DATA_VALUE_INVALID'))
  assert.doesNotThrow(() => privacy.pendingFields('customers', { name: '👕'.repeat(180) }))
  assert.doesNotThrow(() => privacy.pendingFields('sales', { notes: null }))
})

test('INSERT completo guarda apenas envelope e lookup, retornando os dados conforme seleção', async () => {
  const db = memoryDatabase()
  const privacy = createDatabasePrivacy({ db, enabled: true, key })
  Object.assign(db.row(), privacy.pendingFields('customers', fixture))
  await privacy.completeInsert('customers', fixture.id, fixture, db)
  const stored = db.row()
  assert.equal(JSON.stringify(stored).includes(fixture.email), false)
  assert.equal(JSON.stringify(stored).includes(fixture.name), false)
  assert.equal(JSON.stringify(stored).includes(fixture.phone), false)
  const restored = privacy.decodeRow('customers', stored)
  assert.equal(restored.email, fixture.email)
  assert.equal(restored.name, fixture.name)
  assert.equal(restored.phone, fixture.phone)
  assert.equal(restored.active, fixture.active)
  assert.equal(Object.hasOwn(restored, 'private_data'), false)
  const selected = privacy.decodeRow('customers', { id: stored.id, email: stored.email, private_data: stored.private_data })
  assert.deepEqual(selected, { id: fixture.id, email: fixture.email })
  await assert.rejects(privacy.completeInsert('customers', fixture.id, fixture, db), errorCode('DATA_INSERT_INVALID'))
})

test('edição parcial preserva os demais dados privados e os campos operacionais', async () => {
  const db = memoryDatabase()
  const privacy = createDatabasePrivacy({ db, enabled: true, key })
  Object.assign(db.row(), privacy.pendingFields('customers', fixture))
  await privacy.completeInsert('customers', fixture.id, fixture, db)
  await privacy.updateFields('customers', fixture.id, { phone: '21999998888', active: 0 }, db)
  const restored = privacy.decodeRow('customers', db.row())
  assert.equal(restored.phone, '21999998888')
  assert.equal(restored.email, fixture.email)
  assert.equal(restored.name, fixture.name)
  assert.equal(restored.active, 1)
  assert.equal(db.row().phone, '')
  assert.equal(db.row().email, privacy.emailForLookup('customers', fixture.email))
})

test('decodificação nunca repõe texto legado nem permite transplantar outra linha', async () => {
  const db = memoryDatabase()
  const privacy = createDatabasePrivacy({ db, enabled: true, key })
  assert.throws(() => privacy.decodeRow('customers', fixture), errorCode('DATA_PLAINTEXT_FOUND'))
  await privacy.completeInsert('customers', fixture.id, fixture, db)
  assert.throws(() => privacy.decodeRow('customers', { ...db.row(), id: 8 }), errorCode('DATA_DECRYPTION_FAILED'))
  assert.deepEqual(privacy.decodeRows('customers', [{ id: 7, active: 1 }]), [{ id: 7, active: 1 }])
  const catalog = [{ id: 5, name: 'Camiseta' }]
  assert.equal(privacy.decodeRows('products', catalog), catalog)
})

test('startup sem proteção recusa qualquer envelope existente', async () => {
  const db = memoryDatabase()
  const enabled = createDatabasePrivacy({ db, enabled: true, key })
  await enabled.completeInsert('customers', fixture.id, fixture, db)
  const disabled = createDatabasePrivacy({ db, enabled: false })
  await assert.rejects(disabled.ensureSchemaAndMigrate(), errorCode('DATA_ENCRYPTION_DOWNGRADE'))
  assert.throws(() => disabled.decodeRow('customers', db.row()), errorCode('DATA_ENCRYPTION_DOWNGRADE'))
  await assert.rejects(disabled.updateFields('customers', fixture.id, { name: 'não substituir' }, db), errorCode('DATA_ENCRYPTION_DOWNGRADE'))
})

test('migração verifica, protege e limpa a linha mantendo os dados e é idempotente', async () => {
  const db = memoryDatabase()
  const privacy = createDatabasePrivacy({ db, enabled: true, key })
  assert.deepEqual(await privacy.ensureSchemaAndMigrate(), { enabled: true, migrated: 1, validated: 0 })
  assert.equal(db.stats.commits, 1)
  assert.equal(JSON.stringify(db.row()).includes(fixture.email), false)
  assert.equal(privacy.decodeRow('customers', db.row()).phone, fixture.phone)
  assert.deepEqual(await privacy.ensureSchemaAndMigrate(), { enabled: true, migrated: 0, validated: 1 })
  assert.equal(db.stats.commits, 1)
})

test('falha na migração reverte a limpeza da linha em vez de perder os dados', async () => {
  const db = memoryDatabase()
  const privacy = createDatabasePrivacy({ db, enabled: true, key })
  db.stats.failCommit = true
  await assert.rejects(privacy.ensureSchemaAndMigrate(), /commit fixture failure/)
  assert.equal(db.stats.rollbacks, 1)
  assert.deepEqual(db.row(), fixture)
})

test('chave incorreta na reinicialização bloqueia a migração sem regravar a linha', async () => {
  const db = memoryDatabase()
  const privacy = createDatabasePrivacy({ db, enabled: true, key })
  await privacy.ensureSchemaAndMigrate()
  const stored = structuredClone(db.row())
  const wrong = createDatabasePrivacy({ db, enabled: true, key: randomBytes(32).toString('base64') })
  await assert.rejects(wrong.ensureSchemaAndMigrate(), errorCode('DATA_DECRYPTION_FAILED'))
  assert.deepEqual(db.row(), stored)
})

test('modo desativado mantém o contrato legado e normaliza os campos JSON', async () => {
  const db = memoryDatabase()
  const privacy = createDatabasePrivacy({ db, enabled: false })
  assert.deepEqual(await privacy.ensureSchemaAndMigrate(), { enabled: false, migrated: 0, validated: 0 })
  assert.equal(privacy.emailForLookup('customers', ' CLIENTE@GALEO.TEST '), fixture.email)
  assert.deepEqual(privacy.pendingFields('customers', fixture), { name: fixture.name, email: fixture.email, phone: fixture.phone })
  assert.deepEqual(privacy.pendingFields('audit_logs', { details: '{"name":"cliente"}' }), { details: '{"name":"cliente"}' })
  await privacy.updateFields('customers', fixture.id, { name: 'Novo nome' }, db)
  assert.equal(db.row().name, 'Novo nome')
  assert.equal(db.row().private_data, null)
})
