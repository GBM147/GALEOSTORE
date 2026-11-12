import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const parsedUrl = new URL(baseUrl)
if (parsedUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname)) throw new Error('Os testes de CEP recusam produção; use HTTP loopback.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

const address = { postal_code: '01001000', street: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' }
const product = { id: 31, name: 'Camiseta local', price: 80, stock: 5, active: 1, image: '' }

async function fixture(t, { postalResponse, anonymous = false, ignoreAbort = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 950 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  await context.addInitScript(({ cart, ignoreAbort }) => {
    localStorage.setItem('galeo-cart-v2', JSON.stringify(cart))
    if (ignoreAbort) {
      const original = window.fetch
      window.fetch = (url, options) => original(url, String(url).includes('/api/store/postal-codes/') ? { ...options, signal: undefined } : options)
    }
  }, { cart: [{ id: 31, quantity: 1 }], ignoreAbort })
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, []))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    calls.push({ path, method, body: request.postData() ? request.postDataJSON() : null })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {})
    if (path === '/api/store') return json({ products: [product], categories: [] })
    if (path === '/api/store/home') return json({ sections: [] })
    if (path === '/api/store/home/settings') return json({ settings: {} })
    if (path === '/api/customer/me') return json(anonymous ? { authenticated: false } : { authenticated: true, user: { id: 7, name: 'Cliente local', phone: '11999999999' }, csrfToken: 'local-csrf' })
    if (path === '/api/store/shipping/config') return json({ configured: false, connected: false, available: false })
    if (path.startsWith('/api/store/postal-codes/')) return postalResponse ? postalResponse({ path, postalCode: path.split('/').at(-1), json }) : json(address)
    if (path === '/api/store/orders' && method === 'POST') return json({ success: true, payment_configured: false, order: { id: 71, code: 'LOCAL-CEP' } })
    return json({ error: 'API não prevista no teste local.' }, 404)
  })
  await page.goto(baseUrl + '/carrinho')
  await page.getByRole('heading', { name: 'Seu carrinho', exact: true }).waitFor()
  return { page, calls }
}

const postalCalls = calls => calls.filter(call => call.path.startsWith('/api/store/postal-codes/'))
const value = (page, label) => page.getByLabel(label, { exact: true }).inputValue()
async function frame(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }

test('CEP completo preenche endereço sem alterar dados pessoais, número e complemento ou calcular frete', async t => {
  const { page, calls } = await fixture(t)
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa local')
  await page.getByLabel('Telefone', { exact: true }).fill('11988887777')
  await page.getByLabel('Número', { exact: true }).fill('42A')
  await page.getByLabel('Complemento', { exact: true }).fill('Fundos')
  await page.getByLabel('CEP', { exact: true }).fill('01001000')
  await page.locator('#postal-code-address-status').filter({ hasText: 'CEP localizado.' }).waitFor()
  for (const [label, expected] of [['CEP', '01001-000'], ['Rua', address.street], ['Bairro', address.neighborhood], ['Cidade', address.city], ['Estado', address.state], ['Nome', 'Pessoa local'], ['Telefone', '11988887777'], ['Número', '42A'], ['Complemento', 'Fundos']]) assert.equal(await value(page, label), expected)
  assert.deepEqual(postalCalls(calls).map(call => [call.path, call.method]), [['/api/store/postal-codes/01001000', 'GET']])
  assert.equal(calls.some(call => call.method === 'POST'), false)
})

test('CEP incompleto não consulta e repetição do mesmo CEP formatado não repete a busca', async t => {
  const { page, calls } = await fixture(t)
  await page.getByLabel('CEP', { exact: true }).fill('0100100')
  await page.waitForTimeout(380)
  assert.equal(postalCalls(calls).length, 0)
  await page.getByLabel('CEP', { exact: true }).fill('01001000')
  await page.locator('#postal-code-address-status').filter({ hasText: 'CEP localizado.' }).waitFor()
  await page.getByLabel('CEP', { exact: true }).fill('01001-000')
  await page.waitForTimeout(380)
  assert.equal(postalCalls(calls).length, 1)
})

test('edições manuais durante debounce ou consulta prevalecem sobre os dados recebidos', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const { page } = await fixture(t, { postalResponse: async ({ json }) => { await pending; return json(address) } })
  const requested = page.waitForRequest(request => request.url().includes('/api/store/postal-codes/'))
  await page.getByLabel('CEP', { exact: true }).fill('01001000')
  await page.getByLabel('Rua', { exact: true }).fill('Rua corrigida manualmente')
  await requested
  await page.getByLabel('Estado', { exact: true }).fill('rj')
  release()
  await page.locator('#postal-code-address-status').filter({ hasText: 'CEP localizado.' }).waitFor()
  assert.equal(await value(page, 'Rua'), 'Rua corrigida manualmente')
  assert.equal(await value(page, 'Estado'), 'RJ')
  assert.equal(await value(page, 'Cidade'), address.city)
  assert.equal(await value(page, 'Bairro'), address.neighborhood)
})

test('resposta antiga é ignorada mesmo quando o transporte não respeita abort', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const next = { postal_code: '20040002', street: 'Rua da Assembleia', neighborhood: 'Centro', city: 'Rio de Janeiro', state: 'RJ' }
  const { page } = await fixture(t, { ignoreAbort: true, postalResponse: async ({ postalCode, json }) => {
    if (postalCode === address.postal_code) { await pending; return json(address) }
    return json(next)
  } })
  const requested = page.waitForRequest(request => request.url().includes('/api/store/postal-codes/' + address.postal_code))
  await page.getByLabel('CEP', { exact: true }).fill(address.postal_code)
  await requested
  await page.getByLabel('CEP', { exact: true }).fill(next.postal_code)
  await page.locator('#postal-code-address-status').filter({ hasText: 'CEP localizado.' }).waitFor()
  assert.equal(await value(page, 'Cidade'), next.city)
  const response = page.waitForResponse(response => response.url().includes('/api/store/postal-codes/' + address.postal_code))
  release()
  await response
  await frame(page)
  for (const [label, expected] of [['Rua', next.street], ['Bairro', next.neighborhood], ['Cidade', next.city], ['Estado', next.state]]) assert.equal(await value(page, label), expected)
})

