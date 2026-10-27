import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'

// HomeWorkflowRuntime creates and removes only a random loopback fixture DB.
// OAuth and freight responses below are in-process fixtures; no real provider
// request, customer email, label purchase or production database is permitted.
const runtime = new HomeWorkflowRuntime()
const endpoint = 'http://127.0.0.1:10137'
const shipping = { name:'Cliente local de entregas', phone:'11999999999', postal_code:'01001-000', street:'Rua de teste', number:'1', neighborhood:'Centro', city:'São Paulo', state:'SP' }
const measurements = { shipping_weight:0.321, shipping_width:21.25, shipping_height:4.5, shipping_length:32.75 }
const calls = [], refused = []
const originalFetch = globalThis.fetch
const originalEnvironment = { ...process.env }
const accessToken = 'local-access-' + randomBytes(12).toString('hex')
const refreshToken = 'local-refresh-' + randomBytes(12).toString('hex')
let api, server, owner, customer, sequence=0

function client() {
  return { cookie:'', csrfToken:'', async request(path, { method='GET', body, csrf=true }={}) {
    const response = await fetch(endpoint+path, { method, redirect:'manual', headers:{
      ...(this.cookie ? { Cookie:this.cookie } : {}),
      ...(csrf && this.csrfToken ? { 'X-CSRF-Token':this.csrfToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type':'application/json' })
    }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) })
    for (const value of response.headers.getSetCookie()) if (value.startsWith('galeo_sid=')) this.cookie=value.split(';',1)[0]
    const text=await response.text()
    const data=response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null
    if(data?.csrfToken)this.csrfToken=data.csrfToken
    return { status:response.status, data, location:response.headers.get('location') }
  } }
}

before(async()=>{
  // A test process must never inherit provider credentials from its caller.
  for(const key of Object.keys(process.env)) if(/^(MELHOR_ENVIO_|MERCADO_PAGO_|RESEND_|CLOUDINARY_|DISTRIBUTOR_)/.test(key)) delete process.env[key]
  await runtime.initialize({ port:10138 })
  Object.assign(process.env, {
    GALEO_SERVERLESS:'true', NODE_ENV:'test', DB_HOST:'127.0.0.1', DB_PORT:'3307', DB_NAME:runtime.database, DB_SSL:'false',
    DATA_ENCRYPTION_ENABLED:'false', DATA_ENCRYPTION_KEY:'', ADMIN_EMAIL:'', ADMIN_PASSWORD:'', EMAIL_FROM:'', STORE_NOTIFICATION_EMAIL:'',
    APP_URL:endpoint, ALLOWED_ORIGINS:endpoint,
    MELHOR_ENVIO_CLIENT_ID:'local-client', MELHOR_ENVIO_CLIENT_SECRET:'local-client-secret',
    MELHOR_ENVIO_REDIRECT_URI:endpoint+'/api/integrations/melhor-envio/callback',
    MELHOR_ENVIO_ORIGIN_POSTAL_CODE:'08285130', MELHOR_ENVIO_ENVIRONMENT:'production'
  })
  globalThis.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL ? input : input.url)
    if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return originalFetch(input,options)
    if(url.origin!=='https://melhorenvio.com.br') { refused.push(url.origin); throw new Error('External provider refused in local fixture.') }
    const body=JSON.parse(options?.body||'{}')
    calls.push({ path:url.pathname,method:options.method,body,headers:options.headers })
    if(url.pathname==='/oauth/token')return Response.json({ access_token:accessToken, refresh_token:refreshToken, expires_in:2592000, token_type:'Bearer' })
    if(url.pathname==='/api/v2/me/shipment/calculate')return Response.json([
      { id:1,name:'PAC local',price:'25.40',custom_price:'18.75',delivery_time:8,custom_delivery_time:5,company:{name:'Correios local'} },
      { id:2,name:'SEDEX local',price:'31.90',delivery_time:2,company:{name:'Correios local'} },
      { id:3,name:'Indisponível',error:'Sem cobertura',company:{name:'Outra'} }
    ])
    refused.push(url.pathname)
    throw new Error('Unapproved Melhor Envio endpoint refused in local fixture.')
  }
  api=await import('../server/index.js')
  await api.initializeRuntime()
  server=await new Promise(resolve=>{const handle=api.app.listen(10137,'127.0.0.1',()=>resolve(handle))})
  owner=client()
  const login=await owner.request('/api/auth/login',{method:'POST',body:{email:runtime.email,password:runtime.password}})
  assert.equal(login.status,200,login.data?.error)
  const [account]=await runtime.query('SELECT password_hash FROM admin_users WHERE id=?',[runtime.ownerId])
  const email='shipping-'+runtime.suffix+'@example.invalid'
  await runtime.query('INSERT INTO customers(name,email,password_hash,phone,email_verified_at) VALUES(?,?,?,?,NOW())',[shipping.name,email,account.password_hash,shipping.phone])
  customer=client()
  assert.equal((await customer.request('/api/customer/login',{method:'POST',body:{email,password:runtime.password}})).status,200)
})

