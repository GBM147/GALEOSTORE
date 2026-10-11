import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// HTTP fixtures test UI decisions and races. Backend reference discovery and
// persistence are tested separately against real MySQL; Cloudinary is unused.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const origin = new URL(baseUrl)
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  throw new Error('Os testes de uso de mídia exigem servidor HTTP loopback; produção é recusada.')
}
const reportDirectory = process.env.MEDIA_USAGE_BROWSER_REPORT_DIR || join(tmpdir(), 'galeo-media-usage-browser')
const usedId = 71, freeId = 72
const usedTitle = 'Campanha da coleção'
const freeTitle = 'Foto de teste sem uso'
const desktop = { width:1366, height:950 }
const mobile = { width:390, height:844 }
const references = [
  { type:'product', id:31, name:'Camiseta Essential', fields:['image_asset_id'], active:true },
  { type:'home_section', id:'hero', name:'Hero / capa', fields:['desktop_media_id'], state:'published' },
  { type:'home_section', id:'campaigns', name:'Campanhas', fields:['items[0].media_url'], state:'draft' }
]
const report = []
let browser

before(async () => {
  await mkdir(reportDirectory, { recursive:true, mode:0o700 })
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => {
  await browser?.close()
  await writeFile(join(reportDirectory, 'report.json'), JSON.stringify({ source:'controlled-browser-fixtures', checks:report }, null, 2))
})

async function fixture(t, { viewport = desktop, handle, confirm = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion:'reduce' })
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const calls = [], dialogs = [], pageErrors = [], unexpectedApi = []
  const items = [usedId, freeId].map((id, index) => ({
    id, title:index ? freeTitle : usedTitle, media_type:'image', ai_status:'done', use_ai:false,
    original_url:'https://res.cloudinary.com/galeo-usage-fixture/image/upload/' + id + '.jpg',
    url:'https://res.cloudinary.com/galeo-usage-fixture/image/upload/' + id + '.jpg',
    ai_url:'https://res.cloudinary.com/galeo-usage-fixture/image/upload/' + id + '-transparent.png'
  }))
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('dialog', async dialog => {
    dialogs.push({ type:dialog.type(), message:dialog.message(), calls:calls.map(call => ({ path:call.path, method:call.method, completed:call.completed })) })
    if (confirm && dialog.type() === 'confirm') await dialog.accept()
    else await dialog.dismiss()
  })
  await page.route('https://res.cloudinary.com/galeo-usage-fixture/**', route => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="740"><rect width="640" height="740" fill="#d9cdb9"/><path d="M220 140 270 110 Q320 148 370 110 L420 140 500 220 445 285 410 250 410 600 230 600 230 250 195 285 140 220Z" fill="#ab9068" stroke="#786547" stroke-width="4"/><text x="320" y="315" text-anchor="middle" font-family="sans-serif" font-size="25" letter-spacing="7" fill="#514635">GALEO</text></svg>' }))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    const call = { path, method, body, headers:request.headers(), completed:false }
    calls.push(call)
    const json = async (data, status = 200) => {
      await route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
      call.completed = true
    }
    const override = await handle?.({ path, method, body, calls, items })
    if (override) return json(override.data, override.status || 200)
    if (path === '/api/auth/me') return json({ success:true, user:{ id:1, email:'owner@example.invalid', role:'owner' }, csrfToken:'usage-test-csrf' })
    if (path === '/api/customer/me') return json({ authenticated:false }, 401)
    if (path === '/api/store') return json({ products:[], categories:[] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[] })
    if (path === '/api/admin/media-library' && method === 'GET') return json({ items, total:items.length })
    if (/^\/api\/admin\/media-library\/\d+\/usage$/.test(path)) {
      return json(Number(path.split('/')[4]) === usedId ? { in_use:true, references } : { in_use:false, references:[] })
    }
    if (/^\/api\/admin\/media-library\/\d+$/.test(path) && method === 'DELETE') {
      const id = Number(path.split('/')[4])
      if (id === usedId) return json({ error:'Esta mídia está em uso e não pode ser excluída.', code:'MEDIA_IN_USE', in_use:true, references }, 409)
      const index = items.findIndex(item => item.id === id)
      assert.notEqual(index, -1, 'a exclusão deve apontar para uma mídia existente')
      items.splice(index, 1)
      return json({ success:true })
    }
    if (path === '/api/admin/dashboard') return json({ products:{ count:0, stock:0, low_stock:0 }, stock:{ entradas:0, saidas:0 }, sales:{ count:0, total:0 }, income:0, expense:0, payable:0, receivable:0 })
    if (['/api/admin/products', '/api/admin/sales', '/api/admin/store-orders', '/api/admin/finance/entries', '/api/admin/finance/recurring', '/api/admin/finance/categories', '/api/admin/finance/accounts', '/api/admin/stock/movements'].includes(path)) return json([])
    unexpectedApi.push(method + ' ' + path)
    return json({ error:'API não prevista: ' + method + ' ' + path }, 404)
  })
  if (typeof page.routeWebSocket === 'function') {
    await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send('{"type":"keepalive_ack"}')))
  }
  await page.goto(baseUrl + '/admin?tab=library')
  await page.getByTestId('media-usage-' + usedId).waitFor()
  return { page, calls, dialogs, pageErrors, unexpectedApi, items }
}

