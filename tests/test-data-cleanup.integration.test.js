import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import mysql from 'mysql2/promise'
import bcrypt from 'bcrypt'
import { createDataProtection } from '../server/data-protection.js'
import { createDatabasePrivacy } from '../server/database-privacy.js'
import { DELETE_TABLES, PRESERVED_TABLES, buildCleanupConnectionConfig, runTestDataCleanup } from '../server/test-data-cleanup.js'

// This suite creates and destroys its own database. A production host, port,
// configured database, or arbitrary database name is never accepted.
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(process.env.DB_HOST) ||
    process.env.DB_PORT !== '3307' || process.env.DB_NAME !== 'galeo_store_test') {
  throw new Error('Cleanup integration tests require loopback MySQL:3307 and DB_NAME=galeo_store_test. Production is refused.')
}
if (!process.env.DB_USER || !process.env.DB_PASSWORD) throw new Error('Configure credentials for the disposable local MySQL instance.')

const fixturePrefix = 'galeo_store_test_cleanup_' + randomBytes(6).toString('hex')
const fixtureName = name => /^galeo_store_test_cleanup_[a-f0-9]{12}_[0-9]+$/.test(name)
const connectionConfig = {
  host: process.env.DB_HOST, port: 3307, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, multipleStatements: false
}
const existingKey = process.env.DATA_ENCRYPTION_KEY
const existingEnabled = process.env.DATA_ENCRYPTION_ENABLED
const existingKeyId = process.env.DATA_ENCRYPTION_KEY_ID
const localKey = randomBytes(32).toString('base64')
let admin, ddl, protection, ownerHash, inactiveHash, sequence = 0
const openDatabases = new Set()

before(async () => {
  // Credentials must permit CREATE DATABASE only on this local test service.
  // The application/bootstrap and provider clients are never imported.
  admin = await mysql.createConnection(connectionConfig)
  process.env.DATA_ENCRYPTION_KEY = localKey
  process.env.DATA_ENCRYPTION_ENABLED = 'true'
  process.env.DATA_ENCRYPTION_KEY_ID = 'cleanup-local-fixture'
  protection = createDataProtection()
  ownerHash = await bcrypt.hash('Local-owner-' + randomBytes(12).toString('hex'), 12)
  inactiveHash = await bcrypt.hash('Local-inactive-' + randomBytes(12).toString('hex'), 12)

  // Use the application's real DDL as inert SQL text, never server/index.js
  // imports or startup. This exercises the actual FK graph without seeding it.
  const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8')
  const schema = source.slice(source.indexOf('const schema = ['), source.indexOf('for (const statement of schema)'))
  ddl = [...schema.matchAll(/`(CREATE TABLE IF NOT EXISTS [\s\S]*?)`/g)].map(match => match[1])
  assert.ok(ddl.length >= 19, 'the real application schema must be available')
  const mediaSource = await readFile(new URL('../server/media-library.js', import.meta.url), 'utf8')
  const mediaDDL = mediaSource.match(/const DDL = `(CREATE TABLE IF NOT EXISTS [\s\S]*?)`/)?.[1]
  assert.ok(mediaDDL, 'the preserved media library schema must be available')
  ddl.push(mediaDDL)
  ddl.push('CREATE TABLE sessions (session_id VARCHAR(128) NOT NULL PRIMARY KEY,expires INT UNSIGNED NOT NULL,data MEDIUMTEXT) ENGINE=InnoDB')
})

