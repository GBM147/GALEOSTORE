import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const origin = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const address = new URL(origin)
if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('Admin workflow browser tests refuse production.')
let browser
before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

const products = [
  { id:201, name:'Camiséta pesquisável', brand:'Nike', category:'Camisetas', category_id:1, active:1, stock:4, min_stock:0, price:50, cost:20, variants:[] },
  { id:202, name:'Calça da coleção', brand:'Outra marca', category:'Calças', category_id:2, active:1, stock:3, min_stock:0, price:100, cost:40, variants:[] }
]
const movements = products.map((product, index) => ({ id:index + 1, product_id:product.id, product:product.name, type:'ENTRADA', quantity:product.stock, stock_before:0, stock_after:product.stock, reason:'Estoque inicial', created_at:'2026-10-26' }))

async function fixture(t, { expenses = [], recurring = [], failExpenses = false } = {}) {
  const context = await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:'reduce' })
  t.after(() => context.close())
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  const state = { expenses:[...expenses], recurring:[...recurring], failExpenses }
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user:{ id:1, email:'owner@example.test', role:'owner' }, csrfToken:'local-csrf' })
    if (path === '/api/store/categories') return json([{ id:1, name:'Camisetas' }, { id:2, name:'Calças' }])
    if (path === '/api/store') return json({ products, categories:[] })
    if (path === '/api/store/home' || path === '/api/admin/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[] })
    if (path === '/api/admin/products') return json(products)
    if (path === '/api/admin/stock/movements') return json(movements)
    if (path === '/api/admin/dashboard') return json({ products:{ count:2, active_count:1, stock:7, low_stock:0 }, sales:{ count:0, total:0 }, income:0, expense:0 })
    if (path === '/api/admin/sales' || path === '/api/admin/store-orders') return json([])
    if (path === '/api/admin/expenses' && method === 'GET') {
      if (state.failExpenses) { state.failExpenses = false; return json({ error:'Não foi possível carregar a conta de gastos.' }, 503) }
      // Expose regressions where a background reload unmounts the whole panel.
      await new Promise(resolve => setTimeout(resolve, 180))
      return json(state.expenses)
    }
    if (path === '/api/admin/expenses' && method === 'POST') {
      const expense = { ...body, id:1000 + state.expenses.length }
      state.expenses.unshift(expense)
      return json(expense, 201)
    }
    if (path.startsWith('/api/admin/expenses/') && method === 'DELETE') {
      state.expenses = state.expenses.filter(row => row.id !== Number(path.split('/').at(-1)))
      return json({ success:true })
    }
    if (path === '/api/admin/finance/recurring' && method === 'GET') return json(state.recurring)
    if (path === '/api/admin/finance/recurring' && method === 'POST') {
      const recurring = { ...body, id:100 + state.recurring.length, active:1, current_month_recorded:false }
      state.recurring.push(recurring)
      return json(recurring, 201)
    }
    const record = path.match(/^\/api\/admin\/finance\/recurring\/(\d+)\/record$/)
    if (record && method === 'POST') {
      const recurring = state.recurring.find(row => row.id === Number(record[1]))
      recurring.current_month_recorded = true
      state.expenses.push({ id:2000, description:recurring.description, amount:recurring.amount, date:body.date })
      return json({ success:true, existing:false }, 201)
    }
    const remove = path.match(/^\/api\/admin\/finance\/recurring\/(\d+)$/)
    if (remove && method === 'DELETE') {
      state.recurring = state.recurring.filter(row => row.id !== Number(remove[1]))
      return json({ success:true })
    }
    return json([])
  })
  t.after(() => assert.deepEqual(errors, [], 'the actual React workflow must not throw JavaScript errors'))
  return { page, calls, state }
}

const dataCalls = calls => calls.filter(call => call.path.startsWith('/api/admin/') && call.method === 'GET').map(call => call.path)

test('dashboard shows published products separately from the preserved total count', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin')
  const metric = page.locator('.metric').filter({ hasText:'Produtos no catálogo' })
  await metric.waitFor()
  assert.equal(await metric.locator('strong').innerText(), '1')
  assert.deepEqual(dataCalls(calls), ['/api/admin/dashboard'])
})

test('sales is a history without a second registration form; Frente de caixa opens directly and persists in the URL', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin?tab=sales')
  await page.getByRole('heading', { name:'Histórico de vendas', exact:true }).waitFor()
  await page.getByText('Nenhuma venda registrada.', { exact:true }).waitFor()
  assert.equal(await page.getByRole('button', { name:/Registrar venda/ }).count(), 0)
  assert.deepEqual(dataCalls(calls), ['/api/admin/sales'])
  await page.getByRole('button', { name:'Frente de caixa', exact:true }).click()
  await page.getByRole('heading', { name:'Frente de caixa', exact:true }).first().waitFor()
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'pdv')
  await page.reload()
  await page.getByRole('heading', { name:'Frente de caixa', exact:true }).first().waitFor()
  assert.equal(new URL(page.url()).searchParams.get('tab'), 'pdv')
  assert.equal(dataCalls(calls).some(path => path.includes('finance') || path.includes('expenses') || path.includes('store-orders')), false)
})

