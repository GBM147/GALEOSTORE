import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_PHOTO_SIDE, preparePhoto, scaledSize } from './resizeImage.js'

test('large photos shrink to 2000 px on the longest side, keeping the shape', () => {
  assert.deepEqual(scaledSize(4032, 3024), { width: MAX_PHOTO_SIDE, height: 1500, scaled: true })
  assert.deepEqual(scaledSize(3024, 4032), { width: 1500, height: MAX_PHOTO_SIDE, scaled: true })
  assert.deepEqual(scaledSize(1200, 800), { width: 1200, height: 800, scaled: false })
  assert.equal(scaledSize(0, 800), null)
})

test('files that are not common photos are sent unchanged', async () => {
  const video = { type: 'video/mp4', name: 'video.mp4', size: 10 }
  assert.equal(await preparePhoto(video), video)
})