after(async () => {
  if (admin) {
    for (const name of openDatabases) {
      assert.ok(fixtureName(name), 'only generated disposable databases may be removed')
      await admin.query('DROP DATABASE `' + name + '`')
    }
    await admin.end()
  }
  for (const [key, value] of [['DATA_ENCRYPTION_KEY', existingKey], ['DATA_ENCRYPTION_ENABLED', existingEnabled], ['DATA_ENCRYPTION_KEY_ID', existingKeyId]]) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

async function fixture(fn) {
  const name = fixturePrefix + '_' + (++sequence)
  assert.ok(fixtureName(name))
  await admin.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  openDatabases.add(name)
  const connection = await mysql.createConnection({ ...connectionConfig, database: name })
  try {
    for (const statement of ddl) await connection.query(statement)
    await connection.query('ALTER TABLE admin_users ADD private_data JSON NULL')
    await connection.query('ALTER TABLE audit_logs ADD private_data JSON NULL')
    await seed(connection)
    await fn(connection, name)
  } finally {
    await connection.end()
    assert.ok(fixtureName(name))
    await admin.query('DROP DATABASE `' + name + '`')
    openDatabases.delete(name)
  }
}

async function sql(connection, statement, values = []) {
  const [rows] = await connection.execute(statement, values)
  return rows
}

async function seed(connection) {
  const privacy = createDatabasePrivacy({ db: connection, enabled: true })
  await sql(connection, 'INSERT INTO admin_users(id,email,password_hash,role,active,private_data) VALUES(5,?,?,?,1,NULL),(6,?,?,?,1,NULL),(7,?,?,?,0,NULL)', [
    'owner@example.invalid', ownerHash, 'owner',
    'staff@example.invalid', inactiveHash, 'staff', 'inactive-owner@example.invalid', inactiveHash, 'owner'
  ])
  for (const [id, email] of [[5, 'owner@example.invalid'], [6, 'staff@example.invalid'], [7, 'inactive-owner@example.invalid']]) {
    await privacy.completeInsert('admin_users', id, { email }, connection)
  }
  await sql(connection, "INSERT INTO categories(id,name,sort_order) VALUES(3,'Categoria preservada',10)")
  await sql(connection, "INSERT INTO financial_categories(id,name,type) VALUES(4,'Receita preservada','RECEITA')")
  await sql(connection, "INSERT INTO financial_accounts(id,name,initial_balance,active) VALUES(8,'Caixa preservado',123.45,1),(9,'Conta desativada',0,0)")
  await sql(connection, "INSERT INTO products(id,name,category_id,description,price,cost,stock) VALUES(17,'Peça de teste',3,'Descrição de teste',50,10,4),(18,'Outra peça de teste',3,'Descrição de teste',40,8,2)")
  await sql(connection, "INSERT INTO product_media(id,product_id,media_type,url,public_id) VALUES(19,17,'image','https://example.invalid/product.png','fixture-product-media')")
  await sql(connection, "INSERT INTO customers(id,name,email,password_hash,phone,email_verified_at) VALUES(11,'Cliente de teste','customer@example.invalid',?,'11999999999',UTC_TIMESTAMP())", [ownerHash])
  await sql(connection, "INSERT INTO customer_email_verifications(customer_id,token_hash,expires_at,sent_at) VALUES(11,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR),UTC_TIMESTAMP())", ['a'.repeat(64)])
  await sql(connection, "INSERT INTO sales(id,code,customer_name,total,user_id) VALUES(15,'LOCAL-CLEANUP-SALE','Cliente de teste',50,5)")
  await sql(connection, "INSERT INTO sale_items(id,sale_id,product_id,quantity,unit_price,unit_cost,line_total) VALUES(20,15,17,1,50,10,50)")
  await sql(connection, "INSERT INTO store_orders(id,code,customer_id,customer_name,customer_email,customer_phone,sale_id,subtotal,total) VALUES(13,'LOCAL-CLEANUP-ORDER',11,'Cliente de teste','customer@example.invalid','11999999999',15,50,50)")
  await sql(connection, "INSERT INTO store_order_items(id,order_id,product_id,product_name,brand,quantity,unit_price,line_total) VALUES(22,13,17,'Peça de teste','Marca',1,50,50)")
  await sql(connection, "INSERT INTO payments(id,channel,store_order_id,sale_id,provider,status,amount) VALUES(21,'ONLINE',13,15,'LOCAL_FIXTURE','APPROVED',50)")
  await sql(connection, "INSERT INTO stock_movements(id,product_id,type,quantity,stock_before,stock_after,reason,user_id) VALUES(23,17,'SAIDA',1,5,4,'Venda de teste',5)")
  await sql(connection, "INSERT INTO recurring_expenses(id,description,category_id,account_id,amount,due_day) VALUES(24,'Despesa de teste',4,8,10,1)")
  await sql(connection, "INSERT INTO financial_entries(id,account_id,category_id,type,description,amount,status,user_id) VALUES(25,8,4,'RECEITA','Venda de teste',50,'PAGO',5)")
  await sql(connection, "INSERT INTO integration_events(id,provider,event_id,event_type,payload) VALUES(26,'LOCAL_FIXTURE','fixture-event','LOCAL_TEST',?)", [JSON.stringify({ local: true })])
  const featured = {
    heading: 'Escolhas da GALEO', subtitle: 'Texto editorial preservado', product_ids: [17, '18', 987654, '987655', '17-invalid', null],
    cta: { label: 'Ver coleção', href: '/colecao' }, nested: { product_ids: [17], note: 'Outro JSON deve permanecer' }
  }
  await sql(connection, "INSERT INTO home_sections(id,section_key,section_type,sort_order,visible,draft_content,published_content,updated_by,published_by,updated_at,published_at) VALUES(31,'hero','hero',10,1,?,?,5,5,'2026-01-02 03:04:05','2026-01-03 04:05:06'),(32,'featured_products','featured_products',20,1,?,?,5,5,'2026-01-02 03:04:05','2026-01-03 04:05:06'),(33,'campaign-products','campaigns',30,0,?,?,5,5,'2026-01-02 03:04:05','2026-01-03 04:05:06')", [
    JSON.stringify({ heading: 'Vista o que representa você', emphasis: 'representa você', product_ids: [17] }),
    JSON.stringify({ heading: 'Vista o que representa você', emphasis: 'representa você', product_ids: [17] }),
    JSON.stringify(featured), JSON.stringify({ ...featured, heading: 'Seleção publicada' }),
    JSON.stringify({ heading: 'Campanha preservada', product_ids: [17], image: 'https://example.invalid/campaign.png' }),
    JSON.stringify({ heading: 'Campanha publicada', product_ids: [17], image: 'https://example.invalid/campaign.png' })
  ])
  await sql(connection, "INSERT INTO home_settings(setting_key,setting_value,updated_by,updated_at) VALUES('visual',?,5,'2026-01-02 03:04:05'),('campaign_defaults',?,5,'2026-01-02 03:04:05')", [JSON.stringify({ color: '#bda36e' }), JSON.stringify({ motion: 'zoom', transition: 'crossfade' })])
  await sql(connection, "INSERT INTO media_assets(id,public_id,url,media_type,title,created_by) VALUES(34,'fixture-home-media','https://example.invalid/home.png','image','Imagem da Home preservada',5)")
  const cookie = { httpOnly: true, path: '/', sameSite: 'lax', expires: '2033-05-18T03:33:20.000Z' }
  const ownerSession = { cookie, fixture: true, userId: 5, csrfToken: 'b'.repeat(64) }
  await sql(connection, 'INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)', ['local-owner-session', 2000000000, JSON.stringify({
    cookie, protected_session: protection.encryptJSON(ownerSession, { table: 'sessions', field: 'data', rowId: 'local-owner-session' })
  })])
  const securityPrivate = protection.encryptJSON({ details: { local: 'security-event' } }, { table: 'audit_logs', field: 'private_data', rowId: 40 })
  await sql(connection, "INSERT INTO audit_logs(id,user_id,action,entity,entity_id,details,private_data) VALUES(40,5,'LOGIN','admin_user','5',NULL,?),(41,5,'PUBLICAR','home','31',?,NULL),(42,5,'LIBRARY_UPLOAD','media_assets','34',?,NULL),(43,5,'CREATE','produto','17',NULL,NULL),(44,5,'CREATE','venda','15',NULL,NULL),(45,5,'CREATE','pedido_online','13',NULL,NULL),(46,5,'CREATE','lancamento_financeiro','25',NULL,NULL),(47,5,'CREATE','despesa_recorrente','24',NULL,NULL),(48,5,'AJUSTE','estoque','17',NULL,NULL)", [
    JSON.stringify(securityPrivate), JSON.stringify({ publication: 'preserved' }), JSON.stringify({ upload: 'preserved' })
  ])
  await privacy.completeInsert('audit_logs', 41, { details: { publication: 'preserved' } }, connection)
  await privacy.completeInsert('audit_logs', 42, { details: { upload: 'preserved' } }, connection)
}

async function snapshot(connection) {
  const tables = await sql(connection, 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME')
  const result = {}
  for (const { name } of tables) {
    assert.match(name, /^[a-z_]+$/)
    const primary = await sql(connection, "SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION", [name])
    const order = primary.map(column => '`' + column.name + '`').join(',')
    result[name] = await sql(connection, 'SELECT * FROM `' + name + '`' + (order ? ' ORDER BY ' + order : ''))
  }
  return result
}

function observed(connection, fail = null) {
  const statements = [], calls = []
  const wrapped = new Proxy(connection, {
    get(target, key) {
      if (key === 'query' || key === 'execute') return async (...args) => {
        const statement = typeof args[0] === 'string' ? args[0] : args[0].sql
        statements.push(statement)
        if (fail?.(statement)) { const error = new Error('Injected local fixture failure'); error.code = 'LOCAL_FIXTURE_FAILURE'; throw error }
        return target[key](...args)
      }
      const value = Reflect.get(target, key)
      if (typeof value === 'function') return (...args) => { calls.push(key); return value.apply(target, args) }
      return value
    }
  })
  return { connection: wrapped, statements, calls }
}

const writes = statement => /^(?:DELETE|UPDATE|INSERT|REPLACE|TRUNCATE|ALTER|DROP|CREATE)\b/i.test(statement.trim())
const executeOptions = (connection, targetDatabase, extra = {}) => ({
  connection, targetDatabase, execute: true, backupConfirmed: true, writersStopped: true,
  resetTestBalances: true, actorId: 5, privacyEnabled: true, ...extra
})

test('the CLI rejects IP TLS targets that mysql2 cannot verify and never applies the loopback exception remotely', () => {
  const env = { DB_HOST: 'db.example.invalid', DB_NAME: 'fixture', DB_USER: 'fixture', DB_PASSWORD: 'unused-fixture', DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'true' }
  for (const host of ['203.0.113.10', '2001:db8::1', '2130706433', '0x7f000001']) {
    assert.throws(() => buildCleanupConnectionConfig({ ...env, DB_HOST: host }, {
      targetHost: host, targetDatabase: env.DB_NAME
    }), { code: 'CLEANUP_HOSTNAME_REQUIRED' })
  }
  assert.throws(() => buildCleanupConnectionConfig(env, {
    targetHost: env.DB_HOST, targetDatabase: env.DB_NAME, allowLocalPlaintext: true
  }), { code: 'CLEANUP_TLS_REQUIRED' })
  assert.throws(() => buildCleanupConnectionConfig({ ...env, DB_SSL_REJECT_UNAUTHORIZED: 'false' }, {
    targetHost: env.DB_HOST, targetDatabase: env.DB_NAME
  }), { code: 'CLEANUP_TLS_REQUIRED' })
})

test('dry-run uses the real MySQL schema and does not change any row, balance, owner or Home', async () => {
  await fixture(async (connection, name) => {
    const before = await snapshot(connection)
    const trace = observed(connection)
    const report = await runTestDataCleanup({ connection: trace.connection, targetDatabase: name, privacyEnabled: true })
    assert.equal(report.mode, 'dry-run')
    assert.equal(report.after, null)
    for (const table of DELETE_TABLES) assert.ok(Number(report.before.counts[table]) > 0, table + ' must appear in the inventory')
    assert.equal(Number(report.before.accounts_with_test_balance), 1)
    assert.equal(Number(report.before.operational_audit_logs), 6)
    assert.equal(Number(report.before.stock_units), 6)
    assert.deepEqual(await snapshot(connection), before)
    assert.equal(trace.statements.some(writes), false, 'dry-run must issue no data-changing statements')
    assert.equal(trace.calls.includes('commit'), false)
  })
})

test('cleanup deletes the FK graph, keeps owners and Home configuration, resets only test balances and never resets IDs', async () => {
  await fixture(async (connection, name) => {
    const before = await snapshot(connection)
    const trace = observed(connection)
    const report = await runTestDataCleanup(executeOptions(trace.connection, name))
    assert.equal(report.mode, 'executed')
    const afterRows = await snapshot(connection)
    for (const table of DELETE_TABLES) {
      assert.deepEqual(afterRows[table], [], table + ' must be empty')
      assert.equal(Number(report.after.counts[table]), 0)
    }
    for (const table of PRESERVED_TABLES.filter(table => !['financial_accounts', 'home_sections'].includes(table))) {
      assert.deepEqual(afterRows[table], before[table], table + ' must remain unchanged')
    }
    assert.deepEqual(afterRows.financial_accounts, before.financial_accounts.map(row => ({ ...row, initial_balance: '0.00' })))
    assert.equal(Number(report.after.accounts_with_test_balance), 0)
    assert.equal(Number(report.after.stock_units), 0)
    const expectedHome = before.home_sections.map(row => row.id === 32 ? {
      ...row,
      draft_content: { ...row.draft_content, product_ids: [987654, '987655', '17-invalid', null] },
      published_content: { ...row.published_content, product_ids: [987654, '987655', '17-invalid', null] }
    } : row)
    assert.deepEqual(afterRows.home_sections, expectedHome, 'only actual deleted product IDs in the featured section may change')
    assert.deepEqual(afterRows.audit_logs.filter(row => row.id <= 42), before.audit_logs.filter(row => row.id <= 42))
    const reset = afterRows.audit_logs.filter(row => row.action === 'RESET_TEST_DATA')
    assert.equal(reset.length, 1)
    assert.equal(reset[0].user_id, 5)
    assert.equal(reset[0].entity, 'operational_data')
    assert.equal(reset[0].details, null, 'reset details must use the existing protection layer')
    assert.ok(reset[0].private_data)
    assert.equal(afterRows.audit_logs.length, 4)
    assert.equal(trace.statements.some(statement => /\b(?:TRUNCATE|FOREIGN_KEY_CHECKS|AUTO_INCREMENT\s*=)\b/i.test(statement)), false)
    const nextProduct = await sql(connection, "INSERT INTO products(name,description) VALUES('Novo produto local','Produto após limpeza')")
    const nextCustomer = await sql(connection, 'INSERT INTO customers(name,email,password_hash) VALUES(?,?,?)', ['Novo cliente local', 'after-cleanup@example.invalid', ownerHash])
    assert.ok(nextProduct.insertId > 18)
    assert.ok(nextCustomer.insertId > 11)
  })
})

test('initial test balances require explicit consent before any mutation', async () => {
  await fixture(async (connection, name) => {
    const before = await snapshot(connection)
    const trace = observed(connection)
    await assert.rejects(runTestDataCleanup(executeOptions(trace.connection, name, { resetTestBalances: false })))
    assert.deepEqual(await snapshot(connection), before)
    assert.equal(trace.statements.some(writes), false)
  })
})

test('backup, stopped writers, valid OWNER and exact database identity are mandatory', async () => {
  await fixture(async (connection, name) => {
    const before = await snapshot(connection)
    for (const extra of [{ backupConfirmed: false }, { writersStopped: false }, { actorId: null }, { actorId: 6 }, { actorId: 7 }, { targetDatabase: name + '_wrong' }]) {
      const trace = observed(connection)
      await assert.rejects(runTestDataCleanup(executeOptions(trace.connection, name, extra)))
      assert.equal(trace.statements.some(writes), false)
      assert.deepEqual(await snapshot(connection), before)
    }
  })
})

test('an unknown table prevents execution before the first write', async () => {
  await fixture(async (connection, name) => {
    await sql(connection, 'CREATE TABLE unexpected_operational_data(id INT PRIMARY KEY,value VARCHAR(40)) ENGINE=InnoDB')
    await sql(connection, "INSERT INTO unexpected_operational_data VALUES(1,'Preserve on refusal')")
    const before = await snapshot(connection)
    const trace = observed(connection)
    await assert.rejects(runTestDataCleanup(executeOptions(trace.connection, name)))
    assert.equal(trace.statements.some(writes), false)
    assert.deepEqual(await snapshot(connection), before)
  })
})

test('an unexpected FK in a preserved table prevents all writes', async () => {
  await fixture(async (connection, name) => {
    await sql(connection, 'ALTER TABLE media_assets ADD linked_product_id INT NULL, ADD CONSTRAINT fk_unexpected_product FOREIGN KEY(linked_product_id) REFERENCES products(id) ON DELETE SET NULL')
    await sql(connection, 'UPDATE media_assets SET linked_product_id=17 WHERE id=34')
    const before = await snapshot(connection)
    const trace = observed(connection)
    await assert.rejects(runTestDataCleanup(executeOptions(trace.connection, name)))
    assert.equal(trace.statements.some(writes), false)
    assert.deepEqual(await snapshot(connection), before)
  })
})

test('triggers and a nontransactional table are refused before mutation', async () => {
  await fixture(async (connection, name) => {
    // MySQL does not support CREATE/DROP TRIGGER in prepared statements.
    await connection.query('CREATE TRIGGER cleanup_fixture_guard BEFORE DELETE ON products FOR EACH ROW SET @cleanup_trigger_seen=1')
    const before = await snapshot(connection)
    const trace = observed(connection)
    await assert.rejects(runTestDataCleanup(executeOptions(trace.connection, name)))
    assert.equal(trace.statements.some(writes), false)
    assert.deepEqual(await snapshot(connection), before)
    await connection.query('DROP TRIGGER cleanup_fixture_guard')
    // sessions has no FKs and a short key supported by MyISAM. The event table
    // uses a larger utf8mb4 key that MyISAM would refuse before our guard runs.
    await sql(connection, 'ALTER TABLE sessions ENGINE=MyISAM')
    const nontransactionalBefore = await snapshot(connection)
    const secondTrace = observed(connection)
    await assert.rejects(runTestDataCleanup(executeOptions(secondTrace.connection, name)))
    assert.equal(secondTrace.statements.some(writes), false)
    assert.deepEqual(await snapshot(connection), nontransactionalBefore)
  })
})

test('a failure after successful deletes rolls back operations, balances and Home changes', async () => {
  await fixture(async (connection, name) => {
    const before = await snapshot(connection)
    const trace = observed(connection, statement => /^DELETE\s+FROM\s+`?products`?\b/i.test(statement.trim()))
    await assert.rejects(runTestDataCleanup(executeOptions(trace.connection, name)))
    assert.ok(trace.statements.filter(writes).length > 5, 'failure must occur after real mutations, not during validation')
    assert.ok(trace.calls.includes('rollback'), 'the connection must explicitly roll back')
    assert.equal(trace.calls.includes('commit'), false)
    assert.deepEqual(await snapshot(connection), before)
  })
})

test('customer sessions are removed while a mixed owner session keeps its login, cookie, CSRF and expiration', async () => {
  await fixture(async (connection, name) => {
    const cookie = { httpOnly: true, path: '/', sameSite: 'lax', originalMaxAge: 3600000, expires: '2033-05-18T03:33:20.000Z' }
    const mixed = { cookie, userId: 5, customerId: 11, csrfToken: 'c'.repeat(64), manterConectado: true }
    for (const [id, data] of [
      ['local-mixed-session', mixed],
      ['local-customer-session', { cookie, customerId: 11, csrfToken: 'd'.repeat(64) }],
      ['local-inactive-mixed-session', { cookie, userId: 7, customerId: 11, csrfToken: 'e'.repeat(64) }]
    ]) {
      await sql(connection, 'INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)', [id, 2000000000, JSON.stringify({
        cookie, protected_session: protection.encryptJSON(data, { table: 'sessions', field: 'data', rowId: id })
      })])
    }
    await sql(connection, 'INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)', ['local-visitor-session', 2000000000, JSON.stringify({ cookie, visitor: true })])
    const before = (await snapshot(connection)).sessions
    await runTestDataCleanup(executeOptions(connection, name))
    const afterRows = (await snapshot(connection)).sessions
    assert.deepEqual(afterRows.map(row => row.session_id), ['local-mixed-session', 'local-owner-session', 'local-visitor-session'])
    for (const id of ['local-owner-session', 'local-visitor-session']) {
      assert.deepEqual(afterRows.find(row => row.session_id === id), before.find(row => row.session_id === id))
    }
    const retained = afterRows.find(row => row.session_id === 'local-mixed-session')
    assert.equal(retained.expires, 2000000000)
    const envelope = JSON.parse(retained.data)
    assert.deepEqual(envelope.cookie, cookie)
    const restored = protection.decryptJSON(envelope.protected_session, { table: 'sessions', field: 'data', rowId: retained.session_id })
    const expected = { ...mixed }
    delete expected.customerId
    assert.deepEqual(restored, expected)
  })
})

test('encrypted preserved data refuses a disabled or incorrect key before any mutation', async () => {
  await fixture(async (connection, name) => {
    const before = await snapshot(connection)
    const disabled = observed(connection)
    await assert.rejects(runTestDataCleanup(executeOptions(disabled.connection, name, { privacyEnabled: false })))
    assert.equal(disabled.statements.some(writes), false)
    assert.deepEqual(await snapshot(connection), before)
    const original = process.env.DATA_ENCRYPTION_KEY
    try {
      process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64')
      const wrongKey = observed(connection)
      await assert.rejects(runTestDataCleanup(executeOptions(wrongKey.connection, name)))
      assert.equal(wrongKey.statements.some(writes), false)
      assert.deepEqual(await snapshot(connection), before)
    } finally {
      process.env.DATA_ENCRYPTION_KEY = original
    }
  })
})

test('an ambiguous commit is reported without automatically repeating a committed cleanup', async () => {
  await fixture(async (connection, name) => {
    const trace = observed(connection)
    let commits = 0
    const ambiguous = new Proxy(trace.connection, {
      get(target, key) {
        if (key === 'commit') return async () => {
          commits++
          await connection.commit()
          const error = new Error('Injected local lost commit acknowledgment')
          error.code = 'PROTOCOL_CONNECTION_LOST'
          throw error
        }
        return Reflect.get(target, key)
      }
    })
    await assert.rejects(runTestDataCleanup(executeOptions(ambiguous, name)), error => error.code === 'CLEANUP_COMMIT_UNKNOWN')
    assert.equal(commits, 1)
    assert.equal(trace.calls.filter(call => call === 'beginTransaction').length, 1)
    for (const table of DELETE_TABLES) assert.equal(Number((await sql(connection, 'SELECT COUNT(*) AS total FROM `' + table + '`'))[0].total), 0)
    const reset = await sql(connection, "SELECT id FROM audit_logs WHERE action='RESET_TEST_DATA'")
    assert.equal(reset.length, 1, 'the engine must never automatically issue a second reset')
  })
})

test('a database-scoped user cannot hide external metadata and is refused before writes', async () => {
  await fixture(async (connection, name) => {
    const user = 'galeo_cleanup_' + randomBytes(8).toString('hex')
    const password = randomBytes(24).toString('hex')
    assert.match(user, /^galeo_cleanup_[a-f0-9]{16}$/)
    let limited
    let userCreated = false
    try {
      // Bind even disposable credentials and sanitize setup failures so no
      // driver error can accidentally print the fixture password in test logs.
      try {
        await admin.query('CREATE USER ?@? IDENTIFIED BY ?', [user, '%', password])
        userCreated = true
        await admin.query('GRANT ALL PRIVILEGES ON `' + name + '`.* TO ?@?', [user, '%'])
      } catch {
        throw new Error('Unable to create the restricted local test user.')
      }
      limited = await mysql.createConnection({ ...connectionConfig, user, password, database: name })
      const before = await snapshot(connection)
      for (const execute of [false, true]) {
        const trace = observed(limited)
        await assert.rejects(runTestDataCleanup(executeOptions(trace.connection, name, { execute })), error => error.code === 'CLEANUP_SCHEMA_VISIBILITY_UNPROVEN')
        assert.equal(trace.statements.some(writes), false)
        assert.deepEqual(await snapshot(connection), before)
      }
    } finally {
      await limited?.end()
      if (userCreated) await admin.query('DROP USER ?@?', [user, '%'])
    }
  })
})

async function startLocalApi(database) {
  assert.ok(fixtureName(database), 'the API may only start against the disposable cleanup database')
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env, DB_NAME: database, DB_HOST: process.env.DB_HOST, DB_PORT: '3307', DB_SSL: 'false',
      NODE_ENV: 'test', PORT: '10127', SESSION_SECRET: randomBytes(32).toString('hex'),
      APP_URL: 'http://127.0.0.1:10127', ALLOWED_ORIGINS: 'http://127.0.0.1:10127',
      ADMIN_EMAIL: '', ADMIN_PASSWORD: '', RESEND_API_KEY: '', EMAIL_FROM: '', STORE_NOTIFICATION_EMAIL: '',
      CLOUDINARY_URL: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
      MERCADO_PAGO_ACCESS_TOKEN: '', MERCADO_PAGO_POINT_TERMINAL_ID: '', MERCADO_PAGO_WEBHOOK_SECRET: '',
      DISTRIBUTOR_WEBHOOK_SECRET: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-8192) })
  child.stderr.on('data', () => {}) // Never print credential-bearing driver errors.
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The disposable local cleanup API did not start in 30 seconds.')), 30000)
      child.once('error', () => { clearTimeout(timer); reject(new Error('The local cleanup API could not start.')) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('The local cleanup API stopped before startup.')) })
      child.stdout.on('data', () => {
        if (stdout.includes('GALEO API running on port 10127')) { clearTimeout(timer); resolve() }
      })
    })
    const response = await fetch('http://127.0.0.1:10127/health')
    assert.equal(response.status, 200)
    return child
  } catch (error) {
    await stopLocalApi(child)
    throw error
  }
}

