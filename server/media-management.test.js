import test from 'node:test'
import assert from 'node:assert/strict'
import { galeoBackgroundUrl, mediaAssetView, moveMedia } from './media-presentation.js'
import { createMediaManagement } from './media-management.js'

const source = 'https://res.cloudinary.com/galeo/image/upload/e_background_removal/f_png/v123/catalog/shirt.png'

test('GALEO canvas follows cached background removal and retains the resource identity', () => {
  const derived = galeoBackgroundUrl(source)
  assert.equal(derived, source + '#_galeo_background')
  assert.equal(galeoBackgroundUrl('https://res.cloudinary.com/galeo/image/upload/e_background_removal/f_png/catalog/shirt.png'), 'https://res.cloudinary.com/galeo/image/upload/e_background_removal/f_png/catalog/shirt.png#_galeo_background')
  for (const invalid of [null, 'http://res.cloudinary.com/g/image/upload/x', 'https://other.test/x.png', 'https://user:pass@res.cloudinary.com/g/image/upload/x', 'https://res.cloudinary.com/g/image/upload/s--signed--/x']) assert.equal(galeoBackgroundUrl(invalid), null)
})

test('a prepared branded preview never changes the chosen original automatically', () => {
  const row = { id: 1, url: 'original.jpg', ai_url: source, ai_status: 'done', use_ai: 0, presentation: 'galeo' }
  const preview = mediaAssetView(row)
  assert.equal(preview.url, row.url)
  assert.equal(preview.presentation, 'original')
  assert.ok(preview.galeo_url)
  assert.equal(mediaAssetView({ ...row, use_ai: 1 }).url, preview.galeo_url)
  assert.equal(mediaAssetView({ ...row, use_ai: 1, presentation: 'ai' }).url, source)
})

test('ordering moves one item without dropping unloaded assets', () => {
  assert.deepEqual(moveMedia([9,8,7,6,5], { id: 6, before_id: 8 }), [9,6,8,7,5])
  assert.deepEqual(moveMedia([9,8,7,6,5], { id: 9, after_id: 5 }), [8,7,6,5,9])
  for (const selection of [{ id: 3, before_id: 8 }, { id: 8, before_id: 8 }, { id: 8, before_id: 7, after_id: 6 }, { id: 8, before_id: '7' }]) assert.throws(() => moveMedia([9,8,7], selection))
})

function fixture({ assets, uploadFail = false, configured = true, auditFail = false } = {}) {
  let rows = structuredClone(assets || [{ id:1, public_id:'old',url:'original.jpg',media_type:'image',title:'Camisa',sort_order:0,ai_status:'done',ai_url:source,use_ai:0 }])
  const calls = { upload:[], query:[], audit:[], commit:0, rollback:0, prepared:[] }
  const routes = new Map()
  const app = Object.fromEntries(['get','put','patch','post'].map(method => [method, (path, ...handlers) => routes.set(method + ' ' + path, handlers.at(-1))]))
  const query = async (sql, params = []) => {
    calls.query.push({sql,params})
    if (sql.startsWith('CREATE ') || sql.startsWith('INSERT IGNORE')) return {}
    if (sql.includes('information_schema')) return ['sort_order','presentation','replaces_id'].map(name => ({name}))
    if (sql.startsWith('SELECT auto_prepare')) return [{auto_prepare:0}]
    if (sql.startsWith('SELECT id,sort_order')) return rows.sort((a,b) => a.sort_order - b.sort_order || b.id - a.id).map(row => ({...row}))
    if (sql.startsWith('SELECT')) return rows.filter(row => row.id === params[0]).map(row => ({...row}))
    if (sql.startsWith('INSERT INTO media_assets')) {
      const row = {id: Math.max(...rows.map(r=>r.id))+1, public_id:params[0],url:params[1],media_type:params[2],title:params[6],replaces_id:params[8],ai_status:'none',use_ai:0}
      rows.push(row); return {insertId:row.id,affectedRows:1}
    }
    if (sql.startsWith('UPDATE media_assets SET presentation')) { Object.assign(rows.find(row => row.id === params[2]), {presentation:params[0],use_ai:params[1]}); return {affectedRows:1} }
    if (sql.startsWith('UPDATE media_assets SET sort_order')) { rows.find(row => row.id === params[1]).sort_order = params[0]; return {affectedRows:1} }
    if (sql.startsWith('UPDATE media_library_preferences')) return {affectedRows:1}
    throw new Error('Unexpected query: ' + sql)
  }
  const conn = { async beginTransaction() {},async commit(){calls.commit++},async rollback(){calls.rollback++},release(){} }
  const management = createMediaManagement({ query,db:{async getConnection(){return conn}},ensureLibrary:async()=>{},
    audit:async(...args)=>{calls.audit.push(args);if(auditFail)throw new Error('Audit unavailable')},
    exigirLogin(){},exigirOwner(){},mediaUpload:{single(){return ()=>{}}},cloudinaryConfigurado:()=>configured,
    enviarParaCloudinary:async(buffer,options)=>{calls.upload.push(options);if(uploadFail)throw new Error('Upload unavailable');return {public_id:'new-independent',secure_url:'https://provider.test/new.jpg'}},
    prepareNewPhotos:async(items)=>{calls.prepared.push(items.map(item=>item.id))}
  })
  management.register(app)
  return { calls, get rows(){return rows}, async request(method,path,{id='1',body={},file={mimetype:'image/jpeg',buffer:Buffer.from('photo')}}={}) {
    const response={statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}}
    await routes.get(method+' '+path)({params:{id},body,file,admin:{id:1}},response)
    return response
  }}
}

