import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const origin = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const parsed = new URL(origin)
if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Os testes de pagamento recusam produção; use apenas HTTP loopback.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

const order = { id: 42, code: 'PED-LOCAL-42', total: 129.9, status: 'RECEIVED', payment_status: 'PENDING', customer_email: 'buyer@example.test' }
const configuration = { available: true, mode: 'test', public_key: 'PUBLIC-LOCAL-FIXTURE', methods: ['pix', 'credit_card', 'debit_card'] }
const pixPayment = { provider_reference: 'ORDLOCAL42', status: 'PENDING', provider_status: 'action_required', method: 'pix', qr_code: '000201PIX-LOCAL-ONLY', qr_code_base64: 'iVBORw0KGgo=', expires_at: '2030-01-01T12:00:00Z' }

async function fixture(t, { available = true, initialPayment = null, initialStatus = 'PENDING', sdk = true, deviceId, nonce, handle, width = 390, clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  if (deviceId !== undefined) await context.addInitScript(value => { window.MP_DEVICE_SESSION_ID = value }, deviceId)
  if (sdk) await context.addInitScript(({ sdkReady }) => {
    window.__mpSdkConfigurations = []
    window.MercadoPago = class {
      constructor(key, options) { this.key = key; this.options = options }
      cardForm(config) {
        window.__mpSdkConfigurations.push({ key: this.key, advancedFraudPrevention: this.options.advancedFraudPrevention, deviceProfileCspNonce: this.options.deviceProfileCspNonce, iframe: config.iframe, amount: config.amount, fields: Object.keys(config.form), secureFieldStyles: ['cardNumber', 'expirationDate', 'securityCode'].map(field => config.form[field].style) })
        for (const field of ['cardNumber', 'expirationDate', 'securityCode']) {
          const frame = document.createElement('iframe')
          frame.title = field
          frame.srcdoc = '<input aria-label="Campo seguro local" />'
          document.getElementById(config.form[field].id).append(frame)
        }
        const form = document.getElementById(config.form.id)
        const listener = event => config.callbacks.onSubmit(event)
        form.addEventListener('submit', listener)
        if (sdkReady) setTimeout(() => config.callbacks.onFormMounted(), 0)
        return {
          getCardFormData: () => ({ token: 'TOKEN-LOCAL-NOT-CARD-DATA', paymentMethodId: 'visa', identificationNumber: document.getElementById(config.form.identificationNumber.id).value }),
          unmount: () => {
            form.removeEventListener('submit', listener)
            for (const field of ['cardNumber', 'expirationDate', 'securityCode']) document.getElementById(config.form[field].id)?.replaceChildren()
          }
        }
      }
    }
  }, { sdkReady: sdk !== 'stalled' })
  const page = await context.newPage(), calls = [], errors = [], deviceRequests = []
  if (clock) await page.clock.install()
  let snapshot = { order: { ...order, payment_status: initialStatus }, payment: initialPayment }
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, []))
  await page.route('https://sdk.mercadopago.com/**', route => route.abort())
  // The SDK owns device collection; a second standalone collector must not load.
  await page.route('https://www.mercadopago.com/v2/security.js', route => {
    deviceRequests.push(route.request().url())
    return route.abort()
  })
  // Simulates the Netlify payment shell, which adds a per-request nonce to scripts.
  if (nonce) await page.route(origin + '/pagamento/42', async route => {
    const response = await route.fetch()
    return route.fulfill({ response, body: (await response.text()).replace(/<script\b/g, '<script nonce="' + nonce + '"') })
  })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const call = { path, method, body: method === 'POST' ? request.postDataJSON() : null, headers: request.headers() }
    calls.push(call)
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const response = await handle?.({ ...call, calls, snapshot, setSnapshot: value => { snapshot = value } })
    if (response) return json(response.data, response.status || 200)
    if (path === '/api/customer/me') return json({ authenticated: true, user: { id: 7, email: order.customer_email, name: 'Cliente local' }, csrfToken: 'csrf-local-fixture' })
    if (path === '/api/store/payments/config') return json({ ...configuration, available })
    if (path === '/api/store/postal-codes/01001000') return json({ postal_code: '01001000', street: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' })
    if (path === '/api/store/orders/42/payment' && method === 'GET') return json({ success: true, ...snapshot })
    if (path === '/api/store/orders/42/payment' && method === 'POST') {
      snapshot = { order: { ...order }, payment: { ...pixPayment } }
      return json({ success: true, ...snapshot })
    }
    if (path === '/api/store') return json({ products: [], categories: [] })
    if (path === '/api/store/home') return json({ sections: [] })
    if (path === '/api/store/home/settings') return json({ settings: {} })
    if (path === '/api/store/categories') return json([])
    return json({ error: 'API não prevista no teste local.' }, 404)
  })
  await page.goto(origin + '/pagamento/42')
  await page.getByRole('heading', { name: 'Pagamento', exact: true }).waitFor()
  return { page, calls, deviceRequests, setSnapshot: value => { snapshot = value } }
}

