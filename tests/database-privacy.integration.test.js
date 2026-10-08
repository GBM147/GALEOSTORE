import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import mysql from 'mysql2/promise'
import session from 'express-session'
import MySQLStoreFactory from 'express-mysql-session'
import { createDatabasePrivacy, PRIVATE_FIELD_MAP } from '../server/database-privacy.js'
import { createDataProtection, DataProtectionError } from '../server/data-protection.js'
import { protectSessionStore } from '../server/protected-session-store.js'

if (!new Set(['127.0.0.1', 'localhost', '::1']).has(process.env.DB_HOST) ||
    process.env.DB_NAME !== 'galeo_store_test' || process.env.DB_PORT !== '3308') {
  throw new Error('A integração de privacidade exige MySQL local isolado, DB_NAME=galeo_store_test e DB_PORT=3308; outros bancos são recusados.')
}
if (!process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_ENABLED !== 'true') {
  throw new Error('Configure a chave local e DATA_ENCRYPTION_ENABLED=true para testar a privacidade.')
}

const suffix = randomBytes(8).toString('hex')
const email = 'privacy-' + suffix + '@example.invalid'
const customerName = 'Pessoa de teste ' + suffix
const phone = '11999997777'
const fixtures = new Map()
const errorCode = expected => error => error instanceof DataProtectionError && error.code === expected
let db, privacy, productId

async function rows(sql, values = []) {
  const [result] = await db.execute(sql, values)
  return result
}

async function insert(table, record) {
  const fields = Object.keys(record)
  const params = Object.entries(record).map(([field, value]) => {
    return ['raw_payload', 'payload', 'details'].includes(field) && value !== null ? JSON.stringify(value) : value
  })
  const result = await rows('INSERT INTO `' + table + '` (' + fields.map(field => '`' + field + '`').join(',') + ') VALUES (' + fields.map(() => '?').join(',') + ')', params)
  fixtures.set(table, { id: result.insertId, original: record })
  return result.insertId
}

async function stored(table) {
  return (await rows('SELECT * FROM `' + table + '` WHERE id=?', [fixtures.get(table).id]))[0]
}

before(async () => {
  db = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 3 })
  privacy = createDatabasePrivacy({ db, enabled: true })
  const product = await rows("INSERT INTO products(name,description,price,stock) VALUES(?,'Teste de privacidade',10,1)", ['privacy-fixture-' + suffix])
  productId = product.insertId
  const customerId = await insert('customers', { name: customerName, email, phone, password_hash: 'privacy-test-placeholder-hash' })
  await insert('admin_users', { email: 'owner-' + email, password_hash: 'privacy-test-placeholder-hash', role: 'owner', active: 1 })
  await insert('store_orders', { code: 'PR-' + suffix, customer_id: customerId, customer_name: customerName, customer_email: email, customer_phone: phone, postal_code: '01000-000', street: 'Rua fictícia ' + suffix, number: '17', complement: 'Casa de teste', neighborhood: 'Centro de teste', city: 'São Paulo', state: 'SP', notes: 'Detalhe ' + email, payment_url: 'https://example.invalid/checkout/' + suffix })
  await insert('sales', { code: 'PV-' + suffix, customer_name: customerName, notes: 'Contato ' + email })
  await insert('financial_entries', { type: 'RECEITA', description: 'Cliente ' + email, amount: '1.00' })
  await insert('recurring_expenses', { description: 'Contato ' + email, amount: '1.00', due_day: 1 })
  await insert('stock_movements', { product_id: productId, type: 'ENTRADA', quantity: 1, stock_before: 0, stock_after: 1, reason: 'Solicitação ' + email })
  await insert('payments', { channel: 'ONLINE', provider: 'LOCAL_PRIVACY_TEST', raw_payload: { payer: { email, name: customerName, phone } }, payment_url: 'https://example.invalid/pay/' + suffix })
  await insert('integration_events', { provider: 'LOCAL_PRIVACY_TEST', event_id: 'privacy-' + suffix, payload: { customer: { name: customerName, email, phone } } })
  await insert('audit_logs', { action: 'LOCAL_PRIVACY_TEST', entity: 'fixture', details: { email, note: customerName } })
})

after(async () => {
  if (!db) return
  for (const table of ['audit_logs', 'integration_events', 'payments', 'stock_movements', 'recurring_expenses', 'financial_entries', 'sales', 'store_orders', 'customers', 'admin_users']) {
    const fixture = fixtures.get(table)
    if (fixture) await rows('DELETE FROM `' + table + '` WHERE id=?', [fixture.id])
  }
  if (productId) await rows('DELETE FROM products WHERE id=?', [productId])
  await db.end()
})

test('migração MySQL protege todas as cópias de dados pessoais sem mudar o resultado da aplicação', async () => {
  const migration = await privacy.ensureSchemaAndMigrate({ batchSize: 3 })
  assert.ok(migration.migrated >= fixtures.size)
  for (const [table, fixture] of fixtures) {
    const raw = await stored(table)
    assert.ok(raw.private_data, table + ' deve ter payload protegido')
    const serialized = JSON.stringify(raw)
    assert.equal(serialized.includes(email), false, table + ' não deve ter o e-mail original')
    assert.equal(serialized.includes(customerName), false, table + ' não deve ter o nome original')
    const restored = privacy.decodeRow(table, raw)
    assert.equal(Object.hasOwn(restored, 'private_data'), false)
    for (const field of PRIVATE_FIELD_MAP[table]) {
      if (Object.hasOwn(fixture.original, field)) assert.deepEqual(restored[field], fixture.original[field], table + '.' + field)
    }
  }
  assert.equal((await privacy.ensureSchemaAndMigrate()).migrated, 0)
})

