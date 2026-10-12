import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { MediaApprovalRuntime, mediaApprovalBaseUrl } from './helpers/media-approval-runtime.mjs'
import { galeoBackgroundUrl } from '../server/media-presentation.js'

const runtime = new MediaApprovalRuntime()
let orderBefore = [], preferencesBefore
before(async () => {
  await runtime.initialize()
  assert.equal((await runtime.owner.request('/api/admin/media-library-preferences')).status, 200)
  orderBefore = await runtime.query('SELECT id,sort_order FROM media_assets ORDER BY id')
  preferencesBefore = await runtime.query('SELECT * FROM media_library_preferences WHERE id=1')
})
after(async () => {
  await runtime.stopApi()
  try {
    for (const row of orderBefore) await runtime.query('UPDATE media_assets SET sort_order=? WHERE id=?', [row.sort_order,row.id])
    if (preferencesBefore?.length) {
      const p=preferencesBefore[0]
      await runtime.query('UPDATE media_library_preferences SET auto_prepare=?,updated_by=?,updated_at=? WHERE id=1', [p.auto_prepare,p.updated_by,p.updated_at])
    }
    if (runtime.db) assert.deepEqual(await runtime.providerAttempts(), [], 'media management tests must not contact Cloudinary or other external providers')
  } finally { await runtime.close() }
})

test('library preferences and ordering require OWNER and a real CSRF session', async () => {
  assert.equal((await runtime.client().request('/api/admin/media-library-preferences')).status,401)
  assert.equal((await runtime.owner.request('/api/admin/media-library-preferences', {method:'PUT',body:{auto_prepare:false},csrf:false})).status,403)
  const asset=await runtime.asset()
  assert.equal((await runtime.owner.request('/api/admin/media-library-order',{method:'PATCH',body:{id:asset.id,before_id:asset.id},csrf:false})).status,403)
  await runtime.query("UPDATE admin_users SET role='staff' WHERE id=?",[runtime.ownerId])
  try { assert.equal((await runtime.owner.request('/api/admin/media-library-preferences')).status,403) }
  finally {
    await runtime.query("UPDATE admin_users SET role='owner' WHERE id=?",[runtime.ownerId])
    runtime.owner=runtime.client()
    assert.equal((await runtime.owner.request('/api/auth/login',{method:'POST',body:{email:runtime.email,password:runtime.password}})).status,200)
  }
})

test('renaming persists while keeping original and prepared URLs unchanged', async () => {
  const asset=await runtime.asset()
  const before=(await runtime.query('SELECT * FROM media_assets WHERE id=?',[asset.id]))[0]
  const result=await runtime.owner.request('/api/admin/media-library/'+asset.id,{method:'PATCH',body:{title:'Foto organizada'}})
  assert.equal(result.status,200)
  const after=(await runtime.query('SELECT * FROM media_assets WHERE id=?',[asset.id]))[0]
  assert.equal(after.title,'Foto organizada')
  for(const key of ['url','ai_url','public_id','use_ai'])assert.equal(after[key],before[key])
})

test('moving one media preserves every pre-existing row and its original URL', async () => {
  const a=await runtime.asset(),b=await runtime.asset(),c=await runtime.asset()
  const rowsBefore=await runtime.query('SELECT id,url FROM media_assets ORDER BY id')
  const result=await runtime.owner.request('/api/admin/media-library-order',{method:'PATCH',body:{id:a.id,before_id:c.id}})
  assert.equal(result.status,200)
  assert.deepEqual(await runtime.query('SELECT id,url FROM media_assets ORDER BY id'),rowsBefore)
  const persisted=await runtime.query('SELECT id FROM media_assets ORDER BY sort_order,id DESC')
  assert.deepEqual(result.data.ids,persisted.map(r=>r.id))
  assert.equal(persisted.findIndex(r=>r.id===a.id)+1,persisted.findIndex(r=>r.id===c.id))
  assert.ok(persisted.some(r=>r.id===b.id))
  const listed=await runtime.owner.request('/api/admin/media-library?limit=100')
  assert.equal(listed.status,200)
  assert.deepEqual(listed.data.items.map(r=>r.id),persisted.slice(0,100).map(r=>r.id))
})

test('branded choice requires a finished cached image and resolves a product cover independently', async () => {
  const ai='https://res.cloudinary.com/local-fixture/image/upload/e_background_removal/f_png/v123/brand-'+runtime.suffix+'.png'
  const asset=await runtime.asset({ai_url:ai,use_ai:false})
  const before=(await runtime.query('SELECT * FROM media_assets WHERE id=?',[asset.id]))[0]
  const branded=await runtime.owner.request('/api/admin/media-library/'+asset.id+'/presentation',{method:'PATCH',body:{variant:'galeo'}})
  assert.equal(branded.status,200)
  assert.equal(branded.data.item.presentation,'galeo')
  assert.equal(branded.data.item.url,galeoBackgroundUrl(ai))
  const after=(await runtime.query('SELECT * FROM media_assets WHERE id=?',[asset.id]))[0]
  assert.equal(after.url,before.url);assert.equal(after.ai_url,before.ai_url)
  const product=await runtime.createProduct('branded',{image_asset_id:asset.id,image_variant:'galeo'})
  assert.equal((await runtime.owner.request('/api/admin/products')).data.find(item => item.id === product.id).image,galeoBackgroundUrl(ai))
  const reset=await runtime.owner.request('/api/admin/media-library/'+asset.id+'/presentation',{method:'PATCH',body:{variant:'original'}})
  assert.equal(reset.status,200)
  assert.equal((await runtime.query('SELECT image FROM products WHERE id=?',[product.id]))[0].image,galeoBackgroundUrl(ai),'library version changes must not update a saved product cover')
})

