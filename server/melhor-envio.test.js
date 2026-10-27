import test from 'node:test'
import assert from 'node:assert/strict'
import { createMelhorEnvio, ensureMelhorEnvioSchema, MelhorEnvioError } from './melhor-envio.js'

const env = Object.freeze({ NODE_ENV:'test', MELHOR_ENVIO_CLIENT_ID:'test-client', MELHOR_ENVIO_CLIENT_SECRET:'private-app-secret', MELHOR_ENVIO_REDIRECT_URI:'https://galeo.test/api/integrations/melhor-envio/callback', MELHOR_ENVIO_ORIGIN_POSTAL_CODE:'08285-130' })
const secret = 'local-test-only-session-secret-at-least-32-characters'
const startTime = Date.parse('2026-10-27T20:00:00Z')
const sensitive = ['private-app-secret','private-access-token','private-refresh-token','private-code']
const clone = value => value == null ? value : structuredClone(value)
const expectCode = code => error => { assert.ok(error instanceof MelhorEnvioError); assert.equal(error.code,code); return true }
const redacted = value => { for (const text of sensitive) assert.equal(JSON.stringify(value).includes(text),false) }
const response = (data,status=200) => ({ ok:status >= 200 && status < 300, status, json:async()=>data })
const tokenResponse = suffix => ({ access_token:'private-access-token'+suffix, refresh_token:'private-refresh-token'+suffix, token_type:'Bearer', expires_in:2592000 })
const services = () => [{id:1,name:'PAC',price:'25.90',custom_price:'21.35',delivery_time:9,custom_delivery_time:6,company:{name:'Correios'}},{id:2,name:'SEDEX',price:'31.20',delivery_time:3,company:{name:'Correios'}},{id:3,name:'Sem cobertura',error:'Não disponível'}]
const product = () => ({ id:11,name:'Peça local',active:1,price:100,stock:5,variants:[],shipping_weight:0.3,shipping_width:18,shipping_height:3,shipping_length:25 })
const items = [{product_id:11,quantity:1}]
const postal_code = '01001-000'

function memoryDatabase() {
  let row = null, mutex = Promise.resolve()
  const log = []
  async function query(sql,params=[]) {
    log.push({sql,params})
    if(sql.startsWith('SELECT '))return row ? [clone(row)] : []
    if(sql.startsWith('INSERT INTO shipping_integrations')) {
      row ||= {provider:params[0],encrypted_tokens:null,expires_at:null,state_hash:null,state_expires_at:null}
      row.state_hash=params[1];row.state_expires_at=params[2]
      return {affectedRows:1}
    }
    if(sql.includes('SET state_hash=NULL')) {
      if(!row || row.provider!==params[0] || row.state_hash!==params[1] || !(row.state_expires_at > params[2])) return {affectedRows:0}
      row.state_hash=null;row.state_expires_at=null
      return {affectedRows:1}
    }
    if(sql.includes('SET encrypted_tokens=NULL')) { row.encrypted_tokens=null;row.expires_at=null;return {affectedRows:1} }
    if(sql.includes('SET encrypted_tokens=?')) { row.encrypted_tokens=params[0];row.expires_at=params[1];return {affectedRows:1} }
    throw new Error('Unexpected local DB statement: '+sql)
  }
  const db = { async getConnection() {
    let releaseLock, snapshot
    return {
      async beginTransaction() {},
      async execute(sql,params) {
        if(sql.includes('FOR UPDATE')) {
          const before=mutex
          mutex=new Promise(resolve=>{releaseLock=resolve})
          await before
          snapshot=clone(row)
        }
        return [await query(sql,params)]
      },
      async commit(){snapshot=undefined;releaseLock?.();releaseLock=null},
      async rollback(){if(snapshot!==undefined)row=clone(snapshot);releaseLock?.();releaseLock=null},
      release(){releaseLock?.()}
    }
  }}
  return {db,query,log,get row(){return row},set row(value){row=value}}
}