async function stopLocalApi(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('close', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

test('after cleanup, restarting the real local API preserves custom Home draft, publication, metadata and dates', async () => {
  await fixture(async (connection, name) => {
    await runTestDataCleanup(executeOptions(connection, name))
    let child
    try {
      // The first local boot applies normal schema additions/defaults. The
      // owner then saves deliberately chosen phrases that must survive restart.
      child = await startLocalApi(name)
      await stopLocalApi(child)
      child = undefined
      const draft = { heading: 'Vista o que representa você.', editorial: 'Texto exclusivo do proprietário.', formatted: '<em>representa você.</em>' }
      const published = { heading: 'Vista o que representa você.', editorial: 'Uma publicação diferente do rascunho.', accent: 'A escolha é sua.' }
      await sql(connection, "UPDATE home_sections SET draft_content=?,published_content=?,sort_order=70,visible=0,published_sort_order=30,published_visible=1,updated_at='2026-01-02 03:04:05',published_at='2026-01-03 04:05:06' WHERE id=31", [JSON.stringify(draft), JSON.stringify(published)])
      const homeBefore = await sql(connection, 'SELECT * FROM home_sections ORDER BY id')
      const settingsBefore = await sql(connection, 'SELECT * FROM home_settings ORDER BY setting_key')
      child = await startLocalApi(name)
      assert.deepEqual(await sql(connection, 'SELECT * FROM home_sections ORDER BY id'), homeBefore)
      assert.deepEqual(await sql(connection, 'SELECT * FROM home_settings ORDER BY setting_key'), settingsBefore)
      for (const table of DELETE_TABLES) {
        assert.equal(Number((await sql(connection, 'SELECT COUNT(*) AS total FROM `' + table + '`'))[0].total), 0, table + ' must remain empty after bootstrap')
      }
    } finally {
      await stopLocalApi(child)
    }
  })
})
