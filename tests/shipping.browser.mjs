import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
if (new URL(baseUrl).protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname)) throw new Error('Os testes de frete recusam produção; use HTTP loopback.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

const product = { id:31, name:'Camiseta local', price:80, stock:5, active:1, image:'', variants:[{ id:102, product_id:31, size:'M', stock:5, active:1 }], has_variants:true }
const cart = [{ id:31, quantity:1, variant_id:102, size_label:'M' }]
const quotes = [{ id:'1', name:'PAC', company:'Correios', price:18.5, delivery_days:5, token:'signed-local-pac' }, { id:'2', name:'SEDEX', company:'Correios', price:29, delivery_days:2, token:'signed-local-sedex' }]

async function fixture(t, { anonymous=false, viewport={ width:1366, height:950 }, config={ configured:true, connected:true, available:true }, quoteResponse, configStatus=200 }={}) {
  const context = await browser.newContext({ viewport, reducedMotion:'reduce' })
  t.after(() => context.close())
  await context.addInitScript(cart => localStorage.setItem('galeo-cart-v2', JSON.stringify(cart)), cart)
  const page = await context.newPage(), calls=[], errors=[]
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, []))
  await page.route('**/api/**', async route => {
    const request=route.request(), path=new URL(request.url()).pathname, method=request.method()
    const body=request.postData() ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json=(data,status=200)=>route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/store') return json({ products:[product], categories:[] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[] })
    if (path === '/api/customer/me') return json(anonymous ? { authenticated:false } : { authenticated:true, user:{ id:7, name:'Cliente local', phone:'11999999999' }, csrfToken:'local-csrf' })
    if (path === '/api/store/shipping/config') return json(config, configStatus)
    if (path === '/api/store/shipping/quotes') {
      if (quoteResponse) return quoteResponse({ route, body, json })
      return json({ quotes, expires_at:new Date(Date.now()+600000).toISOString() })
    }
    if (path === '/api/store/orders') return json({ success:true, payment_configured:false, order:{ id:71, code:'LOCAL-FRETE' } })
    return json({ error:'API não prevista: '+path },404)
  })
  await page.goto(baseUrl+'/carrinho')
  await page.getByRole('heading', { name:'Seu carrinho', exact:true }).waitFor()
  return { page,calls }
}

async function calculate(page) {
  await page.getByLabel('CEP', { exact:true }).fill('01001-000')
  await page.getByRole('button', { name:'Calcular frete', exact:true }).click()
  await page.getByRole('group', { name:'Escolha a entrega' }).waitFor()
}
async function address(page) {
  for (const [label,value] of [['Estado','SP'],['Rua','Rua local'],['Número','1'],['Bairro','Centro'],['Cidade','São Paulo']]) await page.getByLabel(label,{ exact:true }).fill(value)
}

test('frete soma ao total e envia somente a opção assinada com tamanho/quantidade corretos', async t => {
  const { page,calls }=await fixture(t)
  assert.equal(await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).isDisabled(),true)
  await calculate(page)
  await page.getByRole('radio',{ name:/Correios — PAC/ }).check()
  assert.match(await page.locator('.cart-summary-total').innerText(),/98,50/)
  await address(page)
  await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).click()
  await page.getByRole('heading',{ name:'Pedido recebido',exact:true }).waitFor()
  const submitted=calls.find(call=>call.path==='/api/store/orders')
  assert.deepEqual(submitted.body.items,[{ product_id:31,variant_id:102,quantity:1 }])
  assert.equal(submitted.body.shipping_quote,'signed-local-pac')
  assert.equal(submitted.body.shipping.postal_code,'01001-000')
  assert.equal(submitted.body.shipping_fee,undefined)
})

