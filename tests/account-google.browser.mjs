// "Continuar com o Google" on the account page, with a stand-in for Google's
// script and a mocked API. Nothing reaches Google.
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
const quietMotion = { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }
const googleUser = { id:9, name:'Cliente Google', email:'cliente.google@example.test', phone:'', auth_method:'google' }
// Renders a plain button and answers with a fake credential that carries the nonce.
const fakeGoogleScript = `window.google = { accounts: { id: {
  initialize(config) { window.__gis = config; (window.__gisNonces ||= []).push(config.nonce) },
  renderButton(element, options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = options.text === 'signup_with' ? 'Cadastrar com o Google (teste)' : 'Continuar com o Google (teste)'
    button.dataset.theme = options.theme
    button.style.width = options.width + 'px'
    button.onclick = () => window.__gis.callback({ credential: 'cabecalho.conteudo.' + window.__gis.nonce })
    element.appendChild(button)
  }
} } }`
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { signedIn = null, path = '/conta', width = 1280, googleAvailable = true, answers = {} } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(width <= 700 ? { hasTouch:true, isMobile:true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), errors = [], calls = []
  let nonce = 0
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://accounts.google.com/gsi/client', route => { calls.push({ key:'GIS' }); return route.fulfill({ status:200, contentType:'text/javascript', body:fakeGoogleScript }) })
  await page.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), key = request.method() + ' ' + url.pathname
    const body = request.postData() ? JSON.parse(request.postData()) : undefined
    calls.push({ key, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (answers[key]) { const [status, data] = answers[key](body); return json(data, status) }
    if (key === 'GET /api/customer/google/config') return json(googleAvailable ? { available:true, client_id:'local.apps.googleusercontent.com', nonce:'nonce-' + (++nonce) } : { available:false })
    if (key === 'GET /api/customer/me') return signedIn ? json({ authenticated:true, user:signedIn, csrfToken:'csrf-local' }) : json({ authenticated:false }, 401)
    if (key === 'GET /api/customer/orders') return json({ orders:[] })
    if (key === 'GET /api/customer/registration-status') return json({ registration_available:true })
    if (url.pathname === '/api/store') return json({ products:[], categories:[] })
    if (url.pathname === '/api/store/home') return json({ sections:[] })
    if (url.pathname === '/api/store/home/settings') return json({ settings:[quietMotion] })
    return json({ error:'API não prevista.' }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  await page.goto(baseUrl + path)
  return { page, calls }
}

const sent = (calls, key) => calls.filter(call => call.key === key)
const signedInAnswer = created => () => [200, { success:true, created, user:googleUser, csrfToken:'csrf-google' }]

test('entrar com o Google abre a conta e volta para a página de onde a pessoa veio', async t => {
  const { page, calls } = await fixture(t, { path:'/conta?return=/shop', answers:{ 'POST /api/customer/google':signedInAnswer(false) } })
  const button = page.getByRole('button', { name:'Continuar com o Google (teste)', exact:true })
  await button.waitFor()
  await page.getByText('ou entre com e-mail', { exact:true }).waitFor()
  assert.equal(await button.getAttribute('data-theme'), 'filled_black', 'botão escuro no modo escuro')
  await button.click()
  await page.waitForURL('**/shop')
  const nonce = await page.evaluate(() => window.__gis.nonce)
  assert.deepEqual(sent(calls, 'POST /api/customer/google').map(call => call.body), [{ credential:'cabecalho.conteudo.' + nonce, accept_terms:false }])
})

test('conta nova pelo Google leva para Criar conta e só cria com o aceite marcado', async t => {
  let attempts = 0
  const { page, calls } = await fixture(t, { answers:{
    'POST /api/customer/google':body => ++attempts === 1 || !body.accept_terms
      ? [409, { success:false, code:'GOOGLE_TERMS_REQUIRED', error:'Ainda não há conta com este Google. Para criar, marque o aceite dos Termos de Uso e da Política de Privacidade e toque em "Cadastrar com o Google".' }]
      : signedInAnswer(true)()
  } })
  await page.getByRole('button', { name:'Continuar com o Google (teste)', exact:true }).click()
  await page.getByRole('heading', { name:'Crie sua conta', exact:true }).waitFor()
  await page.getByRole('alert').filter({ hasText:'Ainda não há conta com este Google' }).waitFor()
  const signup = page.getByRole('button', { name:'Cadastrar com o Google (teste)', exact:true })
  await signup.waitFor()
  await page.getByText('ou preencha seus dados', { exact:true }).waitFor()
  const order = await page.locator('form.account-form').evaluate(form => {
    const terms = form.querySelector('.terms-accept'), google = form.querySelector('.account-google'), name = form.querySelector('input[autocomplete="name"]')
    return [terms.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING, google.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING].every(Boolean)
  })
  assert.ok(order, 'aceite, depois o Google, depois os campos')
  await page.getByLabel(/Li e aceito os/).check()
  await signup.click()
  await page.waitForURL(url => new URL(url).pathname === '/')
  const posts = sent(calls, 'POST /api/customer/google').map(call => call.body)
  assert.equal(posts.length, 2)
  assert.equal(posts[1].accept_terms, true)
  assert.notEqual(posts[0].credential, posts[1].credential, 'cada tentativa usa um nonce novo')
})

test('sem Client ID configurado, o botão e o script do Google não aparecem', async t => {
  const { page, calls } = await fixture(t, { googleAvailable:false })
  await page.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
  await page.getByLabel('E-mail').waitFor()
  await page.waitForTimeout(300)
  assert.equal(await page.getByText('ou entre com e-mail').count(), 0)
  assert.equal(sent(calls, 'GIS').length, 0)
})

test('Minha conta de quem entrou com o Google: criar senha por e-mail e excluir sem senha', async t => {
  const { page, calls } = await fixture(t, { signedIn:googleUser, answers:{
    'POST /api/customer/password-reset':() => [202, { success:true, message:'Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora. Confira também a pasta de spam.' }],
    'DELETE /api/customer/account':() => [200, { success:true, authenticated:false, message:'Sua conta foi excluída e seus dados pessoais foram removidos.' }]
  } })
  await page.getByRole('heading', { name:'Cliente Google', level:1, exact:true }).waitFor()
  await page.getByRole('button', { name:'Criar senha por e-mail ↗', exact:true }).click()
  await page.getByRole('status').filter({ hasText:'Enviamos um link para criar uma nova senha' }).waitFor()
  assert.deepEqual(sent(calls, 'POST /api/customer/password-reset').map(call => call.body), [{ email:'cliente.google@example.test' }])
  const card = page.locator('.account-delete-card')
  await card.getByRole('button', { name:'Excluir minha conta', exact:true }).click()
  assert.equal(await card.getByLabel('Sua senha').count(), 0, 'sem campo de senha')
  await card.getByLabel('Entendo que a exclusão é definitiva.').check()
  await card.getByRole('button', { name:'Excluir definitivamente', exact:true }).click()
  await page.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
  assert.deepEqual(sent(calls, 'DELETE /api/customer/account').map(call => call.body), [{ password:'', confirm:true }])
})

test('em 320px o botão do Google cabe no formulário', async t => {
  const { page } = await fixture(t, { width:320 })
  const button = page.getByRole('button', { name:'Continuar com o Google (teste)', exact:true })
  await button.waitFor()
  const [buttonBox, formWidth] = await Promise.all([button.boundingBox(), page.locator('form.account-form').evaluate(form => form.clientWidth)])
  assert.ok(buttonBox.width <= formWidth, buttonBox.width + ' <= ' + formWidth)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
})
