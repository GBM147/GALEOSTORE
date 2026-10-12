import assert from 'node:assert/strict'
import test from 'node:test'
import { registerMediaLibrary } from './media-library.js'

function createLibrary(t, {
  asset: override = {}, missing = false, products = [], productMedia = [], homeSections = [], homeSettings = [], homeVersions = [],
  configured = true, readError, auditError, destroyError, destroyResult = { result: 'ok' },
  deleteError, affectedRows = 1, commitError
} = {}) {
  t.mock.method(console, 'error', () => {})
  const asset = {
    id: 17, public_id: 'library/photo', media_type: 'image', ai_status: 'none', use_ai: 0,
    url: 'https://res.cloudinary.com/galeo/image/upload/v1/library/photo.jpg', ai_url: null,
    ...override
  }
  const routes = new Map()
  const app = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method,
    (path, ...handlers) => routes.set(method + ' ' + path, handlers.at(-1))
  ]))
  const calls = { operations: [], reads: [], audits: [], destroyed: [], committed: 0, rolledBack: 0, released: 0, acquired: 0 }
  const state = { exists: !missing, audits: [], active: false, pendingDelete: false, pendingAudits: [] }
  const conn = {
    async execute(sql, params = []) {
      if (sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') {
        assert.equal(state.active, false)
        calls.operations.push('repeatable-read')
        return [{}, []]
      }
      assert.equal(sql, 'SELECT * FROM media_assets WHERE id=? FOR UPDATE')
      assert.equal(state.active, true)
      calls.operations.push('lock-asset')
      return [[state.exists && Number(params[0]) === asset.id ? { ...asset } : null].filter(Boolean), []]
    },
    async beginTransaction() { assert.equal(state.active, false); state.active = true; calls.operations.push('begin') },
    async rollback() {
      calls.rolledBack++
      calls.operations.push('rollback')
      state.active = false
      state.pendingDelete = false
      state.pendingAudits = []
    },
    async commit() {
      assert.equal(state.active, true)
      calls.operations.push('commit')
      if (commitError) throw commitError
      calls.committed++
      if (state.pendingDelete) state.exists = false
      state.audits.push(...state.pendingAudits)
      state.active = false
      state.pendingAudits = []
    },
    release() { assert.equal(state.active, false); calls.released++; calls.operations.push('release') }
  }
  const query = async (sql, params = [], executor) => {
    if (sql.startsWith('CREATE TABLE')) return {}
    if (sql.startsWith('SELECT COLUMN_NAME')) return ['sort_order','presentation','replaces_id'].map(name => ({name}))
    if (sql.startsWith('INSERT IGNORE INTO media_library_preferences')) return {}
    if (sql.startsWith('SELECT') && sql.includes('FROM media_assets ')) {
      assert.equal(executor, undefined)
      return state.exists && Number(params[0]) === asset.id ? [{ ...asset }] : []
    }
    if (sql.startsWith('DELETE FROM media_assets')) {
      assert.equal(executor, conn)
      assert.equal(state.active, true)
      assert.deepEqual(params, [asset.id])
      calls.operations.push('delete-row')
      if (deleteError) throw deleteError
      state.pendingDelete = affectedRows === 1
      return { affectedRows }
    }
    const table = sql.includes('FROM product_media ') ? 'productMedia'
      : sql.includes('FROM products ') ? 'products'
        : sql.includes('FROM home_sections ') ? 'homeSections'
          : sql.includes('FROM home_settings ') ? 'homeSettings'
            : sql.includes('FROM home_versions ') ? 'homeVersions' : null
    assert.ok(table, 'Unexpected query: ' + sql)
    if (executor !== undefined) {
      assert.equal(executor, conn)
      assert.equal(state.active, true)
      assert.ok(sql.endsWith(' FOR UPDATE'))
    } else assert.ok(!sql.endsWith(' FOR UPDATE'))
    calls.operations.push('read-' + table)
    calls.reads.push({ table, transactional: executor === conn })
    if (readError === table) throw new Error('Fake reference read failure')
    return { products, productMedia, homeSections, homeSettings, homeVersions }[table]
  }
  registerMediaLibrary(app, {
    query, db: { async getConnection() { calls.acquired++; return conn } },
    async audit(...args) {
      calls.audits.push(args)
      calls.operations.push('audit')
      assert.equal(args[5], conn)
      assert.equal(state.active, true)
      if (auditError) throw auditError
      state.pendingAudits.push(args.slice(0, 5))
    },
    exigirLogin() {}, exigirOwner() {}, mediaUpload: { array: () => () => {}, single: () => () => {} },
    cloudinaryConfigurado: () => configured,
    cloudinary: { uploader: {
      async destroy(publicId, options) {
        assert.equal(state.active, true)
        assert.equal(state.pendingAudits.length, 1)
        calls.operations.push('destroy')
        calls.destroyed.push({ publicId, options })
        if (destroyError) throw destroyError
        return destroyResult
      }
    } }
  })
  async function request(method, suffix, id = String(asset.id)) {
    const response = {
      statusCode: 200,
      status(value) { this.statusCode = value; return this },
      json(value) { this.body = value; return this }
    }
    await routes.get(method + ' /api/admin/media-library/:id' + suffix)({ params: { id }, admin: { id: 9 } }, response)
    return response
  }
  return { calls, state, asset, usage: id => request('get', '/usage', id), remove: id => request('delete', '', id) }
}