after(async()=>{
  try {
    assert.deepEqual(refused,[])
    if(runtime.db)assert.deepEqual(await runtime.providerAttempts(),[])
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve))
    await api?.drainBackgroundTasks()
    await api?.closeRuntime()
    globalThis.fetch=originalFetch
    await runtime.close()
    for(const key of Object.keys(process.env))if(!(key in originalEnvironment))delete process.env[key]
    Object.assign(process.env,originalEnvironment)
  }
})

async function product(extra={}) {
  const response=await owner.request('/api/admin/products',{method:'POST',body:{name:'Peça de frete local '+(++sequence),description:'Fixture de frete',price:59.9,cost:20,min_stock:0,stock:0,active:true,variants:[{size:'M',stock:5},{size:'G',stock:3}],...measurements,...extra}})
  assert.equal(response.status,201,response.data?.error)
  return response.data
}
const item=(p,size='M',quantity=1)=>({product_id:p.id,variant_id:p.variants.find(v=>v.size===size).id,quantity})
async function quote(items,postal_code=shipping.postal_code) {
  const response=await client().request('/api/store/shipping/quotes',{method:'POST',body:{items,postal_code}})
  assert.equal(response.status,200,response.data?.error)
  return response.data.quotes[0]
}
async function snapshot(productId) {
  return { products:await runtime.query('SELECT * FROM products WHERE id=?',[productId]), variants:await runtime.query('SELECT * FROM product_variants WHERE product_id=? ORDER BY id',[productId]), orders:await runtime.query('SELECT * FROM store_orders ORDER BY id'), items:await runtime.query('SELECT * FROM store_order_items ORDER BY id'), movements:await runtime.query('SELECT * FROM stock_movements WHERE product_id=? ORDER BY id',[productId]) }
}

test('shipping management requires owner authentication and CSRF; anonymous quotes remain read-only',async()=>{
  assert.equal((await client().request('/api/admin/shipping')).status,401)
  assert.equal((await customer.request('/api/admin/shipping')).status,401)
  assert.equal((await owner.request('/api/admin/shipping/connect',{method:'POST',csrf:false,body:{}})).status,403)
  assert.equal(calls.length,0)
  const config=await client().request('/api/store/shipping/config')
  assert.deepEqual(config.data,{configured:true,connected:false,available:false})
})

test('invalid OAuth state and replay do not exchange or overwrite tokens; valid state encrypts tokens in MySQL',async()=>{
  const first=await owner.request('/api/admin/shipping/connect',{method:'POST',body:{}})
  assert.equal(first.status,200)
  const initial=new URL(first.data.authorization_url)
  assert.equal(initial.origin,'https://melhorenvio.com.br')
  assert.equal(initial.searchParams.get('scope'),'shipping-calculate')
  const wrong=await owner.request('/api/integrations/melhor-envio/callback?code=local-code&state=wrong')
  assert.equal(wrong.status,303)
  assert.equal(wrong.location,'/admin?tab=shipping&shipping=error')
  assert.equal(calls.length,0)
  const start=await owner.request('/api/admin/shipping/connect',{method:'POST',body:{}})
  const state=new URL(start.data.authorization_url).searchParams.get('state')
  const callback='/api/integrations/melhor-envio/callback?code=local-code&state='+encodeURIComponent(state)
  const connected=await owner.request(callback)
  assert.equal(connected.status,303)
  assert.equal(connected.location,'/admin?tab=shipping&shipping=connected')
  assert.equal(calls.filter(c=>c.path==='/oauth/token').length,1)
  const rows=await runtime.query('SELECT * FROM shipping_integrations')
  assert.equal(rows.length,1)
  const stored=JSON.stringify(rows[0])
  assert.ok(!stored.includes(accessToken)&&!stored.includes(refreshToken)&&!stored.includes('local-client-secret'))
  const envelope=typeof rows[0].encrypted_tokens==='string' ? JSON.parse(rows[0].encrypted_tokens) : rows[0].encrypted_tokens
  assert.equal(envelope.alg,'A256GCM')
  assert.equal(rows[0].state_hash,null)
  const replay=await owner.request(callback)
  assert.equal(replay.location,'/admin?tab=shipping&shipping=error')
  assert.equal(calls.filter(c=>c.path==='/oauth/token').length,1)
  assert.deepEqual((await client().request('/api/store/shipping/config')).data,{configured:true,connected:true,available:true})
})

