import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { v2 as sdk } from 'cloudinary'
import { createDirectUploads, DIRECT_UPLOAD_MAX_BYTES, getVerifiedDirectAsset } from './direct-uploads.js'

const config = { cloud_name: 'galeo-test', api_key: 'public-key', api_secret: 'test-provider-secret' }
const format = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
async function fixture(t) {
  const state = { now: Date.UTC(2026, 9, 15), assets: new Map(), resources: [], queries: [], missing: false, configured: true, legacy: 0, sequence: 0 }
  const cloudinary = {
    config: () => config, utils: sdk.utils,
    api: { async resource(id, options) {
      state.resources.push({ id, options })
      if (state.resourceBarrier) await state.resourceBarrier()
      const value = state.assets.get(id)
      if (value instanceof Error) throw value
      return value
    } }
  }
  const multipartUpload = { array: () => (_req, res) => { state.legacy++; res.json({ legacy: true }) }, single: () => (_req, res) => { state.legacy++; res.json({ legacy: true }) } }
  const direct = createDirectUploads({ multipartUpload, cloudinary, sessionSecret: 'test-session-key', now: () => state.now, uuid: () => 'nonce-' + (++state.sequence), cloudinaryConfigurado: () => state.configured,
    query: async (sql, values) => { state.queries.push({ sql, values }); return state.missing ? [] : [{ id: values[0], media_type: 'image' }] } })
  const app = express()
  app.use(express.json({ limit: '32kb' }))
  app.use((req, res, next) => {
    if (req.get('X-Actor')) req.admin = { id: Number(req.get('X-Actor')), role: req.get('X-Role') || 'owner' }
    if (req.get('X-CSRF-Token') !== 'valid-csrf') return res.status(403).json({ error: 'CSRF' })
    next()
  })
  const exigirLogin = (req, res, next) => req.admin ? next() : res.status(401).json({ error: 'Login' })
  const exigirOwner = (req, res, next) => req.admin.role === 'owner' ? next() : res.status(403).json({ error: 'Owner' })
  direct.register(app, { exigirLogin, exigirOwner })
  const done = (req, res) => res.json({ success: true, files: (req.files || [req.file]).map(file => ({ name: file.originalname, mime: file.mimetype, size: file.size, asset: getVerifiedDirectAsset(file.buffer) })) })
  app.post('/api/admin/media-library', exigirLogin, exigirOwner, direct.mediaUpload.array('media', 8), done)
  app.post('/api/admin/products/:id/media', exigirLogin, exigirOwner, direct.mediaUpload.array('media', 8), done)
  app.post('/api/admin/media-library/:id/replacement', exigirLogin, exigirOwner, direct.mediaUpload.single('media'), done)
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  async function request(path, body, headers = {}) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Actor': '1', 'X-CSRF-Token': 'valid-csrf', ...headers }, body: JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  async function sign({ purpose = 'library', target_id = null, files = [{ name: 'Camisa verão.jpg', type: 'image/jpeg', size: 8000000 }] } = {}) {
    const signed = await request('/api/admin/media-upload/sign', { purpose, target_id, files })
    assert.equal(signed.status, 200)
    return signed.data.uploads.map((upload, index) => {
      const file = files[index], public_id = upload.params.folder + '/' + upload.params.public_id, version = Math.floor(state.now / 1000)
      state.assets.set(public_id, { public_id, version, resource_type: file.type.startsWith('video/') ? 'video' : 'image', type: 'upload', format: format[file.type], bytes: file.size, secure_url: 'https://res.cloudinary.com/' + config.cloud_name + '/' + (file.type.startsWith('video/') ? 'video' : 'image') + '/upload/v' + version + '/' + public_id + '.' + format[file.type] })
      return { ticket: upload.ticket, public_id, version, signature: sdk.utils.api_sign_request({ public_id, version }, config.api_secret) }
    })
  }
  return { state, sign, request, base }
}

