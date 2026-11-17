// Customer self-service screens with a mocked API: forgotten password, the
// e-mailed reset link, password change and account deletion.
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
const user = { id:7, name:'Cliente local', email:'cliente@example.test', phone:'' }
const resetToken = '7.' + '1'.repeat(10) + '.' + 'A'.repeat(43)
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

// `answers` maps "METHOD /path" to a function returning [status, body]. Every
// request is recorded so the tests can check what the page sent.
async function fixture(t, { signedIn = false, path = '/conta', width = 1280, answers = {} } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(width <= 700 ? { hasTouch:true, isMobile:true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), errors = [], calls = []
  let session = signedIn
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url())
    const key = request.method() + ' ' + url.pathname
    const body = request.postData() ? JSON.parse(request.postData()) : undefined
    calls.push({ key, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (answers[key]) {
      const [status, data] = answers[key](body)
      if (status === 200 && data?.authenticated === false) session = false
      return json(data, status)
    }
    if (key === 'GET /api/customer/me') return json(session ? { authenticated:true, user, csrfToken:'csrf-local' } : { authenticated:false }, session ? 200 : 401)
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
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test('esqueci minha senha leva o e-mail digitado e mostra a resposta genérica', async t => {
  const message = 'Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.'
  const { page, calls } = await fixture(t, { answers:{ 'POST /api/customer/password-reset':() => [202, { success:true, message }] } })
  await page.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
  await page.getByLabel('E-mail').fill('cliente@example.test')
  await page.getByRole('button', { name:'Esqueci minha senha', exact:true }).click()
  await page.getByRole('heading', { name:'Recuperar senha', exact:true }).waitFor()
  assert.equal(await page.getByLabel('E-mail').inputValue(), 'cliente@example.test', 'o e-mail do login vem preenchido')
  await page.getByRole('button', { name:'Enviar link ↗', exact:true }).click()
  await page.getByRole('status').filter({ hasText:message }).waitFor()
  assert.deepEqual(sent(calls, 'POST /api/customer/password-reset').map(call => call.body), [{ email:'cliente@example.test' }])
  await page.getByRole('button', { name:/^Enviar de novo em \d+s$/ }).waitFor()
  assert.equal(await page.getByRole('button', { name:/^Enviar de novo em/ }).isDisabled(), true)
  await page.getByRole('button', { name:'Voltar para Entrar', exact:true }).click()
  await page.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
})

test('o link do e-mail abre a nova senha, tira o token do endereço e volta para o login', async t => {
  const { page, calls } = await fixture(t, { path:'/conta#redefinir=' + resetToken, answers:{
    'POST /api/customer/password-reset/confirm':() => [200, { success:true, message:'Nova senha criada. Entre com ela para acessar a conta.' }]
  } })
  await page.getByRole('heading', { name:'Crie uma nova senha', exact:true }).waitFor()
  assert.equal(await page.evaluate(() => window.location.hash), '', 'o token sai da barra de endereço')
  assert.equal(sent(calls, 'GET /api/customer/me').length, 0, 'o link não carrega a sessão')
  await page.getByLabel('Nova senha', { exact:true }).fill('Senha-nova-local-1')
  await page.getByLabel('Confirmar nova senha').fill('Senha-nova-local-2')
  await page.getByRole('button', { name:'Salvar nova senha ↗', exact:true }).click()
  await page.getByRole('alert').filter({ hasText:'As senhas não coincidem' }).waitFor()
  assert.equal(sent(calls, 'POST /api/customer/password-reset/confirm').length, 0)
  await page.getByLabel('Nova senha', { exact:true }).fill('Senha-nova-local-1')
  await page.getByLabel('Confirmar nova senha').fill('Senha-nova-local-1')
  await page.getByRole('button', { name:'Salvar nova senha ↗', exact:true }).click()
  await page.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
  await page.getByRole('status').filter({ hasText:'Nova senha criada' }).waitFor()
  assert.deepEqual(sent(calls, 'POST /api/customer/password-reset/confirm').map(call => call.body), [{ token:resetToken, password:'Senha-nova-local-1' }])
})

test('link vencido ou já usado oferece pedir um novo', async t => {
  const { page } = await fixture(t, { path:'/conta#redefinir=' + resetToken, answers:{
    'POST /api/customer/password-reset/confirm':() => [400, { success:false, code:'RESET_LINK_INVALID', error:'Este link é inválido, expirou ou já foi usado. Peça um novo link.' }]
  } })
  await page.getByLabel('Nova senha', { exact:true }).fill('Senha-nova-local-1')
  await page.getByLabel('Confirmar nova senha').fill('Senha-nova-local-1')
  await page.getByRole('button', { name:'Salvar nova senha ↗', exact:true }).click()
  await page.getByRole('alert').filter({ hasText:'já foi usado' }).waitFor()
  assert.equal(await page.getByLabel('Nova senha', { exact:true }).count(), 0, 'o formulário some sem um link válido')
  await page.getByRole('button', { name:'Pedir novo link ↗', exact:true }).click()
  await page.getByRole('heading', { name:'Recuperar senha', exact:true }).waitFor()
  const broken = await fixture(t, { path:'/conta#redefinir=quebrado' })
  await broken.page.getByRole('alert').filter({ hasText:'link para criar uma nova senha é inválido' }).waitFor()
})

test('alterar a senha mostra o erro no próprio quadro e mantém a pessoa na conta', async t => {
  let attempts = 0
  const { page, calls } = await fixture(t, { signedIn:true, answers:{
    'PUT /api/customer/password':() => ++attempts === 1
      ? [400, { success:false, code:'CURRENT_PASSWORD_INVALID', error:'A senha atual está incorreta.' }]
      : [200, { success:true, message:'Senha alterada. As sessões em outros aparelhos foram encerradas.' }]
  } })
  const card = page.locator('.account-side-card').filter({ has:page.getByRole('heading', { name:'Alterar senha', exact:true }) })
  await card.waitFor()
  const fill = async () => {
    await card.getByLabel('Senha atual').fill('Senha-atual-local')
    await card.getByLabel('Nova senha', { exact:true }).fill('Senha-nova-local-1')
    await card.getByLabel('Confirmar nova senha').fill('Senha-nova-local-1')
    await card.getByRole('button', { name:'Alterar senha ↗', exact:true }).click()
  }
  await fill()
  await card.getByRole('alert').filter({ hasText:'A senha atual está incorreta.' }).waitFor()
  await page.getByRole('heading', { name:'Cliente local', level:1, exact:true }).waitFor()
  assert.equal(await page.locator('.account-profile-card .form-error').count(), 0, 'o erro não aparece no Perfil')
  await fill()
  await card.getByRole('status').filter({ hasText:'Senha alterada' }).waitFor()
  assert.deepEqual(sent(calls, 'PUT /api/customer/password').at(-1).body, { currentPassword:'Senha-atual-local', newPassword:'Senha-nova-local-1' })
  assert.equal(await card.getByLabel('Senha atual').inputValue(), '', 'as senhas saem dos campos')
})

test('excluir a conta pede senha e confirmação, explica o bloqueio e sai da conta', async t => {
  let attempts = 0
  const { page, calls } = await fixture(t, { signedIn:true, answers:{
    'DELETE /api/customer/account':() => ++attempts === 1
      ? [409, { success:false, code:'ACCOUNT_HAS_OPEN_ORDERS', error:'Você tem um pedido pago em andamento.' }]
      : [200, { success:true, authenticated:false, message:'Sua conta foi excluída e seus dados pessoais foram removidos.' }]
  } })
  const card = page.locator('.account-delete-card')
  await card.getByRole('button', { name:'Excluir minha conta', exact:true }).click()
  await card.getByRole('button', { name:'Cancelar', exact:true }).click()
  await card.getByRole('button', { name:'Excluir minha conta', exact:true }).click()
  await card.getByLabel('Sua senha').fill('Senha-atual-local')
  await card.getByRole('button', { name:'Excluir definitivamente', exact:true }).click()
  assert.equal(sent(calls, 'DELETE /api/customer/account').length, 0, 'sem a confirmação marcada nada é enviado')
  await card.getByLabel('Entendo que a exclusão é definitiva.').check()
  await card.getByRole('button', { name:'Excluir definitivamente', exact:true }).click()
  await card.getByRole('alert').filter({ hasText:'pedido pago em andamento' }).waitFor()
  await page.getByRole('heading', { name:'Cliente local', level:1, exact:true }).waitFor()
  await card.getByLabel('Sua senha').fill('Senha-atual-local')
  await card.getByRole('button', { name:'Excluir definitivamente', exact:true }).click()
  await page.getByRole('heading', { name:'Entre na sua conta', exact:true }).waitFor()
  await page.getByRole('status').filter({ hasText:'Sua conta foi excluída' }).waitFor()
  assert.deepEqual(sent(calls, 'DELETE /api/customer/account').map(call => call.body), [
    { password:'Senha-atual-local', confirm:true }, { password:'Senha-atual-local', confirm:true }
  ])
})

for (const width of [390, 320]) {
  test(`conta em ${width}px: quadros de senha e exclusão sem rolagem lateral`, async t => {
    const { page } = await fixture(t, { signedIn:true, width })
    await page.getByRole('heading', { name:'Excluir conta', exact:true }).waitFor()
    await page.locator('.account-delete-card').getByRole('button', { name:'Excluir minha conta', exact:true }).click()
    assert.ok(await noSideScroll(page))
    const signedOut = await fixture(t, { width, path:'/conta#redefinir=' + resetToken })
    await signedOut.page.getByRole('heading', { name:'Crie uma nova senha', exact:true }).waitFor()
    assert.ok(await noSideScroll(signedOut.page))
  })
}