test('consulta de frete funciona antes do login em celular sem overflow horizontal',async t=>{
  const { page,calls }=await fixture(t,{ anonymous:true,viewport:{ width:320,height:800 } })
  await calculate(page)
  await page.getByRole('radio',{ name:/Correios — SEDEX/ }).check()
  assert.match(await page.locator('.cart-summary-total').innerText(),/109,00/)
  assert.equal(await page.getByRole('link',{ name:'Entrar / criar conta ↗',exact:true }).count(),1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
  assert.deepEqual(calls.find(call=>call.path==='/api/store/shipping/quotes').body,{ postal_code:'01001000',items:[{ product_id:31,variant_id:102,quantity:1 }] })
})

test('alterações de CEP ou quantidade invalidam seleção e total imediatamente',async t=>{
  const { page }=await fixture(t)
  await calculate(page)
  await page.getByRole('radio',{ name:/PAC/ }).check()
  await page.getByLabel('CEP',{ exact:true }).fill('02002-000')
  assert.equal(await page.getByRole('radio').count(),0)
  assert.equal(await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).isDisabled(),true)
  assert.match(await page.locator('.cart-summary-total').innerText(),/80,00/)
  await page.getByRole('button',{ name:'Calcular frete',exact:true }).click()
  await page.getByRole('radio',{ name:/PAC/ }).check()
  await page.locator('.quantity-control').getByRole('button',{ name:'+',exact:true }).click()
  assert.equal(await page.getByRole('radio').count(),0)
  assert.match(await page.locator('.cart-summary-total').innerText(),/160,00/)
})

test('resposta antiga não retorna ao trocar o CEP durante a consulta',async t=>{
  let release
  const pending=new Promise(resolve=>{ release=resolve })
  const { page,calls }=await fixture(t,{ quoteResponse:async({json})=>{ await pending;return json({ quotes,expires_at:new Date(Date.now()+600000).toISOString() }) } })
  await page.getByLabel('CEP',{ exact:true }).fill('01001-000')
  await page.getByRole('button',{ name:'Calcular frete',exact:true }).click()
  await page.waitForFunction(()=>document.querySelector('.shipping-postal-row button')?.textContent.includes('Calculando'))
  await page.getByLabel('CEP',{ exact:true }).fill('02002-000')
  const response=page.waitForResponse(response=>response.url().includes('/api/store/shipping/quotes'))
  release()
  await response
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.equal(calls.filter(call=>call.path==='/api/store/shipping/quotes').length,1)
  assert.equal(await page.getByRole('radio').count(),0)
  assert.equal(await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).isDisabled(),true)
})

test('cotação expirada deixa de permitir envio do pedido',async t=>{
  const { page }=await fixture(t,{ quoteResponse:({json})=>json({ quotes,expires_at:new Date(Date.now()+1600).toISOString() }) })
  await calculate(page)
  await page.getByRole('radio',{ name:/PAC/ }).check()
  assert.equal(await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).isDisabled(),false)
  await page.getByRole('alert').filter({ hasText:/cotação expirou/ }).waitFor()
  assert.equal(await page.getByRole('radio').count(),0)
  assert.equal(await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).isDisabled(),true)
})

test('erro ao conferir configuração bloqueia pedido e não apresenta frete grátis',async t=>{
  const { page,calls }=await fixture(t,{ config:{ error:'Indisponível' },configStatus:503 })
  await page.getByRole('alert').filter({ hasText:/Não foi possível conferir o frete/ }).waitFor()
  assert.equal(await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).isDisabled(),true)
  assert.equal(calls.some(call=>call.path==='/api/store/orders'),false)
  assert.equal(await page.getByText('R$ 0,00',{ exact:true }).count(),0)
})

test('modo anterior mantém solicitação manual e informa que frete não faz parte do subtotal',async t=>{
  const { page,calls }=await fixture(t,{ config:{ configured:false,connected:false,available:false } })
  await page.getByText('O frete será combinado com a loja e não está incluído no subtotal.',{ exact:true }).waitFor()
  await page.getByLabel('CEP',{ exact:true }).fill('01001-000')
  await address(page)
  await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).click()
  await page.getByRole('heading',{ name:'Pedido recebido',exact:true }).waitFor()
  assert.equal(calls.find(call=>call.path==='/api/store/orders').body.shipping_quote,undefined)
})


