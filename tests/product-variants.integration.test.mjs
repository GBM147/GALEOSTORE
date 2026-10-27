import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { HomeWorkflowRuntime } from './helpers/home-workflow-runtime.mjs'
import { ensureProductVariantSchema } from '../server/product-variants.js'

// The fixture refuses production and creates/drops only its own random local DB.
const runtime = new HomeWorkflowRuntime()
const shipping={name:'Cliente local de tamanhos',phone:'11999999999',postal_code:'01001000',street:'Rua local',number:'1',neighborhood:'Centro',city:'São Paulo',state:'SP'}
let customer, sequence=0, serverlessApi, originalFetch, environmentBefore

function client() {
  return { cookie:'', csrfToken:'', async request(path,{method='GET',body}={}) {
    const response=await fetch(runtime.baseUrl+path,{method,headers:{...(this.cookie?{Cookie:this.cookie}:{}),...(this.csrfToken?{'X-CSRF-Token':this.csrfToken}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    for(const value of response.headers.getSetCookie()) if(value.startsWith('galeo_sid=')) this.cookie=value.split(';',1)[0]
    const data=await response.json()
    if(data.csrfToken)this.csrfToken=data.csrfToken
    return {status:response.status,data}
  }}
}

before(async()=>{
  await runtime.initialize({port:10135})
  const [owner]=await runtime.query('SELECT password_hash FROM admin_users WHERE id=?',[runtime.ownerId])
  const email='sizes-'+runtime.suffix+'@example.invalid'
  await runtime.query('INSERT INTO customers(name,email,password_hash,phone,email_verified_at) VALUES(?,?,?,?,NOW())',[shipping.name,email,owner.password_hash,shipping.phone])
  customer=client()
  assert.equal((await customer.request('/api/customer/login',{method:'POST',body:{email,password:runtime.password}})).status,200)
})
after(async()=>{
  if(originalFetch)globalThis.fetch=originalFetch
  await serverlessApi?.closeRuntime()
  if(environmentBefore)for(const[key,value]of Object.entries(environmentBefore)) value===undefined?delete process.env[key]:process.env[key]=value
  try{if(runtime.db)assert.deepEqual(await runtime.providerAttempts(),[])}finally{await runtime.close()}
})

async function product(variants=[{size:'M',stock:3},{size:'G',stock:4}],extra={}) {
  const body={name:'Peça local '+runtime.suffix+'-'+(++sequence),brand:'Marca local',description:'Fixture de estoque por tamanho',price:59.9,cost:20,stock:0,min_stock:0,image:'',video:'',active:true,...(variants===null?{}:{variants}),...extra}
  const result=await runtime.request('/api/admin/products',{method:'POST',body})
  assert.equal(result.status,201,result.data.error)
  return result.data
}
const variant=(product,size)=>product.variants.find(row=>row.size===size)
const item=(product,size,quantity=1)=>({product_id:product.id,...(size?{variant_id:variant(product,size).id}:{}),quantity})
const order=items=>customer.request('/api/store/orders',{method:'POST',body:{items,shipping}})
const sale=(items,extra={})=>runtime.request('/api/admin/sales',{method:'POST',body:{items,payment_method:'PIX',...extra}})
const cancelOrder=id=>runtime.request('/api/admin/store-orders/'+id+'/status',{method:'PATCH',body:{status:'CANCELLED'}})
const cancelSale=id=>runtime.request('/api/admin/sales/'+id+'/cancel',{method:'PATCH',body:{}})
async function current(productId){const response=await runtime.request('/api/admin/products');assert.equal(response.status,200);return response.data.find(row=>row.id===productId)}
async function stock(product,expected){
  const row=await current(product.id)
  assert.equal(Number(row.stock),Object.values(expected).reduce((sum,n)=>sum+n,0))
  assert.deepEqual(Object.fromEntries(row.variants.map(v=>[v.size,v.stock])),expected)
  return row
}
async function snapshot(productId){
  return {products:await runtime.query('SELECT * FROM products WHERE id=?',[productId]),variants:await runtime.query('SELECT * FROM product_variants WHERE product_id=? ORDER BY id',[productId]),movements:await runtime.query('SELECT * FROM stock_movements WHERE product_id=? ORDER BY id',[productId]),orders:await runtime.query('SELECT id FROM store_orders ORDER BY id'),sales:await runtime.query('SELECT id FROM sales ORDER BY id')}
}

test('legacy products keep a single stock balance and existing sale/cancellation behavior',async()=>{
  const p=await product(null,{stock:3})
  assert.equal(p.has_variants,false);assert.deepEqual(p.variants,[])
  const moved=await runtime.request('/api/admin/stock',{method:'POST',body:{product_id:p.id,type:'ENTRADA',quantity:1,reason:'Entrada local'}})
  assert.equal(moved.status,200);assert.equal(moved.data.after,4)
  const sold=await sale([item(p,null,2)])
  assert.equal(sold.status,201,sold.data.error)
  assert.equal(Number((await current(p.id)).stock),2)
  assert.equal((await cancelSale(sold.data.id)).status,200)
  assert.equal(Number((await current(p.id)).stock),4)
})

test('grade creation derives the total, returns stable IDs and publishes sizes in list and details',async()=>{
  const p=await product([{size:'m',stock:2},{size:'G',stock:3}],{stock:999})
  assert.equal(p.stock,5);assert.equal(p.has_variants,true);assert.deepEqual(p.sizes,['M','G'])
  assert.ok(p.variants.every(row=>Number.isSafeInteger(row.id)&&row.product_id===p.id))
  const catalog=await runtime.request('/api/store',{auth:false})
  const publicProduct=catalog.data.products.find(row=>row.id===p.id)
  assert.deepEqual(publicProduct.variants,p.variants)
  const detail=await runtime.request('/api/store/products/'+p.id,{auth:false})
  assert.equal(detail.status,200);assert.deepEqual(detail.data.product.variants,p.variants)
  const movements=await runtime.query('SELECT variant_id,size_label,quantity,stock_before,stock_after FROM stock_movements WHERE product_id=? ORDER BY id',[p.id])
  assert.deepEqual(movements.map(row=>[row.size_label,row.quantity,row.stock_before,row.stock_after]),[['M',2,0,2],['G',3,0,3]])
  assert.ok(movements.every(row=>row.variant_id))
})

test('converting existing stock reallocates the legacy balance instead of duplicating inventory movements',async()=>{
  for(const variants of [[{size:'M',stock:5},{size:'G',stock:15}],[{size:'M',stock:2}]]){
    const p=await product(null,{stock:20})
    const [initial]=await runtime.query('SELECT MAX(id) id FROM stock_movements WHERE product_id=?',[p.id])
    const changed=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:{...p,variants}})
    assert.equal(changed.status,200,changed.data.error)
    const total=variants.reduce((sum,row)=>sum+row.stock,0)
    assert.equal(Number(changed.data.stock),total)
    const rows=await runtime.query('SELECT variant_id,size_label,type,quantity,stock_before,stock_after,reason FROM stock_movements WHERE product_id=? AND id>? ORDER BY id',[p.id,initial.id])
    assert.deepEqual(rows.map(row=>[row.size_label,row.type,row.quantity,row.stock_before,row.stock_after]),[
      ['','AJUSTE',-20,20,0],...variants.map(row=>[row.size,'AJUSTE',row.stock,0,row.stock])
    ])
    assert.match(rows[0].reason,/Distribuição do estoque/)
    assert.equal(rows.reduce((sum,row)=>sum+Number(row.quantity),0),total-20)
  }
})

test('duplicate sizes, invalid quantities and foreign size IDs roll back product creation',async()=>{
  const other=await product()
  for(const variants of [[{size:'M',stock:1},{size:'m',stock:2}],[{size:'M',stock:-1}],[{size:'M',stock:1.5}],[{id:other.variants[0].id,size:'M',stock:1}],[{size:'M',stock:2,active:false}]]){
    const before=await runtime.query('SELECT COUNT(*) total FROM products')
    const response=await runtime.request('/api/admin/products',{method:'POST',body:{name:'Inválido local '+(++sequence),price:10,stock:0,variants}})
    assert.equal(response.status,400,response.data.error)
    assert.deepEqual(await runtime.query('SELECT COUNT(*) total FROM products'),before)
  }
})

test('stock adjustments require a matching size and update that size and the aggregate atomically',async()=>{
  const p=await product(),other=await product()
  const before=await snapshot(p.id)
  for(const variantId of [undefined,other.variants[0].id]){
    const response=await runtime.request('/api/admin/stock',{method:'POST',body:{product_id:p.id,variant_id:variantId,type:'SAIDA',quantity:1}})
    assert.equal(response.status,400);assert.deepEqual(await snapshot(p.id),before)
  }
  const changed=await runtime.request('/api/admin/stock',{method:'POST',body:{product_id:p.id,variant_id:variant(p,'M').id,type:'AJUSTE',quantity:1,reason:'Contagem M'}})
  assert.equal(changed.status,200);assert.equal(changed.data.before,3);assert.equal(changed.data.after,1)
  assert.equal(changed.data.size_label,'M');await stock(p,{M:1,G:4})
})

test('physical sales keep M and G separate, merge only identical size lines and restore each size once',async()=>{
  const p=await product([{size:'M',stock:5},{size:'G',stock:3}])
  const sold=await sale([item(p,'M'),item(p,'M'),item(p,'G',2)],{client_reference:'sizes-sale-'+runtime.suffix})
  assert.equal(sold.status,201,sold.data.error);assert.equal(Number(sold.data.total),239.6)
  await stock(p,{M:3,G:1})
  const details=await runtime.request('/api/admin/sales/'+sold.data.id)
  assert.deepEqual(details.data.items.map(row=>[row.size_label,row.quantity]),[['M',2],['G',2]])
  const retry=await sale([item(p,'M'),item(p,'M'),item(p,'G',2)],{client_reference:'sizes-sale-'+runtime.suffix})
  assert.equal(retry.status,200);assert.equal(retry.data.id,sold.data.id);await stock(p,{M:3,G:1})
  assert.equal((await cancelSale(sold.data.id)).status,200);await stock(p,{M:5,G:3})
  const before=await snapshot(p.id)
  assert.equal((await cancelSale(sold.data.id)).status,400);assert.deepEqual(await snapshot(p.id),before)
})

test('online orders accept M plus G and cancellation restores the exact reserved sizes only once',async()=>{
  const p=await product([{size:'M',stock:5},{size:'G',stock:3}])
  const created=await order([item(p,'M',2),item(p,'G')])
  assert.equal(created.status,200,created.data.error);assert.equal(Number(created.data.order.total),179.7)
  await stock(p,{M:3,G:2})
  const details=await runtime.request('/api/admin/store-orders/'+created.data.order.id)
  assert.deepEqual(details.data.items.map(row=>[row.size_label,row.quantity]),[['M',2],['G',1]])
  const own=await customer.request('/api/customer/orders')
  assert.equal(own.status,200);assert.deepEqual(own.data.orders.find(row=>row.id===created.data.order.id).items.map(row=>row.size_label),['M','G'])
  assert.equal((await cancelOrder(created.data.order.id)).status,200);await stock(p,{M:5,G:3})
  const before=await snapshot(p.id)
  assert.equal((await cancelOrder(created.data.order.id)).status,200);assert.deepEqual(await snapshot(p.id),before)
})

test('missing, foreign and duplicate size selections cannot create an order or consume stock',async()=>{
  const p=await product(),other=await product()
  const before=await snapshot(p.id)
  for(const items of [[item(p,null)],[{product_id:p.id,variant_id:other.variants[0].id,quantity:1}],[item(p,'M'),{...item(p,'M'),variant_id:'00'+variant(p,'M').id}]]){
    const result=await order(items)
    assert.equal(result.status,400);assert.deepEqual(await snapshot(p.id),before)
  }
})

test('concurrent checkout of the final M cannot consume another size or sell M twice',async()=>{
  const p=await product([{size:'M',stock:1},{size:'G',stock:8}])
  const requests=await Promise.all([order([item(p,'M')]),order([item(p,'M')])])
  assert.deepEqual(requests.map(row=>row.status).sort(),[200,400])
  await stock(p,{M:0,G:8})
  const rows=await runtime.query('SELECT quantity,size_label FROM store_order_items WHERE product_id=?',[p.id])
  assert.deepEqual(rows.map(row=>[row.size_label,row.quantity]),[['M',1]])
})

test('grade edits preserve IDs and reject stale stock instead of recreating quantities already sold',async()=>{
  const p=await product()
  const sold=await sale([item(p,'M')]);assert.equal(sold.status,201)
  const before=await snapshot(p.id)
  const stale=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:{...p,name:'Descrição local atualizada',variants:p.variants.map(row=>({...row,stock_before:row.stock}))}})
  assert.equal(stale.status,409);assert.deepEqual(await snapshot(p.id),before)
  // An older client editing a description without a grade cannot overwrite the
  // authoritative aggregate even when its stale product.stock was supplied.
  const legacyPayload={...p,description:'Descrição local preservando saldo'};delete legacyPayload.variants;delete legacyPayload.inventory_token
  const edited=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:legacyPayload})
  assert.equal(edited.status,200,edited.data.error);await stock(p,{M:2,G:4})
  assert.deepEqual(edited.data.variants.map(row=>row.id),p.variants.map(row=>row.id))
})

