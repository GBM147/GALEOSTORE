import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const origin = new URL(baseUrl)
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  throw new Error('A regressão de rolagem exige servidor HTTP local; produção é recusada.')
}
let browser
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
})
after(async () => { await browser?.close() })

async function fixture(t, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const errors = [], calls = [], unexpected = []
  const items = Array.from({ length: 32 }, (_, index) => ({
    id: 700 + index, title: 'Peça da biblioteca ' + String(index + 1).padStart(2, '0'), media_type: 'image',
    url: '/images/media-scroll-' + index + '.svg', original_url: '/images/media-scroll-' + index + '.svg',
    ai_url: '/images/media-scroll-' + index + '-ai.svg', ai_status: 'done', use_ai: false,
    presentation: 'original', width: 640, height: 800
  }))
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss())
  await page.route('**/images/media-scroll-*.svg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#a68c63"/></svg>'
  }))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, role: 'owner', email: 'owner@example.invalid' }, csrfToken: 'scroll-fixture' })
    if (path === '/api/admin/media-library-preferences' && method === 'GET') return json({ auto_prepare: false })
    if (path === '/api/admin/media-library' && method === 'GET') return json({ items, total: items.length })
    const itemId = Number(/^\/api\/admin\/media-library\/(\d+)/.exec(path)?.[1])
    const item = items.find(item => item.id === itemId)
    if (item && path.endsWith('/usage')) return json({ in_use: false, references: [] })
    if (item && method === 'PATCH') {
      if (body.title !== undefined) item.title = body.title
      if (body.use_ai !== undefined) { item.use_ai = body.use_ai; item.presentation = body.use_ai ? 'ai' : 'original'; item.url = body.use_ai ? item.ai_url : item.original_url }
      return json({ success: true, item })
    }
    if (item && path.endsWith('/replacement') && method === 'POST') {
      const replacement = { ...item, id: 900, title: 'Nova versão local', replaces_id: item.id,
        url: '/images/media-scroll-replacement.svg', original_url: '/images/media-scroll-replacement.svg',
        ai_url: null, ai_status: 'none', use_ai: false, presentation: 'original' }
      items.push(replacement)
      return json({ success: true, item: replacement, message: 'Nova versão salva; o original foi mantido.' })
    }
    if (item && method === 'DELETE') { items.splice(items.indexOf(item), 1); return json({ success: true }) }
    if (path === '/api/admin/media-library-order' && method === 'PATCH') {
      const index = items.findIndex(item => item.id === body.id), [moved] = items.splice(index, 1)
      const anchorIndex = items.findIndex(item => item.id === (body.before_id || body.after_id))
      items.splice(anchorIndex + (body.after_id ? 1 : 0), 0, moved)
      return json({ success: true, ids: items.map(item => item.id) })
    }
    unexpected.push(method + ' ' + path)
    return json({ error: 'API não prevista na fixture.' }, 404)
  })
  t.after(() => {
    assert.deepEqual(errors, [], 'ações de mídia devem continuar sem erros JavaScript')
    assert.deepEqual(unexpected, [], 'nenhuma chamada deve escapar das fixtures locais')
  })
  await page.goto(baseUrl + '/admin?tab=library')
  await page.getByTestId('media-compare-710').waitFor()
  return { page, items, calls }
}

const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function position(page, target) {
  await target.scrollIntoViewIfNeeded()
  await settle(page)
  return page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }))
}
async function keptPosition(page, before, label) {
  await settle(page)
  const after = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }))
  assert.ok(Math.abs(after.y - before.y) <= 3, label + ': a rolagem do documento deve permanecer no mesmo lugar (' + before.y + ' → ' + after.y + ')')
  assert.ok(after.max - after.y > 600, label + ': a ação não deve levar o usuário ao fim da biblioteca')
}

