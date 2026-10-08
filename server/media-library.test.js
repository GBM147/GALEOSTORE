import assert from 'node:assert/strict'
import test from 'node:test'
import { registerMediaLibrary } from './media-library.js'

function createAiRequest(t, { ai_age, ai_url }) {
  const originalAiUrl = ai_url
  const row = { id: 1, public_id: 'photo-1', media_type: 'image', ai_status: 'processing', ai_age, ai_url, url: 'https://example.test/original.jpg', use_ai: 0 }
  const calls = { claimed: 0, explicit: 0, checked: [] }
  const routes = new Map()
  const app = {
    get() {}, patch() {}, delete() {},
    post(path, ...handlers) { routes.set(path, handlers.at(-1)) }
  }
  const query = async (sql, params = []) => {
    if (sql.startsWith('CREATE TABLE')) return {}
    if (sql.startsWith('SELECT')) return [{ ...row }]
    if (sql.includes("SET ai_status='processing'")) {
      calls.claimed++
      return { affectedRows: ai_age >= 600 ? 1 : 0 }
    }
    if (sql.startsWith('UPDATE media_assets SET ai_url=')) row.ai_url = params[0]
    else if (sql.includes("SET ai_status='done'")) Object.assign(row, { ai_status: 'done', use_ai: 1 })
    else throw new Error('Unexpected query: ' + sql)
    return { affectedRows: 1 }
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, 'HEAD')
    calls.checked.push(url)
    return { status: 200 }
  })
  registerMediaLibrary(app, {
    query, audit: async () => {}, exigirLogin() {}, exigirOwner() {},
    mediaUpload: { array: () => () => {} },
    cloudinaryConfigurado: () => true,
    cloudinary: { uploader: { async explicit(publicId, options) {
      calls.explicit++
      assert.equal(publicId, row.public_id)
      assert.equal(options.eager[0].effect, 'background_removal')
      return { eager: [{ secure_url: 'https://example.test/generated.png' }] }
    } } }
  })
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this },
    json(value) { this.body = value; return this }
  }
  return {
    calls, originalAiUrl, response,
    run: () => routes.get('/api/admin/media-library/:id/ai-background')({ params: { id: '1' }, admin: { id: 1 } }, response)
  }
}

test('checking an AI result older than ten minutes reuses its saved URL without another paid transformation', async (t) => {
  const request = createAiRequest(t, { ai_age: 1200, ai_url: 'https://example.test/existing.png' })
  await request.run()
  assert.equal(request.response.statusCode, 200)
  assert.equal(request.response.body.item.ai_status, 'done')
  assert.equal(request.response.body.item.url, request.originalAiUrl)
  assert.equal(request.calls.claimed, 0)
  assert.equal(request.calls.explicit, 0)
  assert.deepEqual(request.calls.checked, [request.originalAiUrl])
})

test('a stale processing attempt without a saved URL can recover by starting a transformation', async (t) => {
  const request = createAiRequest(t, { ai_age: 1200, ai_url: null })
  await request.run()
  assert.equal(request.response.statusCode, 200)
  assert.equal(request.response.body.item.ai_status, 'done')
  assert.equal(request.calls.claimed, 1)
  assert.equal(request.calls.explicit, 1)
  assert.deepEqual(request.calls.checked, ['https://example.test/generated.png'])
})

test('a recent processing attempt without a URL prevents a concurrent paid transformation', async (t) => {
  const request = createAiRequest(t, { ai_age: 60, ai_url: null })
  await request.run()
  assert.equal(request.response.statusCode, 409)
  assert.equal(request.calls.explicit, 0)
  assert.deepEqual(request.calls.checked, [])
})