function fixture({database=memoryDatabase(),configuration=env,provider}={}) {
  const calls=[]
  let clock=startTime
  const service=createMelhorEnvio({db:database.db,query:database.query,sessionSecret:secret,env:configuration,now:()=>clock,fetchImpl:async(url,options)=>{
    const call={url,options,body:JSON.parse(options.body)}
    calls.push(call)
    if(provider)return provider(call,calls)
    return response(url.endsWith('/oauth/token') ? tokenResponse('') : services())
  }})
  return {service,database,calls,advance(ms){clock+=ms},req(){return {session:{save(callback){callback()}},query:{}}}}
}
async function authorize(f) {
  const req=f.req()
  const started=await f.service.startAuthorization(req)
  req.query={state:new URL(started.authorization_url).searchParams.get('state'),code:'private-code'}
  await f.service.completeAuthorization(req)
  return req
}
async function quote(f,p=product(),input=items) { return f.service.calculateQuotes({items:input,products:[p],postal_code}) }


test('configuration reports safe readiness and partial credentials require a real quote',async()=>{
  const empty=fixture({configuration:{}})
  assert.equal(empty.service.required(),false)
  assert.equal((await empty.service.status()).configured,false)
  assert.equal((await empty.service.status()).available,false)
  const partial=fixture({configuration:{MELHOR_ENVIO_CLIENT_ID:'test-client'}})
  const status=await partial.service.status()
  assert.equal(status.configured,true)
  assert.equal(status.configuration_complete,false)
  assert.equal(status.available,false)
  assert.equal(partial.service.required(),true)
  assert.ok(status.pending_configuration.includes('MELHOR_ENVIO_ORIGIN_POSTAL_CODE'))
  redacted(status)
  await assert.rejects(partial.service.startAuthorization(partial.req()),expectCode('SHIPPING_NOT_CONFIGURED'))
  assert.equal(partial.calls.length,0)
})

test('OAuth requests only shipping calculation, validates state, encrypts tokens and survives restart',async()=>{
  const f=fixture(), req=f.req()
  const result=await f.service.startAuthorization(req)
  const url=new URL(result.authorization_url)
  assert.equal(url.origin,'https://melhorenvio.com.br')
  assert.equal(url.pathname,'/oauth/authorize')
  assert.equal(url.searchParams.get('scope'),'shipping-calculate')
  assert.equal(url.searchParams.get('redirect_uri'),env.MELHOR_ENVIO_REDIRECT_URI)
  assert.equal(url.searchParams.has('client_secret'),false)
  assert.equal(url.searchParams.get('state').length,43)
  assert.notEqual(f.database.row.state_hash,url.searchParams.get('state'))
  req.query={state:url.searchParams.get('state'),code:'private-code'}
  assert.deepEqual(await f.service.completeAuthorization(req),{connected:true})
  assert.equal(f.database.row.state_hash,null)
  assert.equal(req.session.melhorEnvioOAuth,undefined)
  assert.equal(f.calls.length,1)
  assert.equal(f.calls[0].body.grant_type,'authorization_code')
  assert.equal(f.calls[0].body.client_secret,env.MELHOR_ENVIO_CLIENT_SECRET)
  assert.equal(f.calls[0].options.redirect,'error')
  redacted(f.database.row)
  assert.equal(JSON.parse(f.database.row.encrypted_tokens).alg,'A256GCM')
  const restarted=fixture({database:f.database})
  const status=await restarted.service.status()
  assert.equal(status.connected,true)
  assert.equal(status.available,true)
  redacted(status)
})

test('wrong or expired OAuth state and provider denial cannot exchange credentials',async()=>{
  for(const scenario of ['wrong','expired','denied']) {
    const f=fixture(),req=f.req()
    const started=await f.service.startAuthorization(req)
    req.query={state:new URL(started.authorization_url).searchParams.get('state'),code:'private-code'}
    if(scenario==='wrong')req.query.state='attacker-state'
    if(scenario==='expired')f.advance(10*60000)
    if(scenario==='denied')req.query.error='access_denied'
    await assert.rejects(f.service.completeAuthorization(req),expectCode(scenario==='denied'?'SHIPPING_AUTH_DENIED':'SHIPPING_OAUTH_STATE_INVALID'))
    assert.equal(f.calls.length,0)
    assert.equal(f.database.row.encrypted_tokens,null)
    assert.equal(req.session.melhorEnvioOAuth,undefined)
  }
})