test('alterar CEP limpa somente os valores automáticos antigos e preserva correções manuais', async t => {
  const { page } = await fixture(t)
  await page.getByLabel('CEP', { exact: true }).fill(address.postal_code)
  await page.locator('#postal-code-address-status').filter({ hasText: 'CEP localizado.' }).waitFor()
  await page.getByLabel('Rua', { exact: true }).fill('Rua manual')
  await page.getByLabel('Número', { exact: true }).fill('20')
  await page.getByLabel('Complemento', { exact: true }).fill('Casa')
  await page.getByLabel('CEP', { exact: true }).fill('12')
  assert.equal(await value(page, 'Rua'), 'Rua manual')
  for (const label of ['Bairro', 'Cidade', 'Estado']) assert.equal(await value(page, label), '')
  for (const [label, expected] of [['Nome', 'Cliente local'], ['Telefone', '11999999999'], ['Número', '20'], ['Complemento', 'Casa']]) assert.equal(await value(page, label), expected)
})

test('CEP genérico preenche cidade/UF e permite completar rua e bairro', async t => {
  const { page } = await fixture(t, { postalResponse: ({ json }) => json({ ...address, street: '', neighborhood: '' }) })
  await page.getByLabel('CEP', { exact: true }).fill(address.postal_code)
  await page.getByText('CEP localizado. Complete os campos de endereço que ficaram em branco.', { exact: true }).waitFor()
  assert.equal(await value(page, 'Rua'), '')
  assert.equal(await value(page, 'Bairro'), '')
  assert.equal(await value(page, 'Cidade'), address.city)
  assert.equal(await value(page, 'Estado'), address.state)
  await page.getByLabel('Rua', { exact: true }).fill('Rua local')
  await page.getByLabel('Bairro', { exact: true }).fill('Bairro local')
  assert.equal(await value(page, 'Rua'), 'Rua local')
})

test('CEP genérico não apaga rua manual que o serviço não informa', async t => {
  const { page } = await fixture(t, { postalResponse: ({ json }) => json({ ...address, street: '', neighborhood: '' }) })
  await page.getByLabel('Rua', { exact: true }).fill('Rua informada pelo cliente')
  await page.getByLabel('CEP', { exact: true }).fill(address.postal_code)
  await page.getByText('CEP localizado. Complete os campos de endereço que ficaram em branco.', { exact: true }).waitFor()
  assert.equal(await value(page, 'Rua'), 'Rua informada pelo cliente')
  assert.equal(await value(page, 'Cidade'), address.city)
  assert.equal(await value(page, 'Estado'), address.state)
})

test('falha da busca permite preencher e enviar endereço manualmente sem reservar frete automaticamente', async t => {
  const { page, calls } = await fixture(t, { postalResponse: ({ json }) => json({ error: 'Serviço temporariamente indisponível.' }, 503) })
  await page.getByLabel('CEP', { exact: true }).fill(address.postal_code)
  await page.getByText('Não foi possível buscar o endereço agora. Você pode preenchê-lo manualmente.', { exact: true }).waitFor()
  for (const [label, entry] of [['Rua', 'Rua manual'], ['Bairro', 'Centro'], ['Cidade', 'São Paulo'], ['Estado', 'SP'], ['Número', '1']]) await page.getByLabel(label, { exact: true }).fill(entry)
  await page.getByRole('checkbox', { name: /Li e concordo com os Termos/ }).check()
  await page.getByRole('button', { name: 'Solicitar pedido ↗', exact: true }).click()
  await page.getByRole('heading', { name: 'Pedido recebido', exact: true }).waitFor()
  const created = calls.filter(call => call.method === 'POST')
  assert.equal(created.length, 1)
  assert.equal(created[0].path, '/api/store/orders')
  assert.equal(created[0].body.shipping.street, 'Rua manual')
  assert.equal(created[0].body.shipping.city, 'São Paulo')
})

test('CEP não encontrado ou resposta inconsistente não insere endereço de outro CEP', async t => {
  for (const variant of ['missing', 'wrong-postal-code']) {
    const { page } = await fixture(t, { postalResponse: ({ json }) => variant === 'missing' ? json({ error: 'CEP não encontrado.' }, 404) : json({ ...address, postal_code: '22222222' }) })
    await page.getByLabel('CEP', { exact: true }).fill(address.postal_code)
    await page.locator('#postal-code-address-status').filter({ hasText: variant === 'missing' ? 'CEP não encontrado.' : 'Não foi possível buscar' }).waitFor()
    for (const label of ['Rua', 'Bairro', 'Cidade', 'Estado']) assert.equal(await value(page, label), '')
    assert.equal(await page.getByRole('button', { name: 'Solicitar pedido ↗', exact: true }).isEnabled(), true)
  }
})

test('consulta de endereço funciona antes do login sem iniciar cotação ou pedido', async t => {
  const { page, calls } = await fixture(t, { anonymous: true })
  await page.getByLabel('CEP', { exact: true }).fill(address.postal_code)
  await page.locator('#postal-code-address-status').filter({ hasText: 'CEP localizado.' }).waitFor()
  assert.equal(await page.locator('.checkout-form').count(), 0)
  assert.equal(postalCalls(calls).length, 1)
  assert.equal(calls.some(call => call.method === 'POST'), false)
})
