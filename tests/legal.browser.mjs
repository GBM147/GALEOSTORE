import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes das políticas exigem servidor local; produção é recusada.')
}
const quietMotion = { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }
const company = { legal_name:'GALEO Comércio de Roupas LTDA', cnpj:'11.222.333/0001-81', street:'Rua Augusta', number:'100', neighborhood:'Consolação', city:'São Paulo', state:'SP', postal_code:'01304-000', email:'contato@galeo.test', hours:'seg. a sex., 9h às 18h' }
const pages = [['Termos de Uso', '/termos', 'Termos de Uso e Condições de Compra'], ['Privacidade', '/privacidade', 'Política de Privacidade'], ['Trocas e Devoluções', '/trocas', 'Trocas, Devoluções e Arrependimento'], ['Entregas', '/entregas', 'Entregas'], ['Contato', '/contato', 'Contato']]
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280, settings = [{ key:'company', value:company }], handle } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(width < 700 ? { isMobile:true, hasTouch:true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), errors = [], calls = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    const custom = handle?.({ path, method, body })
    if (custom) return json(custom.data, custom.status)
    if (path === '/api/store') return json({ products:[], categories:[] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[quietMotion, { key:'footer', value:{ brand:'GALEO STORE', year:'2026', whatsapp:'11999999999' } }, ...settings] })
    if (path === '/api/customer/me') return json({ authenticated:false }, 401)
    return json({ error:'API não prevista.' }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  return { page, calls }
}

const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

for (const [theme, width] of [['dark', 1280], ['light', 390]]) {
  test(`rodapé leva às 5 páginas de políticas (${theme}, ${width}px)`, async t => {
    const { page } = await fixture(t, { width })
    await page.goto(baseUrl + '/?theme=' + theme)
    for (const [link, path, title] of pages) {
      const footer = page.getByRole('navigation', { name:'Institucional' })
      await footer.scrollIntoViewIfNeeded()
      await footer.getByRole('link', { name:link, exact:true }).click()
      await page.waitForURL('**' + path)
      await page.getByRole('heading', { level:1, name:title, exact:true }).waitFor()
      assert.equal(await page.getByRole('navigation', { name:'Políticas da loja' }).getByRole('link', { name:link, exact:true }).getAttribute('aria-current'), 'page')
      if (path !== '/contato') {
        assert.equal(await page.locator('.legal-version').textContent(), 'Versão de 12 de novembro de 2026')
        await page.getByRole('heading', { name:'Resumo', exact:true }).waitFor()
      }
      assert.ok(await noHorizontalScroll(page), path + ' sem rolagem lateral')
      assert.match(await page.title(), new RegExp('^' + title.replace(/[,]/g, '.') + ' \\| Galeo Store$'))
    }
  })
}

test('dados da empresa aparecem no Contato, nos Termos e no rodapé', async t => {
  const { page } = await fixture(t)
  await page.goto(baseUrl + '/contato')
  const main = page.locator('main.legal-page')
  await main.getByText('GALEO Comércio de Roupas LTDA').waitFor()
  await main.getByText('11.222.333/0001-81').waitFor()
  await main.getByText('Rua Augusta, 100, Consolação, São Paulo/SP, CEP 01304-000').waitFor()
  assert.equal(await main.getByRole('link', { name:'contato@galeo.test' }).getAttribute('href'), 'mailto:contato@galeo.test')
  assert.equal(await main.getByRole('link', { name:'(11) 99999-9999' }).getAttribute('href'), 'https://wa.me/5511999999999')
  assert.match(await page.locator('.site-footer-bottom').textContent(), /GALEO Comércio de Roupas LTDA · CNPJ 11\.222\.333\/0001-81/)
  await page.goto(baseUrl + '/termos')
  await page.getByText(/operada por GALEO Comércio de Roupas LTDA, CNPJ 11\.222\.333\/0001-81/).waitFor()
})

test('sem dados da empresa, as páginas continuam claras e o Contato avisa', async t => {
  const { page } = await fixture(t, { settings:[] })
  await page.goto(baseUrl + '/contato')
  await page.locator('main.legal-page').getByRole('link', { name:'(11) 99999-9999' }).waitFor()
  assert.equal(await page.getByRole('heading', { name:'Dados da empresa' }).count(), 0)
  await page.goto(baseUrl + '/termos')
  await page.getByText(/operada pela empresa identificada na página/).waitFor()
  assert.doesNotMatch(await page.locator('main').innerText(), /undefined|null/)
})

test('cadastro só sai com o aceite dos Termos e envia a confirmação', async t => {
  const { page, calls } = await fixture(t, { handle:({ path, method }) => {
    if (path === '/api/customer/registration-status') return { data:{ registration_available:true } }
    if (path === '/api/customer/register' && method === 'POST') return { status:202, data:{ success:true, verification_required:true, message:'Enviamos um link para confirmar seu e-mail.' } }
  } })
  await page.goto(baseUrl + '/conta')
  await page.getByRole('button', { name:'Criar conta', exact:true }).click()
  await page.getByLabel('Nome').fill('Cliente local')
  await page.getByLabel('E-mail').fill('cliente@example.test')
  await page.getByLabel('Senha', { exact:true }).fill('SenhaForte#2026')
  await page.getByLabel('Confirmar senha').fill('SenhaForte#2026')
  const box = page.getByRole('checkbox', { name:/Li e aceito os Termos de Uso e a Política de Privacidade/ })
  assert.equal(await box.isChecked(), false)
  for (const [name, path] of [['Termos de Uso', '/termos'], ['Política de Privacidade', '/privacidade']]) {
    const link = page.locator('label.terms-accept').getByRole('link', { name, exact:true })
    assert.equal(await link.getAttribute('href'), path)
    assert.equal(await link.getAttribute('target'), '_blank')
  }
  await page.getByRole('button', { name:'Criar conta ↗', exact:true }).click()
  assert.equal(calls.filter(call => call.path === '/api/customer/register').length, 0, 'sem o aceite, o cadastro não é enviado')
  await box.check()
  await page.getByRole('button', { name:'Criar conta ↗', exact:true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Enviamos um link'))
  assert.equal(calls.find(call => call.path === '/api/customer/register').body.accept_terms, true)
})