test('OAuth state is consumed atomically once across concurrent callback instances',async()=>{
  const f=fixture(),req=f.req()
  const started=await f.service.startAuthorization(req)
  req.query={state:new URL(started.authorization_url).searchParams.get('state'),code:'private-code'}
  const duplicate={query:{...req.query},session:{melhorEnvioOAuth:clone(req.session.melhorEnvioOAuth)}}
  const settled=await Promise.allSettled([f.service.completeAuthorization(req),f.service.completeAuthorization(duplicate)])
  assert.equal(settled.filter(result=>result.status==='fulfilled').length,1)
  assert.equal(settled.find(result=>result.status==='rejected').reason.code,'SHIPPING_OAUTH_STATE_INVALID')
  assert.equal(f.calls.length,1)
  await assert.rejects(f.service.completeAuthorization(req),expectCode('SHIPPING_OAUTH_STATE_INVALID'))
})

test('quotation uses actual packaged metrics, per-size quantity and customized price/delivery',async()=>{
  const f=fixture();await authorize(f)
  const p=product();p.variants=[{id:21,size:'M',active:1,stock:3}]
  const result=await quote(f,p,[{product_id:11,variant_id:21,quantity:2}])
  assert.equal(result.quotes.length,2)
  assert.equal(result.quotes[0].price,21.35)
  assert.equal(result.quotes[0].delivery_days,6)
  assert.equal(Date.parse(result.expires_at)-startTime,15*60000)
  const request=f.calls.at(-1)
  assert.equal(request.url,'https://melhorenvio.com.br/api/v2/me/shipment/calculate')
  assert.equal(request.options.headers.Authorization,'Bearer private-access-token')
  assert.equal(request.options.headers['User-Agent'],'GALEO (storegaleo@gmail.com)')
  assert.deepEqual(request.body,{from:{postal_code:'08285130'},to:{postal_code:'01001000'},products:[{id:'11-V21',width:18,height:3,length:25,weight:0.3,insurance_value:100,quantity:2}],options:{receipt:false,own_hand:false}})
  const verified=f.service.validateQuote({token:result.quotes[0].token,items:[{product_id:11,variant_id:21,quantity:2}],postal_code,products:[p]})
  assert.equal(verified.price,21.35)
  assert.equal(verified.details.name,'PAC')
  assert.equal(verified.details.company,'Correios')
  redacted(verified)
})

test('signed quote rejects tampering, expiry, changed CEP/size/quantity/price/package and cross-environment reuse',async()=>{
  const f=fixture();await authorize(f)
  const p=product();p.variants=[{id:21,size:'M',active:1,stock:3},{id:22,size:'G',active:1,stock:2}]
  const selected=[{product_id:11,variant_id:21,quantity:1}]
  const result=await quote(f,p,selected),token=result.quotes[0].token
  const validate=overrides=>f.service.validateQuote({token,items:selected,postal_code,products:[p],...overrides})
  assert.equal(validate({}).price,21.35)
  const [body,signature]=token.split('.')
  const tampered=JSON.parse(Buffer.from(body,'base64url').toString());tampered.quote.price=0
  assert.throws(()=>validate({token:Buffer.from(JSON.stringify(tampered)).toString('base64url')+'.'+signature}),expectCode('SHIPPING_QUOTE_INVALID'))
  assert.throws(()=>validate({postal_code:'01310100'}),expectCode('SHIPPING_QUOTE_EXPIRED'))
  assert.throws(()=>validate({items:[{...selected[0],quantity:2}]}),expectCode('SHIPPING_QUOTE_EXPIRED'))
  assert.throws(()=>validate({items:[{...selected[0],variant_id:22}]}),expectCode('SHIPPING_QUOTE_EXPIRED'))
  assert.throws(()=>validate({products:[{...p,price:99.99}]}),expectCode('SHIPPING_QUOTE_EXPIRED'))
  assert.throws(()=>validate({products:[{...p,shipping_weight:0.4}]}),expectCode('SHIPPING_QUOTE_EXPIRED'))
  const sandbox=fixture({configuration:{...env,MELHOR_ENVIO_ENVIRONMENT:'sandbox'}})
  assert.throws(()=>sandbox.service.validateQuote({token,items:selected,postal_code,products:[p]}),expectCode('SHIPPING_QUOTE_EXPIRED'))
  f.advance(15*60000)
  assert.throws(()=>validate({}),expectCode('SHIPPING_QUOTE_EXPIRED'))
  assert.throws(()=>validate({token:undefined}),expectCode('SHIPPING_QUOTE_REQUIRED'))
})