test('direct upload signs limited Cloudinary destinations and verifies 8 files without transmitting their bytes', async t => {
  const f = await fixture(t)
  const files = Array.from({ length: 8 }, (_, i) => ({ name: 'Foto ' + i + '.jpg', type: 'image/jpeg', size: DIRECT_UPLOAD_MAX_BYTES }))
  const uploads = await f.sign({ purpose: 'product', target_id: 7, files })
  assert.ok(JSON.stringify({ uploads }).length < 12000)
  const response = await f.request('/api/admin/products/7/media', { uploads })
  assert.equal(response.status, 200)
  assert.equal(response.data.files.length, 8)
  assert.equal(response.data.files[0].size, DIRECT_UPLOAD_MAX_BYTES)
  assert.equal(f.state.resources.length, 8)
  assert.equal(f.state.legacy, 0)
  assert.deepEqual(f.state.resources[0].options, { resource_type: 'image', type: 'upload', timeout: 15000 })
  assert.equal(getVerifiedDirectAsset({ public_id: uploads[0].public_id }), undefined)
})

test('authorization requires an owner, CSRF and an existing target before using the provider', async t => {
  const f = await fixture(t), body = { purpose: 'product', target_id: 7, files: [{ name: 'x.jpg', type: 'image/jpeg', size: 2 }] }
  for (const [headers, status] of [[{ 'X-Actor': '' }, 401], [{ 'X-Role': 'staff' }, 403], [{ 'X-CSRF-Token': '' }, 403]]) {
    assert.equal((await f.request('/api/admin/media-upload/sign', body, headers)).status, status)
  }
  f.state.missing = true
  assert.equal((await f.request('/api/admin/media-upload/sign', body)).status, 404)
  assert.equal(f.state.resources.length, 0)
})

test('all eight provider verifications run in one bounded window and retain file order', async t => {
  const f = await fixture(t)
  const uploads = await f.sign({ files: Array.from({ length: 8 }, (_, i) => ({ name: 'photo-' + i + '.jpg', type: 'image/jpeg', size: 2 })) })
  let started = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const fallback = setTimeout(release, 250)
  t.after(() => clearTimeout(fallback))
  let concurrent = 0
  f.state.resourceBarrier = async () => { started++; if (started === 8) { concurrent = started; release() }; await gate }
  const result = await f.request('/api/admin/media-library', { uploads })
  assert.equal(result.status, 200)
  assert.equal(started, 8)
  assert.equal(concurrent, 8)
  assert.deepEqual(result.data.files.map(file => file.asset.public_id), uploads.map(upload => upload.public_id))
})

test('signed upload parameters prevent overwriting and never expose secrets', async t => {
  const f = await fixture(t)
  const response = await f.request('/api/admin/media-upload/sign', { purpose: 'library', files: [{ name: 'x.png', type: 'image/png', size: 2 }] })
  assert.equal(response.status, 200)
  const upload = response.data.uploads[0]
  assert.equal(upload.upload_url, 'https://api.cloudinary.com/v1_1/galeo-test/image/upload')
  assert.equal(upload.params.overwrite, false)
  assert.equal(upload.params.unique_filename, false)
  assert.equal(upload.params.type, 'upload')
  assert.equal(upload.signature, sdk.utils.api_sign_request(upload.params, config.api_secret))
  assert.equal(JSON.stringify(response.data).includes(config.api_secret), false)
  assert.equal(JSON.stringify(response.data).includes('test-session-key'), false)
})

test('file count, MIME, size, filename and replacement kind are checked before signing', async t => {
  const f = await fixture(t), valid = { name: 'x.jpg', type: 'image/jpeg', size: 2 }
  for (const files of [[], Array(9).fill(valid), [{ ...valid, type: 'image/svg+xml' }], [{ ...valid, size: DIRECT_UPLOAD_MAX_BYTES + 1 }], [{ ...valid, size: 0 }], [{ ...valid, size: 1.5 }], [{ ...valid, name: 'bad\u0000.jpg' }]]) {
    assert.equal((await f.request('/api/admin/media-upload/sign', { purpose: 'library', files })).status, 400)
  }
  assert.equal((await f.request('/api/admin/media-upload/sign', { purpose: 'replacement', target_id: 8, files: [{ name: 'v.mp4', type: 'video/mp4', size: 2 }] })).status, 400)
  assert.equal((await f.request('/api/admin/media-upload/sign', { purpose: 'library', target_id: 8, files: [valid] })).status, 400)
})