for (const width of [1440, 390]) {
  test(width + 'px: comparar e escolher versão mantém a grade, a rolagem e o foco', async t => {
    const { page, items } = await fixture(t, width)
    const opener = page.getByTestId('media-compare-710')
    const before = await position(page, opener)
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Comparar versões', exact: true })
    await dialog.waitFor()
    await keptPosition(page, before, 'abrir comparação')
    const use = dialog.getByRole('button', { name: 'Usar esta versão: Sem fundo', exact: true })
    await use.waitFor()
    await page.waitForFunction(() => !document.querySelector('[data-testid="media-version-ai"] button')?.disabled)
    await use.click()
    await dialog.getByTestId('media-version-ai').getByText('Em uso', { exact: true }).waitFor()
    assert.equal(items.find(item => item.id === 710).use_ai, true)
    await keptPosition(page, before, 'escolher versão')
    await dialog.getByRole('button', { name: 'Voltar à biblioteca', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'media-compare-710')
    await keptPosition(page, before, 'fechar comparação')
  })

  test(width + 'px: salvar nome e consultar uso não desloca a biblioteca para o fim', async t => {
    const { page, items } = await fixture(t, width)
    const tile = page.locator('.media-tile').filter({ has: page.getByTestId('media-compare-710') })
    const edit = tile.getByRole('button', { name: /Editar mídia:/ })
    const before = await position(page, edit)
    await edit.click()
    const dialog = page.getByRole('dialog', { name: 'Editar mídia', exact: true })
    await dialog.getByLabel('Nome da mídia', { exact: true }).fill('Peça com nome revisado')
    await dialog.getByRole('button', { name: 'Salvar nome', exact: true }).click()
    await dialog.getByText('Peça com nome revisado', { exact: true }).waitFor()
    assert.equal(items.find(item => item.id === 710).title, 'Peça com nome revisado')
    await keptPosition(page, before, 'salvar nome')
    await dialog.getByRole('button', { name: 'Fechar edição', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await keptPosition(page, before, 'fechar edição')
    const usage = page.getByTestId('media-usage-710')
    const usageBefore = await position(page, usage)
    await usage.click()
    const usageDialog = page.getByRole('dialog', { name: 'Onde esta mídia é usada', exact: true })
    await usageDialog.getByText('Nenhum uso encontrado.', { exact: true }).waitFor()
    await usageDialog.getByRole('button', { name: 'Atualizar uso', exact: true }).click()
    await usageDialog.getByText('Nenhum uso encontrado.', { exact: true }).waitFor()
    await keptPosition(page, usageBefore, 'consultar uso')
    await usageDialog.getByRole('button', { name: 'Fechar lista de uso', exact: true }).click()
    await usageDialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'media-usage-710')
    await keptPosition(page, usageBefore, 'fechar uso')
  })

  test(width + 'px: reordenar e excluir uma mídia livre preserva o contexto de leitura', async t => {
    const { page, items, calls } = await fixture(t, width)
    const tile = page.locator('.media-tile').filter({ has: page.getByTestId('media-compare-710') })
    const move = tile.getByRole('button', { name: /Mover depois:/ })
    const before = await position(page, move)
    await move.click()
    await page.getByText('Ordem da biblioteca salva.', { exact: true }).waitFor()
    assert.equal(items.findIndex(item => item.id === 710), 11)
    await keptPosition(page, before, 'reordenar mídia')
    const remove = page.getByTestId('media-delete-710')
    const deleteBefore = await position(page, remove)
    await remove.click()
    await page.getByTestId('media-compare-710').waitFor({ state: 'detached' })
    assert.equal(items.some(item => item.id === 710), false)
    assert.equal(calls.filter(call => call.method === 'DELETE').length, 1)
    await keptPosition(page, deleteBefore, 'excluir mídia livre')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'media-usage-712')
  })

  test(width + 'px: substituir um arquivo mantém o original e retorna ao mesmo ponto da grade', async t => {
    const { page, items, calls } = await fixture(t, width)
    const tile = page.locator('.media-tile').filter({ has: page.getByTestId('media-compare-710') })
    const edit = tile.getByRole('button', { name: /Editar mídia:/ })
    const before = await position(page, edit)
    await edit.click()
    const management = page.getByTestId('media-management')
    await management.getByLabel('Novo arquivo de imagem').setInputFiles({ name: 'nova-foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('local-media-fixture') })
    await management.getByRole('button', { name: 'Enviar nova versão', exact: true }).click()
    const comparison = page.getByRole('dialog', { name: 'Comparar versões', exact: true })
    await comparison.getByText('Nova versão local', { exact: true }).waitFor()
    assert.equal(items.length, 33)
    assert.equal(items.some(item => item.id === 710), true)
    assert.equal(calls.filter(call => call.method === 'POST').length, 1)
    await keptPosition(page, before, 'substituir arquivo')
    await comparison.press('Escape')
    await comparison.waitFor({ state: 'detached' })
    await keptPosition(page, before, 'voltar depois da substituição')
    assert.equal(await edit.evaluate(element => document.activeElement === element), true)
  })
}