test('expenses use only description, amount and date and reload without unmounting or jumping to page end', async t => {
  const expenses = Array.from({ length:60 }, (_, index) => ({ id:index + 1, description:'Gasto anterior ' + index, amount:20, date:'2026-10-20' }))
  const { page, calls } = await fixture(t, { expenses })
  await page.goto(origin + '/admin?tab=finance')
  await page.getByText('Gasto anterior 59', { exact:true }).waitFor()
  assert.deepEqual(dataCalls(calls), ['/api/admin/expenses'])
  await page.locator('.admin-panel').evaluate(panel => { panel.dataset.reloadSentinel = 'kept' })
  await page.getByRole('button', { name:'+ Registrar gasto', exact:true }).click()
  const modal = page.getByRole('dialog', { name:'Registrar gasto', exact:true })
  assert.equal(await modal.locator('input').count(), 3)
  assert.equal(await modal.locator('select').count(), 0)
  await modal.getByLabel('Descrição do gasto', { exact:true }).fill('Embalagens reais')
  await modal.getByLabel('Valor gasto', { exact:true }).fill('45.90')
  await page.evaluate(() => window.scrollTo(0, 1400))
  const before = await page.evaluate(() => window.scrollY)
  await modal.getByRole('button', { name:'Salvar gasto', exact:true }).click()
  await modal.waitFor({ state:'detached' })
  await page.waitForFunction(() => document.querySelector('tbody')?.textContent.includes('Embalagens reais'))
  assert.equal(await page.locator('.admin-panel').getAttribute('data-reload-sentinel'), 'kept')
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - before) < 200, 'saving must retain the current area of the page')
  const created = calls.find(call => call.path === '/api/admin/expenses' && call.method === 'POST')
  assert.deepEqual(Object.keys(created.body).sort(), ['amount','date','description'])
  assert.equal(created.body.amount, 45.9)
  assert.equal(await page.getByRole('columnheader', { name:/Tipo|Categoria|Conta|Status/ }).count(), 0)
})

test('recurring expenses register once for the month and can be removed without removing the recorded expense', async t => {
  const { page, calls, state } = await fixture(t, { recurring:[{ id:9, description:'Aluguel da loja', amount:1000, due_day:10, active:1, current_month_recorded:false }] })
  await page.goto(origin + '/admin?tab=recurring')
  const row = page.getByRole('row').filter({ hasText:'Aluguel da loja' })
  await row.getByRole('button', { name:'Registrar gasto', exact:true }).click()
  await row.getByRole('button', { name:'Registrado neste mês', exact:true }).waitFor()
  assert.equal(await row.getByRole('button', { name:'Registrado neste mês', exact:true }).isDisabled(), true)
  await row.getByRole('button', { name:'Remover', exact:true }).click()
  await page.getByText('Nenhum gasto recorrente cadastrado.', { exact:true }).waitFor()
  assert.equal(state.expenses.length, 1)
  assert.equal(state.expenses[0].description, 'Aluguel da loja')
  assert.equal(calls.filter(call => call.path.endsWith('/9/record')).length, 1)
  assert.equal(calls.filter(call => call.path.endsWith('/recurring/9') && call.method === 'DELETE').length, 1)
  assert.equal(calls.some(call => call.path.startsWith('/api/admin/expenses/') && call.method === 'DELETE'), false)
})

test('recurring expense registration omits duplicate account and category fields', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin?tab=recurring')
  await page.getByRole('button', { name:'+ Novo gasto recorrente', exact:true }).click()
  const modal = page.getByRole('dialog', { name:'Novo gasto recorrente', exact:true })
  assert.equal(await modal.locator('input').count(), 3)
  assert.equal(await modal.locator('select').count(), 0)
  await modal.getByLabel('Descrição do gasto', { exact:true }).fill('Internet')
  await modal.getByLabel('Valor mensal', { exact:true }).fill('99.90')
  await modal.getByLabel('Dia habitual do gasto', { exact:true }).fill('15')
  await modal.getByRole('button', { name:'Salvar gasto recorrente', exact:true }).click()
  await modal.waitFor({ state:'detached' })
  await page.getByRole('cell', { name:'Internet', exact:true }).waitFor()
  const created = calls.find(call => call.path === '/api/admin/finance/recurring' && call.method === 'POST')
  assert.deepEqual(Object.keys(created.body).sort(), ['amount','description','due_day'])
})

test('stock history can search products by name, brand or code and filter the movements', async t => {
  const { page, calls } = await fixture(t)
  await page.goto(origin + '/admin?tab=movements')
  await page.getByRole('cell', { name:'Calça da coleção', exact:true }).waitFor()
  const search = page.getByRole('combobox', { name:'Pesquisar produto no histórico', exact:true })
  await search.fill('nike')
  await page.getByRole('option', { name:/Camiséta pesquisável/ }).click()
  assert.equal(await page.getByRole('cell', { name:'Calça da coleção', exact:true }).count(), 0)
  await search.fill('202')
  await page.getByRole('option', { name:/Calça da coleção/ }).click()
  await page.getByRole('cell', { name:'Calça da coleção', exact:true }).waitFor()
  assert.equal(await page.getByRole('cell', { name:'Camiséta pesquisável', exact:true }).count(), 0)
  await page.setViewportSize({ width:390, height:844 })
  await search.fill('camiseta')
  const option = page.getByRole('option', { name:/Camiséta pesquisável/ })
  await option.waitFor()
  const bounds = await option.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'product search must remain usable on mobile')
  assert.deepEqual(dataCalls(calls).sort(), ['/api/admin/products','/api/admin/stock/movements'].sort())
})

test('a failed expenses request is retryable without ending the owner session', async t => {
  const { page, calls } = await fixture(t, { failExpenses:true })
  await page.goto(origin + '/admin?tab=finance')
  await page.getByRole('alert').getByText('Não foi possível carregar a conta de gastos.', { exact:true }).waitFor()
  assert.equal(await page.getByRole('button', { name:'Sair', exact:true }).count(), 1)
  await page.getByRole('button', { name:'Tentar novamente', exact:true }).click()
  await page.getByRole('alert').waitFor({ state:'detached' })
  await page.getByText('Nenhum gasto registrado.', { exact:true }).waitFor()
  assert.equal(calls.filter(call => call.path === '/api/admin/expenses').length, 2)
})