test('replacement uploads a distinct asset and leaves current original URL and treatment untouched', async () => {
  const f=fixture(); const old=structuredClone(f.rows[0])
  const result=await f.request('post','/api/admin/media-library/:id/replacement')
  assert.equal(result.statusCode,201)
  assert.deepEqual(f.rows[0],old)
  assert.equal(f.rows[1].replaces_id,old.id)
  assert.equal(f.rows[1].url,'https://provider.test/new.jpg')
  assert.equal(f.rows[1].use_ai,0)
  assert.equal(f.calls.upload[0].overwrite,false)
  assert.notEqual(f.calls.upload[0].public_id,old.public_id)
  assert.equal(f.calls.commit,1)
  assert.ok(f.calls.query.every(call => !/DELETE|UPDATE products|UPDATE home_/.test(call.sql)))
})

test('replacement refuses incompatible file types before uploading', async () => {
  const f=fixture();const result=await f.request('post','/api/admin/media-library/:id/replacement',{file:{mimetype:'video/mp4',buffer:Buffer.from('video')}})
  assert.equal(result.statusCode,400);assert.equal(f.calls.upload.length,0);assert.equal(f.rows.length,1)
})

test('replacement provider failure preserves the original and does not create a row', async t => {
  t.mock.method(console,'error',()=>{})
  const f=fixture({uploadFail:true});const result=await f.request('post','/api/admin/media-library/:id/replacement')
  assert.equal(result.statusCode,500);assert.equal(f.rows.length,1);assert.equal(f.rows[0].url,'original.jpg');assert.equal(f.calls.commit,0)
})

test('explicit branded choice resolves the saved result without contacting an upload or AI provider', async () => {
  const f=fixture();const result=await f.request('patch','/api/admin/media-library/:id/presentation',{body:{variant:'galeo'}})
  assert.equal(result.statusCode,200);assert.equal(result.body.item.presentation,'galeo');assert.equal(result.body.item.url,galeoBackgroundUrl(source));assert.equal(f.calls.upload.length,0)
})

test('an incomplete treatment cannot be explicitly selected or automatically approved', async () => {
  const f=fixture({assets:[{id:1,media_type:'image',url:'original.jpg',ai_url:source,ai_status:'processing',use_ai:0}]})
  const result=await f.request('patch','/api/admin/media-library/:id/presentation',{body:{variant:'galeo'}})
  assert.equal(result.statusCode,409);assert.equal(f.rows[0].use_ai,0);assert.equal(f.calls.commit,0)
})

test('ordering persists all rows transactionally after locking the current library order', async () => {
  const f=fixture({assets:[{id:1,sort_order:1},{id:2,sort_order:2},{id:3,sort_order:3}]})
  const result=await f.request('patch','/api/admin/media-library-order',{body:{id:3,before_id:1}})
  assert.equal(result.statusCode,200);assert.deepEqual(result.body.ids,[3,1,2]);assert.equal(f.calls.commit,1)
  assert.ok(f.calls.query.some(call=>call.sql.endsWith('FOR UPDATE')))
  assert.deepEqual([...f.rows].sort((a,b)=>a.sort_order-b.sort_order).map(row=>row.id),[3,1,2])
})

test('preferences reject truthy strings and avoid enabling automatic credits with an unconfigured provider', async () => {
  const f=fixture({configured:false})
  assert.equal((await f.request('put','/api/admin/media-library-preferences',{body:{auto_prepare:'true'}})).statusCode,400)
  assert.equal((await f.request('put','/api/admin/media-library-preferences',{body:{auto_prepare:true}})).statusCode,503)
  assert.equal((await f.request('put','/api/admin/media-library-preferences',{body:{auto_prepare:false}})).statusCode,200)
})