const paymentPosts = calls => calls.filter(call => call.path === '/api/store/orders/42/payment' && call.method === 'POST')

test('entrada da tela apenas consulta configuração e pedido, sem gerar cobrança', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cartão', exact: true }).click()
  await page.getByRole('button', { name: 'Pagar com cartão', exact: true }).waitFor()
  assert.equal(paymentPosts(calls).length, 0)
  assert.equal(calls.some(call => call.method !== 'GET'), false)
})

test('Pix usa CPF e tentativa estável; confirmação vem de consulta autenticada do pedido', async t => {
  const { page, calls, setSnapshot } = await fixture(t)
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Pix copia e cola').inputValue(), pixPayment.qr_code)
  const body = paymentPosts(calls)[0].body
  assert.deepEqual(Object.keys(body).sort(), ['attempt_id', 'identification', 'method', 'use_shipping_address'])
  assert.equal(body.use_shipping_address, true)
  assert.equal(body.method, 'pix')
  assert.equal(body.identification.number, '12345678909')
  assert.match(body.attempt_id, /^[a-f\d-]{36}$/)
  assert.equal(paymentPosts(calls)[0].headers['x-csrf-token'], 'csrf-local-fixture')
  setSnapshot({ order: { ...order, status: 'CONFIRMED', payment_status: 'APPROVED' }, payment: { ...pixPayment, status: 'APPROVED' } })
  await page.getByRole('button', { name: 'Conferir pagamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Pagamento aprovado', exact: true }).waitFor()
  assert.equal(paymentPosts(calls).length, 1)
  assert.equal(await page.getByRole('button', { name: 'Gerar Pix' }).count(), 0)
})

test('falha HTTP ambígua retoma mesmo corpo e attempt_id, sem nova cobrança lógica', async t => {
  let requests = 0
  const { page, calls } = await fixture(t, { handle: ({ path, method }) => {
    if (path === '/api/store/orders/42/payment' && method === 'POST' && ++requests === 1) return { status: 503, data: { error: 'Não foi possível confirmar a solicitação agora.' } }
  } })
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByText('Não foi possível confirmar a solicitação agora.', { exact: true }).waitFor()
  await page.getByLabel('CPF do comprador').fill('11144477735')
  await page.getByRole('button', { name: 'Retomar pagamento Pix', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.deepEqual(paymentPosts(calls)[0].body, paymentPosts(calls)[1].body)
})

test('identificador real do dispositivo é encaminhado sem entrar no armazenamento do navegador', async t => {
  const deviceId = 'LOCAL_PROVIDER_DEVICE_SESSION_42'
  const { page, calls, deviceRequests } = await fixture(t, { deviceId })
  assert.equal(await page.locator('script[src="https://www.mercadopago.com/v2/security.js"]').count(), 0)
  assert.equal(deviceRequests.length, 0)
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.equal(paymentPosts(calls)[0].body.device_id, deviceId)
  const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(' '))
  assert.equal(stored.includes(deviceId), false)
  assert.equal(stored.includes('12345678909'), false)
})

test('coletor de dispositivo do SDK recebe o nonce da página de pagamento', async t => {
  const nonce = 'TestNonceFromPaymentShell01'
  const { page, deviceRequests } = await fixture(t, { nonce })
  await page.getByRole('button', { name: 'Cartão', exact: true }).click()
  await page.getByRole('button', { name: 'Pagar com cartão', exact: true }).waitFor()
  const configuration = await page.evaluate(() => window.__mpSdkConfigurations.at(-1))
  assert.equal(configuration.advancedFraudPrevention, true)
  assert.equal(configuration.deviceProfileCspNonce, nonce)
  assert.equal(deviceRequests.length, 0)
})

test('identificador inválido não é encaminhado nem substituído por um valor inventado', async t => {
  const { page, calls } = await fixture(t, { deviceId: 'invalid session\nvalue' })
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.equal(Object.hasOwn(paymentPosts(calls)[0].body, 'device_id'), false)
})

test('endereço próprio usa o CEP e só permite envio depois de completar os dados do comprador', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('checkbox', { name: 'Endereço do comprador é o mesmo da entrega' }).uncheck()
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Confira o endereço do comprador antes de pagar.' }).waitFor()
  assert.equal(paymentPosts(calls).length, 0)
  await page.getByLabel('CEP do comprador', { exact: true }).fill('01001000')
  await page.getByText('CEP localizado. Confira o endereço e complete o número e o complemento, se houver.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Rua do comprador', { exact: true }).inputValue(), 'Praça da Sé')
  assert.equal(await page.getByLabel('Cidade do comprador', { exact: true }).inputValue(), 'São Paulo')
  assert.equal(await page.getByLabel('Estado do comprador', { exact: true }).inputValue(), 'SP')
  await page.getByLabel('Número do comprador', { exact: true }).fill('15')
  await page.getByLabel('Complemento do comprador', { exact: true }).fill('Loja 2')
  const geometry = await page.getByLabel('Rua do comprador', { exact: true }).evaluate(element => ({ font: parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height, width: document.documentElement.scrollWidth, viewport: innerWidth }))
  assert.ok(geometry.font >= 16 && geometry.height >= 50 && geometry.width <= geometry.viewport)
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.equal(paymentPosts(calls)[0].body.use_shipping_address, false)
  assert.deepEqual(paymentPosts(calls)[0].body.billing_address, { zip_code: '01001000', street_name: 'Praça da Sé', street_number: '15', city: 'São Paulo', state: 'SP', neighborhood: 'Sé', complement: 'Loja 2' })
})