const usagePath = id => '/api/admin/media-library/' + id + '/usage'
const deletePath = id => '/api/admin/media-library/' + id
const gets = (calls, id) => calls.filter(call => call.path === usagePath(id) && call.method === 'GET')
const deletes = calls => calls.filter(call => call.method === 'DELETE')

async function assertReferences(panel) {
  for (const name of ['Camiseta Essential', 'Hero / capa', 'Campanhas']) await panel.getByText(name, { exact:true }).waitFor()
  for (const state of ['Publicado', 'Rascunho']) await panel.getByText(state, { exact:true }).waitFor()
  const text = await panel.innerText()
  assert.equal(text.includes('image_asset_id'), false, 'a lista deve apresentar nomes legíveis em vez de campos técnicos')
  assert.equal(text.includes('items[0].media_url'), false, 'o dono não deve precisar interpretar caminhos JSON')
}

function assertNoErrors({ pageErrors, unexpectedApi }) {
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(unexpectedApi, [])
}

for (const [device, viewport] of [['desktop', desktop], ['mobile', mobile]]) {
  test(device + ': mídia em uso mostra produto e Home publicada/rascunho e bloqueia exclusão sem confirmação', async t => {
    const state = await fixture(t, { viewport })
    const { page, calls, dialogs } = state
    // The status is initially unknown. Delete itself must consult first and
    // reveal references rather than asking for destructive confirmation.
    await page.getByTestId('media-delete-' + usedId).click()
    const panel = page.getByTestId('media-usage-panel')
    await assertReferences(panel)
    assert.equal(await page.getByTestId('media-delete-' + usedId).isDisabled(), true)
    assert.equal(gets(calls, usedId).length, 1)
    assert.equal(deletes(calls).length, 0)
    assert.equal(dialogs.length, 0)
    await panel.getByRole('button', { name:'Fechar lista de uso', exact:true }).click()
    await panel.waitFor({ state:'detached' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'media-usage-71')
    await page.getByTestId('media-usage-' + usedId).click()
    await assertReferences(panel)
    const trigger = page.getByTestId('media-usage-' + usedId)
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
    const labelledBy = await panel.getAttribute('aria-labelledby')
    assert.ok(labelledBy, 'o painel deve ter um título acessível')
    const panelTitle = panel.getByRole('heading', { name:'Onde esta mídia é usada', exact:true })
    assert.equal(await panelTitle.getAttribute('id'), labelledBy)
    const panelId = await panel.getAttribute('id')
    assert.ok(panelId, 'o painel precisa de um identificador acessível para seu controle')
    assert.equal(await trigger.getAttribute('aria-controls'), panelId)
    assert.equal(await panelTitle.evaluate(element => document.activeElement === element), true, 'ao abrir a lista o foco deve chegar ao seu título')
    const layout = await panel.evaluate(element => ({
      viewport:window.innerWidth, document:document.documentElement.scrollWidth,
      left:element.getBoundingClientRect().left, right:element.getBoundingClientRect().right,
      width:element.clientWidth, scroll:element.scrollWidth
    }))
    assert.ok(layout.document <= layout.viewport + 2)
    assert.ok(layout.left >= -2 && layout.right <= layout.viewport + 2)
    assert.ok(layout.scroll <= layout.width + 2)
    await panel.screenshot({ path:join(reportDirectory, device + '-onde-midia-usada.png') })
    report.push({ scenario:device + '-references', ...layout })
    await panel.getByRole('button', { name:'Fechar lista de uso', exact:true }).press('Enter')
    await panel.waitFor({ state:'detached' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'media-usage-71')
    assert.equal(deletes(calls).length, 0)
    assert.equal(dialogs.length, 0)
    assertNoErrors(state)
  })
}

test('exclusão consulta antes de confirmar, impede clique duplicado durante carregamento e cancelar mantém a mídia', async t => {
  let release, requested
  const ready = new Promise(resolve => { requested = resolve })
  const pending = new Promise(resolve => { release = resolve })
  const state = await fixture(t, { handle:async ({ path }) => {
    if (path !== usagePath(freeId)) return undefined
    requested()
    await pending
    return { data:{ in_use:false, references:[] } }
  } })
  const { page, calls, dialogs, items } = state
  const button = page.getByTestId('media-delete-' + freeId)
  await button.evaluate(element => { element.click(); element.click() })
  await ready
  await page.getByText('Consultando onde a mídia é usada…', { exact:true }).waitFor()
  assert.equal(await button.isDisabled(), true)
  assert.equal(gets(calls, freeId).length, 1)
  assert.equal(dialogs.length, 0, 'a confirmação deve aguardar o resultado da consulta')
  assert.equal(deletes(calls).length, 0)
  release()
  await page.waitForFunction(() => !document.querySelector('[data-testid="media-delete-72"]')?.disabled)
  assert.equal(dialogs.length, 1)
  assert.equal(dialogs[0].type, 'confirm')
  assert.equal(dialogs[0].calls.filter(call => call.path === usagePath(freeId) && call.completed).length, 1)
  assert.equal(deletes(calls).length, 0)
  assert.equal(items.some(item => item.id === freeId), true)
  assert.equal(await page.getByTestId('media-compare-' + freeId).count(), 1)
  assertNoErrors(state)
})

test('uso criado após a consulta retorna 409, mostra referências e preserva a mídia', async t => {
  const state = await fixture(t, { confirm:true, handle:({ path, method }) => {
    if (path === deletePath(freeId) && method === 'DELETE') {
      return { status:409, data:{ error:'Esta mídia passou a ser usada e não pode ser excluída.', code:'MEDIA_IN_USE', in_use:true, references } }
    }
  } })
  const { page, calls, dialogs, items } = state
  await page.getByTestId('media-delete-' + freeId).click()
  await assertReferences(page.getByTestId('media-usage-panel'))
  await page.getByRole('alert').filter({ hasText:'Esta mídia passou a ser usada' }).waitFor()
  assert.equal(await page.getByTestId('media-delete-' + freeId).isDisabled(), true)
  assert.equal(gets(calls, freeId).length, 1)
  assert.equal(deletes(calls).length, 1)
  assert.equal(deletes(calls)[0].headers['x-csrf-token'], 'usage-test-csrf')
  assert.equal(dialogs.length, 1)
  assert.equal(items.some(item => item.id === freeId), true)
  assert.equal(await page.getByTestId('media-compare-' + freeId).count(), 1)
  assertNoErrors(state)
})

test('IA iniciada após a consulta retorna MEDIA_PROCESSING sem inventar vínculos e mantém a foto', async t => {
  const message = 'Esta foto está sendo tratada pela IA. Aguarde antes de excluir.'
  const state = await fixture(t, { confirm:true, handle:({ path, method }) => {
    if (path === deletePath(freeId) && method === 'DELETE') {
      return { status:409, data:{ error:message, code:'MEDIA_PROCESSING' } }
    }
  } })
  const { page, calls, dialogs, items } = state
  await page.getByTestId('media-delete-' + freeId).click()
  await page.getByRole('alert').filter({ hasText:message }).waitFor()
  assert.equal(deletes(calls).length, 1)
  assert.equal(dialogs.length, 1)
  assert.equal(gets(calls, freeId).length, 1)
  assert.equal(items.length, 2)
  assert.equal(await page.getByTestId('media-compare-' + freeId).count(), 1)
  const panel = page.getByTestId('media-usage-panel')
  assert.equal(await panel.locator('.media-usage-warning').count(), 0, 'processamento de IA não significa vínculo com produto ou Home')
  assert.equal(await panel.locator('.media-usage-list').count(), 0, 'a resposta sem referências não deve inventar uma lista de uso')
  const tile = page.locator('.media-tile').filter({ has:page.getByTestId('media-compare-' + freeId) })
  assert.equal(await tile.getByText('Em uso', { exact:true }).count(), 0)
  assertNoErrors(state)
})

test('falha ao consultar uso bloqueia exclusão mesmo depois de um resultado livre armazenado na tela', async t => {
  let requests = 0
  const state = await fixture(t, { confirm:true, handle:({ path }) => {
    if (path !== usagePath(freeId)) return undefined
    requests++
    return requests === 1 ? { data:{ in_use:false, references:[] } }
      : { status:500, data:{ error:'Não foi possível verificar onde a mídia é usada. Nada foi excluído.', code:'MEDIA_USAGE_CHECK_FAILED' } }
  } })
  const { page, calls, dialogs, items } = state
  await page.getByTestId('media-usage-' + freeId).click()
  await page.getByTestId('media-usage-panel').getByText('Nenhum uso encontrado.', { exact:true }).waitFor()
  await page.getByTestId('media-delete-' + freeId).click()
  await page.getByRole('alert').filter({ hasText:'Não foi possível verificar onde a mídia é usada' }).first().waitFor()
  assert.equal(gets(calls, freeId).length, 2, 'exclusão precisa consultar novamente em vez de confiar no resultado anterior')
  assert.equal(deletes(calls).length, 0)
  assert.equal(dialogs.length, 0)
  assert.equal(items.length, 2)
  assert.equal(await page.getByTestId('media-compare-' + freeId).count(), 1)
  const panel = page.getByTestId('media-usage-panel')
  await panel.getByRole('button', { name:'Atualizar uso', exact:true }).waitFor()
  await panel.screenshot({ path:join(reportDirectory, 'erro-consulta-preserva-midia.png') })
  assertNoErrors(state)
})

test('exclusão livre confirmada remove somente a mídia escolhida após verificar seu uso', async t => {
  const state = await fixture(t, { confirm:true })
  const { page, calls, dialogs, items } = state
  await page.getByTestId('media-delete-' + freeId).click()
  await page.getByTestId('media-compare-' + freeId).waitFor({ state:'detached' })
  assert.equal(gets(calls, freeId).length, 1)
  assert.equal(dialogs.length, 1)
  assert.equal(dialogs[0].calls.filter(call => call.path === usagePath(freeId) && call.completed).length, 1)
  assert.deepEqual(deletes(calls).map(call => call.path), [deletePath(freeId)])
  assert.equal(deletes(calls)[0].headers['x-csrf-token'], 'usage-test-csrf')
  assert.deepEqual(items.map(item => item.id), [usedId])
  assert.equal(await page.getByTestId('media-compare-' + usedId).count(), 1)
  assertNoErrors(state)
})
