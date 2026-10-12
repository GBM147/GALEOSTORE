import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHomeWorkflow, HOME_SECTION_KEYS } from '../server/home-workflow.js'
import { pruneAuditLogs, compactAuditDetails, AUDIT_DETAILS_MAX_BYTES } from '../server/audit-retention.js'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'

const runtime = new HomeWorkflowRuntime()
let initialPublicHome, initialPublicSettings, firstVersion, currentPublishedHome, currentPublishedSettings
const section = (home, key) => home.sections.find(row => row.key === key)
const setting = (home, key) => home.settings.find(row => row.key === key)
const adminHome = async () => (await runtime.request('/api/admin/home')).data
const adminSettings = async () => (await runtime.request('/api/admin/home/settings')).data
const publicHome = async () => (await runtime.request('/api/store/home', { auth: false })).data
const publicSettings = async () => (await runtime.request('/api/store/home/settings', { auth: false })).data

before(async () => {
  await runtime.initialize()
  initialPublicHome = await publicHome()
  initialPublicSettings = await publicSettings()
  firstVersion = (await runtime.request('/api/admin/home/versions')).data.versions[0]
})
after(async () => { await runtime.close() })

test('initial published Home is recorded once without changing its seven sections or public settings', async () => {
  assert.equal(firstVersion.version, 1)
  assert.equal(firstVersion.current, true)
  assert.equal((await runtime.query('SELECT COUNT(*) AS total FROM home_versions'))[0].total, 1)
  assert.equal(initialPublicHome.sections.length, 7)
  assert.equal(initialPublicSettings.settings.length, 4)
  const snapshot = (await runtime.query('SELECT snapshot FROM home_versions WHERE id=?', [firstVersion.id]))[0].snapshot
  assert.equal(snapshot.schema, 1)
  assert.deepEqual(snapshot.sections.map(item => ({ key: item.key, content: item.content })), initialPublicHome.sections.map(item => ({ key: item.key, content: item.content })))
  const home = await adminHome()
  assert.equal(section(home, 'hero').published_order, section(home, 'hero').order)
  assert.equal(section(home, 'hero').published_visible, true)
  assert.deepEqual(setting(await adminSettings(), 'navigation').published, setting(initialPublicSettings, 'navigation').value)
})

test('workflow endpoints retain OWNER authentication, CSRF and strict order/version validation', async () => {
  assert.equal((await runtime.request('/api/admin/home/versions', { auth: false })).status, 401)
  assert.equal((await runtime.request('/api/admin/home/order', { method: 'PUT', body: { keys: [...HOME_SECTION_KEYS] }, csrf: false })).status, 403)
  assert.equal((await runtime.request('/api/admin/home/publish', { method: 'POST', body: {}, csrf: false })).status, 403)
  assert.equal((await runtime.request('/api/admin/home/versions/' + firstVersion.id + '/restore', { method: 'POST', body: {}, csrf: false })).status, 403)
  for (const keys of [[], [...HOME_SECTION_KEYS, 'hero'], ['hero', 'utility', 'categories', 'featured_products', 'campaigns', 'manifesto', 'unknown']]) {
    const result = await runtime.request('/api/admin/home/order', { method: 'PUT', body: { keys } })
    assert.equal(result.status, 400)
    assert.equal(result.data.code, 'HOME_ORDER_INVALID')
  }
  assert.equal((await runtime.request('/api/admin/home/versions/-1/restore', { method: 'POST', body: {} })).status, 400)
  assert.equal((await runtime.request('/api/admin/home/versions/9999999/restore', { method: 'POST', body: {} })).status, 404)
  assert.deepEqual(await publicHome(), initialPublicHome)
})