test('login pode consultar o mesmo e-mail pelo índice sem existir uma cópia legível no MySQL', async () => {
  const lookup = privacy.emailForLookup('customers', ' ' + email.toUpperCase() + ' ')
  const found = await rows('SELECT id FROM customers WHERE email=?', [lookup])
  assert.equal(found[0].id, fixtures.get('customers').id)
  assert.deepEqual(await rows('SELECT id FROM customers WHERE email=?', [email]), [])
})

test('edição parcial transacional preserva os demais dados pessoais e mantém as colunas antigas vazias', async () => {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await privacy.updateFields('customers', fixtures.get('customers').id, { phone: '21999996666' }, conn)
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { conn.release() }
  const raw = await stored('customers')
  assert.equal(raw.phone, '')
  const restored = privacy.decodeRow('customers', raw)
  assert.equal(restored.email, email)
  assert.equal(restored.name, customerName)
  assert.equal(restored.phone, '21999996666')
})

test('uma falha após completar o INSERT não deixa conta parcial no banco', async () => {
  const conn = await db.getConnection()
  const rollbackEmail = 'rollback-' + email
  const original = { name: customerName, email: rollbackEmail, phone }
  try {
    await conn.beginTransaction()
    const pending = privacy.pendingFields('customers', original)
    const [result] = await conn.execute('INSERT INTO customers(name,email,password_hash,phone) VALUES(?,?,?,?)', [pending.name, pending.email, 'rollback-fixture-hash', pending.phone])
    await privacy.completeInsert('customers', result.insertId, original, conn)
    await conn.rollback()
    assert.deepEqual(await rows('SELECT id FROM customers WHERE email=?', [privacy.emailForLookup('customers', rollbackEmail)]), [])
  } finally { conn.release() }
})

test('trocar linha, tabela ou chave é recusado sem sobrescrever os dados armazenados', async () => {
  const raw = await stored('customers')
  assert.throws(() => privacy.decodeRow('customers', { ...raw, id: raw.id + 1 }), errorCode('DATA_DECRYPTION_FAILED'))
  assert.throws(() => privacy.decodeRow('admin_users', { id: raw.id, email: raw.email, private_data: raw.private_data }), errorCode('DATA_DECRYPTION_FAILED'))
  const wrongKey = createDatabasePrivacy({ db, enabled: true, key: randomBytes(32).toString('base64') })
  await assert.rejects(wrongKey.ensureSchemaAndMigrate(), errorCode('DATA_DECRYPTION_FAILED'))
  assert.deepEqual(await stored('customers'), raw)
})

test('reiniciar com proteção desabilitada recusa o banco já protegido', async () => {
  const disabled = createDatabasePrivacy({ db, enabled: false })
  await assert.rejects(disabled.ensureSchemaAndMigrate(), errorCode('DATA_ENCRYPTION_DOWNGRADE'))
  const raw = await stored('customers')
  assert.throws(() => disabled.decodeRow('customers', raw), errorCode('DATA_ENCRYPTION_DOWNGRADE'))
  assert.equal(privacy.decodeRow('customers', raw).email, email)
})

test('sessões antigas são migradas sem perder acesso; adulteração e sessões novas em texto puro são recusadas', async () => {
  const Store = MySQLStoreFactory(session)
  const rawStore = new Store({ endConnectionOnClose: false }, db)
  const protection = createDataProtection()
  const protectedStore = protectSessionStore(rawStore, { db, protection })
  const id = 'privacy-session-' + randomBytes(16).toString('hex')
  const otherId = 'privacy-session-' + randomBytes(16).toString('hex')
  const legacy = { cookie: { expires: new Date(Date.now() + 60000), httpOnly: true }, userId: fixtures.get('admin_users').id, csrfToken: randomBytes(32).toString('hex') }
  try {
    await rawStore.onReady()
    await rawStore.set(id, legacy)
    const before = (await rows('SELECT expires FROM sessions WHERE session_id=?', [id]))[0].expires
    await protectedStore.migrate()
    const migrated = await rawStore.get(id)
    assert.ok(migrated.protected_session)
    assert.equal(JSON.stringify(migrated).includes(legacy.csrfToken), false)
    assert.equal(Object.hasOwn(migrated, 'userId'), false)
    assert.equal((await rows('SELECT expires FROM sessions WHERE session_id=?', [id]))[0].expires, before)
    const restored = await protectedStore.get(id)
    assert.equal(restored.userId, legacy.userId)
    assert.equal(restored.csrfToken, legacy.csrfToken)
    await rawStore.set(otherId, migrated)
    await assert.rejects(protectedStore.get(otherId), errorCode('DATA_DECRYPTION_FAILED'))
    const disabled = protectSessionStore(rawStore, { db })
    await assert.rejects(disabled.get(id), /chave/)
    const wrongKey = protectSessionStore(rawStore, { db, protection: createDataProtection({ key: randomBytes(32).toString('base64') }) })
    await assert.rejects(wrongKey.get(id), errorCode('DATA_DECRYPTION_FAILED'))
    await rawStore.set(otherId, legacy)
    assert.equal(await protectedStore.get(otherId), null)
    assert.equal((await rows('SELECT session_id FROM sessions WHERE session_id=?', [otherId])).length, 0)
  } finally {
    await rawStore.destroy(id)
    await rawStore.destroy(otherId)
    await rawStore.close()
  }
})
