import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VerificationRuntime, baseUrl } from './helpers/email-verification-runtime.mjs'

// The environment already supplies Playwright. These tests use the real API,
// the isolated MySQL database and local provider delivery, without API routes.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const runtime = new VerificationRuntime()
let browser, reportDirectory

before(async () => {
  await runtime.initialize()
  reportDirectory = process.env.EMAIL_BROWSER_REPORT_DIR || join(tmpdir(), 'galeo-email-browser-' + runtime.suffix)
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 })
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close(); await runtime.close() })

async function contextFor(t) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  const page = await context.newPage()
  const pageErrors = []
  const calls = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) calls.push({ path: url.pathname, method: request.method(), headers: request.headers() })
  })
  return { page, context, calls, pageErrors }
}

async function fillRegistration(page, email, name = 'Cliente local navegador') {
  await page.goto(baseUrl + '/conta')
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
  await page.getByLabel('Nome', { exact: true }).fill(name)
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Telefone', { exact: true }).fill('11999999999')
  await page.getByLabel('Senha', { exact: true }).fill(runtime.password)
  await page.getByLabel('Confirmar senha', { exact: true }).fill(runtime.password)
}

async function login(page, email) {
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(runtime.password)
  await page.getByRole('button', { name: 'Entrar ↗', exact: true }).click()
}

test('navegador real: cadastro pendente, confirmação explícita com senha, login, perfil e logout', async t => {
  const { page, context, calls, pageErrors } = await contextFor(t)
  const email = runtime.email('browser-confirm')
  const name = 'Cliente local navegador'
  await fillRegistration(page, email, name)
  await page.getByRole('button', { name: 'Criar conta ↗', exact: true }).click()
  await page.getByRole('heading', { name: 'Confirme seu e-mail', exact: true }).waitFor()
  const { id, token } = await runtime.trackMailAccount(email)
  assert.equal((await context.cookies()).some(cookie => cookie.name === 'galeo_sid'), false)
  assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '')
  assert.equal(await page.getByRole('button', { name: /^Reenviar em/ }).isDisabled(), true)
  await page.screenshot({ path: join(reportDirectory, 'cadastro-pendente.png'), fullPage: true })
  const { call } = await runtime.verificationMail(email)
  assert.ok(call.payload.html.includes(baseUrl + '/conta#verify='), 'the email link must open the actual storefront account route')
  await page.goto(baseUrl + '/conta#verify=' + token)
  await page.getByRole('button', { name: 'Confirmar e-mail ↗', exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, '', 'the fragment must be removed immediately from browser history')
  assert.equal(calls.filter(call => call.path === '/api/customer/verify-email').length, 0, 'opening a link must never consume it')
  assert.equal((await runtime.query('SELECT email_verified_at FROM customers WHERE id=?', [id]))[0].email_verified_at, null)
  await page.getByLabel('Senha', { exact: true }).fill('Wrong-local-password')
  await page.getByRole('button', { name: 'Confirmar e-mail ↗', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Link inválido' }).waitFor()
  assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '')
  await page.getByLabel('Senha', { exact: true }).fill(runtime.password)
  await page.getByRole('button', { name: 'Confirmar e-mail ↗', exact: true }).click()
  await page.getByRole('heading', { name: 'Entre na sua conta', exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: 'E-mail confirmado' }).waitFor()
  assert.equal((await context.cookies()).some(cookie => cookie.name === 'galeo_sid'), false, 'confirmation must not automatically authenticate')
  await page.screenshot({ path: join(reportDirectory, 'email-confirmado.png'), fullPage: true })
  await login(page, email)
  await page.waitForURL(baseUrl + '/')
  await page.goto(baseUrl + '/conta')
  await page.getByRole('heading', { name, exact: true }).waitFor()
  await page.getByLabel('Nome', { exact: true }).fill('Cliente local atualizado')
  await page.getByRole('button', { name: 'Salvar dados ↗', exact: true }).click()
  await page.getByText('Dados atualizados', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Cliente local atualizado', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await page.waitForURL(baseUrl + '/')
  await fillRegistration(page, runtime.email('browser-after-logout'))
  await page.getByRole('button', { name: 'Criar conta ↗', exact: true }).click()
  await page.getByRole('heading', { name: 'Confirme seu e-mail', exact: true }).waitFor()
  await runtime.trackMailAccount(runtime.email('browser-after-logout'))
  assert.equal(calls.filter(call => call.path === '/api/customer/register').at(-1).headers['x-csrf-token'], undefined, 'a registration after logout must not carry the old authenticated CSRF token')
  assert.equal(calls.filter(call => call.path === '/api/customer/verify-email').length, 2)
  assert.deepEqual(pageErrors, [])
})

test('navegador real: login pendente, reenvio com limite, link antigo recusado e erro de entrega compreensível', async t => {
  const fixture = await runtime.register('browser-resend')
  const { page, calls, pageErrors } = await contextFor(t)
  await page.goto(baseUrl + '/conta')
  await page.getByRole('heading', { name: 'Entre na sua conta', exact: true }).waitFor()
  await login(page, fixture.email)
  await page.getByRole('heading', { name: 'Confirme seu e-mail', exact: true }).waitFor()
  assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), fixture.email)
  assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '')
  await page.getByLabel('Senha', { exact: true }).fill(runtime.password)
  await page.getByRole('button', { name: 'Reenviar e-mail ↗', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Aguarde um minuto' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^Reenviar em/ }).isDisabled(), true)
  assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '')
  await runtime.query('UPDATE customer_email_verifications SET sent_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 61 SECOND) WHERE customer_id=?', [fixture.id])
  await page.reload()
  await page.getByRole('heading', { name: 'Entre na sua conta', exact: true }).waitFor()
  await login(page, fixture.email)
  await page.getByRole('heading', { name: 'Confirme seu e-mail', exact: true }).waitFor()
  await page.getByLabel('Senha', { exact: true }).fill(runtime.password)
  await page.getByRole('button', { name: 'Reenviar e-mail ↗', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Se os dados estiverem corretos' }).waitFor()
  const { token: replacement } = await runtime.verificationMail(fixture.email)
  assert.notEqual(replacement, fixture.token)
  await page.goto(baseUrl + '/conta#verify=' + fixture.token)
  await page.getByRole('button', { name: 'Confirmar e-mail ↗', exact: true }).waitFor()
  await page.getByLabel('Senha', { exact: true }).fill(runtime.password)
  await page.getByRole('button', { name: 'Confirmar e-mail ↗', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Link inválido' }).waitFor()
  await page.screenshot({ path: join(reportDirectory, 'link-substituido-recusado.png'), fullPage: true })
  await runtime.setMailStatus(503)
  try {
    await fillRegistration(page, runtime.email('browser-delivery-failed'))
    await page.getByRole('button', { name: 'Criar conta ↗', exact: true }).click()
    await page.getByText('Não foi possível enviar o e-mail de confirmação. Tente novamente mais tarde.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Crie sua conta', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Criar conta ↗', exact: true }).isEnabled(), true)
    await page.screenshot({ path: join(reportDirectory, 'falha-de-entrega.png'), fullPage: true })
  } finally { await runtime.setMailStatus(200) }
  assert.equal(calls.filter(call => call.path === '/api/customer/resend-verification').length, 2)
  assert.deepEqual(pageErrors, [])
})
