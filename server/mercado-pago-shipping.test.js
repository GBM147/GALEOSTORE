import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createMercadoPagoOnlineOrder } from './mercado-pago.js'

const items = [{ product_id:11,variant_id:21,size_label:'M',product_name:'Peça local',quantity:2,unit_price:50,line_total:100 }]

async function captureOrder(shippingFee, expectedTotal) {
  const previousFetch = globalThis.fetch
  const keys = ['APP_URL','DB_NAME','MERCADO_PAGO_MODE','MERCADO_PAGO_TEST_SELLER_ID','MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED','GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN','GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY','GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET']
  const previousEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  let captured, calls = 0
  const idempotencyKey = randomUUID()
  Object.assign(process.env,{APP_URL:'https://galeo.test',DB_NAME:'galeo_shipping_test',MERCADO_PAGO_MODE:'test',MERCADO_PAGO_TEST_SELLER_ID:'42',MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED:'true',GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN:'APP_USR-local-fixture-'+randomUUID(),GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY:'APP_USR-local-public-key',GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET:'local-webhook-secret'})
  globalThis.fetch = async (url, options) => {
    if(url==='https://api.mercadopago.com/users/me')return{ok:true,status:200,text:async()=>JSON.stringify({id:42,site_id:'MLB',tags:['test_user']})}
    calls++
    assert.equal(url,'https://api.mercadopago.com/v1/orders')
    assert.equal(options.method,'POST')
    assert.equal(options.headers['X-Idempotency-Key'],idempotencyKey)
    captured = JSON.parse(options.body)
    return {ok:true,status:201,text:async()=>JSON.stringify({id:'local-order',user_id:'42',country_code:'BRA',external_reference:'LOCAL-ORDER',total_amount:expectedTotal.toFixed(2)})}
  }
  try {
    const order = {id:1,code:'LOCAL-ORDER',customer_name:'Cliente local',customer_email:'local@example.invalid',customer_phone:'11999999999',postal_code:'01001000',street:'Rua local',number:'1',neighborhood:'Centro',city:'São Paulo',total:expectedTotal,...(shippingFee === undefined ? {} : {shipping_fee:shippingFee})}
    const originalItems = structuredClone(items)
    await createMercadoPagoOnlineOrder({order,items,payment:{method:'pix'},idempotencyKey})
    assert.equal(calls,1)
    assert.deepEqual(items,originalItems)
    assert.equal(captured.total_amount,expectedTotal.toFixed(2))
    assert.equal(captured.transactions.payments[0].amount,expectedTotal.toFixed(2))
    assert.equal(captured.items,undefined)
    return captured
  } finally {
    globalThis.fetch = previousFetch
    for(const [key,value] of Object.entries(previousEnvironment))value === undefined ? delete process.env[key] : process.env[key]=value
  }
}

test('online checkout total includes freight once without transmitting optional item metadata',async()=>{
  const payload=await captureOrder('21.35',121.35)
  assert.equal(payload.total_amount,'121.35')
  assert.equal(payload.shipment,undefined)
  assert.deepEqual(payload.payer,{email:'local@example.invalid'})
})

test('legacy orders and zero-cost delivery retain the product-only total',async()=>{
  for(const shippingFee of [undefined,null,0,'0.00']) {
    const payload=await captureOrder(shippingFee,100)
    assert.equal(payload.total_amount,'100.00')
    assert.equal(payload.items,undefined)
  }
})
