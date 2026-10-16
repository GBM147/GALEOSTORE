import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
let browser
before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

const keys = ['hero','utility','categories','featured_products','campaigns','manifesto','newsletter']
const titles = ['Hero','Faixa informativa','Categorias','Produtos destaque','Campanhas','Manifesto','Newsletter']
async function fixture(t, { width = 1280, handle } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:1000 }, reducedMotion:'reduce' })
  t.after(() => context.close())
  const page = await context.newPage()
  const calls = []
  const errors = []
  const sections = keys.map((key, index) => ({ key, order:(index + 1) * 10, visible:true, published_order:(index + 1) * 10, published_visible:true, updated_at:'2026-10-10T12:00:00Z', published_at:'2026-10-09T12:00:00Z',
    draft:key === 'hero' ? { title:'Título do rascunho', description:'Descrição do rascunho', desktop_media_url:'/images/test-draft.svg' } : key === 'campaigns' ? { items:[{ title:'Campanha teste', media_url:'/images/test-original.svg' }] } : key === 'utility' ? { items:['Compra segura'] } : { items:[] },
    published:key === 'hero' ? { title:'Título publicado', description:'Descrição pública', desktop_media_url:'/images/test-published.svg' } : key === 'utility' ? { items:['Compra segura'] } : { items:[] }
  }))
  const settings = [
    { key:'campaign_defaults', value:{ effect:'zoom', transition:'crossfade', speed:'slow', duration_seconds:6 }, published:{ effect:'static', transition:'fade', speed:'normal', duration_seconds:4 } },
    { key:'navigation', value:{ items:[{ label:'Loja', url:'/shop' }] }, published:{ items:[{ label:'Coleção', url:'/shop' }] } },
    { key:'footer', value:{ brand:'GALEO STORE', location:'São Paulo / BR', year:'2026' }, published:{ brand:'GALEO STORE', location:'São Paulo / BR', year:'2026' } }
  ]
  const mediaItems = [{ id:51, title:'Campanha desktop', url:'/images/test-desktop.svg', media_type:'image' }, { id:52, title:'Campanha mobile', url:'/images/test-mobile.svg', media_type:'image' }]
  const versions = [{ id:102, version:12, published_at:'2026-10-10T12:00:00Z', current:true }, { id:101, version:11, published_at:'2026-10-09T12:00:00Z', current:false }]
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    const call = { path, method, body, headers:request.headers() }
    calls.push(call)
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    const custom = await handle?.({ ...call, calls, sections, settings, versions })
    if (custom) return json(custom.data, custom.status || 200)
    if (path === '/api/auth/me') return json({ user:{ id:1, role:'owner', email:'owner@example.test' }, csrfToken:'workflow-csrf' })
    if (path === '/api/customer/me') return json({ authenticated:false })
    if (path === '/api/admin/home') return json({ sections })
    if (path === '/api/admin/home/settings') return json({ settings })
    if (path === '/api/admin/home/versions') return json({ versions, limit:5 })
    if (path === '/api/admin/home/order' && method === 'PUT') { body.keys.forEach((key, index) => { sections.find((section) => section.key === key).order = (index + 1) * 10 }); return json({ success:true }) }
    if (path === '/api/admin/home/publish') { sections.forEach((section) => { section.published = structuredClone(section.draft); section.published_visible = section.visible; section.published_order = section.order }); return json({ success:true, version:13 }) }
    if (path === '/api/admin/home/versions/101/restore') { sections[0].draft = { title:'Versão anterior restaurada', description:'Descrição restaurada' }; return json({ success:true, saved_as:'draft', restored_from:{ id:101, version:11 } }) }
    const sectionKey = path.match(/^\/api\/admin\/home\/([^/]+)$/)?.[1]
    if (sectionKey && method === 'PUT') { Object.assign(sections.find((section) => section.key === sectionKey), { draft:body.content, order:body.order, visible:body.visible }); return json({ success:true }) }
    if (path === '/api/admin/media-library') return json({ items:mediaItems })
    if (path === '/api/admin/products') return json([])
    if (path === '/api/store') return json({ products:[], categories:[] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[] })
    if (path === '/api/admin/dashboard') return json({ products:{ count:0, stock:0, low_stock:0 }, stock:{ entradas:0, saidas:0 }, sales:{ count:0, total:0 } })
    if (path.startsWith('/api/admin/')) return json([])
    return json({ error:'Unhandled fixture API' },404)
  })
  await page.route('**/images/test-*.svg', (route) => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#66513a"/></svg>' }))
  await page.goto(baseUrl + '/admin?tab=editor&mode=advanced')
  await page.locator('.home-editor-heading').getByRole('heading', { name:'Hero', exact:true }).waitFor()
  await page.getByLabel('Título', { exact:true }).waitFor()
  assert.equal(await page.locator('.site-header').count(), 0, 'the storefront menu must not overlap the owner editor')
  return { page, calls, errors, sections }
}