test('metadata-only saves preserve inventory sold while a legacy or size form was open',async()=>{
  for(const withSizes of [false,true]){
    const p=await product(withSizes?[{size:'M',stock:5}]:null,{stock:5})
    assert.equal(typeof p.inventory_token,'string')
    const reserved=await order([item(p,withSizes?'M':null,2)])
    assert.equal(reserved.status,200,reserved.data.error)
    const body={...p,description:'Descrição atualizada sem editar estoque'}
    delete body.stock;delete body.variants;delete body.inventory_token
    const changed=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body})
    assert.equal(changed.status,200,changed.data.error)
    assert.equal(Number(changed.data.stock),3)
    assert.equal(changed.data.description,body.description)
    if(withSizes)assert.equal(changed.data.variants[0].stock,3)
    assert.notEqual(changed.data.inventory_token,p.inventory_token)
  }
})

test('inventory baseline rejects stale total and size edits without changing reservations or metadata',async()=>{
  for(const withSizes of [false,true]){
    const p=await product(withSizes?[{size:'M',stock:5}]:null,{stock:5})
    const reserved=await order([item(p,withSizes?'M':null,2)])
    assert.equal(reserved.status,200,reserved.data.error)
    const before=await snapshot(p.id)
    const stale={...p,name:'Não pode ser salvo parcialmente',stock:8,
      ...(withSizes?{variants:p.variants.map(row=>({...row,stock:8}))}:{})}
    const response=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:stale})
    assert.equal(response.status,409,response.data.error)
    assert.equal(response.data.code,'INVENTORY_CHANGED')
    assert.deepEqual(await snapshot(p.id),before)
    const fresh=await current(p.id)
    const corrected={...fresh,stock:4,...(withSizes?{variants:fresh.variants.map(row=>({...row,stock:4}))}:{})}
    const saved=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:corrected})
    assert.equal(saved.status,200,saved.data.error)
    assert.equal(Number(saved.data.stock),4)
  }
})

