import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const origin = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
if (new URL(origin).protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Os testes do registro de erros recusam produção.')
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }) })
after(async () => { await browser?.close() })

const events = [
  { id: 2, created_at: '2026-11-06T22:30:00.000Z', method: 'POST', route: '/api/store/orders/:id/payment', status: 503, code: 'ER_LOCK_WAIT_TIMEOUT', context: 'Erro no pagamento:', request_id: '01JREQLOCAL2' },
  { id: 1, created_at: '2026-11-06T21:00:00.000Z', method: 'GET', route: '/api/store', status: 500, code: null, context: null, request_id: null }
]

async function fixture(t, { role = 'owner', list = events, width = 1366 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, []))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, email: 'owner@example.invalid', role }, csrfToken: 'local-errors-csrf' })
    if (path === '/api/admin/error-events') return json({ available: true, retention_days: 30, events: list })
    if (path === '/api/admin/dashboard') return json({ products: { count: 0, active_count: 0, stock: 0, low_stock: 0 }, sales: { count: 0, total: 0 }, income: 0, expense: 0 })
    if (path === '/api/store/home/settings') return json({ settings: [] })
    if (path === '/api/store/home' || path === '/api/admin/home') return json({ sections: [] })
    if (path === '/api/store') return json({ products: [], categories: [] })
    return json([])
  })
  return { page, calls }
}

test('dono vê os erros recentes com rota, código e requisição, sem dados de cliente', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin?tab=errors')
  await page.getByRole('heading', { name: 'Erros recentes', exact: true }).waitFor()
  const rows = page.locator('.admin-error-events tbody tr')
  assert.equal(await rows.count(), 2)
  assert.match(await rows.first().innerText(), /POST \/api\/store\/orders\/:id\/payment[\s\S]*503[\s\S]*ER_LOCK_WAIT_TIMEOUT[\s\S]*Erro no pagamento:[\s\S]*01JREQLOCAL2/)
  assert.match(await rows.nth(1).innerText(), /GET \/api\/store[\s\S]*500[\s\S]*—/)
  assert.match(await page.locator('.admin-error-events').innerText(), /últimos 30 dias/)
  const loads = () => calls.filter(path => path === '/api/admin/error-events').length
  const before = loads()
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.admin-error-events button')?.textContent === 'Atualizar')
  assert.equal(loads(), before + 1)
  assert.equal(await page.getByRole('button', { name: 'Erros recentes', exact: true }).count(), 1)
})

test('sem erros, a tela informa que está tudo certo e cabe no celular', async t => {
  const { page } = await fixture(t, { list: [], width: 390 })
  await page.goto(origin + '/admin?tab=errors')
  await page.getByRole('status').filter({ hasText: 'Nenhum erro registrado' }).waitFor()
  assert.equal(await page.locator('.admin-error-events table').count(), 0)
})

test('a aba de erros não aparece para quem não é dono', async t => {
  const { page, calls } = await fixture(t, { role: 'staff' })
  await page.goto(origin + '/admin?tab=errors')
  await page.waitForTimeout(800)
  assert.equal(await page.getByRole('button', { name: 'Erros recentes', exact: true }).count(), 0)
  assert.equal(calls.includes('/api/admin/error-events'), false)
})