function assertPreserved(library, { auditAttempt = false, providerAttempt = false } = {}) {
  assert.equal(library.state.exists, true)
  assert.deepEqual(library.state.audits, [])
  assert.equal(library.calls.committed, 0)
  assert.equal(library.calls.audits.length, auditAttempt ? 1 : 0)
  assert.equal(library.calls.destroyed.length, providerAttempt ? 1 : 0)
  assert.equal(library.calls.operations.includes('delete-row'), false)
}

test('usage and DELETE return the same actionable references and keep an asset used by an inactive product', async t => {
  const library = createLibrary(t, { products: [{ id: 2, name: 'Produto oculto', active: 0, image: 'https://res.cloudinary.com/galeo/image/upload/c_fill,w_100/v9/library/photo.webp' }] })
  const usage = await library.usage()
  assert.equal(usage.statusCode, 200)
  assert.equal(usage.body.in_use, true)
  assert.deepEqual(usage.body.references, [{ type: 'product', id: 2, name: 'Produto oculto', active: false, fields: ['image'] }])
  const deleted = await library.remove()
  assert.equal(deleted.statusCode, 409)
  assert.equal(deleted.body.code, 'MEDIA_IN_USE')
  assert.equal(deleted.body.in_use, true)
  assert.deepEqual(deleted.body.references, usage.body.references)
  assertPreserved(library)
  assert.equal(library.calls.rolledBack, 1)
  assert.equal(library.calls.released, 1)
  assert.equal(library.calls.reads.filter(read => read.transactional).length, 5)
})

for (const [name, fixture] of [
  ['gallery', { productMedia: [{ id: 3, product_id: 2, product_name: 'Produto 2', active: 1, media_type: 'image', public_id: 'library/photo' }] }],
  ['Home draft', { homeSections: [{ section_key: 'hero', draft_content: { desktop_media_id: 17 }, published_content: {} }] }],
  ['Home published', { homeSections: [{ section_key: 'hero', draft_content: {}, published_content: { desktop_media_url: 'https://res.cloudinary.com/galeo/image/upload/v1/library/photo.jpg' } }] }],
  ['setting draft', { homeSettings: [{ setting_key: 'visual', draft_value: { media_asset_id: 17 }, setting_value: {} }] }],
  ['setting published', { homeSettings: [{ setting_key: 'visual', draft_value: null, setting_value: { image: 'https://res.cloudinary.com/galeo/image/upload/v1/library/photo.jpg' } }] }]
]) {
  test('DELETE blocks an asset referenced by ' + name + ' before audit or provider calls', async t => {
    const library = createLibrary(t, fixture)
    const response = await library.remove()
    assert.equal(response.statusCode, 409)
    assert.equal(response.body.code, 'MEDIA_IN_USE')
    assert.equal(response.body.references.length, 1)
    assertPreserved(library)
    assert.equal(library.calls.rolledBack, 1)
    assert.equal(library.calls.released, 1)
  })
}

test('DELETE blocks an AI transformation in progress without a provider call', async t => {
  const library = createLibrary(t, { asset: { ai_status: 'processing' } })
  const response = await library.remove()
  assert.equal(response.statusCode, 409)
  assert.equal(response.body.code, 'MEDIA_PROCESSING')
  assertPreserved(library)
  assert.equal(library.calls.rolledBack, 1)
  assert.equal(library.calls.released, 1)
})

test('DELETE retains an unused asset when the provider is not configured', async t => {
  const library = createLibrary(t, { configured: false })
  const response = await library.remove()
  assert.equal(response.statusCode, 503)
  assert.equal(response.body.code, 'MEDIA_PROVIDER_UNAVAILABLE')
  assertPreserved(library)
  assert.equal(library.calls.rolledBack, 1)
  assert.equal(library.calls.released, 1)
})

for (const table of ['products', 'productMedia', 'homeSections', 'homeSettings', 'homeVersions']) {
  test('a failed ' + table + ' reference read blocks DELETE and rolls back before audit or provider calls', async t => {
    const library = createLibrary(t, { readError: table })
    const response = await library.remove()
    assert.equal(response.statusCode, 500)
    assert.equal(response.body.code, 'MEDIA_USAGE_CHECK_FAILED')
    assertPreserved(library)
    assert.equal(library.calls.rolledBack, 1)
    assert.equal(library.calls.released, 1)
  })
}

test('malformed Home JSON blocks both usage inspection and DELETE', async t => {
  const library = createLibrary(t, { homeSections: [{ section_key: 'hero', draft_content: '{"media_id":', published_content: {} }] })
  const usage = await library.usage()
  assert.equal(usage.statusCode, 500)
  assert.equal(usage.body.code, 'MEDIA_USAGE_CHECK_FAILED')
  const deleted = await library.remove()
  assert.equal(deleted.statusCode, 500)
  assert.equal(deleted.body.code, 'MEDIA_USAGE_CHECK_FAILED')
  assertPreserved(library)
  assert.equal(library.calls.rolledBack, 1)
  assert.equal(library.calls.released, 1)
})