test('section arrows save draft order and preserve the current unsaved edit', async (t) => {
  const { page, calls, errors } = await fixture(t)
  await page.getByLabel('Título', { exact:true }).fill('Edição ainda não salva')
  await page.getByRole('button', { name:'Mover Hero para baixo', exact:true }).click()
  await page.getByText('Ordem salva no rascunho. Publique a Home para aplicar na loja.', { exact:true }).waitFor()
  assert.equal(await page.getByLabel('Título', { exact:true }).inputValue(), 'Edição ainda não salva')
  assert.equal(await page.getByRole('button', { name:'Publicar Home', exact:true }).isDisabled(), true)
  assert.deepEqual(await page.locator('.home-section-order-row').evaluateAll((rows) => rows.map((row) => row.dataset.sectionKey)), ['utility','hero',...keys.slice(2)])
  const call = calls.find((item) => item.path === '/api/admin/home/order')
  assert.deepEqual(call.body.keys, ['utility','hero',...keys.slice(2)])
  assert.equal(call.headers['x-csrf-token'], 'workflow-csrf')
  assert.equal(calls.filter((item) => item.path === '/api/admin/home/publish').length, 0)
  assert.deepEqual(errors, [])
})

test('drag reorder persists all section keys and failed reorder retains the original order', async (t) => {
  let attempts = 0
  const { page, calls, errors } = await fixture(t, { handle:({ path }) => path === '/api/admin/home/order' && ++attempts === 1 ? { status:500, data:{ error:'Não foi possível salvar a ordem' } } : null })
  await page.getByRole('button', { name:'Mover Hero para baixo', exact:true }).click()
  await page.locator('.home-editor-status').getByText('Não foi possível salvar a ordem', { exact:true }).waitFor()
  assert.deepEqual(await page.locator('.home-section-order-row').evaluateAll((rows) => rows.map((row) => row.dataset.sectionKey)), keys)
  await page.getByRole('button', { name:'Arrastar Hero', exact:true }).dragTo(page.locator('[data-section-key="categories"]'))
  await page.getByText('Ordem salva no rascunho. Publique a Home para aplicar na loja.', { exact:true }).waitFor()
  assert.deepEqual(await page.locator('.home-section-order-row').evaluateAll((rows) => rows.map((row) => row.dataset.sectionKey)), ['utility','categories','hero',...keys.slice(3)])
  assert.equal(calls.filter((item) => item.path === '/api/admin/home/order').length, 2)
  assert.deepEqual(errors, [])
})

test('comparison shows saved draft and published values while unsaved edits stay explicit', async (t) => {
  const { page, calls, errors } = await fixture(t)
  await page.getByLabel('Título', { exact:true }).fill('Ainda não salvo')
  await page.getByRole('button', { name:/Comparar com publicado/ }).click()
  await page.getByText('Você tem alterações ainda não salvas. Salve o rascunho para incluí-las nesta comparação e na prévia.', { exact:true }).waitFor()
  assert.ok((await page.getByTestId('home-compare-draft').innerText()).includes('Título do rascunho'))
  assert.ok((await page.getByTestId('home-compare-published').innerText()).includes('Título publicado'))
  assert.equal(await page.getByRole('button', { name:'Publicar Home', exact:true }).isDisabled(), true)
  await page.getByRole('button', { name:'Salvar rascunho', exact:true }).click()
  await page.getByText('Rascunho salvo', { exact:true }).first().waitFor()
  assert.ok((await page.getByTestId('home-compare-draft').innerText()).includes('Ainda não salvo'))
  assert.ok((await page.getByTestId('home-compare-published').innerText()).includes('Título publicado'))
  assert.equal(await page.getByRole('button', { name:'Publicar Home', exact:true }).isDisabled(), false)
  assert.equal(calls.filter((item) => item.path === '/api/admin/home/publish').length, 0)
  assert.deepEqual(errors, [])
})