test('invalid CEP and missing measures never call provider or invent packaging',async()=>{
  const f=fixture();await authorize(f)
  const before=f.calls.length
  for(const field of ['shipping_weight','shipping_width','shipping_height','shipping_length']) {
    await assert.rejects(quote(f,{...product(),[field]:null}),expectCode('SHIPPING_MEASUREMENTS_REQUIRED'))
  }
  await assert.rejects(f.service.calculateQuotes({items,products:[product()],postal_code:'invalid'}),expectCode('SHIPPING_INVALID'))
  await assert.rejects(quote(f,{...product(),stock:0}),expectCode('SHIPPING_CART_CHANGED'))
  await assert.rejects(quote(f,{...product(),price:0}),expectCode('SHIPPING_CART_CHANGED'))
  await assert.rejects(quote(f,{...product(),variants:[{id:21,size:'M',active:1,stock:2}]}),expectCode('SHIPPING_CART_CHANGED'))
  await assert.rejects(quote(f,product(),[{product_id:11,variant_id:999,quantity:1}]),expectCode('SHIPPING_CART_CHANGED'))
  await assert.rejects(quote(f,product(),[{product_id:true,quantity:1}]),expectCode('SHIPPING_CART_CHANGED'))
  await assert.rejects(quote(f,product(),[{product_id:11,quantity:true}]),expectCode('SHIPPING_CART_CHANGED'))
  assert.equal(f.calls.length,before)
})

test('parallel function instances rotate an expired refresh token only once under a row lock',async()=>{
  let refreshes=0
  const f=fixture({provider:async call=>{
    if(call.body.grant_type==='refresh_token') {
      refreshes++
      await new Promise(resolve=>setTimeout(resolve,20))
      return response(tokenResponse('-rotated'))
    }
    return response(call.url.endsWith('/oauth/token')?tokenResponse(''):services())
  }})
  await authorize(f)
  f.database.row.expires_at=startTime-1
  const other=fixture({database:f.database,provider:async call=>{
    if(call.body.grant_type==='refresh_token'){refreshes++;return response(tokenResponse('-wrong-double-rotation'))}
    return response(services())
  }})
  const results=await Promise.all([quote(f),quote(other)])
  assert.equal(results.length,2)
  assert.equal(refreshes,1)
  assert.equal(other.calls[0].options.headers.Authorization,'Bearer private-access-token-rotated')
  redacted(f.database.row)
})

test('permanently invalid refresh token clears authorization and reports reconnect',async()=>{
  const f=fixture({provider:async call=>call.body.grant_type==='refresh_token'?response({error:'invalid_grant',secret:'private-refresh-token'},400):response(tokenResponse(''))})
  await authorize(f)
  f.database.row.expires_at=startTime-1
  await assert.rejects(quote(f),expectCode('SHIPPING_RECONNECT_REQUIRED'))
  assert.equal((await f.service.status()).connected,false)
  assert.equal(f.database.row.encrypted_tokens,null)
})