test('retomada incerta mantém endereço e dispositivo originais mesmo depois de atualizar o SDK', async t => {
  let requests = 0
  const { page, calls } = await fixture(t, { deviceId: 'LOCAL_DEVICE_BEFORE_RETRY', handle: ({ path, method }) => {
    if (path === '/api/store/orders/42/payment' && method === 'POST' && ++requests === 1) return { status: 503, data: { error: 'Confirmação ainda pendente.' } }
  } })
  await page.getByRole('checkbox', { name: 'Endereço do comprador é o mesmo da entrega' }).uncheck()
  await page.getByLabel('CEP do comprador', { exact: true }).fill('01001000')
  await page.getByText('CEP localizado. Confira o endereço e complete o número e o complemento, se houver.', { exact: true }).waitFor()
  await page.getByLabel('Número do comprador', { exact: true }).fill('15')
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Confirmação ainda pendente.' }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: 'Endereço do comprador é o mesmo da entrega' }).isDisabled(), true)
  assert.equal(await page.getByLabel('Rua do comprador', { exact: true }).isDisabled(), true)
  await page.evaluate(() => { window.MP_DEVICE_SESSION_ID = 'LOCAL_DEVICE_AFTER_RETRY' })
  await page.getByRole('button', { name: 'Retomar pagamento Pix', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.deepEqual(paymentPosts(calls)[0].body, paymentPosts(calls)[1].body)
  assert.equal(paymentPosts(calls)[1].body.device_id, 'LOCAL_DEVICE_BEFORE_RETRY')
})

test('recusa definitiva permite nova tentativa com outro identificador', async t => {
  let requests = 0
  const { page, calls } = await fixture(t, { handle: ({ path, method }) => {
    if (path === '/api/store/orders/42/payment' && method === 'POST' && ++requests === 1) return { data: { order: { ...order, payment_status: 'REJECTED' }, payment: { ...pixPayment, status: 'REJECTED' } } }
  } })
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByText('O pagamento não foi aprovado. Confira os dados ou escolha outra forma de pagamento.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.notEqual(paymentPosts(calls)[0].body.attempt_id, paymentPosts(calls)[1].body.attempt_id)
})

test('cartão monta três iframes e envia token e metadados sem dados brutos do cartão', async t => {
  const { page, calls } = await fixture(t, { deviceId: 'LOCAL_PROVIDER_CARD_DEVICE' })
  await page.getByRole('button', { name: 'Cartão', exact: true }).click()
  await page.getByRole('button', { name: 'Pagar com cartão', exact: true }).waitFor()
  await page.getByLabel('Nome no cartão', { exact: true }).fill('APRO')
  await page.getByLabel('CPF do titular', { exact: true }).fill('12345678909')
  await page.getByRole('button', { name: 'Pagar com cartão', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  const body = paymentPosts(calls)[0].body
  assert.equal(body.method, 'credit_card')
  assert.equal(body.token, 'TOKEN-LOCAL-NOT-CARD-DATA')
  assert.equal(body.payment_method_id, 'visa')
  assert.equal(body.installments, 1)
  assert.equal(body.identification.number, '12345678909')
  assert.equal(body.device_id, 'LOCAL_PROVIDER_CARD_DEVICE')
  assert.equal(body.use_shipping_address, true)
  assert.equal(['card_number', 'security_code', 'expiration_month', 'expiration_year', 'amount', 'email', 'issuer_id'].some(key => Object.hasOwn(body, key)), false)
  const configuration = await page.evaluate(() => window.__mpSdkConfigurations.at(-1))
  assert.equal(configuration.iframe, true)
  assert.equal(configuration.advancedFraudPrevention, true)
  assert.equal(configuration.deviceProfileCspNonce, undefined)
  assert.equal(configuration.amount, '129.90')
  for (const field of ['issuer', 'installments', 'identificationType']) assert.ok(configuration.fields.includes(field))
  for (const style of configuration.secureFieldStyles) {
    assert.equal(style.fontSize, '16px')
    assert.equal(style.color, '#111111')
    assert.equal(style.height, '100%')
  }
})

test('falha do SDK é visível e impede envio de cartão', async t => {
  const { page, calls } = await fixture(t, { sdk: false })
  await page.getByRole('button', { name: 'Cartão', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Não foi possível abrir os campos seguros do cartão.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Pagar com cartão', exact: true }).isDisabled(), true)
  assert.equal(paymentPosts(calls).length, 0)
})

test('configuração desativada não monta SDK nem oferece cobrança', async t => {
  const { page, calls, deviceRequests } = await fixture(t, { available: false })
  await page.getByText('O pagamento online ainda está sendo preparado pela loja. Você pode acompanhar seu pedido na sua conta.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Gerar Pix' }).count(), 0)
  assert.equal(paymentPosts(calls).length, 0)
  assert.deepEqual(await page.evaluate(() => window.__mpSdkConfigurations), [])
  assert.equal(deviceRequests.length, 0)
})

test('SDK com iframes incompletos exibe falha em vez de carregar indefinidamente', async t => {
  const { page, calls } = await fixture(t, { sdk: 'stalled', clock: true })
  await page.getByRole('button', { name: 'Cartão', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.mp-secure-input iframe').length === 3)
  await page.clock.runFor(8000)
  await page.getByRole('alert').filter({ hasText: 'Não foi possível abrir os campos seguros do cartão.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Pagar com cartão', exact: true }).isDisabled(), true)
  assert.equal(paymentPosts(calls).length, 0)
})

test('pagamento pendente retoma após reload e polling não cria nova cobrança', async t => {
  const { page, calls, setSnapshot } = await fixture(t, { initialPayment: pixPayment, clock: true })
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  setSnapshot({ order: { ...order, payment_status: 'APPROVED' }, payment: { ...pixPayment, status: 'APPROVED' } })
  await page.clock.runFor(9000)
  await page.getByRole('heading', { name: 'Pagamento aprovado', exact: true }).waitFor()
  assert.equal(paymentPosts(calls).length, 0)
})

test('challenge aceita somente HTTPS do Mercado Pago e nunca HTML do provedor', async t => {
  const { page, calls, setSnapshot } = await fixture(t, { initialPayment: { ...pixPayment, qr_code: '', qr_code_base64: '', redirect_url: 'https://mercadopago.com.br.attacker.invalid/3ds' } })
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Confirmar no Mercado Pago' }).count(), 0)
  setSnapshot({ order, payment: { ...pixPayment, qr_code: '', qr_code_base64: '', redirect_url: 'https://www.mercadopago.com.br/3ds/local-fixture' } })
  await page.getByRole('button', { name: 'Conferir pagamento', exact: true }).click()
  assert.equal(await page.getByRole('link', { name: 'Confirmar no Mercado Pago', exact: true }).getAttribute('href'), 'https://www.mercadopago.com.br/3ds/local-fixture')
  assert.equal(paymentPosts(calls).length, 0)
})

test('campos permanecem legíveis sem overflow em 390px', async t => {
  const { page } = await fixture(t)
  const field = page.getByLabel('CPF do comprador')
  await field.waitFor()
  const geometry = await field.evaluate(element => ({ font: parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height, width: document.documentElement.scrollWidth, viewport: innerWidth }))
  assert.ok(geometry.font >= 16)
  assert.ok(geometry.height >= 50)
  assert.ok(geometry.width <= geometry.viewport)
})

test('tentativa de débito ambígua é restaurada pelo servidor sem permitir trocar o tipo', async t => {
  const attemptId = 'e3d6c278-0766-442c-922a-8aee7e0c4719'
  const { page, calls } = await fixture(t, { initialPayment: { provider_reference: '', status: 'PENDING', method: 'debit_card', attempt_id: attemptId, awaiting_confirmation: true } })
  await page.getByRole('button', { name: 'Retomar pagamento com cartão', exact: true }).waitFor()
  assert.equal(await page.getByRole('radio', { name: 'Débito', exact: true }).isChecked(), true)
  assert.equal(await page.getByRole('radio', { name: 'Crédito', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Pix', exact: true }).isDisabled(), true)
  await page.getByLabel('Nome no cartão', { exact: true }).fill('APRO')
  await page.getByLabel('CPF do titular', { exact: true }).fill('12345678909')
  await page.getByRole('button', { name: 'Retomar pagamento com cartão', exact: true }).click()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.equal(paymentPosts(calls)[0].body.method, 'debit_card')
  assert.equal(paymentPosts(calls)[0].body.attempt_id, attemptId)
})

test('tentativa cancelada pode ser retomada se o pedido continuar aberto', async t => {
  const { page, calls } = await fixture(t, { initialStatus: 'CANCELLED', initialPayment: { ...pixPayment, status: 'CANCELLED' } })
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Pedido cancelado' }).count(), 0)
  assert.equal(paymentPosts(calls).length, 0)
})

test('falha ao trocar de pedido não deixa o formulário do pedido anterior visível', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).waitFor()
  await page.evaluate(() => {
    history.pushState({}, '', '/pagamento/43')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.getByRole('alert').filter({ hasText: 'API não prevista no teste local.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Gerar Pix', exact: true }).count(), 0)
  assert.equal(paymentPosts(calls).length, 0)
})

test('resposta atrasada de outro pedido não libera o envio atual', async t => {
  let releaseFirst, releaseSecond, secondStarted = false
  const first = new Promise(resolve => { releaseFirst = resolve })
  const second = new Promise(resolve => { releaseSecond = resolve })
  t.after(() => { releaseFirst(); releaseSecond() })
  const { page, calls } = await fixture(t, { handle: async ({ path, method }) => {
    if (path === '/api/store/orders/42/payment' && method === 'POST') {
      await first
      return { data: { order, payment: pixPayment } }
    }
    if (path === '/api/store/orders/43/payment' && method === 'GET') return { data: { order: { ...order, id: 43, code: 'PED-LOCAL-43' }, payment: null } }
    if (path === '/api/store/orders/43/payment' && method === 'POST') {
      secondStarted = true
      await second
      return { data: { order: { ...order, id: 43, code: 'PED-LOCAL-43' }, payment: { ...pixPayment, provider_reference: 'ORDLOCAL43' } } }
    }
  } })
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('button', { name: 'Gerando Pix…', exact: true }).waitFor()
  await page.evaluate(() => { history.pushState({}, '', '/pagamento/43'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.getByText('PED-LOCAL-43', { exact: true }).waitFor()
  await page.getByLabel('CPF do comprador').fill('12345678909')
  await page.getByRole('button', { name: 'Gerar Pix', exact: true }).click()
  await page.getByRole('button', { name: 'Gerando Pix…', exact: true }).waitFor()
  assert.equal(secondStarted, true)
  const firstResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/store/orders/42/payment' && response.request().method() === 'POST')
  releaseFirst()
  await firstResponse
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.locator('.mp-payment-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await page.getByRole('button', { name: 'Gerando Pix…', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Gerando Pix…', exact: true }).isDisabled(), true)
  releaseSecond()
  await page.getByRole('heading', { name: 'Aguardando pagamento', exact: true }).waitFor()
  assert.equal(calls.filter(call => call.path === '/api/store/orders/43/payment' && call.method === 'POST').length, 1)
})
