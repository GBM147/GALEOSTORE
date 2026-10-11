import assert from 'node:assert/strict'
import test from 'node:test'
import { findMediaUsage, loadMediaUsage } from './media-usage.js'

const asset = {
  id: 17,
  public_id: 'galeo-store/library/photo.v2',
  media_type: 'image',
  url: 'https://res.cloudinary.com/galeo/image/upload/v1700000000/galeo-store/library/photo.v2.jpg',
  ai_url: 'https://res.cloudinary.com/galeo/image/upload/e_background_removal,f_png/v1700000000/galeo-store/library/photo.v2.png'
}
const product = (id, fields = {}) => ({ id, name: 'Produto ' + id, active: 1, image: '', video: '', ...fields })

test('original and AI URLs remain references independently of the selected library variant', () => {
  for (const use_ai of [0, 1]) {
    const references = findMediaUsage({ ...asset, use_ai }, {
      products: [product(1, { image: asset.url }), product(2, { image: asset.ai_url })]
    })
    assert.deepEqual(references.map(({ id, fields }) => ({ id, fields })), [
      { id: 1, fields: ['image'] }, { id: 2, fields: ['image'] }
    ])
  }
})

test('Cloudinary transformations, delivery versions, formats, queries, signatures, and fragments still refer to the same asset', () => {
  const urls = [
    'https://res.cloudinary.com/galeo/image/upload/c_fill,w_800,h_800/v1800000000/galeo-store/library/photo.v2.webp',
    'https://res.cloudinary.com/galeo/image/upload/c_fill,w_800/e_background_removal/f_png/v1/galeo-store/library/photo.v2.png',
    'https://res.cloudinary.com/galeo/image/upload/c_fill,w_800/galeo-store/library/photo.v2.jpg',
    'https://res.cloudinary.com/galeo/image/upload/v2/galeo-store/library/photo.v2.avif?download=1&cache=changed',
    'http://res.cloudinary.com/galeo/image/upload/v2/galeo-store/library/photo.v2.jpg#preview',
    'https://res.cloudinary.com/galeo/image/upload/s--signature--/c_fill,w_800/v2/galeo-store/library/photo.v2.jpg',
    'https://res.cloudinary.com/galeo/image/upload/v2/galeo-store%2Flibrary%2Fphoto.v2.jpg'
  ]
  const references = findMediaUsage(asset, { products: urls.map((image, index) => product(index + 1, { image })) })
  assert.deepEqual(references.map(reference => reference.id), urls.map((_, index) => index + 1))
})

test('similar public IDs, other clouds, resource types, delivery types, and unrelated hosts are separate assets', () => {
  const urls = [
    'https://res.cloudinary.com/another-cloud/image/upload/v1/galeo-store/library/photo.v2.jpg',
    'https://res.cloudinary.com/galeo/video/upload/v1/galeo-store/library/photo.v2.jpg',
    'https://res.cloudinary.com/galeo/image/authenticated/v1/galeo-store/library/photo.v2.jpg',
    'https://res.cloudinary.com/galeo/image/upload/v1/galeo-store/library/photo.v20.jpg',
    'https://res.cloudinary.com/galeo/image/upload/v1/another-folder/galeo-store/library/photo.v2.jpg',
    'https://res.cloudinary.com/galeo/image/upload/v1/galeo-store/library/Photo.v2.jpg',
    'https://res.cloudinary.com/galeo/image/upload/v1/galeo-store/library/photo.v2-copy.jpg',
    'https://res.cloudinary.com.attacker.invalid/galeo/image/upload/v1/galeo-store/library/photo.v2.jpg',
    'https://example.invalid/galeo/image/upload/v1/galeo-store/library/photo.v2.jpg'
  ]
  assert.deepEqual(findMediaUsage(asset, { products: urls.map((image, index) => product(index + 1, { image })) }), [])
})

test('inactive products and their primary videos are retained in the reference report', () => {
  const references = findMediaUsage(asset, { products: [product(1, { active: 0, image: asset.url, video: asset.ai_url })] })
  assert.deepEqual(references, [{ type: 'product', id: 1, name: 'Produto 1', active: false, fields: ['image', 'video'] }])
})

test('non-Cloudinary original and AI URLs are references without guessing identities for other hosts', () => {
  const external = { ...asset, url: 'https://example.invalid/original.jpg?version=1', ai_url: 'https://example.invalid/ai.png' }
  const references = findMediaUsage(external, {
    products: [
      product(1, { image: external.url + '#preview' }),
      product(2, { image: external.ai_url }),
      product(3, { image: 'https://example.invalid/original.jpg?version=2' }),
      product(4, { image: 'https://another.invalid/ai.png' })
    ]
  })
  assert.deepEqual(references.map(reference => reference.id), [1, 2])
})