test('pending treatment remains unapproved and automatic preparation cannot be enabled without the provider', async () => {
  const asset=await runtime.asset({ai_status:'processing'})
  const denied=await runtime.owner.request('/api/admin/media-library/'+asset.id+'/presentation',{method:'PATCH',body:{variant:'galeo'}})
  assert.equal(denied.status,409)
  assert.equal((await runtime.query('SELECT use_ai FROM media_assets WHERE id=?',[asset.id]))[0].use_ai,0)
  assert.equal((await runtime.owner.request('/api/admin/media-library-preferences',{method:'PUT',body:{auto_prepare:'true'}})).status,400)
  assert.equal((await runtime.owner.request('/api/admin/media-library-preferences',{method:'PUT',body:{auto_prepare:true}})).status,503)
})

test('a replacement attempt without Cloudinary preserves the complete original, product and Home', async () => {
  const asset=await runtime.asset()
  const product=await runtime.createProduct('replacement-protected',{image:asset.originalUrl})
  const original=(await runtime.query('SELECT * FROM media_assets WHERE id=?',[asset.id]))[0]
  const home=await runtime.query('SELECT * FROM home_sections ORDER BY id')
  const form=new FormData();form.append('media',new Blob([Buffer.from('local-photo')],{type:'image/jpeg'}),'local.jpg')
  const response=await fetch(mediaApprovalBaseUrl+'/api/admin/media-library/'+asset.id+'/replacement',{method:'POST',headers:{Cookie:runtime.owner.cookie,'X-CSRF-Token':runtime.owner.csrfToken},body:form})
  assert.equal(response.status,503)
  assert.deepEqual((await runtime.query('SELECT * FROM media_assets WHERE id=?',[asset.id]))[0],original)
  assert.equal((await runtime.query('SELECT image FROM products WHERE id=?',[product.id]))[0].image,original.url)
  assert.deepEqual(await runtime.query('SELECT * FROM home_sections ORDER BY id'),home)
})


test('a retained Home version blocks deletion even after current drafts stop referencing the file', async () => {
  const asset = await runtime.asset()
  const inserted = await runtime.query('INSERT INTO home_versions(version_number,snapshot) SELECT COALESCE(MAX(version_number),0)+1,? FROM home_versions', [JSON.stringify({ schema:1, sections:[{ key:'hero', content:{ media_id:asset.id } }], settings:[] })])
  try {
    const usage = await runtime.owner.request('/api/admin/media-library/' + asset.id + '/usage')
    assert.equal(usage.status,200)
    assert.equal(usage.data.references.some(reference => reference.type === 'home_version'),true)
    const deletion = await runtime.owner.request('/api/admin/media-library/' + asset.id,{method:'DELETE'})
    assert.equal(deletion.status,409)
    assert.equal(deletion.data.code,'MEDIA_IN_USE')
    assert.equal((await runtime.query('SELECT id FROM media_assets WHERE id=?',[asset.id])).length,1)
  } finally { await runtime.query('DELETE FROM home_versions WHERE id=?',[inserted.insertId]) }
})

test('removing a gallery association preserves the shared library file and the other product cover', async () => {
  const asset = await runtime.asset()
  const first = await runtime.createProduct('shared-first',{image:asset.originalUrl})
  const second = await runtime.createProduct('shared-second',{image:asset.originalUrl})
  const inserted = await runtime.query('INSERT INTO product_media(product_id,media_type,url,public_id) VALUES(?,?,?,?)',[first.id,'image',asset.originalUrl,'shared-'+runtime.suffix])
  const removed = await runtime.owner.request('/api/admin/products/'+first.id+'/media/'+inserted.insertId,{method:'DELETE'})
  assert.equal(removed.status,200)
  assert.equal((await runtime.query('SELECT url FROM media_assets WHERE id=?',[asset.id]))[0].url,asset.originalUrl)
  assert.equal((await runtime.query('SELECT image FROM products WHERE id=?',[second.id]))[0].image,asset.originalUrl)
  assert.equal((await runtime.query('SELECT image FROM products WHERE id=?',[first.id]))[0].image,'')
})


test('deleting a product without sales or stock history preserves its reusable library media', async () => {
  const asset = await runtime.asset()
  const product = await runtime.createProduct('delete-no-history',{stock:0,image:asset.originalUrl})
  await runtime.query('INSERT INTO product_media(product_id,media_type,url,public_id) VALUES(?,?,?,?)',[product.id,'image',asset.originalUrl,'delete-'+runtime.suffix])
  const result = await runtime.owner.request('/api/admin/products/'+product.id,{method:'DELETE'})
  assert.equal(result.status,200)
  assert.equal(result.data.mode,'deleted')
  assert.equal((await runtime.query('SELECT id FROM products WHERE id=?',[product.id])).length,0)
  assert.equal((await runtime.query('SELECT url FROM media_assets WHERE id=?',[asset.id]))[0].url,asset.originalUrl)
})
