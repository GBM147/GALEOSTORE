import assert from 'node:assert/strict'
import test from 'node:test'
import { ProductImageSelectionError, resolveProductImage } from './product-image-selection.js'

const originalUrl = 'https://example.test/original.jpg'
const aiUrl = 'https://example.test/without-background.png'

function assetQuery(overrides = {}) {
  const asset = { id: 7, media_type: 'image', url: originalUrl, ai_url: aiUrl, ai_status: 'done', use_ai: 0, ...overrides }
  const calls = []
  return {
    asset, calls,
    query: async (sql, params) => {
      assert.match(sql, /^SELECT .* FROM media_assets WHERE id=\?$/)
      assert.deepEqual(params, [7])
      calls.push({ sql, params })
      return [{ ...asset }]
    }
  }
}

async function expectSelectionError(input, query, status) {
  await assert.rejects(resolveProductImage(input, query), error => {
    assert.ok(error instanceof ProductImageSelectionError)
    assert.equal(error.status, status)
    return true
  })
}

test('a manually supplied product image requires no library lookup when no asset is selected', async () => {
  const query = async () => { assert.fail('A manual image must not query the media library') }
  for (const image_asset_id of [undefined, null, '']) {
    assert.equal(await resolveProductImage({ image_asset_id, image: originalUrl, image_variant: 'ai' }, query), originalUrl)
    assert.equal(await resolveProductImage({ image_asset_id }, query), '')
  }
})

test('the original selection uses the trusted library URL even when AI is active or still processing', async () => {
  const fixture = assetQuery({ use_ai: 1, ai_status: 'processing' })
  const image = await resolveProductImage({ image_asset_id: '7', image_variant: 'original', image: 'https://example.test/untrusted.jpg' }, fixture.query)
  assert.equal(image, originalUrl)
  assert.equal(fixture.calls.length, 1)
})

test('an explicit AI selection uses the completed library URL independently of its default preference', async () => {
  const fixture = assetQuery({ use_ai: 0 })
  const image = await resolveProductImage({ image_asset_id: 7, image_variant: 'ai', image: 'https://example.test/untrusted.jpg' }, fixture.query)
  assert.equal(image, aiUrl)
  assert.equal(fixture.calls.length, 1)
})

test('the resolved product image is a saved URL value unaffected by later library selections', async () => {
  const fixture = assetQuery()
  const selectedImage = await resolveProductImage({ image_asset_id: 7, image_variant: 'ai' }, fixture.query)
  fixture.asset.use_ai = 1
  fixture.asset.ai_url = 'https://example.test/new-preview.png'
  assert.equal(selectedImage, aiUrl)
  assert.equal(await resolveProductImage({ image_asset_id: 7, image_variant: 'original' }, fixture.query), originalUrl)
})

test('invalid asset identifiers fail before querying the library', async () => {
  const query = async () => { assert.fail('Invalid identifiers must not reach the database') }
  for (const image_asset_id of [0, -1, 1.5, NaN, Infinity, 'invalid', '1.5', true, false, [7], {}, 9007199254740992, '9007199254740992']) {
    await expectSelectionError({ image_asset_id, image_variant: 'original' }, query, 400)
  }
})

test('an asset selection requires an exact original or AI variant before querying the library', async () => {
  const query = async () => { assert.fail('Invalid variants must not reach the database') }
  for (const image_variant of [undefined, null, '', 'AI', 'image', 'original ', true]) {
    await expectSelectionError({ image_asset_id: 7, image_variant }, query, 400)
  }
})

test('a missing library asset reports not found instead of trusting the client URL', async () => {
  const query = async () => []
  await expectSelectionError({ image_asset_id: 7, image_variant: 'original', image: originalUrl }, query, 404)
})

test('a library video cannot be selected as a product image in either variant', async () => {
  const fixture = assetQuery({ media_type: 'video' })
  for (const image_variant of ['original', 'ai']) {
    await expectSelectionError({ image_asset_id: 7, image_variant }, fixture.query, 400)
  }
})

test('an AI product image requires a completed transformation and a saved URL', async () => {
  for (const overrides of [
    { ai_status: 'none' }, { ai_status: 'processing' }, { ai_status: 'failed' },
    { ai_status: 'done', ai_url: null }, { ai_status: 'done', ai_url: '' }
  ]) {
    const fixture = assetQuery(overrides)
    await expectSelectionError({ image_asset_id: 7, image_variant: 'ai', image: originalUrl }, fixture.query, 409)
  }
})

test('selected original URLs must fit the product image column and contain a string', async () => {
  for (const url of ['', null, 42, 'x'.repeat(1001)]) {
    const fixture = assetQuery({ url })
    await expectSelectionError({ image_asset_id: 7, image_variant: 'original', image: originalUrl }, fixture.query, 400)
  }
  const fixture = assetQuery({ url: 'x'.repeat(1000) })
  assert.equal((await resolveProductImage({ image_asset_id: 7, image_variant: 'original' }, fixture.query)).length, 1000)
})

test('a completed AI URL must also fit the product image column and contain a string', async () => {
  for (const ai_url of [42, 'x'.repeat(1001)]) {
    const fixture = assetQuery({ ai_url })
    await expectSelectionError({ image_asset_id: 7, image_variant: 'ai', image: originalUrl }, fixture.query, 400)
  }
})
