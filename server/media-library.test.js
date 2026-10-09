import assert from 'node:assert/strict'
import test from 'node:test'
import { registerMediaLibrary } from './media-library.js'

const originalUrl = 'https://example.test/original.jpg'
const generatedUrl = 'https://example.test/generated.png'

function createLibrary(t, { asset = {}, configured = true, ready = true, afterFind, explicitError } = {}) {
  const row = {
    id: 1, public_id: 'photo-1', title: 'Foto original', media_type: 'image',
    ai_status: 'none', ai_age: 0, ai_url: null, url: originalUrl, use_ai: 0,
    ...asset
  }
  const calls = { claimed: 0, explicit: 0, checked: [], updates: [], audited: [] }
  const routes = new Map()
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method,
    (path, ...handlers) => routes.set(method + ' ' + path, handlers.at(-1))
  ]))
  let found = false
  const query = async (sql, params = []) => {
    if (sql.startsWith('CREATE TABLE')) return {}
    if (sql.startsWith('SELECT')) {
      if (Number(params[0]) !== row.id) return []
      const snapshot = { ...row }
      if (!found) { found = true; afterFind?.(row) }
      return [snapshot]
    }
    if (!sql.startsWith('UPDATE media_assets SET ')) throw new Error('Unexpected query: ' + sql)
    calls.updates.push({ sql, params: [...params] })
    if (sql.includes("SET ai_status='processing'")) {
      calls.claimed++
      const canClaim = ['none', 'failed'].includes(row.ai_status) || (row.ai_status === 'processing' && row.ai_age >= 600)
      if (!canClaim) return { affectedRows: 0 }
    }
    const assignments = sql.slice(sql.indexOf(' SET ') + 5, sql.indexOf(' WHERE ')).split(',')
    let parameter = 0
    for (const assignment of assignments) {
      const match = assignment.trim().match(/^(\w+)\s*=\s*(\?|NULL|'[^']*'|\d+|NOW\(\))$/i)
      if (!match) throw new Error('Unexpected assignment: ' + assignment)
      const [, field, value] = match
      row[field] = value === '?' ? params[parameter++]
        : value === 'NULL' ? null
          : value.startsWith("'") ? value.slice(1, -1)
            : value === 'NOW()' ? '2026-10-09T00:00:00.000Z' : Number(value)
    }
    return { affectedRows: 1 }
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, 'HEAD')
    calls.checked.push(url)
    return { status: 200 }
  })
  registerMediaLibrary(app, {
    query, audit: async (...args) => calls.audited.push(args), exigirLogin() {}, exigirOwner() {},
    mediaUpload: { array: () => () => {} }, cloudinaryConfigurado: () => configured,
    ...(ready ? {} : { verifyAiResult: async url => { calls.checked.push(url); return false } }),
    cloudinary: { uploader: { async explicit(publicId, options) {
      calls.explicit++
      assert.equal(publicId, row.public_id)
      assert.equal(options.eager[0].effect, 'background_removal')
      if (explicitError) throw explicitError
      return { eager: [{ secure_url: generatedUrl }] }
    } } }
  })
  const request = async (method, suffix, { id = '1', body = {} } = {}) => {
    const response = {
      statusCode: 200,
      status(value) { this.statusCode = value; return this },
      json(value) { this.body = value; return this }
    }
    await routes.get(method + ' /api/admin/media-library' + suffix)({ params: { id }, body, admin: { id: 1 } }, response)
    return response
  }
  return {
    calls, row,
    process: options => request('post', '/:id/ai-background', options),
    patch: body => request('patch', '/:id', { body })
  }
}

function assertUnapproved(item, aiUrl) {
  assert.equal(item.use_ai, false)
  assert.equal(item.url, originalUrl)
  assert.equal(item.original_url, originalUrl)
  assert.equal(item.ai_url, aiUrl)
}

test('checking an AI result older than ten minutes reuses its saved URL without approving or charging again', async t => {
  const savedUrl = 'https://example.test/existing.png'
  const library = createLibrary(t, { asset: { ai_status: 'processing', ai_age: 1200, ai_url: savedUrl } })
  const response = await library.process()
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.item.ai_status, 'done')
  assertUnapproved(response.body.item, savedUrl)
  assert.equal(library.calls.claimed, 0)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [savedUrl])
})

test('a stale processing attempt without a saved URL recovers without approving the generated image', async t => {
  const library = createLibrary(t, { asset: { ai_status: 'processing', ai_age: 1200 } })
  const response = await library.process()
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.item.ai_status, 'done')
  assertUnapproved(response.body.item, generatedUrl)
  assert.equal(library.calls.claimed, 1)
  assert.equal(library.calls.explicit, 1)
  assert.deepEqual(library.calls.checked, [generatedUrl])
})

test('a recent processing attempt without a URL prevents a concurrent paid transformation', async t => {
  const library = createLibrary(t, { asset: { ai_status: 'processing', ai_age: 60 } })
  const response = await library.process()
  assert.equal(response.statusCode, 409)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [])
  assert.equal(library.row.use_ai, 0)
})

test('a completed AI result is reused without another transformation, availability check, or approval', async t => {
  const library = createLibrary(t, { configured: false, asset: { ai_status: 'done', ai_url: generatedUrl } })
  const response = await library.process()
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.reused, true)
  assertUnapproved(response.body.item, generatedUrl)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [])
  assert.deepEqual(library.calls.updates, [])
})

test('a failed attempt with a saved AI URL checks that result without another paid transformation', async t => {
  const library = createLibrary(t, { asset: { ai_status: 'failed', ai_url: generatedUrl } })
  const response = await library.process()
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.item.ai_status, 'done')
  assertUnapproved(response.body.item, generatedUrl)
  assert.equal(library.calls.claimed, 0)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [generatedUrl])
})