test('integração configurada sem autorização não permite pedido sem frete',async t=>{
  const { page,calls }=await fixture(t,{ config:{ configured:true,connected:false,available:false } })
  await page.getByRole('status').filter({ hasText:/entrega ainda está sendo preparada/ }).waitFor()
  assert.equal(await page.getByRole('button',{ name:'Calcular frete',exact:true }).count(),0)
  assert.equal(await page.getByRole('button',{ name:'Solicitar pedido ↗',exact:true }).isDisabled(),true)
  assert.equal(calls.some(call=>call.path==='/api/store/orders'),false)
})

const jadlogQuotes = [
  { id:'3', name:'.Package', company:'Jadlog', price:15.23, delivery_days:5, token:'provider-package-token' },
  { id:'4', name:'.Com', company:'Jadlog', price:15.35, delivery_days:4, token:'provider-com-token' }
]

test('Jadlog uses readable names and local official logos while keeping the provider quote and checkout token', async t => {
  const { page, calls } = await fixture(t, { quoteResponse:({json}) => json({ quotes:jadlogQuotes, expires_at:new Date(Date.now()+600000).toISOString() }) })
  await calculate(page)
  const economical = page.getByRole('radio', { name:/Jadlog — Entrega econômica/ })
  const express = page.getByRole('radio', { name:/Jadlog — Entrega expressa/ })
  await economical.focus()
  await economical.press('Space')
  assert.equal(await economical.isChecked(), true)
  const labels = page.locator('.shipping-options label')
  assert.equal(await labels.count(), 2)
  assert.match(await labels.nth(0).innerText(), /15,23/)
  assert.match(await labels.nth(0).innerText(), /5 dias úteis/)
  assert.match(await labels.nth(1).innerText(), /15,35/)
  assert.match(await labels.nth(1).innerText(), /4 dias úteis/)
  for (const logo of await labels.locator('img').all()) {
    assert.equal(await logo.getAttribute('src'), '/images/carriers/jadlog.png')
    await logo.evaluate(img => img.decode())
    assert.ok(await logo.evaluate(img => img.naturalWidth > 0 && img.clientWidth > 0))
  }
  await page.getByText('Cotação pelo Melhor Envio', { exact:true }).waitFor()
  assert.doesNotMatch(await page.locator('.shipping-options').innerText(), /\.Package|\.Com/)
  assert.match(await page.locator('.cart-summary-total').innerText(), /95,23/)
  await express.check()
  assert.match(await page.locator('.cart-summary-total').innerText(), /95,35/)
  await address(page)
  await page.getByRole('button', { name:'Solicitar pedido ↗', exact:true }).click()
  await page.getByRole('heading', { name:'Pedido recebido', exact:true }).waitFor()
  assert.equal(calls.find(call => call.path === '/api/store/orders').body.shipping_quote, 'provider-com-token')
})

test('carrier branding stays inside a 320px cart and a failed logo preserves the readable selectable service', async t => {
  const { page } = await fixture(t, { viewport:{ width:320, height:800 }, quoteResponse:({json}) => json({ quotes:jadlogQuotes, expires_at:new Date(Date.now()+600000).toISOString() }) })
  await page.route('**/images/carriers/jadlog.png', route => route.fulfill({ status:404, body:'' }))
  await calculate(page)
  await page.getByRole('radio', { name:/Entrega econômica/ }).check()
  await page.waitForFunction(() => document.querySelectorAll('.shipping-options img').length === 0)
  assert.equal(await page.getByRole('radio', { name:/Jadlog — Entrega econômica/ }).isChecked(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.match(await page.locator('.cart-summary-total').innerText(), /95,23/)
})

test('an unknown carrier or modality keeps its provider identity and does not borrow a different carrier logo', async t => {
  const unknown = { id:'3', company:'Outra transportadora', name:'Serviço regional', price:11.5, delivery_days:2, token:'unknown-provider-token' }
  const { page } = await fixture(t, { quoteResponse:({json}) => json({ quotes:[unknown], expires_at:new Date(Date.now()+600000).toISOString() }) })
  await calculate(page)
  await page.getByRole('radio', { name:/Outra transportadora — Serviço regional/ }).check()
  assert.equal(await page.locator('.shipping-options img').count(), 0)
  assert.match(await page.locator('.cart-summary-total').innerText(), /91,50/)
})
