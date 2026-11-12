import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes do carrinho exigem servidor local; produção é recusada.')
}
const product = { id:51, name:'Camiseta local do carrinho', brand:'Marca local', category:'Camisetas', category_id:1, price:129.9, stock:4, active:1, image:'/images/product-placeholder.svg', has_variants:false, sizes:[], variants:[] }
const quietMotion = { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280, anonymous = false } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(width <= 700 ? { hasTouch:true, isMobile:true } : {}) })
  t.after(() => context.close())
  await context.addInitScript(item => { localStorage.setItem('galeo-cart-v2', JSON.stringify([item])) }, { id:product.id, name:product.name, quantity:2, price:product.price })
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    calls.push({ path, method:request.method() })
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/customer/me') return anonymous ? json({ authenticated:false }) : json({ authenticated:true, user:{ id:7, email:'cliente@example.test', name:'Cliente local' }, csrfToken:'csrf-local' })
    if (path === '/api/store') return json({ products:[product], categories:[] })
    if (path === '/api/store/shipping/config') return json({ configured:false, available:false })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[quietMotion] })
    return json({ error:'API não prevista.' }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  await page.goto(baseUrl + '/carrinho')
  await page.getByRole('heading', { name:'Seu carrinho', exact:true }).waitFor()
  return { page, calls }
}

const box = locator => locator.evaluate(node => { const rect = node.getBoundingClientRect(); return { x:rect.x, y:rect.y, width:rect.width } })

test('carrinho mostra as etapas e o resumo ao lado no computador', async t => {
  const { page } = await fixture(t)
  const summary = page.locator('.cart-summary')
  await summary.getByRole('heading', { name:'Resumo do pedido', exact:true }).waitFor()
  const steps = page.getByRole('list', { name:'Etapas da compra', exact:true })
  assert.equal(await steps.locator('[aria-current="step"]').textContent(), '1Carrinho')
  assert.equal(await page.locator('.cart-count').textContent(), '2 itens')
  const form = page.locator('.cart-main > form#cart-checkout-form')
  await form.getByRole('heading', { name:'Endereço de entrega', exact:true }).waitFor()
  const submit = summary.getByRole('button', { name:'Solicitar pedido ↗', exact:true })
  assert.equal(await submit.getAttribute('form'), 'cart-checkout-form')
  const [main, aside] = await Promise.all([box(page.locator('.cart-main')), box(summary)])
  assert.ok(aside.x > main.x + main.width - 1, 'o resumo fica à direita')
  assert.match(await summary.locator('.cart-secure').textContent(), /Pagamento seguro/)
  assert.match(await page.locator('.cart-summary-total').innerText(), /259,80/)
})

test('o botão do resumo valida os campos do endereço antes de registrar o pedido', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('checkbox', { name: /Li e concordo com os Termos/ }).check()
  await page.getByRole('button', { name:'Solicitar pedido ↗', exact:true }).click()
  assert.equal(await page.evaluate(() => document.activeElement?.matches(':invalid')), true, 'o primeiro campo vazio recebe o foco')
  assert.equal(calls.some(call => call.method === 'POST'), false)
})

test('sem conta o resumo leva ao login e não mostra formulário de endereço', async t => {
  const { page } = await fixture(t, { anonymous:true })
  await page.locator('.cart-summary').getByRole('link', { name:'Entrar / criar conta ↗', exact:true }).waitFor()
  assert.equal(await page.locator('.checkout-form').count(), 0)
  assert.equal(await page.getByRole('button', { name:'Solicitar pedido ↗', exact:true }).count(), 0)
})

for (const width of [390, 320]) {
  test(`no celular de ${width}px o resumo vem depois do endereço e nada vaza para o lado`, async t => {
    const { page } = await fixture(t, { width })
    const [form, summary] = await Promise.all([box(page.locator('#cart-checkout-form')), box(page.locator('.cart-summary'))])
    assert.ok(summary.y > form.y, 'resumo abaixo do endereço')
    const fields = await page.locator('.cart-page input:not([type="radio"])').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ height:node.getBoundingClientRect().height, radius:parseFloat(getComputedStyle(node).borderTopLeftRadius), font:parseFloat(getComputedStyle(node).fontSize) })))
    assert.ok(fields.length >= 8)
    for (const field of fields) assert.ok(field.height >= 44 && field.radius >= 8 && field.font === 16, JSON.stringify(field))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  })
}