test('inventory baseline also detects a concurrent size layout change with the same total',async()=>{
  const p=await product([{size:'M',stock:5},{size:'G',stock:0}])
  const first=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:{...p,variants:p.variants.map(row=>({...row,size:row.size==='G'?'GG':row.size}))}})
  assert.equal(first.status,200,first.data.error)
  const before=await snapshot(p.id)
  const stale=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:{...p,variants:p.variants.map(row=>({...row,stock:row.size==='M'?6:0}))}})
  assert.equal(stale.status,409);assert.equal(stale.data.code,'INVENTORY_CHANGED')
  assert.deepEqual(await snapshot(p.id),before)
})

test('active operations protect size names and prevent ambiguous conversion of legacy products',async()=>{
  const legacy=await product(null,{stock:3})
  const sold=await sale([item(legacy,null)]);assert.equal(sold.status,201)
  const before=await snapshot(legacy.id)
  const conversion=await runtime.request('/api/admin/products/'+legacy.id,{method:'PUT',body:{...await current(legacy.id),stock:2,variants:[{size:'M',stock:2}]}})
  assert.equal(conversion.status,400);assert.deepEqual(await snapshot(legacy.id),before)
  assert.equal((await cancelSale(sold.data.id)).status,200)
  const converted=await runtime.request('/api/admin/products/'+legacy.id,{method:'PUT',body:{...legacy,stock:3,variants:[{size:'M',stock:3}]}})
  assert.equal(converted.status,200,converted.data.error);await stock(legacy,{M:3})
  const p=await product([{size:'M',stock:1}]);const reserved=await order([item(p,'M')]);assert.equal(reserved.status,200)
  const currentProduct=await current(p.id)
  const rename=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:{...currentProduct,variants:currentProduct.variants.map(row=>({...row,size:'G'}))}})
  assert.equal(rename.status,400);await stock(p,{M:0})
})