test('saving section and setting drafts records compact audit and keeps their published content untouched', async () => {
  const hero = section(await adminHome(), 'hero')
  const content = { ...hero.draft, title: 'Hero de teste exclusivo ' + runtime.suffix }
  const saved = await runtime.request('/api/admin/home/hero', { method: 'PUT', body: { content, visible: false } })
  assert.equal(saved.status, 200)
  assert.equal(saved.data.saved_as, 'draft')
  const menu = { items: [{ label: 'Menu rascunho', url: '/shop' }] }
  assert.equal((await runtime.request('/api/admin/home/settings/navigation', { method: 'PUT', body: { value: menu } })).status, 200)
  const comparison = section(await adminHome(), 'hero')
  assert.equal(comparison.draft.title, content.title)
  assert.equal(comparison.published.title, hero.published.title)
  assert.equal(comparison.visible, false)
  assert.equal(comparison.published_visible, true)
  const settings = await adminSettings()
  assert.deepEqual(setting(settings, 'navigation').value, menu)
  assert.deepEqual(setting(settings, 'navigation').published, setting(initialPublicSettings, 'navigation').value)
  assert.deepEqual(await publicHome(), initialPublicHome)
  assert.deepEqual(await publicSettings(), initialPublicSettings)
  const audits = await runtime.query("SELECT entity,entity_id,details FROM audit_logs WHERE action='EDITAR_CONTEUDO' ORDER BY id")
  assert.equal(audits.length, 2)
  assert.deepEqual(audits.map(row => row.details), [{ saved_as: 'draft' }, { saved_as: 'draft' }])
  assert.deepEqual(audits.map(row => row.entity), ['home', 'home_setting'])
  assert.equal((await runtime.query('SELECT COUNT(*) AS total FROM home_versions'))[0].total, 1)
})

test('reordering is atomic, survives reload and changes only the draft order', async () => {
  const keys = [...HOME_SECTION_KEYS].reverse()
  const result = await runtime.request('/api/admin/home/order', { method: 'PUT', body: { keys } })
  assert.equal(result.status, 200)
  assert.equal(result.data.saved_as, 'draft')
  const home = await adminHome()
  assert.deepEqual(home.sections.map(row => row.key), keys)
  assert.deepEqual(home.sections.map(row => row.order), [10, 20, 30, 40, 50, 60, 70])
  assert.deepEqual([...home.sections].sort((a, b) => a.published_order - b.published_order).map(row => row.key), [...HOME_SECTION_KEYS])
  assert.deepEqual(await publicHome(), initialPublicHome)
})

test('publishing atomically applies content, visibility, order, settings and a new complete version', async () => {
  const response = await runtime.request('/api/admin/home/publish', { method: 'POST', body: {} })
  assert.equal(response.status, 200)
  assert.equal(response.data.version, 2)
  currentPublishedHome = await publicHome()
  currentPublishedSettings = await publicSettings()
  assert.equal(currentPublishedHome.sections.some(row => row.key === 'hero'), false)
  assert.deepEqual(currentPublishedHome.sections.map(row => row.key), [...HOME_SECTION_KEYS].reverse().filter(key => key !== 'hero'))
  assert.equal(setting(currentPublishedSettings, 'navigation').value.items[0].label, 'Menu rascunho')
  const versions = (await runtime.request('/api/admin/home/versions')).data.versions
  assert.deepEqual(versions.map(row => row.version), [2, 1])
  assert.deepEqual(versions.map(row => row.current), [true, false])
  const snapshot = (await runtime.query('SELECT snapshot FROM home_versions WHERE version_number=2'))[0].snapshot
  assert.equal(snapshot.sections.find(row => row.key === 'hero').visible, false)
  assert.equal(snapshot.settings.find(row => row.key === 'navigation').value.items[0].label, 'Menu rascunho')
})

test('restoring a previous version recovers every draft while the public Home and current version stay unchanged', async () => {
  const response = await runtime.request('/api/admin/home/versions/' + firstVersion.id + '/restore', { method: 'POST', body: {} })
  assert.equal(response.status, 200)
  assert.equal(response.data.saved_as, 'draft')
  assert.equal(response.data.restored_from.version, 1)
  const home = await adminHome()
  assert.deepEqual(home.sections.map(row => row.key), [...HOME_SECTION_KEYS])
  assert.equal(section(home, 'hero').visible, true)
  assert.equal(section(home, 'hero').published_visible, false)
  assert.equal(section(home, 'hero').draft.title, section(initialPublicHome, 'hero').content.title)
  assert.deepEqual(setting(await adminSettings(), 'navigation').value, setting(initialPublicSettings, 'navigation').value)
  assert.deepEqual(await publicHome(), currentPublishedHome)
  assert.deepEqual(await publicSettings(), currentPublishedSettings)
  assert.equal((await runtime.request('/api/admin/home/versions')).data.versions[0].version, 2)
})