test('gallery references report the parent product and match exact public IDs only in the same resource type', () => {
  const references = findMediaUsage(asset, { productMedia: [
    { id: 3, product_id: 2, product_name: 'Produto oculto', active: 0, media_type: 'image', public_id: asset.public_id, url: asset.ai_url },
    { id: 4, product_id: 2, product_name: 'Produto oculto', active: 0, media_type: 'image', public_id: asset.public_id, url: null },
    { id: 5, product_id: 2, media_type: 'video', public_id: asset.public_id, url: 'https://example.invalid/unrelated.mp4' },
    { id: 6, product_id: 2, media_type: 'image', public_id: asset.public_id + '-copy', url: 'https://example.invalid/unrelated.jpg' }
  ] })
  assert.deepEqual(references, [
    { type: 'product_media', id: 3, product_id: 2, name: 'Produto oculto', active: false, fields: ['url', 'public_id'] },
    { type: 'product_media', id: 4, product_id: 2, name: 'Produto oculto', active: false, fields: ['public_id'] }
  ])
})

test('video assets match transformed Cloudinary videos and gallery references without matching an image resource with the same ID', () => {
  const video = { id: 19, public_id: 'library/campaign', media_type: 'video', url: 'https://res.cloudinary.com/galeo/video/upload/v1/library/campaign.mp4', ai_url: null }
  const references = findMediaUsage(video, {
    products: [
      product(1, { video: 'https://res.cloudinary.com/galeo/video/upload/q_auto,w_900/v9/library/campaign.webm' }),
      product(2, { image: 'https://res.cloudinary.com/galeo/image/upload/v1/library/campaign.jpg' })
    ],
    productMedia: [{ id: 3, product_id: 1, product_name: 'Produto 1', active: 1, media_type: 'video', public_id: video.public_id }]
  })
  assert.deepEqual(references.map(reference => [reference.type, reference.id, reference.fields]), [
    ['product', 1, ['video']], ['product_media', 3, ['public_id']]
  ])
})

test('Home draft and published references include nested URLs, numeric and string IDs, and media ID arrays', () => {
  const references = findMediaUsage(asset, { homeSections: [{
    section_key: 'hero',
    draft_content: JSON.stringify({
      desktop_media_id: asset.id,
      mobile_media_id: String(asset.id),
      items: [{ media_url: asset.ai_url }, { nested: { image_asset_id: asset.id, related_media_ids: [9, asset.id] } }]
    }),
    published_content: {
      desktop_media_url: asset.url,
      items: [{ media_id: asset.id, media_public_id: asset.public_id }]
    }
  }] })
  assert.ok(references.every(reference => typeof reference.name === 'string' && reference.name.length > 0))
  assert.deepEqual(references.map(({ name, ...reference }) => reference), [
    { type: 'home_section', id: 'hero', state: 'draft', fields: [
      'desktop_media_id', 'items[0].media_url', 'items[1].nested.image_asset_id', 'items[1].nested.related_media_ids[1]', 'mobile_media_id'
    ] },
    { type: 'home_section', id: 'hero', state: 'published', fields: [
      'desktop_media_url', 'items[0].media_id', 'items[0].media_public_id'
    ] }
  ])
})

test('hidden Home sections still block deletion when either draft or published content contains a reference', () => {
  const references = findMediaUsage(asset, { homeSections: [
    { section_key: 'draft_only', visible: 0, published_visible: 0, draft_content: { media_id: asset.id }, published_content: {} },
    { section_key: 'published_only', visible: 0, published_visible: 0, draft_content: {}, published_content: { media_url: asset.url } }
  ] })
  assert.deepEqual(references.map(({ id, state }) => ({ id, state })), [
    { id: 'draft_only', state: 'draft' }, { id: 'published_only', state: 'published' }
  ])
})

test('Home settings inspect published values and separate draft values', () => {
  const references = findMediaUsage(asset, { homeSettings: [{
    setting_key: 'visual', draft_value: { logo: { src: asset.ai_url }, media_asset_id: String(asset.id) },
    setting_value: JSON.stringify({ nested: [{ background_image: asset.url, imageUrl: asset.ai_url }] })
  }] })
  assert.ok(references.every(reference => typeof reference.name === 'string' && reference.name.length > 0))
  assert.deepEqual(references.map(({ name, ...reference }) => reference), [
    { type: 'home_setting', id: 'visual', state: 'draft', fields: ['logo.src', 'media_asset_id'] },
    { type: 'home_setting', id: 'visual', state: 'published', fields: ['nested[0].background_image', 'nested[0].imageUrl'] }
  ])
})

