import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareMediaBackground } from './media-background.js'

test('serverless photo preparation persists the pending derivative and verifies it without another transformation', async () => {
  const asset = { id: 17, public_id: 'galeo-store/library/fixture', media_type: 'image', url: 'https://res.cloudinary.com/test/image/upload/fixture.jpg', ai_status: 'none', ai_url: null }
  let transformations = 0, checks = 0
  const derived = 'https://res.cloudinary.com/test/image/upload/e_background_removal/f_png/fixture.png'
  const deps = {
    serverless: true, cloudinaryConfigurado: () => true,
    cloudinary: { uploader: { explicit: async (_id, options) => { transformations++; assert.equal(options.eager_async, true); return { eager: [] } } }, url: () => derived },
    audit: async () => {}, verifyAiResult: async url => { checks++; assert.equal(url, derived); return true },
    query: async (sql, values) => {
      if (sql.startsWith('SELECT')) return [{ ...asset }]
      if (sql.includes("ai_status='processing'")) { asset.ai_status = 'processing'; return { affectedRows: 1 } }
      if (sql.includes('SET ai_url=')) { asset.ai_url = values[0]; return { affectedRows: 1 } }
      if (sql.includes("ai_status='done'")) { asset.ai_status = 'done'; return { affectedRows: 1 } }
      throw new Error('Unexpected query')
    }
  }
  const initial = await prepareMediaBackground({ ...asset }, deps)
  assert.equal(initial.status, 202)
  assert.equal(asset.ai_status, 'processing')
  assert.equal(asset.ai_url, derived)
  assert.equal(checks, 0)
  const verified = await prepareMediaBackground({ ...asset }, deps)
  assert.equal(verified.status, 200)
  assert.equal(asset.ai_status, 'done')
  assert.equal(transformations, 1)
  assert.equal(checks, 1)
})