test('product measurements persist with real precision, preserve old clients and reject partial or zero-rounding values',async()=>{
  const p=await product()
  for(const [key,value]of Object.entries(measurements))assert.equal(Number(p[key]),value)
  const legacyUpdate={...p,name:p.name+' editada'}
  for(const key of Object.keys(measurements))delete legacyUpdate[key]
  const updated=await owner.request('/api/admin/products/'+p.id,{method:'PUT',body:legacyUpdate})
  assert.equal(updated.status,200,updated.data?.error)
  for(const [key,value]of Object.entries(measurements))assert.equal(Number(updated.data[key]),value)
  const invalidMeasurements = [
    {shipping_weight:0.2,shipping_width:null,shipping_height:null,shipping_length:null},
    {...measurements,shipping_weight:0.0001},
    {...measurements,shipping_width:0.001},
    {...measurements,shipping_weight:1e-12},
    {...measurements,shipping_height:'0.000000000001'},
    {...measurements,shipping_weight:true},
    {...measurements,shipping_weight:false},
    {...measurements,shipping_length:true},
    {...measurements,shipping_height:false}
  ]
  for(const invalid of invalidMeasurements) {
    const before=await snapshot(p.id)
    const result=await owner.request('/api/admin/products/'+p.id,{method:'PUT',body:{...updated.data,...invalid}})
    assert.equal(result.status,400,result.data?.error)
    assert.deepEqual(await snapshot(p.id),before)
  }
  const cleared=await owner.request('/api/admin/products/'+p.id,{method:'PUT',body:{...updated.data,...Object.fromEntries(Object.keys(measurements).map(key=>[key,null]))}})
  assert.equal(cleared.status,200,cleared.data?.error)
  for(const key of Object.keys(measurements))assert.equal(cleared.data[key],null)
  const count=(await runtime.query('SELECT COUNT(*) total FROM products'))[0].total
  const partial=await owner.request('/api/admin/products',{method:'POST',body:{name:'Parcial local',price:10,shipping_weight:0.2}})
  assert.equal(partial.status,400,partial.data?.error)
  assert.equal((await runtime.query('SELECT COUNT(*) total FROM products'))[0].total,count)
  const allProducts=async()=>({ products:await runtime.query('SELECT * FROM products ORDER BY id'),variants:await runtime.query('SELECT * FROM product_variants ORDER BY id'),movements:await runtime.query('SELECT * FROM stock_movements ORDER BY id') })
  const beforeRejectedCreates=await allProducts()
  for(const invalid of invalidMeasurements) {
    const result=await owner.request('/api/admin/products',{method:'POST',body:{name:'Medidas inválidas locais',price:10,stock:4,...invalid}})
    assert.equal(result.status,400,result.data?.error)
    assert.deepEqual(await allProducts(),beforeRejectedCreates)
  }
})

test('anonymous quotation uses persisted dimensions, quantities and sizes and custom carrier price/time',async()=>{
  const p=await product(), items=[item(p,'M',2),item(p,'G')]
  const before=await snapshot(p.id)
  const selected=await quote(items)
  assert.equal(selected.name,'PAC local')
  assert.equal(selected.price,18.75)
  assert.equal(selected.delivery_days,5)
  assert.equal(typeof selected.token,'string')
  const request=calls.filter(c=>c.path.endsWith('/calculate')).at(-1)
  assert.deepEqual(request.body.from,{postal_code:'08285130'})
  assert.deepEqual(request.body.to,{postal_code:'01001000'})
  assert.deepEqual(request.body.products,items.map(line=>({id:p.id+'-V'+line.variant_id,width:21.25,height:4.5,length:32.75,weight:0.321,insurance_value:59.9,quantity:line.quantity})))
  assert.equal(request.headers.Authorization,'Bearer '+accessToken)
  assert.match(request.headers['User-Agent'],/^GALEO /)
  assert.deepEqual(await snapshot(p.id),before)
})