test('cancelled size snapshots survive renaming and permanent product deletion',async()=>{
  const p=await product([{size:'M',stock:1}])
  const sold=await sale([item(p,'M')]);assert.equal(sold.status,201)
  assert.equal((await cancelSale(sold.data.id)).status,200)
  let updated=await current(p.id)
  const renamed=await runtime.request('/api/admin/products/'+p.id,{method:'PUT',body:{...updated,variants:updated.variants.map(row=>({...row,size:'GG'}))}})
  assert.equal(renamed.status,200,renamed.data.error)
  const removed=await runtime.request('/api/admin/products/'+p.id,{method:'DELETE'})
  assert.equal(removed.status,200,removed.data.error)
  const detail=await runtime.request('/api/admin/sales/'+sold.data.id)
  assert.equal(detail.status,200);assert.equal(detail.data.items[0].size_label,'M');assert.equal(detail.data.items[0].variant_id,null);assert.equal(detail.data.items[0].product_id,null)
})

test('the explicit size migration is idempotent and does not modify business data',async()=>{
  const p=await product()
  const before=await snapshot(p.id)
  const ensureColumn=async(table,column,definition)=>{
    const rows=await runtime.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column])
    if(!rows.length)await runtime.query('ALTER TABLE `'+table+'` ADD COLUMN `'+column+'` '+definition)
  }
  for(let n=0;n<2;n++)await ensureProductVariantSchema({query:(sql,params)=>runtime.query(sql,params),ensureColumn})
  assert.deepEqual(await snapshot(p.id),before)
})