test('an audit write failure retains the asset and prevents an irreversible provider deletion', async t => {
  const library = createLibrary(t, { auditError: new Error('Fake audit failure') })
  const response = await library.remove()
  assert.equal(response.statusCode, 500)
  assert.equal(response.body.code, 'MEDIA_DELETE_FAILED')
  assertPreserved(library, { auditAttempt: true })
  assert.equal(library.calls.rolledBack, 1)
  assert.equal(library.calls.released, 1)
})

for (const [label, options] of [
  ['throws', { destroyError: new Error('Fake provider failure') }],
  ['returns an error', { destroyResult: { result: 'error' } }],
  ['returns an unconfirmed response', { destroyResult: {} }],
  ['returns no response', { destroyResult: null }]
]) {
  test('when the provider ' + label + ', DELETE retains the asset and rolls back its audit', async t => {
    const library = createLibrary(t, options)
    const response = await library.remove()
    assert.equal(response.statusCode, 502)
    assert.equal(response.body.code, 'MEDIA_PROVIDER_DELETE_FAILED')
    assertPreserved(library, { auditAttempt: true, providerAttempt: true })
    assert.equal(library.calls.rolledBack, 1)
    assert.equal(library.calls.released, 1)
  })
}

for (const result of ['ok', 'not found']) {
  test('a confirmed provider result ' + result + ' commits one library deletion and its audit after locking all references', async t => {
    const library = createLibrary(t, { destroyResult: { result } })
    const response = await library.remove()
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.body, { success: true })
    assert.equal(library.state.exists, false)
    assert.deepEqual(library.state.audits, [[9, 'LIBRARY_DELETE', 'media_assets', 17, { public_id: 'library/photo' }]])
    assert.deepEqual(library.calls.destroyed, [{ publicId: 'library/photo', options: { resource_type: 'image', type: 'upload', invalidate: true, timeout: 15000 } }])
    assert.equal(library.calls.committed, 1)
    assert.equal(library.calls.rolledBack, 0)
    assert.equal(library.calls.released, 1)
    assert.deepEqual(library.calls.operations, [
      'repeatable-read', 'begin', 'lock-asset', 'read-products', 'read-productMedia', 'read-homeSections', 'read-homeSettings', 'read-homeVersions',
      'audit', 'destroy', 'delete-row', 'commit', 'release'
    ])
  })
}

test('deleting a video uses the video resource type', async t => {
  const library = createLibrary(t, { asset: { media_type: 'video', public_id: 'library/video', url: 'https://res.cloudinary.com/galeo/video/upload/v1/library/video.mp4' } })
  assert.equal((await library.remove()).statusCode, 200)
  assert.equal(library.calls.destroyed[0].options.resource_type, 'video')
})

for (const [label, options] of [
  ['row deletion fails', { deleteError: new Error('Fake row deletion failure') }],
  ['no row is deleted', { affectedRows: 0 }],
  ['commit fails', { commitError: new Error('Fake commit failure') }]
]) {
  test('when ' + label + ' after provider success, DELETE reports failure and rolls back local state', async t => {
    const library = createLibrary(t, options)
    const response = await library.remove()
    assert.equal(response.statusCode, 500)
    assert.equal(response.body.code, 'MEDIA_DELETE_FAILED')
    assert.equal(library.state.exists, true)
    assert.deepEqual(library.state.audits, [])
    assert.equal(library.calls.destroyed.length, 1)
    assert.equal(library.calls.committed, 0)
    assert.equal(library.calls.rolledBack, 1)
    assert.equal(library.calls.released, 1)
  })
}

test('invalid IDs are rejected before opening a transaction or checking references', async t => {
  const library = createLibrary(t)
  for (const id of ['0', '-1', '17.5', 'invalid', '9007199254740992']) {
    assert.equal((await library.remove(id)).statusCode, 400)
  }
  assertPreserved(library)
  assert.equal(library.calls.acquired, 0)
  assert.equal(library.calls.reads.length, 0)
})

test('a missing asset rolls back and releases its transaction before checking references or contacting the provider', async t => {
  const library = createLibrary(t, { missing: true })
  assert.equal((await library.remove()).statusCode, 404)
  assert.equal(library.calls.reads.length, 0)
  assert.equal(library.calls.audits.length, 0)
  assert.equal(library.calls.destroyed.length, 0)
  assert.equal(library.calls.rolledBack, 1)
  assert.equal(library.calls.released, 1)
})

test('unused usage inspection reports an empty list without a transaction, audit, or provider call', async t => {
  const library = createLibrary(t)
  const response = await library.usage()
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body, { in_use: false, references: [] })
  assert.equal(library.calls.acquired, 0)
  assert.equal(library.calls.audits.length, 0)
  assert.equal(library.calls.destroyed.length, 0)
  assert.equal(library.calls.reads.length, 5)
})
