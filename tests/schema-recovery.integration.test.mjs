import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'

// This reproduces the Adminer mistake in a generated disposable loopback
// database. The shared application database and external providers are refused
// by HomeWorkflowRuntime and its provider network guard.
const removedTables = [
  'payments', 'integration_events', 'store_order_items', 'sale_items',
  'store_orders', 'sales', 'stock_movements', 'product_media', 'products',
  'financial_entries', 'recurring_expenses', 'customer_email_verifications',
  'customers', 'newsletter_subscriptions'
]
const preservedTables = [
  'admin_users', 'audit_logs', 'categories', 'financial_accounts',
  'financial_categories', 'home_sections', 'home_settings', 'home_versions',
  'media_assets', 'media_library_preferences', 'sessions'
]
const plainRows = rows => rows.map(row => ({ ...row }))
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value

async function stopApi(runtime) {
  const child = runtime.child
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('close', () => { clearTimeout(timeout); resolve() })
    child.kill('SIGTERM')
  })
}

async function tables(runtime) {
  return (await runtime.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME')).map(row => row.name)
}

async function structure(runtime) {
  const columns = await runtime.query(`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`)
  const indexes = await runtime.query(`SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`)
  const foreignKeys = await runtime.query(`SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`)
  return { columns: plainRows(columns), indexes: plainRows(indexes), foreignKeys: plainRows(foreignKeys) }
}

async function preservedContent(runtime) {
  const result = {}
  for (const table of preservedTables.filter(name => !['audit_logs', 'sessions'].includes(name))) {
    const order = table === 'home_settings' ? 'setting_key' : 'id'
    result[table] = plainRows(await runtime.query('SELECT * FROM `' + table + '` ORDER BY ' + order))
  }
  return result
}

function withoutDeletedProductSelections(content) {
  const expected = structuredClone(content)
  for (const row of expected.home_sections) {
    if (row.section_key !== 'featured_products') continue
    for (const field of ['draft_content', 'published_content']) {
      const section = parseJson(row[field])
      row[field] = { ...section, product_ids: [] }
    }
  }
  for (const row of expected.home_versions) {
    const snapshot = parseJson(row.snapshot)
    row.snapshot = {
      ...snapshot,
      sections: snapshot.sections.map(section => section.key === 'featured_products'
        ? { ...section, content: { ...section.content, product_ids: [] } }
        : section)
    }
  }
  return expected
}

function sessionCookie(id) {
  const signature = createHmac('sha256', process.env.SESSION_SECRET).update(id).digest('base64').replace(/=+$/, '')
  return 'galeo_sid=' + encodeURIComponent('s:' + id + '.' + signature)
}

async function requestWithSession(runtime, path, id, options = {}) {
  const response = await fetch(runtime.baseUrl + path, {
    ...options,
    headers: { Cookie: sessionCookie(id), ...(options.headers || {}) }
  })
  return { status: response.status, data: await response.json() }
}

test('startup recovers the 14 dropped operational tables and removes stale identities without overwriting owners or Home', { timeout: 120000 }, async t => {
  const runtime = new HomeWorkflowRuntime()
  const sessionIds = Object.fromEntries(['owner', 'mixed', 'customer'].map(kind => [kind, 'recovery-' + kind + '-' + runtime.suffix]))
  const csrfToken = randomBytes(32).toString('hex')
  const expires = Math.floor(Date.now() / 1000) + 14 * 86400
  const sessionData = {
    cookie: { originalMaxAge: 14 * 86400000, expires: new Date(expires * 1000).toISOString(), httpOnly: true, secure: false, sameSite: 'lax' },
    csrfToken
  }
  try {
    await runtime.initialize({ port: 10139 })
    await stopApi(runtime)

    await runtime.query("INSERT INTO products(id,name,description,price,stock) VALUES(42,'Produto anterior de teste','Será removido junto à tabela',123.45,8)")
    await runtime.query('INSERT INTO customers(id,name,email,password_hash,email_verified_at) VALUES(42,?,?,?,NOW())', ['Cliente anterior', 'deleted-' + runtime.suffix + '@example.invalid', 'unused-fixture-hash'])
    const hero = (await runtime.query("SELECT draft_content,published_content FROM home_sections WHERE section_key='hero'"))[0]
    await runtime.query("UPDATE home_sections SET draft_content=?,published_content=?,updated_by=?,published_by=? WHERE section_key='hero'", [
      JSON.stringify({ ...hero.draft_content, title: 'Título proprietário rascunho ' + runtime.suffix, desktop_media_id: 9 }),
      JSON.stringify({ ...hero.published_content, title: 'Título proprietário publicado ' + runtime.suffix, desktop_media_id: 9 }),
      runtime.ownerId, runtime.ownerId
    ])
    const featured = (await runtime.query("SELECT draft_content,published_content FROM home_sections WHERE section_key='featured_products'"))[0]
    await runtime.query("UPDATE home_sections SET draft_content=?,published_content=? WHERE section_key='featured_products'", [
      JSON.stringify({ ...featured.draft_content, source: 'manual', product_ids: [42] }),
      JSON.stringify({ ...featured.published_content, source: 'manual', product_ids: [42] })
    ])
    await runtime.query("UPDATE home_settings SET setting_value=?,draft_value=?,updated_by=? WHERE setting_key='navigation'", [
      JSON.stringify({ items: [{ label: 'Menu proprietário publicado', url: '/shop' }] }),
      JSON.stringify({ items: [{ label: 'Menu proprietário rascunho', url: '/shop?category=Camisas' }] }), runtime.ownerId
    ])
    const version = (await runtime.query('SELECT id,snapshot FROM home_versions ORDER BY id LIMIT 1'))[0]
    const snapshot = structuredClone(parseJson(version.snapshot))
    for (const section of snapshot.sections) {
      if (section.key === 'featured_products') section.content = { ...section.content, source: 'manual', product_ids: [42] }
      if (section.key === 'hero') section.content.title = 'Título histórico proprietário ' + runtime.suffix
    }
    await runtime.query('UPDATE home_versions SET snapshot=?,published_by=? WHERE id=?', [JSON.stringify(snapshot), runtime.ownerId, version.id])
    await runtime.query('INSERT INTO media_assets(id,public_id,url,media_type,title,created_by) VALUES(9,?,?,?,?,?)', [
      'recovery/' + runtime.suffix, 'https://res.cloudinary.com/local-fixture/image/upload/recovery/' + runtime.suffix + '.png', 'image', 'Mídia proprietária preservada', runtime.ownerId
    ])
    await runtime.query('UPDATE media_library_preferences SET auto_prepare=1,updated_by=? WHERE id=1', [runtime.ownerId])
    await runtime.query("UPDATE financial_accounts SET initial_balance=987.65 WHERE name='Caixa da loja'")
    for (const [kind, id] of Object.entries(sessionIds)) {
      const data = { ...sessionData, ...(kind === 'customer' ? {} : { userId: runtime.ownerId }), ...(kind === 'owner' ? {} : { customerId: 42 }) }
      await runtime.query('INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)', [id, expires, JSON.stringify(data)])
    }
    const beforeContent = await preservedContent(runtime)
    const expectedContent = withoutDeletedProductSelections(beforeContent)
    const beforeStructure = await structure(runtime)
    const ownerSessionBefore = (await runtime.query('SELECT * FROM sessions WHERE session_id=?', [sessionIds.owner]))[0]
    const mixedSessionBefore = (await runtime.query('SELECT * FROM sessions WHERE session_id=?', [sessionIds.mixed]))[0]

    await t.test('the reproduction leaves exactly the eleven tables shown in Adminer without disabling foreign key checks', async () => {
      for (const table of removedTables) await runtime.query('DROP TABLE `' + table + '`')
      assert.deepEqual(await tables(runtime), [...preservedTables].sort())
      assert.equal((await runtime.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled'))[0].enabled, 1)
    })

    await runtime.startApi()

    await t.test('all operational structures return empty, including every original column, index and foreign key', async () => {
      assert.deepEqual(await tables(runtime), [...removedTables, ...preservedTables].sort())
      assert.deepEqual(await structure(runtime), beforeStructure)
      for (const table of removedTables) assert.equal((await runtime.query('SELECT COUNT(*) AS count FROM `' + table + '`'))[0].count, 0, table + ' must start empty')
      const floor = await runtime.query(`SELECT TABLE_NAME AS name,AUTO_INCREMENT AS next_id FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${removedTables.map(() => '?').join(',')}) AND AUTO_INCREMENT IS NOT NULL`, removedTables)
      assert.equal(floor.length, 13)
      for (const row of floor) assert.ok(Number(row.next_id) >= 1_000_000_000, row.name + ' cannot reuse an old operational identifier')
    })

    await t.test('owners, Home, history, media, configuration and balances survive with only obsolete product selections removed', async () => {
      assert.deepEqual(await preservedContent(runtime), expectedContent)
      const ownerSession = (await runtime.query('SELECT * FROM sessions WHERE session_id=?', [sessionIds.owner]))[0]
      assert.deepEqual(ownerSession, ownerSessionBefore)
      const mixedSession = (await runtime.query('SELECT * FROM sessions WHERE session_id=?', [sessionIds.mixed]))[0]
      const expectedMixed = parseJson(mixedSessionBefore.data)
      delete expectedMixed.customerId
      assert.equal(mixedSession.session_id, mixedSessionBefore.session_id)
      assert.equal(mixedSession.expires, mixedSessionBefore.expires)
      assert.deepEqual(parseJson(mixedSession.data), expectedMixed)
      assert.equal((await runtime.query('SELECT COUNT(*) AS count FROM sessions WHERE session_id=?', [sessionIds.customer]))[0].count, 0)
      const home = await runtime.request('/api/store/home', { auth: false })
      assert.equal(home.status, 200)
      assert.equal(home.data.sections.find(row => row.key === 'hero').content.title, 'Título proprietário publicado ' + runtime.suffix)
      assert.deepEqual(home.data.sections.find(row => row.key === 'featured_products').content.product_ids, [])
    })

    await t.test('real OWNER and mixed sessions keep working while operational APIs return empty results', async () => {
      assert.equal((await runtime.request('/api/admin/home')).status, 200)
      assert.equal((await requestWithSession(runtime, '/api/admin/home', sessionIds.owner)).status, 200)
      assert.equal((await requestWithSession(runtime, '/api/admin/home', sessionIds.mixed)).status, 200)
      for (const path of ['/api/admin/products', '/api/admin/store-orders', '/api/admin/sales', '/api/admin/stock/movements', '/api/admin/finance/entries', '/api/admin/finance/recurring']) {
        const response = await runtime.request(path)
        assert.equal(response.status, 200, path)
        assert.deepEqual(response.data, [], path)
      }
      const catalog = await runtime.request('/api/store', { auth: false })
      assert.equal(catalog.status, 200)
      assert.deepEqual(catalog.data.products, [])
      assert.equal((await runtime.request('/api/admin/dashboard')).status, 200)
      const mixedCheck = await requestWithSession(runtime, '/api/admin/home/order', sessionIds.mixed, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [] })
      })
      assert.equal(mixedCheck.status, 403, 'mixed session still enforces CSRF')
      const authorizedMixedCheck = await requestWithSession(runtime, '/api/admin/home/order', sessionIds.mixed, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ keys: [] })
      })
      assert.equal(authorizedMixedCheck.status, 400, 'the original mixed-session CSRF token remains valid')
      assert.equal(authorizedMixedCheck.data.code, 'HOME_ORDER_INVALID')
    })

    await t.test('old customer cookies cannot authenticate a recreated account, and new IDs avoid stale client carts', async () => {
      await runtime.query('INSERT INTO customers(id,name,email,password_hash,email_verified_at) VALUES(42,?,?,?,NOW())', ['Nova identidade', 'replacement-' + runtime.suffix + '@example.invalid', 'unused-fixture-hash'])
      assert.equal((await requestWithSession(runtime, '/api/customer/me', sessionIds.customer)).status, 401)
      assert.equal((await requestWithSession(runtime, '/api/customer/me', sessionIds.mixed)).status, 401)
      await runtime.query('DELETE FROM customers WHERE id=42')
      const inserted = await runtime.query('INSERT INTO products(name,description) VALUES(?,?)', ['Novo produto', 'Identificador novo'])
      assert.ok(Number(inserted.insertId) >= 1_000_000_000)
      assert.notEqual(Number(inserted.insertId), 42)
      await runtime.query('DELETE FROM products WHERE id=?', [inserted.insertId])
    })

    await t.test('a second restart is idempotent and never repeats recovery or resets allocated identifier counters', async () => {
      await stopApi(runtime)
      const afterFirstContent = await preservedContent(runtime)
      const afterFirstSessions = plainRows(await runtime.query('SELECT * FROM sessions ORDER BY session_id'))
      const firstCounters = plainRows(await runtime.query(`SELECT TABLE_NAME,AUTO_INCREMENT FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${removedTables.map(() => '?').join(',')}) ORDER BY TABLE_NAME`, removedTables))
      await runtime.startApi()
      assert.deepEqual(await preservedContent(runtime), afterFirstContent)
      assert.deepEqual(plainRows(await runtime.query('SELECT * FROM sessions ORDER BY session_id')), afterFirstSessions)
      assert.deepEqual(plainRows(await runtime.query(`SELECT TABLE_NAME,AUTO_INCREMENT FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${removedTables.map(() => '?').join(',')}) ORDER BY TABLE_NAME`, removedTables)), firstCounters)
      for (const table of removedTables) assert.equal((await runtime.query('SELECT COUNT(*) AS count FROM `' + table + '`'))[0].count, 0)
      assert.deepEqual(await runtime.providerAttempts(), [])
    })
  } finally {
    await runtime.close()
  }
})

