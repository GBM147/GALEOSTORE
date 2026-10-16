import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadDirectMedia } from '../src/directUpload.js'

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
function authorize(count) {
  return { uploads: Array.from({ length: count }, (_, i) => ({ ticket: 'ticket-' + i, upload_url: 'https://api.cloudinary.com/v1_1/test/image/upload', api_key: 'public-key', signature: 'signature-' + i, params: { timestamp: 1, folder: 'galeo-store/library', public_id: 'nonce-' + i, overwrite: false, allowed_formats: ['jpg', 'jpeg'] } })) }
}

test('client sends an actual 8 MB file directly to Cloudinary and only small confirmations to the application', async t => {
  const calls = [], progress = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    if (url === '/api/admin/media-upload/sign') {
      const data = JSON.parse(options.body)
      assert.deepEqual(data, { purpose: 'product', target_id: 7, files: [{ name: 'camisa.jpg', type: 'image/jpeg', size: 8 * 1024 * 1024 }] })
      assert.equal(options.headers['X-CSRF-Token'], 'csrf')
      return response(authorize(1))
    }
    if (url.startsWith('https://api.cloudinary.com/')) {
      assert.equal(options.credentials, 'omit')
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers, undefined)
      assert.equal(options.body.get('file').size, 8 * 1024 * 1024)
      assert.equal(options.body.get('overwrite'), 'false')
      assert.equal(options.body.get('allowed_formats'), 'jpg,jpeg')
      assert.equal(options.body.has('X-CSRF-Token'), false)
      return response({ public_id: 'galeo-store/library/nonce-0', version: 1, signature: 'provider-confirmation' })
    }
    assert.equal(url, '/api/admin/products/7/media')
    assert.ok(options.body.length < 1000)
    assert.deepEqual(JSON.parse(options.body), { uploads: [{ ticket: 'ticket-0', public_id: 'galeo-store/library/nonce-0', version: 1, signature: 'provider-confirmation' }] })
    assert.equal(options.credentials, 'include')
    assert.equal(options.headers['X-CSRF-Token'], 'csrf')
    return response({ success: true, media: [{ id: 1 }] })
  })
  const file = new File([new Uint8Array(8 * 1024 * 1024)], 'camisa.jpg', { type: 'image/jpeg' })
  const result = await uploadDirectMedia({ csrf: () => 'csrf', url: '/api/admin/products/7/media', files: [file], onProgress: (...value) => progress.push(value) })
  assert.deepEqual(result, { success: true, media: [{ id: 1 }] })
  assert.deepEqual(progress, [[1, 1]])
  assert.equal(calls.length, 3)
})

test('client batches files in groups of 8, confirms each batch and preserves result order', async t => {
  let provider = 0, finalizations = 0
  const progress = [], batches = []
  const api = async (url, options) => {
    if (url.endsWith('/sign')) { batches.push(options.body.files.length); return authorize(options.body.files.length) }
    finalizations++
    return { success: true, items: options.body.uploads.map(upload => ({ id: upload.version })) }
  }
  t.mock.method(globalThis, 'fetch', async () => response({ public_id: 'library/photo-' + (++provider), version: provider, signature: 'confirmation' }))
  const files = Array.from({ length: 9 }, (_, i) => new File(['photo'], 'photo-' + i + '.jpg', { type: 'image/jpeg' }))
  const result = await uploadDirectMedia({ api, url: '/api/admin/media-library', files, onProgress: (...value) => progress.push(value) })
  assert.deepEqual(batches, [8, 1])
  assert.equal(finalizations, 2)
  assert.deepEqual(result.items.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(progress, [[8, 9], [9, 9]])
})

test('client rejects unsupported, oversize, empty, multiple-replacement and unsafe-destination files before upload', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected network request') })
  const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' })
  for (const options of [
    { files: [] }, { files: [new File(['x'], 'x.svg', { type: 'image/svg+xml' })] },
    { files: [{ name: 'huge.jpg', type: 'image/jpeg', size: 25 * 1024 * 1024 + 1 }] },
    { url: '/api/admin/media-library/7/replacement', files: [file, file] },
    { url: 'https://attacker.test/api', files: [file] }
  ]) await assert.rejects(uploadDirectMedia({ url: '/api/admin/media-library', ...options }))
  assert.equal(calls, 0)
  await assert.rejects(uploadDirectMedia({ api: async () => ({ uploads: [{ ...authorize(1).uploads[0], upload_url: 'https://api.cloudinary.com.attacker.test/v1_1/test/image/upload' }] }), url: '/api/admin/media-library', files: [file] }), /destino seguro/)
  assert.equal(calls, 0)
})

test('failed provider transfers are not finalized and server failures remain visible', async t => {
  const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' })
  let confirmations = 0
  const api = async (url) => {
    if (url.endsWith('/sign')) return authorize(1)
    confirmations++
    throw new Error('Sessão expirou')
  }
  t.mock.method(globalThis, 'fetch', async () => response({ error: 'provider' }, 500))
  await assert.rejects(uploadDirectMedia({ api, url: '/api/admin/media-library', files: [file] }), /armazenamento/)
  assert.equal(confirmations, 0)
  globalThis.fetch = async () => response({ public_id: 'library/x', version: 1 })
  await assert.rejects(uploadDirectMedia({ api, url: '/api/admin/media-library', files: [file] }), /Sessão expirou/)
  assert.equal(confirmations, 1)
})
