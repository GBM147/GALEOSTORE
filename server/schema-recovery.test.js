import test from 'node:test'
import assert from 'node:assert/strict'
import { createDataProtection } from './data-protection.js'
import { inspectOperationalRecovery, restoreOperationalReferences, stripDeletedProductSelections } from './schema-recovery.js'

test('first installation has no recovery while a preserved store detects missing operational tables', async () => {
  const fresh = await inspectOperationalRecovery(async () => [{ name:'sessions' }])
  assert.deepEqual(fresh.missingTables, [])
  const existing = await inspectOperationalRecovery(async () => ['admin_users','home_sections','products'].map(name => ({name})))
  assert.equal(existing.customersMissing,true)
  assert.equal(existing.productsMissing,false)
  assert.equal(existing.missingTables.includes('products'),false)
})

test('deleted product selections are removed from current content and versions without changing text or media', () => {
  const original = { title:'Vista o que <em>representa você</em>', image_url:'https://example.invalid/photo.png', product_ids:[42,'98'], sections:[{content:{product_ids:[100],title:'Histórico'}}] }
  const result = stripDeletedProductSelections(JSON.stringify(original))
  assert.equal(result.highestId,100)
  assert.equal(result.changed,true)
  assert.deepEqual(result.content,{...original,product_ids:[],sections:[{content:{product_ids:[],title:'Histórico'}}]})
  assert.deepEqual(original.product_ids,[42,'98'])
  assert.throws(()=>stripDeletedProductSelections({product_ids:'42'}))
})

function fixture({ protection = null, malformed = false } = {}) {
  const writes=[],events=[]
  const owner={userId:7,csrfToken:'preserved-csrf',cookie:{expires:'2090-01-01T00:00:00.000Z'},other:'keep'}
  const mixed={...owner,customerId:42},customer={customerId:42,cookie:{expires:'2090-01-01T00:00:00.000Z'}}
  const encode=(id,value)=>JSON.stringify(protection?{cookie:value.cookie,protected_session:protection.encryptJSON(value,{table:'sessions',field:'data',rowId:id})}:value)
  const sessions=[{session_id:'owner',data:encode('owner',owner)},{session_id:'mixed',data:encode('mixed',mixed)},{session_id:'customer',data:encode('customer',customer)}]
  if(malformed)sessions.push({session_id:'broken',data:'{invalid'})
  const conn={beginTransaction:async()=>events.push('begin'),commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback'),release:()=>events.push('release')}
  const query=async(sql,params,executor)=>{
    assert.equal(executor,conn)
    if(sql.startsWith('SELECT id FROM admin_users'))return [{id:7}]
    if(sql.startsWith('SELECT session_id,data'))return sessions
    if(sql.startsWith('SELECT')&&sql.includes('highest_id'))return [{highest_id:99}]
    writes.push({sql,params});return {affectedRows:1}
  }
  const state={missingTables:['customers'],existingTables:['admin_users','sessions','audit_logs'],customersMissing:true,productsMissing:false}
  return {state,query,db:{getConnection:async()=>conn},writes,events,owner}
}

for(const encrypted of [false,true])test((encrypted?'protected':'plain')+' sessions lose deleted customer identities while OWNER session, CSRF and cookie are retained', async()=>{
  const protection=encrypted?createDataProtection({key:Buffer.alloc(32,7).toString('base64'),keyId:'local-recovery'}):null
  const f=fixture({protection})
  const result=await restoreOperationalReferences({...f,protection})
  assert.deepEqual(result,{removedCustomerSessions:1,detachedCustomerSessions:1,clearedProductSelections:0})
  assert.equal(f.state.nextId,1000000000)
  assert.equal(f.writes.some(write=>write.params.includes('owner')),false)
  const retained=JSON.parse(f.writes.find(write=>write.sql.startsWith('UPDATE sessions')).params[0])
  const value=encrypted?protection.decryptJSON(retained.protected_session,{table:'sessions',field:'data',rowId:'mixed'}):retained
  assert.deepEqual(value,f.owner)
  assert.deepEqual(f.events,['begin','commit','release'])
})

test('a malformed preserved session blocks recovery before any write',async()=>{
  const f=fixture({malformed:true})
  await assert.rejects(restoreOperationalReferences(f))
  assert.deepEqual(f.writes,[])
  assert.deepEqual(f.events,['begin','rollback','release'])
})

test('ordinary startup does not scan or change sessions and Home',async()=>{
  const result=await restoreOperationalReferences({state:{missingTables:[]},db:{getConnection:()=>{throw new Error('must not connect')}}})
  assert.deepEqual(result,{removedCustomerSessions:0,detachedCustomerSessions:0,clearedProductSelections:0})
})