test('missing product measurements and foreign size reject quotation before touching the provider',async()=>{
  const p=await product({shipping_weight:null,shipping_width:null,shipping_height:null,shipping_length:null})
  const other=await product()
  const count=calls.length
  const missing=await client().request('/api/store/shipping/quotes',{method:'POST',body:{postal_code:shipping.postal_code,items:[item(p)]}})
  assert.equal(missing.status,409)
  assert.equal(missing.data.code,'SHIPPING_MEASUREMENTS_REQUIRED')
  const invalid=await client().request('/api/store/shipping/quotes',{method:'POST',body:{postal_code:shipping.postal_code,items:[{product_id:other.id,variant_id:p.variants[0].id,quantity:1}]}})
  assert.equal(invalid.status,409,invalid.data?.error)
  assert.equal(calls.length,count)
})

test('orders reject missing, tampered, changed CEP and changed quantity quotes atomically',async()=>{
  const p=await product(),items=[item(p)]
  const selected=await quote(items)
  const before=await snapshot(p.id)
  for(const body of [
    {items,shipping},
    {items,shipping,shipping_quote:selected.token+'.tampered'},
    {items,shipping:{...shipping,postal_code:'02002000'},shipping_quote:selected.token},
    {items:[item(p,'M',2)],shipping,shipping_quote:selected.token}
  ]) {
    const response=await customer.request('/api/store/orders',{method:'POST',body})
    assert.ok([400,409].includes(response.status),response.data?.error)
    assert.deepEqual(await snapshot(p.id),before)
  }
})

test('a changed catalog price invalidates a previously valid signed quote before stock or order changes',async()=>{
  const p=await product(),items=[item(p)]
  const selected=await quote(items)
  await runtime.query('UPDATE products SET price=65 WHERE id=?',[p.id])
  const before=await snapshot(p.id)
  const result=await customer.request('/api/store/orders',{method:'POST',body:{items,shipping,shipping_quote:selected.token}})
  assert.equal(result.status,409,result.data?.error)
  assert.deepEqual(await snapshot(p.id),before)
})

test('valid quote persists shipping price/service, reserves exact sizes, and cancellation restores them once',async()=>{
  const p=await product(),items=[item(p,'M',2),item(p,'G')]
  const selected=await quote(items)
  const response=await customer.request('/api/store/orders',{method:'POST',body:{items,shipping,shipping_quote:selected.token,shipping_fee:0,total:0}})
  assert.equal(response.status,200,response.data?.error)
  const order=response.data.order
  assert.equal(order.shipping_fee,18.75)
  assert.equal(order.total,198.45)
  const [stored]=await runtime.query('SELECT * FROM store_orders WHERE id=?',[order.id])
  assert.equal(Number(stored.shipping_fee),18.75)
  assert.equal(Number(stored.total),198.45)
  const details=typeof stored.shipping_details==='string'?JSON.parse(stored.shipping_details):stored.shipping_details
  assert.equal(details.provider,'MELHOR_ENVIO')
  assert.equal(details.company,'Correios local')
  assert.equal(details.service_name,'PAC local')
  assert.equal(details.delivery_days,5)
  assert.equal(details.price,18.75)
  const detail=await owner.request('/api/admin/store-orders/'+order.id)
  assert.equal(detail.status,200)
  assert.ok(detail.data.shipping_details)
  const sizes=async()=>Object.fromEntries((await runtime.query('SELECT size,stock FROM product_variants WHERE product_id=? ORDER BY size',[p.id])).map(row=>[row.size,Number(row.stock)]))
  assert.deepEqual(await sizes(),{G:2,M:3})
  assert.equal((await owner.request('/api/admin/store-orders/'+order.id+'/status',{method:'PATCH',body:{status:'CANCELLED'}})).status,200)
  assert.deepEqual(await sizes(),{G:3,M:5})
  assert.equal((await owner.request('/api/admin/store-orders/'+order.id+'/status',{method:'PATCH',body:{status:'CANCELLED'}})).status,200)
  assert.deepEqual(await sizes(),{G:3,M:5})
})

test('explicit migration remains repeatable and preserves owners, home, products, orders and encrypted connection',async()=>{
  const state=async()=>Object.fromEntries(await Promise.all(['admin_users','home_sections','home_settings','products','product_variants','store_orders','store_order_items','stock_movements','shipping_integrations'].map(async table=>[table,await runtime.query('SELECT * FROM `'+table+'` ORDER BY '+(table==='home_settings'?'setting_key':table==='shipping_integrations'?'provider':'id'))])))
  const before=await state()
  await api.migrateSchema()
  await api.initializeRuntime()
  await api.migrateSchema()
  await api.initializeRuntime()
  assert.deepEqual(await state(),before)
})