test('an interrupted schema recovery reserves identifiers at CREATE time and a later restart finishes safely', { timeout: 120000 }, async () => {
  const runtime = new HomeWorkflowRuntime()
  let alterRevoked = false
  const restoreAlterPermission = async () => {
    if (!alterRevoked) return
    assert.match(runtime.database, /^galeo_store_test_home_[a-f0-9]{12}$/)
    await runtime.adminDb.query('GRANT ALTER ON `' + runtime.database + '`.* TO ?@?', [process.env.DB_USER, '%'])
    alterRevoked = false
  }
  try {
    await runtime.initialize({ port: 10138 })
    await stopApi(runtime)
    const beforeContent = await preservedContent(runtime)
    const beforeStructure = await structure(runtime)
    for (const table of removedTables) await runtime.query('DROP TABLE `' + table + '`')
    assert.deepEqual(await tables(runtime), [...preservedTables].sort())

    // Change privileges only on this generated fixture, never the shared
    // application database. CREATE remains allowed; the first subsequent
    // ALTER fails, reproducing a process that stops after structural creation.
    assert.match(runtime.database, /^galeo_store_test_home_[a-f0-9]{12}$/)
    await runtime.adminDb.query('REVOKE ALTER ON `' + runtime.database + '`.* FROM ?@?', [process.env.DB_USER, '%'])
    alterRevoked = true
    await assert.rejects(runtime.startApi(), /stopped before startup/)
    const partialTables = await tables(runtime)
    assert.deepEqual(partialTables, [...preservedTables, ...removedTables.filter(table => table !== 'newsletter_subscriptions')].sort())
    const createdCounters = await runtime.query(`SELECT TABLE_NAME AS name,AUTO_INCREMENT AS next_id FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${removedTables.map(() => '?').join(',')}) AND AUTO_INCREMENT IS NOT NULL`, removedTables)
    assert.equal(createdCounters.length, 12)
    for (const row of createdCounters) assert.ok(Number(row.next_id) >= 1_000_000_000, row.name + ' reserves safe IDs even when the process stops before ALTER')
    assert.deepEqual(await preservedContent(runtime), beforeContent)

    await restoreAlterPermission()
    await runtime.startApi()
    assert.deepEqual(await tables(runtime), [...preservedTables, ...removedTables].sort())
    assert.deepEqual(await structure(runtime), beforeStructure)
    assert.deepEqual(await preservedContent(runtime), beforeContent)
    for (const table of removedTables) assert.equal((await runtime.query('SELECT COUNT(*) AS count FROM `' + table + '`'))[0].count, 0)
    const finalCounters = await runtime.query(`SELECT TABLE_NAME AS name,AUTO_INCREMENT AS next_id FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${removedTables.map(() => '?').join(',')}) AND AUTO_INCREMENT IS NOT NULL`, removedTables)
    assert.equal(finalCounters.length, 13)
    for (const row of finalCounters) assert.ok(Number(row.next_id) >= 1_000_000_000)
    const inserted = await runtime.query('INSERT INTO customers(name,email,password_hash) VALUES(?,?,?)', ['Cliente posterior', 'partial-' + runtime.suffix + '@example.invalid', 'unused-fixture-hash'])
    assert.ok(Number(inserted.insertId) >= 1_000_000_000)
    await runtime.query('DELETE FROM customers WHERE id=?', [inserted.insertId])
    assert.equal((await runtime.request('/api/admin/home')).status, 200)
    assert.deepEqual((await runtime.request('/api/store', { auth: false })).data.products, [])
    assert.deepEqual(await runtime.providerAttempts(), [])
  } finally {
    await restoreAlterPermission()
    await runtime.close()
  }
})