test('invalid historical data refuses restoration and leaves all drafts unchanged', async () => {
  const snapshot = (await runtime.query('SELECT snapshot FROM home_versions WHERE id=?', [firstVersion.id]))[0].snapshot
  const before = await runtime.query('SELECT * FROM home_sections ORDER BY id')
  const settingsBefore = await runtime.query('SELECT * FROM home_settings ORDER BY setting_key')
  await runtime.query('UPDATE home_versions SET snapshot=? WHERE id=?', [JSON.stringify({ schema: 1, sections: [], settings: [] }), firstVersion.id])
  try {
    const response = await runtime.request('/api/admin/home/versions/' + firstVersion.id + '/restore', { method: 'POST', body: {} })
    assert.equal(response.status, 422)
    assert.equal(response.data.code, 'HOME_VERSION_INVALID')
    assert.deepEqual(await runtime.query('SELECT * FROM home_sections ORDER BY id'), before)
    assert.deepEqual(await runtime.query('SELECT * FROM home_settings ORDER BY setting_key'), settingsBefore)
  } finally { await runtime.query('UPDATE home_versions SET snapshot=? WHERE id=?', [JSON.stringify(snapshot), firstVersion.id]) }
})

test('audit failure rolls publication and its snapshot back in the same MySQL transaction', async () => {
  const before = await runtime.query('SELECT * FROM home_sections ORDER BY id')
  const settingsBefore = await runtime.query('SELECT * FROM home_settings ORDER BY setting_key')
  const versionsBefore = await runtime.query('SELECT * FROM home_versions ORDER BY id')
  const workflow = createHomeWorkflow({ db: runtime.db, query: async (sql, params = [], executor = runtime.db) => { const [rows] = await executor.execute(sql, params); return rows }, audit: async () => { throw new Error('Fixture audit failure') } })
  await assert.rejects(workflow.publish(runtime.ownerId), /Fixture audit failure/)
  assert.deepEqual(await runtime.query('SELECT * FROM home_sections ORDER BY id'), before)
  assert.deepEqual(await runtime.query('SELECT * FROM home_settings ORDER BY setting_key'), settingsBefore)
  assert.deepEqual(await runtime.query('SELECT * FROM home_versions ORDER BY id'), versionsBefore)
})

test('concurrent publications produce distinct versions and the retained history never exceeds five snapshots', async () => {
  const concurrent = await Promise.all([1, 2].map(() => runtime.request('/api/admin/home/publish', { method: 'POST', body: {} })))
  assert.deepEqual(concurrent.map(row => row.status), [200, 200])
  assert.deepEqual(concurrent.map(row => row.data.version).sort((a, b) => a - b), [3, 4])
  for (let index = 0; index < 5; index++) assert.equal((await runtime.request('/api/admin/home/publish', { method: 'POST', body: {} })).status, 200)
  const versions = (await runtime.request('/api/admin/home/versions')).data
  assert.equal(versions.limit, 5)
  assert.deepEqual(versions.versions.map(row => row.version), [9, 8, 7, 6, 5])
  assert.equal((await runtime.query('SELECT COUNT(*) AS total FROM home_versions'))[0].total, 5)
  assert.equal((await runtime.request('/api/admin/home/versions/' + firstVersion.id + '/restore', { method: 'POST', body: {} })).status, 404)
  assert.deepEqual(await runtime.providerAttempts(), [])
})

test('economic audit retention removes events older than 90 days and keeps at most the latest 5000', async () => {
  await runtime.query("INSERT INTO audit_logs(user_id,action,entity,created_at) VALUES(?, 'FIXTURE_EXPIRED','home',DATE_SUB(NOW(), INTERVAL 91 DAY))", [runtime.ownerId])
  const context = compactAuditDetails(Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['field' + i, '🙂'.repeat(1000)])))
  assert.ok(Buffer.byteLength(JSON.stringify(context), 'utf8') <= AUDIT_DETAILS_MAX_BYTES)
  for (let chunk = 0; chunk < 6; chunk++) {
    const count = chunk === 5 ? 2 : 1000
    await runtime.query('INSERT INTO audit_logs(user_id,action,entity,details) VALUES ' + Array.from({ length: count }, () => '(?,?,?,?)').join(','), Array.from({ length: count }, () => [runtime.ownerId, 'FIXTURE_LIMIT', 'home', JSON.stringify(context)]).flat())
  }
  await pruneAuditLogs(sql => runtime.query(sql))
  assert.equal((await runtime.query("SELECT COUNT(*) AS total FROM audit_logs WHERE action='FIXTURE_EXPIRED'"))[0].total, 0)
  assert.equal((await runtime.query('SELECT COUNT(*) AS total FROM audit_logs'))[0].total, 5000)
})