test('an unavailable generated result remains pending and retains the original without spending another credit on a recheck', async t => {
  const library = createLibrary(t, { ready: false })
  const first = await library.process()
  assert.equal(first.statusCode, 202)
  assert.equal(first.body.processing, true)
  assert.equal(first.body.item.ai_status, 'processing')
  assertUnapproved(first.body.item, generatedUrl)
  const second = await library.process()
  assert.equal(second.statusCode, 202)
  assertUnapproved(second.body.item, generatedUrl)
  assert.equal(library.calls.explicit, 1)
  assert.deepEqual(library.calls.checked, [generatedUrl, generatedUrl])
})

test('explicit approval selects the AI version and revocation restores the original while retaining both URLs', async t => {
  const library = createLibrary(t, { asset: { ai_status: 'done', ai_url: generatedUrl } })
  const approved = await library.patch({ use_ai: true })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.body.item.use_ai, true)
  assert.equal(approved.body.item.url, generatedUrl)
  assert.equal(approved.body.item.original_url, originalUrl)
  assert.equal(approved.body.item.ai_url, generatedUrl)
  const revoked = await library.patch({ use_ai: false })
  assert.equal(revoked.statusCode, 200)
  assertUnapproved(revoked.body.item, generatedUrl)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [])
})

for (const value of ['true', 'false', 1, 0, null, {}, []]) {
  test('AI approval rejects the non-boolean value ' + JSON.stringify(value) + ' without changing the asset', async t => {
    const library = createLibrary(t, { asset: { ai_status: 'done', ai_url: generatedUrl } })
    const response = await library.patch({ use_ai: value })
    assert.equal(response.statusCode, 400)
    assert.equal(library.row.use_ai, 0)
    assert.deepEqual(library.calls.updates, [])
    assert.deepEqual(library.calls.audited, [])
  })
}

for (const asset of [
  { ai_status: 'none' },
  { ai_status: 'processing', ai_url: generatedUrl },
  { ai_status: 'failed', ai_url: generatedUrl },
  { ai_status: 'done', ai_url: null },
  { media_type: 'video', ai_status: 'done', ai_url: generatedUrl }
]) {
  test('AI approval rejects an unavailable variant: ' + JSON.stringify(asset), async t => {
    const library = createLibrary(t, { asset })
    const response = await library.patch({ use_ai: true })
    assert.equal(response.statusCode, asset.media_type === 'video' ? 400 : 409)
    assert.deepEqual(library.calls.updates, [])
    assert.deepEqual(library.calls.audited, [])
  })
}

test('returning to the original is allowed even if no completed AI version is available', async t => {
  const library = createLibrary(t, { asset: { ai_status: 'processing', use_ai: 1 } })
  const response = await library.patch({ use_ai: false })
  assert.equal(response.statusCode, 200)
  assertUnapproved(response.body.item, null)
})

test('editing a title preserves an approval made after the request read its asset', async t => {
  const library = createLibrary(t, {
    asset: { ai_status: 'done', ai_url: generatedUrl },
    afterFind: row => { row.use_ai = 1 }
  })
  const response = await library.patch({ title: '  Nova legenda  ' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.item.title, 'Nova legenda')
  assert.equal(response.body.item.use_ai, true)
  assert.equal(response.body.item.url, generatedUrl)
  assert.equal(response.body.item.original_url, originalUrl)
})

test('approving an AI version preserves a title edited after the request read its asset', async t => {
  const library = createLibrary(t, {
    asset: { ai_status: 'done', ai_url: generatedUrl },
    afterFind: row => { row.title = 'Legenda atualizada em outra sessão' }
  })
  const response = await library.patch({ use_ai: true })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.item.title, 'Legenda atualizada em outra sessão')
  assert.equal(response.body.item.use_ai, true)
  assert.equal(response.body.item.url, generatedUrl)
})

test('processing cannot claim an asset another request has already started', async t => {
  const library = createLibrary(t, { afterFind: row => { row.ai_status = 'processing'; row.ai_age = 1 } })
  const response = await library.process()
  assert.equal(response.statusCode, 409)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [])
})

test('AI processing refuses videos without checking or transforming their URL', async t => {
  const library = createLibrary(t, { asset: { media_type: 'video' } })
  const response = await library.process()
  assert.equal(response.statusCode, 400)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [])
  assert.deepEqual(library.calls.updates, [])
})

test('AI processing validates the asset identifier and reports missing assets without external calls', async t => {
  const library = createLibrary(t)
  for (const id of ['0', '-1', '1.5', 'invalid']) {
    const response = await library.process({ id })
    assert.equal(response.statusCode, 400)
  }
  const missing = await library.process({ id: '99' })
  assert.equal(missing.statusCode, 404)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.checked, [])
  assert.deepEqual(library.calls.updates, [])
})

test('AI processing reports an unconfigured provider without claiming or approving the asset', async t => {
  const library = createLibrary(t, { configured: false })
  const response = await library.process()
  assert.equal(response.statusCode, 503)
  assert.equal(library.calls.explicit, 0)
  assert.deepEqual(library.calls.updates, [])
  assert.equal(library.row.ai_status, 'none')
  assert.equal(library.row.use_ai, 0)
})

test('a provider transformation failure marks the attempt failed without changing the original or approving it', async t => {
  t.mock.method(console, 'error', () => {})
  const library = createLibrary(t, { explicitError: new Error('Fake provider failure') })
  const response = await library.process()
  assert.equal(response.statusCode, 500)
  assert.equal(library.row.ai_status, 'failed')
  assert.equal(library.row.url, originalUrl)
  assert.equal(library.row.use_ai, 0)
  assert.equal(library.row.ai_url, null)
  assert.deepEqual(library.calls.checked, [])
})