test('restoring an older version changes only the draft and uses the authenticated API', async (t) => {
  const { page, calls, errors } = await fixture(t)
  await page.getByRole('button', { name:/Versões da Home/ }).click()
  const previous = page.locator('.home-version-list li').filter({ hasText:'Versão 11' })
  await previous.getByRole('button', { name:'Restaurar no rascunho', exact:true }).click()
  await page.getByText('Versão 11 restaurada no rascunho. Confira a prévia antes de publicar.', { exact:true }).waitFor()
  assert.equal(await page.getByLabel('Título', { exact:true }).inputValue(), 'Versão anterior restaurada')
  await page.getByRole('button', { name:/Comparar com publicado/ }).click()
  assert.ok((await page.getByTestId('home-compare-published').innerText()).includes('Título publicado'))
  assert.ok((await page.getByTestId('home-compare-draft').innerText()).includes('Versão anterior restaurada'))
  const restores = calls.filter((item) => item.path === '/api/admin/home/versions/101/restore')
  assert.equal(restores.length, 1)
  assert.equal(restores[0].headers['x-csrf-token'], 'workflow-csrf')
  assert.equal(calls.filter((item) => item.path === '/api/admin/home/publish').length, 0)
  assert.deepEqual(errors, [])
})

test('failed restoration keeps the draft and exposes an actionable error', async (t) => {
  const { page, calls, errors } = await fixture(t, { handle:({ path }) => path.endsWith('/101/restore') ? { status:500, data:{ error:'Versão não pôde ser restaurada' } } : null })
  await page.getByRole('button', { name:/Versões da Home/ }).click()
  await page.locator('.home-version-list li').filter({ hasText:'Versão 11' }).getByRole('button', { name:'Restaurar no rascunho', exact:true }).click()
  await page.getByRole('alert').getByText('Versão não pôde ser restaurada', { exact:true }).waitFor()
  assert.equal(await page.getByLabel('Título', { exact:true }).inputValue(), 'Título do rascunho')
  assert.equal(calls.filter((item) => item.path === '/api/admin/home/publish').length, 0)
  assert.deepEqual(errors, [])
})

test('campaign editor saves selected desktop/mobile slides and explicit motion defaults', async (t) => {
  const { page, calls, errors } = await fixture(t)
  await page.locator('.home-section-order').getByRole('button', { name:'Campanhas Visível', exact:true }).click()
  await page.getByRole('button', { name:'+ adicionar foto / vídeo', exact:true }).click()
  const second = page.getByRole('region', { name:'Campanha 1, foto 2', exact:true })
  await second.getByLabel('Mídia desktop', { exact:true }).selectOption('51')
  await second.getByLabel('Mídia mobile', { exact:true }).selectOption('52')
  const defaultCheckbox = page.getByLabel('Usar padrão da GALEO', { exact:true })
  assert.equal(await defaultCheckbox.isChecked(), true)
  await defaultCheckbox.uncheck()
  await page.getByLabel('Movimento', { exact:true }).selectOption('ken-burns')
  await page.getByLabel('Transição', { exact:true }).selectOption('slide')
  await page.getByRole('button', { name:'Salvar rascunho', exact:true }).click()
  await page.getByText('Rascunho salvo', { exact:true }).first().waitFor()
  const content = calls.find((item) => item.path === '/api/admin/home/campaigns' && item.method === 'PUT').body.content
  assert.equal(content.items[0].slides.length, 2)
  assert.equal(content.items[0].media_url, '')
  assert.equal(content.items[0].slides[1].media_id, 51)
  assert.equal(content.items[0].slides[1].mobile_media_id, 52)
  assert.equal(content.items[0].slides[1].media_type, 'image')
  assert.equal(content.items[0].animation.use_default, false)
  assert.equal(content.items[0].animation.effect, 'ken-burns')
  assert.equal(content.items[0].animation.transition, 'slide')
  assert.deepEqual(errors, [])
})

test('mobile order and comparison remain reachable without horizontal overflow', async (t) => {
  const { page, errors } = await fixture(t, { width:390 })
  await page.getByRole('button', { name:'Mover Hero para baixo', exact:true }).click()
  await page.getByText('Ordem salva no rascunho. Publique a Home para aplicar na loja.', { exact:true }).waitFor()
  await page.getByRole('button', { name:/Comparar com publicado/ }).click()
  await page.getByTestId('home-compare-draft').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  for (const title of titles) assert.ok(await page.getByRole('button', { name:'Arrastar ' + title, exact:true }).isVisible())
  assert.deepEqual(errors, [])
})