test('approved online payments preserve size snapshots and repeated refunds restore only the purchased size',async()=>{
  const p=await product([{size:'M',stock:2},{size:'G',stock:5}])
  const created=await order([item(p,'M')]);assert.equal(created.status,200,created.data.error)
  const code=created.data.order.code,orderId=created.data.order.id,providerId='sizes-provider-'+runtime.suffix
  const secret=randomBytes(32).toString('hex'),origin='https://galeo-variants-fixture.netlify.app'
  const overrides={NODE_ENV:'production',GALEO_SERVERLESS:'true',DB_NAME:runtime.database,DB_SSL:'false',APP_URL:origin,ALLOWED_ORIGINS:origin,DATA_ENCRYPTION_ENABLED:'false',DATA_ENCRYPTION_KEY:'',ADMIN_EMAIL:'',ADMIN_PASSWORD:'',CLOUDINARY_URL:'',CLOUDINARY_CLOUD_NAME:'',CLOUDINARY_API_KEY:'',CLOUDINARY_API_SECRET:'',RESEND_API_KEY:'',EMAIL_FROM:'',STORE_NOTIFICATION_EMAIL:'',MERCADO_PAGO_ACCESS_TOKEN:'fixture-only-token',MERCADO_PAGO_WEBHOOK_SECRET:secret}
  environmentBefore=Object.fromEntries(Object.keys(overrides).map(key=>[key,process.env[key]]))
  Object.assign(process.env,overrides)
  let status='approved'
  originalFetch=globalThis.fetch
  globalThis.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
    if(url.hostname==='api.mercadopago.com'){
      assert.equal(url.pathname,'/v1/orders/'+providerId)
      return new Response(JSON.stringify({id:providerId,external_reference:code,status,total_amount:String(created.data.order.total),transactions:{payments:[{status,amount:String(created.data.order.total),payment_method:{type:'pix'}}]}}),{status:200,headers:{'Content-Type':'application/json'}})
    }
    assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'external providers must be mocked in local size tests')
    return originalFetch(input,options)
  }
  serverlessApi=await import('../server/index.js')
  const handler=(await import('../netlify/functions/api.mjs')).default
  async function notify(event){
    const timestamp=String(Math.floor(Date.now()/1000)),requestId='sizes-request-'+event
    const signature=createHmac('sha256',secret).update('id:'+providerId+';request-id:'+requestId+';ts:'+timestamp+';').digest('hex')
    const response=await handler(new Request(origin+'/api/integrations/mercado-pago/webhook?data.id='+providerId,{method:'POST',headers:{'Content-Type':'application/json','X-Request-Id':requestId,'X-Signature':'ts='+timestamp+',v1='+signature},body:JSON.stringify({id:event,type:'order',data:{id:providerId}})}),{ip:'198.51.100.31',requestId})
    return{status:response.status,data:await response.json()}
  }
  const paid=await notify('size-paid');assert.equal(paid.status,200,paid.data.error)
  await stock(p,{M:1,G:5})
  const [paidOrder]=await runtime.query('SELECT sale_id FROM store_orders WHERE id=?',[orderId])
  const [line]=await runtime.query('SELECT variant_id,size_label FROM sale_items WHERE sale_id=?',[paidOrder.sale_id])
  assert.equal(line.variant_id,variant(p,'M').id);assert.equal(line.size_label,'M')
  status='refunded'
  assert.equal((await notify('size-refund')).status,200)
  assert.equal((await notify('size-refund-again')).status,200)
  await stock(p,{M:2,G:5})
  const restored=await runtime.query("SELECT size_label,quantity FROM stock_movements WHERE product_id=? AND type='ENTRADA' AND reference_id=?",[p.id,'store-order:'+orderId])
  assert.deepEqual(restored.map(row=>[row.size_label,row.quantity]),[['M',1]])
})
