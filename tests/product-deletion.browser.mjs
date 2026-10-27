import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname), 'Product deletion browser tests must use a local fixture server.')
let browser

before(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { confirm = true, deleteStatus = 200, deleteError } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const calls = [], dialogs = [], errors = [], unexpected = []
  let deleted = false
  const product = { id: 31, name: 'Camiseta cadastrada por engano', category: 'Camisetas', brand: 'GALEO', price: 89.9, cost: 30, stock: 4, min_stock: 0, active: 1 }
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message() })
    if (dialog.type() === 'confirm' && !confirm) await dialog.dismiss()
    else await dialog.accept()
  })
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method()
    calls.push({ path, method, headers: req.headers() })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, role: 'owner', email: 'owner@example.invalid' }, csrfToken: 'fixture-csrf' })
    if (path === '/api/customer/me') return json({ authenticated: false }, 401)
    if (path === '/api/store') return json({ products: deleted ? [] : [product], categories: [] })
    if (path === '/api/store/categories') return json([])
    if (path === '/api/store/home') return json({ sections: [] })
    if (path === '/api/store/home/settings') return json({ settings: [] })
    if (path === '/api/admin/dashboard') return json({ products: { count: deleted ? 0 : 1, stock: deleted ? 0 : 4, low_stock: 0 }, stock: { entradas: deleted ? 0 : 4, saidas: 0 }, sales: { count: 0, total: 0 } })
    if (path === '/api/admin/products' && method === 'GET') return json(deleted ? [] : [product])
    if (path === '/api/admin/products/31' && method === 'DELETE') {
      if (deleteStatus !== 200) return json({ error: deleteError }, deleteStatus)
      deleted = true
      return json({ success: true, mode: 'deleted' })
    }
    if (method === 'GET' && ['/api/admin/finance/entries', '/api/admin/finance/categories', '/api/admin/finance/accounts', '/api/admin/finance/recurring', '/api/admin/sales', '/api/admin/store-orders'].includes(path)) return json([])
    unexpected.push({ path, method })
    return json({ error: 'Unexpected fixture API' }, 500)
  })
  await page.goto(baseUrl + '/admin?tab=products')
  await page.getByRole('button', { name: 'Excluir', exact: true }).waitFor()
  const initialReads = new Map(calls.filter(call => call.method === 'GET').map(call => [call.path, calls.filter(other => other.path === call.path && other.method === 'GET').length]))
  return { page, calls, dialogs, errors, unexpected, product, initialReads }
}

test('canceling permanent deletion keeps the product and makes no DELETE request', async t => {
  const f = await fixture(t, { confirm: false })
  await f.page.getByRole('button', { name: 'Excluir', exact: true }).click()
  assert.equal(f.dialogs.length, 1)
  assert.match(f.dialogs[0].message, /Excluir definitivamente o produto "Camiseta cadastrada por engano"/)
  assert.match(f.dialogs[0].message, /movimentações de estoque e os vínculos de mídia serão removidos/)
  assert.match(f.dialogs[0].message, /não pode ser desfeita/)
  assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 0)
  assert.equal(await f.page.getByText(f.product.name, { exact: true }).count(), 1)
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.unexpected, [])
})

for (const failure of [
  { status: 403, error: 'Você não tem permissão para excluir este produto.' },
  { status: 409, error: 'Este produto está vinculado a vendas ou pedidos não cancelados e não pode ser excluído.' }
]) {
  test('deletion failure ' + failure.status + ' keeps the product active and displays the server reason', async t => {
    const f = await fixture(t, { deleteStatus: failure.status, deleteError: failure.error })
    const alert = f.page.waitForEvent('dialog', { predicate: dialog => dialog.type() === 'alert' })
    await f.page.getByRole('button', { name: 'Excluir', exact: true }).click()
    await alert
    assert.equal(f.dialogs.at(-1)?.type, 'alert')
    assert.equal(f.dialogs.at(-1)?.message, failure.error)
    assert.equal(await f.page.getByText(f.product.name, { exact: true }).count(), 1)
    assert.equal(await f.page.getByText('Ativo', { exact: true }).count(), 1)
    assert.equal(f.calls.filter(call => call.path === '/api/admin/products' && call.method === 'GET').length, f.initialReads.get('/api/admin/products'))
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1)
    assert.deepEqual(f.errors, [])
    assert.deepEqual(f.unexpected, [])
  })
}

test('successful deletion refreshes products and loads the fresh dashboard without a separate stock history request', async t => {
  const f = await fixture(t)
  await f.page.getByRole('button', { name: 'Excluir', exact: true }).click()
  await f.page.getByText('Nenhum produto cadastrado ainda.', { exact: true }).waitFor()
  assert.equal(await f.page.getByText(f.product.name, { exact: true }).count(), 0)
  assert.equal(f.dialogs.at(-1)?.message, 'Produto e movimentações de estoque excluídos definitivamente.')
  const deletion = f.calls.filter(call => call.method === 'DELETE')
  assert.equal(deletion.length, 1)
  assert.equal(deletion[0].headers['x-csrf-token'], 'fixture-csrf')
  assert.equal(f.calls.filter(call => call.path === '/api/admin/products' && call.method === 'GET').length, f.initialReads.get('/api/admin/products') + 1)
  for (const path of ['/api/admin/stock/movements', '/api/admin/dashboard']) assert.equal(f.calls.filter(call => call.path === path).length, 0, 'inactive tabs should not be fetched during deletion')
  assert.equal(await f.page.getByRole('button', { name: 'Movimentações de estoque', exact: true }).count(), 0)
  await f.page.getByRole('button', { name: 'Visão geral', exact: true }).click()
  await f.page.waitForFunction(() => document.querySelector('.metric strong')?.textContent === '0')
  assert.equal(f.calls.filter(call => call.path === '/api/admin/dashboard').length, 1)
  assert.equal(await f.page.locator('.metric').filter({ hasText: 'Produtos no catálogo' }).locator('strong').textContent(), '0')
  assert.equal(f.calls.some(call => call.path === '/api/admin/stock/movements'), false)
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.unexpected, [])
})
