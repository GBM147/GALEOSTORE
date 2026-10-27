import test from 'node:test'
import assert from 'node:assert/strict'
import { createMercadoPagoOnlineOrder } from './mercado-pago.js'

const items = [{ product_id:11,variant_id:21,size_label:'M',product_name:'Peça local',quantity:2,unit_price:50,line_total:100 }]

async function captureOrder(shippingFee, expectedTotal) {
  const previousFetch = globalThis.fetch
  const previousEnvironment = { APP_URL:process.env.APP_URL, MERCADO_PAGO_ACCESS_TOKEN:process.env.MERCADO_PAGO_ACCESS_TOKEN }
  let captured, calls = 0
  process.env.APP_URL = 'https://galeo.test'
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'local-fixture-token'
  globalThis.fetch = async (url, options) => {
    calls++
    assert.equal(url,'https://api.mercadopago.com/v1/orders')
    assert.equal(options.method,'POST')
    assert.equal(options.headers['X-Idempotency-Key'],'local-shipping-order')
    captured = JSON.parse(options.body)
    return {ok:true,status:201,text:async()=>JSON.stringify({id:'local-order',checkout_url:'https://payments.example.invalid/local'})}
  }
  try {
    const order = {id:1,code:'LOCAL-ORDER',customer_name:'Cliente local',customer_email:'local@example.invalid',customer_phone:'11999999999',postal_code:'01001000',street:'Rua local',number:'1',neighborhood:'Centro',city:'São Paulo',total:expectedTotal,...(shippingFee === undefined ? {} : {shipping_fee:shippingFee})}
    const originalItems = structuredClone(items)
    await createMercadoPagoOnlineOrder({order,items,idempotencyKey:'local-shipping-order'})
    assert.equal(calls,1)
    assert.deepEqual(items,originalItems)
    const lineCents = captured.items.reduce((sum,item)=>sum+Math.round(Number(item.total_amount)*100),0)
    assert.equal(lineCents,Math.round(Number(captured.total_amount)*100))
    assert.equal(captured.total_amount,expectedTotal.toFixed(2))
    return captured
  } finally {
    globalThis.fetch = previousFetch
    for(const [key,value] of Object.entries(previousEnvironment))value === undefined ? delete process.env[key] : process.env[key]=value
  }
}

test('online checkout item totals include one explicit shipping charge with no stock item mutation',async()=>{
  const payload=await captureOrder('21.35',121.35)
  assert.equal(payload.items.length,2)
  assert.deepEqual(payload.items[1],{external_code:'GALEO-SHIPPING',title:'Frete',quantity:1,unit_price:'21.35',unit_measure:'unit',total_amount:'21.35'})
  assert.equal(payload.items[0].external_code,'P11-V21')
  assert.equal(payload.items[0].total_amount,'100.00')
})

test('legacy orders and zero-cost delivery retain product-only payment items',async()=>{
  for(const shippingFee of [undefined,null,0,'0.00']) {
    const payload=await captureOrder(shippingFee,100)
    assert.equal(payload.items.length,1)
    assert.equal(payload.items.some(item=>item.external_code==='GALEO-SHIPPING'),false)
  }
})