test('titles, text, descriptions, unrelated IDs, and public ID substrings are not references', () => {
  const content = {
    id: asset.id, product_ids: [asset.id], title: asset.url, text: asset.ai_url, description: 'Use ' + asset.url,
    subtitle: asset.public_id, media_url: 'See image ' + asset.url, public_id: 'prefix-' + asset.public_id,
    items: [{ text: String(asset.id), media_id: true }, { media_id: asset.id + 1, public_id: asset.public_id + '-suffix' }]
  }
  assert.deepEqual(findMediaUsage(asset, {
    products: [product(1, { name: asset.url, description: asset.ai_url })],
    homeSections: [{ section_key: 'prose', draft_content: content, published_content: JSON.stringify(content) }],
    homeSettings: [{ setting_key: 'prose', draft_value: content, setting_value: JSON.stringify(content) }]
  }), [])
})

test('empty and nullable JSON values produce no references', () => {
  assert.deepEqual(findMediaUsage(asset, {
    homeSections: [{ section_key: 'empty', draft_content: {}, published_content: 'null' }],
    homeSettings: [{ setting_key: 'empty', draft_value: null, setting_value: '[]' }]
  }), [])
})

test('explicit media reference arrays preserve each matching path without interpreting product ID arrays', () => {
  const references = findMediaUsage(asset, { homeSettings: [{
    setting_key: 'visual', draft_value: null,
    setting_value: { media_ids: [asset.id], media_urls: [asset.ai_url], public_ids: [asset.public_id], product_ids: [asset.id] }
  }] })
  assert.deepEqual(references[0].fields, ['media_ids[0]', 'media_urls[0]', 'public_ids[0]'])
})

for (const [collection, column, key] of [
  ['homeSections', 'draft_content', 'section_key'],
  ['homeSections', 'published_content', 'section_key'],
  ['homeSettings', 'draft_value', 'setting_key'],
  ['homeSettings', 'setting_value', 'setting_key']
]) {
  test('malformed ' + column + ' JSON aborts inspection instead of reporting the asset unused', () => {
    assert.throws(() => findMediaUsage(asset, {
      [collection]: [{ [key]: 'broken', [column]: '{"media_url":' }]
    }), SyntaxError)
  })
}

for (const folder of ['c_fill', 't_shirts', 'v123']) {
  test('a Cloudinary public ID in folder ' + folder + ' remains distinct from transformations and delivery versions', () => {
    const unusual = { ...asset, public_id: folder + '/photo', url: 'https://res.cloudinary.com/galeo/image/upload/' + folder + '/photo.jpg', ai_url: null }
    const references = findMediaUsage(unusual, { products: [
      product(1, { image: unusual.url }),
      product(2, { image: 'https://res.cloudinary.com/galeo/image/upload/v2/' + folder + '/photo.webp' }),
      product(3, { image: 'https://res.cloudinary.com/galeo/image/upload/c_fill,w_100/' + folder + '/photo.avif' }),
      product(4, { image: 'https://res.cloudinary.com/galeo/image/upload/v2/photo.jpg' })
    ] })
    assert.deepEqual(references.map(reference => reference.id), [1, 2, 3])
  })
}

test('usage loading includes every product and both Home states without an active or visibility filter', async () => {
  const queries = []
  const result = await loadMediaUsage(asset, async sql => {
    queries.push(sql)
    if (sql.includes('FROM products ')) return [product(1, { active: 0, image: asset.url })]
    if (sql.includes('FROM product_media ')) return []
    if (sql.includes('FROM home_sections ')) return [{ section_key: 'hero', draft_content: {}, published_content: { media_id: asset.id } }]
    if (sql.includes('FROM home_settings ')) return [{ setting_key: 'visual', draft_value: { media_id: asset.id }, setting_value: {} }]
    throw new Error('Unexpected query')
  })
  assert.equal(queries.length, 4)
  assert.ok(queries.every(sql => !/\bWHERE\b|FOR UPDATE/i.test(sql)))
  assert.deepEqual(result.map(({ type, state }) => ({ type, ...(state ? { state } : {}) })), [
    { type: 'product' }, { type: 'home_section', state: 'published' }, { type: 'home_setting', state: 'draft' }
  ])
})

test('deletion usage loading locks all reference tables and propagates read errors', async () => {
  const queries = []
  assert.deepEqual(await loadMediaUsage(asset, async sql => { queries.push(sql); return [] }, { lock: true }), [])
  assert.equal(queries.length, 4)
  assert.ok(queries.every(sql => sql.endsWith(' FOR UPDATE')))
  const error = new Error('Reference table unavailable')
  await assert.rejects(loadMediaUsage(asset, async () => { throw error }, { lock: true }), error)
})