test('provider 401 refreshes once without exposing token and retries only calculation',async()=>{
  let calculations=0
  const f=fixture({provider:async call=>{
    if(call.url.endsWith('/oauth/token'))return response(tokenResponse(call.body.grant_type==='refresh_token'?'-new':''))
    calculations++
    return calculations===1?response({error:'private-access-token'},401):response(services())
  }})
  await authorize(f)
  assert.equal((await quote(f)).quotes.length,2)
  assert.equal(calculations,2)
  assert.equal(f.calls.filter(call=>call.body.grant_type==='refresh_token').length,1)
  assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer private-access-token-new')
})

test('network/provider failures and corrupted envelopes surface only safe errors',async()=>{
  const f=fixture();await authorize(f)
  const broken=fixture({database:f.database,provider:async()=>{throw new Error('private-app-secret private-access-token private-code')}})
  await assert.rejects(quote(broken),error=>{redacted(error);redacted(error.stack);return expectCode('SHIPPING_PROVIDER_UNAVAILABLE')(error)})
  const rejected=fixture({database:f.database,provider:async()=>response({message:'private-app-secret private-refresh-token'},422)})
  await assert.rejects(quote(rejected),error=>{redacted(error);redacted(error.stack);return expectCode('SHIPPING_PROVIDER_UNAVAILABLE')(error)})
  f.database.row.encrypted_tokens='{"v":1,"alg":"A256GCM","data":"tampered"}'
  const status=await f.service.status()
  assert.equal(status.connected,false)
  assert.equal(status.available,false)
  assert.ok(status.connection_error)
  redacted(status)
})

test('sandbox configuration uses separate app identity and official sandbox endpoints',async()=>{
  const f=fixture();await authorize(f)
  const sandbox=fixture({database:f.database,configuration:{...env,MELHOR_ENVIO_ENVIRONMENT:'sandbox'}})
  assert.equal((await sandbox.service.status()).connected,false)
  const authorization=await sandbox.service.startAuthorization(sandbox.req())
  assert.equal(new URL(authorization.authorization_url).origin,'https://sandbox.melhorenvio.com.br')
  const invalid=fixture({configuration:{...env,MELHOR_ENVIO_ENVIRONMENT:'attacker.example'}})
  assert.equal((await invalid.service.status()).configuration_complete,false)
  await assert.rejects(quote(invalid),expectCode('SHIPPING_NOT_CONFIGURED'))
})

test('schema is additive and never populates invented measures or changes business records',async()=>{
  const queries=[],columns=[]
  await ensureMelhorEnvioSchema({query:async sql=>queries.push(sql),ensureColumn:async(...args)=>columns.push(args)})
  assert.equal(queries.length,1)
  assert.match(queries[0],/^CREATE TABLE IF NOT EXISTS shipping_integrations/)
  assert.deepEqual(columns.map(([table,column])=>[table,column]),[['products','shipping_weight'],['products','shipping_width'],['products','shipping_height'],['products','shipping_length'],['store_orders','shipping_details']])
  assert.ok(columns.every(([, ,definition])=>definition.endsWith(' NULL')))
})


test('malformed provider prices/delivery are filtered, preserving legitimate customized zero price',async()=>{
  const f=fixture({provider:async call=>response(call.url.endsWith('/oauth/token')?tokenResponse(''):[
    ...[null,'',true,[],{}].map((value,index)=>({id:index+100,name:'Inválido',custom_price:value,custom_delivery_time:3,company:{name:'Local'}})),
    ...[null,'',true,[],{}].map((value,index)=>({id:index+200,name:'Inválido',custom_price:5,custom_delivery_time:value,company:{name:'Local'}})),
    {id:true,name:'Inválido',custom_price:5,custom_delivery_time:3,company:{name:'Local'}},
    {id:42,name:'Frete ajustado',custom_price:'0.00',custom_delivery_time:2,company:{name:'Local'}}
  ])})
  await authorize(f)
  const result=await quote(f)
  assert.equal(result.quotes.length,1)
  assert.equal(result.quotes[0].id,'42')
  assert.equal(result.quotes[0].price,0)
})