test('finalization rejects forged, expired, other-owner, other-purpose and other-target tickets', async t => {
  const f = await fixture(t)
  const [upload] = await f.sign({ purpose: 'product', target_id: 7 })
  assert.equal((await f.request('/api/admin/products/7/media', { uploads: [{ ...upload, ticket: upload.ticket + 'x' }] })).status, 400)
  assert.equal((await f.request('/api/admin/products/7/media', { uploads: [upload] }, { 'X-Actor': '2' })).status, 400)
  assert.equal((await f.request('/api/admin/products/8/media', { uploads: [upload] })).status, 400)
  assert.equal((await f.request('/api/admin/media-library', { uploads: [upload] })).status, 400)
  assert.equal((await f.request('/api/admin/products/7/media', { uploads: [{ ...upload, public_id: 'other/asset' }] })).status, 400)
  assert.equal((await f.request('/api/admin/products/7/media', { uploads: [upload, upload] })).status, 400)
  f.state.now += 10 * 60 * 1000 + 1
  assert.equal((await f.request('/api/admin/products/7/media', { uploads: [upload] })).status, 400)
})

test('provider metadata is authoritative for bytes, resource, delivery type, format, version and URL', async t => {
  const f = await fixture(t)
  for (const change of [{ public_id: 'wrong' }, { bytes: DIRECT_UPLOAD_MAX_BYTES + 1 }, { bytes: 1 }, { resource_type: 'video' }, { type: 'private' }, { format: 'svg' }, { version: 1 }, { secure_url: 'https://attacker.test/x.jpg' }, { secure_url: 'http://res.cloudinary.com/galeo-test/image/upload/x.jpg' }, { secure_url: 'https://res.cloudinary.com/other/image/upload/x.jpg' }]) {
    const [upload] = await f.sign()
    f.state.assets.set(upload.public_id, { ...f.state.assets.get(upload.public_id), ...change })
    assert.equal((await f.request('/api/admin/media-library', { uploads: [upload], secure_url: 'https://attacker.test/ignored.jpg' })).status, 400, JSON.stringify(change))
  }
  const [upload] = await f.sign()
  assert.equal((await f.request('/api/admin/media-library', { uploads: [{ ...upload, signature: 'forged' }] })).status, 400)
  assert.equal((await f.request('/api/admin/media-library', { uploads: [{ ...upload, version: '123' }] })).status, 400)
  f.state.assets.set(upload.public_id, new Error('Sensitive provider error detail'))
  const response = await f.request('/api/admin/media-library', { uploads: [upload] })
  assert.equal(response.status, 502)
  assert.equal(JSON.stringify(response.data).includes('Sensitive'), false)
})

test('native multipart remains available and single replacement uses the same opaque verification', async t => {
  const f = await fixture(t)
  const body = new FormData(); body.append('media', new Blob(['x'], { type: 'image/jpeg' }), 'x.jpg')
  const legacy = await fetch(f.base + '/api/admin/media-library', { method: 'POST', headers: { 'X-Actor': '1', 'X-CSRF-Token': 'valid-csrf' }, body })
  assert.equal(legacy.status, 200)
  assert.equal(f.state.legacy, 1)
  const uploads = await f.sign({ purpose: 'replacement', target_id: 9 })
  const replacement = await f.request('/api/admin/media-library/9/replacement', { uploads })
  assert.equal(replacement.status, 200)
  assert.equal(Buffer.from(replacement.data.files[0].name, 'latin1').toString('utf8'), 'Camisa verão.jpg')
  assert.equal(replacement.data.files[0].asset.public_id, uploads[0].public_id)
  f.state.missing = true
  assert.equal((await f.request('/api/admin/media-library/9/replacement', { uploads })).status, 404)
})
