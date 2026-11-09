import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes da conta exigem servidor local; produção é recusada.')
}
const orders = [
  { id:12, code:'GALEO-LOCAL-0012', created_at:'2026-11-09T20:44:00Z', status:'RECEIVED', status_label:'Recebido', total:59.9, payment_status:'PENDING', payment_available:true, items:[{ name:'Boné local', quantity:1 }] },
  { id:11, code:'GALEO-LOCAL-0011', created_at:'2026-11-09T15:44:00Z', status:'CONFIRMED', status_label:'Confirmado', total:89.9, payment_status:'APPROVED', payment_available:false, items:[{ name:'Camiseta local', size_label:'M', quantity:1 }] }
]
const quietMotion = { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280, signedIn = true } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(width <= 700 ? { hasTouch:true, isMobile:true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/customer/me') return json(signedIn ? { authenticated:true, user:{ id:7, name:'Cliente local', email:'cliente@example.test', phone:'' }, csrfToken:'csrf-local' } : { authenticated:false })
    if (path === '/api/customer/orders') return json({ orders })
    if (path === '/api/customer/registration-status') return json({ registration_available:true })
    if (path === '/api/store') return json({ products:[], categories:[] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[quietMotion] })
    return json({ error:'API não prevista.' }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  await page.goto(baseUrl + '/conta')
  return page
}

const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test('conta mostra os pedidos primeiro, com selo de pagamento e botão compacto', async t => {
  const page = await fixture(t)
  const heading = page.getByRole('heading', { name:'Cliente local', level:1, exact:true })
  await heading.waitFor()
  assert.ok(await heading.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) < 48)
  await page.locator('.account-heading').getByRole('button', { name:'Sair da conta', exact:true }).waitFor()
  assert.equal(await page.locator('.account-orders-card + .account-profile-card').count(), 1, 'Perfil vem depois dos pedidos')
  const payments = page.locator('.account-payment')
  assert.deepEqual(await payments.allTextContents(), ['Pagamento: Aguardando pagamento', 'Pagamento: Aprovado'])
  assert.deepEqual(await payments.evaluateAll(nodes => nodes.map(node => node.dataset.status)), ['PENDING', 'APPROVED'])
  const pay = page.getByRole('link', { name:'Continuar pagamento', exact:true })
  assert.equal(await pay.getAttribute('href'), '/pagamento/12')
  const height = await pay.evaluate(node => node.getBoundingClientRect().height)
  assert.ok(height >= 44 && height <= 48, `botão com ${height}px`)
  const [orders, profile] = await Promise.all(['.account-orders-card', '.account-profile-card'].map(selector => page.locator(selector).evaluate(node => node.getBoundingClientRect().x)))
  assert.ok(profile > orders, 'Perfil fica ao lado, à direita')
  for (const field of await page.locator('.account-profile-card input').evaluateAll(nodes => nodes.map(node => ({ height:node.getBoundingClientRect().height, radius:parseFloat(getComputedStyle(node).borderTopLeftRadius), font:parseFloat(getComputedStyle(node).fontSize) })))) {
    assert.ok(field.height >= 44 && field.radius >= 8 && field.font === 16, JSON.stringify(field))
  }
})

test('entrar e criar conta formam um seletor com a aba ativa anunciada', async t => {
  const page = await fixture(t, { signedIn:false })
  await page.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
  const login = page.getByRole('button', { name:'Entrar', exact:true }), register = page.getByRole('button', { name:'Criar conta', exact:true })
  assert.equal(await login.getAttribute('aria-pressed'), 'true')
  assert.equal(await register.getAttribute('aria-pressed'), 'false')
  await register.click()
  await page.getByRole('heading', { name:'Crie sua conta', exact:true }).waitFor()
  assert.equal(await register.getAttribute('aria-pressed'), 'true')
  const [active, idle] = await Promise.all([register, login].map(button => button.evaluate(node => getComputedStyle(node).backgroundColor)))
  assert.notEqual(active, idle)
  const submit = await page.getByRole('button', { name:'Criar conta ↗', exact:true }).evaluate(node => ({ height:node.getBoundingClientRect().height, radius:parseFloat(getComputedStyle(node).borderTopLeftRadius) }))
  assert.ok(submit.height >= 46 && submit.radius >= 8, JSON.stringify(submit))
})

for (const width of [390, 320]) {
  test(`conta em ${width}px: pedidos antes do Perfil e nada vaza para o lado`, async t => {
    const page = await fixture(t, { width })
    await page.getByRole('heading', { name:'Cliente local', level:1, exact:true }).waitFor()
    const [orders, profile] = await Promise.all(['.account-orders-card', '.account-profile-card'].map(selector => page.locator(selector).evaluate(node => node.getBoundingClientRect().y)))
    assert.ok(profile > orders)
    assert.ok(await noSideScroll(page))
    const signedOut = await fixture(t, { width, signedIn:false })
    await signedOut.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
    assert.ok(await noSideScroll(signedOut))
  })
}
