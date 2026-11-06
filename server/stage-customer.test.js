import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stageCustomerConfig, syncStageCustomer } from './stage-customer.js'
import { newPasswordError } from './password-policy.js'

const stageEnv = { GALEO_STAGE_CUSTOMER_EMAIL: ' Stage@Example.Test ', GALEO_STAGE_CUSTOMER_PASSWORD: 'nova-senha-de-teste-123', DB_NAME: 'galeo_store_test', MERCADO_PAGO_MODE: 'test' }

function fakeDb(rows) {
  const statements = [], state = { committed: false, rolledBack: false, released: false }
  const conn = {
    async beginTransaction() {},
    async execute(sql, params) {
      statements.push({ sql, params })
      if (sql.startsWith('SELECT')) return [rows]
      if (sql.startsWith('INSERT')) return [{ insertId: 77 }]
      return [{ affectedRows: 1 }]
    },
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    release() { state.released = true }
  }
  return { db: { getConnection: async () => conn }, statements, state }
}
const privacy = {
  emailForLookup: (table, email) => 'lookup:' + table + ':' + email,
  pendingFields: (_table, record) => ({ ...record, email: 'pending:' + record.email }),
  completed: [],
  async completeInsert(table, id, record) { this.completed.push({ table, id, record }) }
}
const bcrypt = { hash: async password => 'hash:' + password, compare: async (password, hash) => hash === 'hash:' + password }

test('conta de teste só é sincronizada em banco _test e Mercado Pago em teste', () => {
  assert.deepEqual(stageCustomerConfig(stageEnv), { email: 'stage@example.test', password: 'nova-senha-de-teste-123' })
  for (const change of [{ DB_NAME: 'galeo_store' }, { DB_NAME: 'galeo_test_store' }, { MERCADO_PAGO_MODE: 'production' }, { MERCADO_PAGO_MODE: 'disabled' }, { GALEO_STAGE_CUSTOMER_EMAIL: '' }, { GALEO_STAGE_CUSTOMER_PASSWORD: '' }, { GALEO_STAGE_CUSTOMER_EMAIL: 'invalido' }]) {
    assert.equal(stageCustomerConfig({ ...stageEnv, ...change }), null)
  }
})

test('fora da homologação não abre conexão com o banco', async () => {
  const db = { getConnection: async () => { throw new Error('não deveria conectar') } }
  assert.deepEqual(await syncStageCustomer({ env: { ...stageEnv, DB_NAME: 'galeo_store' }, db, privacy, bcrypt, newPasswordError }), { status: 'skipped' })
  assert.deepEqual(await syncStageCustomer({ env: { ...stageEnv, GALEO_STAGE_CUSTOMER_PASSWORD: 'curta' }, db, privacy, bcrypt, newPasswordError }), { status: 'invalid_password' })
})

test('cria a conta de teste confirmada quando ela não existe', async () => {
  const { db, statements, state } = fakeDb([])
  privacy.completed.length = 0
  assert.deepEqual(await syncStageCustomer({ env: stageEnv, db, privacy, bcrypt, newPasswordError }), { status: 'created' })
  assert.deepEqual(statements[0].params, ['lookup:customers:stage@example.test'])
  assert.match(statements[1].sql, /^INSERT INTO customers\(name,email,password_hash,phone,email_verified_at\)/)
  assert.deepEqual(statements[1].params, ['Cliente de homologação', 'pending:stage@example.test', 'hash:nova-senha-de-teste-123', ''])
  assert.deepEqual(privacy.completed, [{ table: 'customers', id: 77, record: { name: 'Cliente de homologação', email: 'stage@example.test', phone: '' } }])
  assert.equal(state.committed && state.released, true)
})

test('troca a senha e reativa/confirma a conta existente', async () => {
  const { db, statements, state } = fakeDb([{ id: 5, password_hash: 'hash:senha-antiga-1234', active: 0, email_verified_at: null }])
  assert.deepEqual(await syncStageCustomer({ env: stageEnv, db, privacy, bcrypt, newPasswordError }), { status: 'updated' })
  assert.match(statements[1].sql, /^UPDATE customers SET password_hash=\?, active=1, email_verified_at=COALESCE/)
  assert.deepEqual(statements[1].params, ['hash:nova-senha-de-teste-123', 5])
  assert.equal(state.committed, true)
})

test('não altera a conta que já está com a senha, ativa e confirmada', async () => {
  const { db, statements } = fakeDb([{ id: 5, password_hash: 'hash:nova-senha-de-teste-123', active: 1, email_verified_at: '2026-11-06 12:00:00' }])
  assert.deepEqual(await syncStageCustomer({ env: stageEnv, db, privacy, bcrypt, newPasswordError }), { status: 'unchanged' })
  assert.equal(statements.length, 1)
})

test('falha no banco desfaz a transação e libera a conexão', async () => {
  const { db, state } = fakeDb([])
  const conn = await db.getConnection()
  conn.execute = async () => { throw Object.assign(new Error('falha'), { code: 'ER_LOCK_WAIT_TIMEOUT' }) }
  await assert.rejects(syncStageCustomer({ env: stageEnv, db, privacy, bcrypt, newPasswordError }), { code: 'ER_LOCK_WAIT_TIMEOUT' })
  assert.equal(state.rolledBack && state.released, true)
})
