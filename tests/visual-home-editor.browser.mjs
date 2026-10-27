import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Every API, media file and socket in this suite stays in local browser fixtures.
// Refuse production even if FRONTEND_TEST_URL was accidentally set globally.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes do editor exigem servidor HTTP loopback; produção é recusada.')
}

const editorUrl = '/?preview=draft&edit=1'
const keys = ['hero', 'utility', 'categories', 'featured_products', 'campaigns', 'manifesto', 'newsletter']
const content = {
  hero:{ eyebrow:'GALEO / MULTIBRAND STORE', title:'Vista o que representa você', description:'Descrição exclusiva do rascunho', button_label:'Explorar coleção', button_url:'/shop', desktop_media_id:50, desktop_media_url:'/images/visual-editor-original.svg', mobile_media_id:null, mobile_media_url:'', video_media_id:null, video_media_url:'', retained_metadata:{ focal_point:'center', untouched:true } },
  utility:{ items:['Compra segura', 'Curadoria multimarcas'] },
  categories:{ eyebrow:'01 / CATEGORIAS', title:'Escolha seu movimento', button_label:'Ver catálogo', button_url:'/shop', items:[{ id:'existing-category', title:'Camisetas', url:'/shop?category=Camisetas', media_id:50, media_url:'/images/visual-editor-original.svg', retained_metadata:'preservar' }] },
  featured_products:{ eyebrow:'02 / SELEÇÃO', title:'Seleção multimarcas', source:'manual', product_ids:[31], button_label:'Ver todos', button_url:'/shop' },
  campaigns:{ defaults:{ effect:'static' }, retained_metadata:'padrões da seção', items:[{ eyebrow:'NOVA COLEÇÃO', title:'Sua próxima peça', button_label:'Descobrir', button_url:'/shop', retained_metadata:{ campaign_credit:'GALEO' }, animation:{ use_default:true }, slides:[{ id:'original-slide', retained_metadata:'crédito da foto original', media_id:50, media_url:'/images/visual-editor-original.svg', media_type:'image', mobile_media_id:null, mobile_media_url:'' }] }] },
  manifesto:{ eyebrow:'SOBRE A GALEO', text:'Não seguimos o padrão\nCriamos o nosso' },
  newsletter:{ eyebrow:'GALEO / INSIDER', title:'Entre para a próxima fase', button_label:'Entrar' }
}
const product = { id:31, name:'Camiseta local', category:'Camisetas', price:129.9, stock:4, image:'/images/visual-editor-original.svg' }
const csrfToken = 'visual-editor-fixture-csrf'
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280, role = 'owner', handle, navigate = editorUrl, reducedMotion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion, hasTouch:width <= 700 })
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const calls = [], errors = [], unexpected = []
  const sections = keys.map((key, index) => ({ key, order:(index + 1) * 10, visible:true, published_order:(index + 1) * 10, published_visible:true, draft:structuredClone(content[key]), published:{ ...structuredClone(content[key]), ...(key === 'hero' ? { title:'Título que está publicado', description:'Descrição pública' } : {}) }, updated_at:'2026-10-10T12:00:00Z', published_at:'2026-10-09T12:00:00Z' }))
  const settings = [
    { key:'campaign_defaults', value:{ effect:'static', transition:'crossfade', speed:'slow', duration_seconds:6 }, published:{ effect:'static', transition:'crossfade', speed:'slow', duration_seconds:6 } },
    { key:'storefront_visual_defaults', value:{ theme:'dark', interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } }, published:{ theme:'dark' } },
    { key:'navigation', value:{ items:[{ label:'Coleção', url:'/shop' }] }, published:{ items:[{ label:'Coleção', url:'/shop' }] } },
    { key:'footer', value:{ brand:'GALEO STORE', location:'São Paulo / BR', year:'2026' }, published:{ brand:'GALEO STORE', location:'São Paulo / BR', year:'2026' } }
  ]
  const media = [
    { id:51, title:'Foto desktop da coleção', url:'/images/visual-editor-desktop.svg', media_type:'image', width:1200, height:900 },
    { id:52, title:'Foto mobile da coleção', url:'/images/visual-editor-mobile.svg', media_type:'image', width:600, height:900 }
  ]
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    const call = { path, method, body, headers:request.headers(), query:url.searchParams }
    calls.push(call)
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    const custom = await handle?.({ ...call, calls, sections, settings })
    if (custom) return json(custom.data, custom.status || 200)
    if (path === '/api/auth/me') return role ? json({ user:{ id:1, role, email:'owner@example.test' }, csrfToken }) : json({ authenticated:false, error:'Sessão necessária' }, 401)
    if (path === '/api/customer/me') return json({ authenticated:false }, 401)
    if (path === '/api/store') return json({ products:[product], categories:[{ id:301, name:'Camisetas', sort_order:10 }] })
    if (path === '/api/store/home') return json({ sections:sections.map(section => ({ key:section.key, order:section.published_order, visible:section.published_visible, content:section.published })) })
    if (path === '/api/store/home/settings') return json({ settings:settings.map(setting => ({ key:setting.key, value:setting.published })) })
    if (path.startsWith('/api/admin/') && role !== 'owner') return json({ error:'Somente o proprietário pode editar a Home', code:role ? 'ADMIN_OWNER_REQUIRED' : 'AUTH_REQUIRED' }, role ? 403 : 401)
    if (path === '/api/admin/home' && method === 'GET') return json({ sections })
    if (path === '/api/admin/home/settings' && method === 'GET') return json({ settings })
    if (path === '/api/admin/products') return json([product])
    if (path === '/api/admin/dashboard') return json({ products:{ count:1, stock:4, low_stock:0 }, stock:{ entradas:0, saidas:0 }, sales:{ count:0, total:0 } })
    if (['/api/admin/finance/entries', '/api/admin/finance/categories', '/api/admin/finance/accounts', '/api/admin/finance/recurring', '/api/admin/stock/movements', '/api/admin/sales', '/api/admin/store-orders'].includes(path) && method === 'GET') return json([])
    if (path === '/api/admin/media-library') return json({ items:media, total:media.length, page:1, limit:24, has_more:false })
    if (path === '/api/admin/home/publish' && method === 'POST') {
      sections.forEach(section => Object.assign(section, { published:structuredClone(section.draft), published_order:section.order, published_visible:section.visible }))
      settings.forEach(setting => { setting.published = structuredClone(setting.value) })
      return json({ success:true, version:14, published_at:'2026-10-15T12:00:00Z' })
    }
    const settingKey = path.match(/^\/api\/admin\/home\/settings\/([^/]+)$/)?.[1]
    if (settingKey && method === 'PUT') { settings.find(setting => setting.key === settingKey).value = structuredClone(body.value); return json({ success:true }) }
    const sectionKey = path.match(/^\/api\/admin\/home\/([^/]+)$/)?.[1]
    if (keys.includes(sectionKey) && method === 'PUT') {
      const section = sections.find(item => item.key === sectionKey)
      Object.assign(section, { draft:structuredClone(body.content), ...(body.order === undefined ? {} : { order:body.order }), ...(body.visible === undefined ? {} : { visible:body.visible }) })
      return json({ success:true, key:sectionKey, saved_as:'draft' })
    }
    unexpected.push(method + ' ' + path)
    return json({ error:'API não prevista na fixture local' }, 404)
  })
  await page.route('**/images/visual-editor-*.svg', route => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><rect width="800" height="900" fill="#7d6949"/><text x="400" y="450" text-anchor="middle" fill="#fff" font-size="70">GALEO</text></svg>' }))
  if (typeof page.routeWebSocket === 'function') await page.routeWebSocket('**/ws', socket => socket.onMessage(() => socket.send('{"type":"keepalive_ack"}')))
  t.after(() => {
    assert.deepEqual(errors, [], 'a edição deve permanecer sem erros JavaScript')
    assert.deepEqual(unexpected, [], 'os testes devem usar somente APIs simuladas')
    assert.ok(calls.filter(call => !['GET', 'HEAD'].includes(call.method)).every(call => call.headers['x-csrf-token'] === csrfToken), 'cada gravação deve enviar o CSRF da sessão OWNER')
  })
  await page.goto(baseUrl + navigate)
  if (role === 'owner' && navigate === editorUrl) await toolbar(page).waitFor()
  return { page, calls, sections, settings }
}

const toolbar = page => page.getByRole('toolbar', { name:'Editor visual da loja', exact:true })
const mutations = calls => calls.filter(call => !['GET', 'HEAD'].includes(call.method))
const saves = calls => calls.filter(call => call.method === 'PUT')
const publications = calls => calls.filter(call => call.path === '/api/admin/home/publish')

for (const width of [1366, 390]) for (const theme of ['dark', 'light']) {
  test(`the active Hero text remains readable and unclipped at ${width}px in ${theme} mode`, async t => {
    const { page, calls } = await fixture(t, { width, navigate:editorUrl + '&theme=' + theme })
    await page.setViewportSize({ width, height:width === 390 ? 844 : 768 })
    await toolbar(page).waitFor()
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole('button', { name:theme === 'light' ? 'Ativar modo claro' : 'Ativar modo escuro', exact:true }).click()
    }
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme)
    await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click()
    const input = page.getByRole('textbox', { name:'Título do Hero', exact:true })
    const sentence = 'Kit lupa + boné\n' + Array.from({ length:12 }, (_, index) => 'Coleção ' + (index + 1) + ' — peças para o seu movimento').join('\n') + '\n'
    await input.fill(sentence)
    await input.evaluate(element => { element.focus(); element.setSelectionRange(0, 0); element.scrollTop = 0 })
    const geometry = await input.evaluate(element => {
      const css = getComputedStyle(element), rect = element.getBoundingClientRect()
      const hero = document.querySelector('.hero-full').getBoundingClientRect()
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(value => {
          const normalized = Number(value) / 255
          return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
        })
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
      }
      const foreground = luminance(css.color), background = luminance(css.backgroundColor)
      return { fontSize:parseFloat(css.fontSize), contrast:(Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05),
        top:rect.top, bottom:rect.bottom, left:rect.left, right:rect.right, heroTop:hero.top, heroBottom:hero.bottom, heroLeft:hero.left, heroRight:hero.right,
        clientHeight:element.clientHeight, scrollHeight:element.scrollHeight, overflowY:css.overflowY, scrollTop:element.scrollTop }
    })
    assert.equal(await input.inputValue(), sentence)
    assert.ok(geometry.fontSize >= 16 && geometry.fontSize <= 24, 'the input must use a readable editing size rather than the oversized storefront heading')
    assert.ok(geometry.contrast >= 4.5, 'the normal text must remain readable against the actual input background')
    assert.ok(geometry.top >= geometry.heroTop && geometry.bottom <= geometry.heroBottom, 'the Hero must grow to contain the whole text field instead of clipping its first lines')
    assert.ok(geometry.left >= geometry.heroLeft && geometry.right <= geometry.heroRight, 'the text field must stay inside the Hero horizontally')
    assert.equal(geometry.scrollTop, 0, 'the first line must be reachable')
    if (geometry.scrollHeight > geometry.clientHeight + 2) {
      assert.ok(['auto', 'scroll'].includes(geometry.overflowY), 'long text must remain scrollable inside its field')
      assert.ok(await input.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop > 0 }), 'the last lines must be reachable')
      await input.evaluate(element => { element.scrollTop = 0 })
    }
    await page.getByRole('textbox', { name:'Trecho em destaque', exact:true }).focus()
    const afterBlur = await input.boundingBox()
    const hero = await page.locator('.hero-full').boundingBox()
    assert.ok(afterBlur.y >= hero.y && afterBlur.y + afterBlur.height <= hero.y + hero.height, 'blurring the field must not push it behind the Hero clipping edge')
    const captureDirectory = process.env.EDITOR_VISIBILITY_CAPTURE_DIR
    if (captureDirectory) {
      mkdirSync(captureDirectory, { recursive:true })
      await input.fill('Kit lupa + boné\n')
      await input.press('ArrowRight')
      await input.scrollIntoViewIfNeeded()
      await page.screenshot({ path:join(captureDirectory, 'after-local-' + width + '-' + theme + '.png') })
    }
    await page.getByRole('button', { name:'Concluir edição', exact:true }).click()
    assert.equal(await page.locator('.hero-title').evaluate(element => parseFloat(getComputedStyle(element).fontSize) > 24), true, 'the storefront heading must keep its display typography after editing')
    assert.equal(mutations(calls).length, 0, 'visibility checks must not save or publish content')
  })
}

async function edit(page, label, value) {
  await page.getByRole('button', { name:'Editar ' + label, exact:true }).click()
  await page.getByRole('textbox', { name:label, exact:true }).fill(value)
  await page.getByRole('button', { name:'Concluir edição', exact:true }).click()
}
async function saveDraft(page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/api/admin/home/') && response.request().method() === 'PUT')
  await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).click()
  await response
}

for (const width of [1440, 390]) for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`Hero title stays clickable at ${width}px with motion ${reducedMotion}`, async t => {
    const { page, calls } = await fixture(t, { width, reducedMotion })
    await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click({ timeout:2000 })
    const input = page.getByRole('textbox', { name:'Título do Hero', exact:true })
    assert.equal(await input.inputValue(), content.hero.title)
    await input.press('Escape')
    assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), true)
    assert.equal(mutations(calls).length, 0, 'abrir e cancelar a edição não deve gravar conteúdo')
  })
}

test('editing the actual draft heading preserves typography and saves only changed content with CSRF', async t => {
  const { page, calls } = await fixture(t)
  assert.equal(mutations(calls).length, 0)
  const title = page.locator('.hero-title')
  assert.equal(await title.locator('em').evaluate(element => getComputedStyle(element).fontFamily.includes('Roboto')), true)
  await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click()
  await page.getByRole('textbox', { name:'Título do Hero', exact:true }).fill('Vista o que representa a sua história')
  assert.equal(mutations(calls).length, 0, 'digitar deve alterar somente o rascunho em memória')
  await page.getByRole('button', { name:'Concluir edição', exact:true }).click()
  assert.equal(await title.innerText(), 'Vista o que representa a sua história')
  assert.equal(await toolbar(page).getByRole('button', { name:'Publicar alterações', exact:true }).isDisabled(), true)
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  assert.equal(saves(calls).length, 1)
  const saved = saves(calls)[0]
  assert.equal(saved.path, '/api/admin/home/hero')
  assert.equal(saved.body.content.title, 'Vista o que representa a sua história')
  assert.deepEqual(saved.body.content.retained_metadata, content.hero.retained_metadata)
  assert.equal(saved.body.content.desktop_media_id, 50)
  assert.equal(saved.body.visible, true)
  assert.equal(saved.body.order, 10)
  assert.equal(publications(calls).length, 0)
})

for (const width of [1440, 390]) test(`a custom highlighted phrase survives draft saving, reloading and client preview at ${width}px`, async t => {
  const { page, calls, sections } = await fixture(t, { width })
  const title = 'Coleção feita para o seu movimento'
  const highlight = 'seu movimento'
  await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click()
  const titleInput = page.getByRole('textbox', { name:'Título do Hero', exact:true })
  await titleInput.fill(title)
  const highlightInput = page.getByRole('textbox', { name:'Trecho em destaque', exact:true })
  if (width === 1440) {
    await titleInput.evaluate((input, phrase) => {
      const start = input.value.indexOf(phrase)
      input.setSelectionRange(start, start + phrase.length)
      input.dispatchEvent(new Event('select', { bubbles:true }))
    }, highlight)
    await page.getByRole('button', { name:'Destacar seleção', exact:true }).click()
    assert.equal(await highlightInput.inputValue(), highlight)
  } else await highlightInput.fill(highlight)
  assert.equal(mutations(calls).length, 0, 'the text style must remain an unsaved local draft while editing')
  await page.getByRole('button', { name:'Concluir edição', exact:true }).click()
  const emphasis = page.locator('.hero-title em')
  await emphasis.waitFor()
  assert.equal(await emphasis.innerText(), highlight)
  const style = await emphasis.evaluate(element => {
    const emphasisStyle = getComputedStyle(element)
    const headingStyle = getComputedStyle(document.querySelector('.hero-title'))
    return { family:emphasisStyle.fontFamily, italic:emphasisStyle.fontStyle, color:emphasisStyle.color, normalColor:headingStyle.color }
  })
  assert.ok(style.family.includes('Roboto'))
  assert.equal(style.italic, 'italic')
  assert.notEqual(style.color, style.normalColor, 'the highlighted phrase must visibly differ from normal text')
  await saveDraft(page)
  const saved = saves(calls).at(-1)
  assert.equal(saved.body.content.title, title)
  assert.equal(saved.body.content.title_highlight, highlight)
  assert.deepEqual(saved.body.content.retained_metadata, content.hero.retained_metadata)
  assert.equal(sections[0].published.title, 'Título que está publicado', 'saving a highlighted draft must not publish it')
  await page.reload()
  await toolbar(page).waitFor()
  await page.locator('.hero-title em').waitFor()
  assert.equal(await page.locator('.hero-title em').innerText(), highlight)
  await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click()
  assert.equal(await page.getByRole('textbox', { name:'Trecho em destaque', exact:true }).inputValue(), highlight)
  await page.getByRole('button', { name:'Cancelar edição', exact:true }).click()
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), true)
  await toolbar(page).getByRole('button', { name:'Ver como cliente', exact:true }).click()
  assert.equal((await page.locator('.hero-title').innerText()).replace(/\s+/g, ' '), title)
  assert.equal(await page.locator('.hero-title em').innerText(), highlight)
  assert.equal(publications(calls).length, 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
})

test('cancelling restores legacy emphasis without a dirty metadata field and clearing it explicitly removes the style', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click()
  const title = page.getByRole('textbox', { name:'Título do Hero', exact:true })
  const highlight = page.getByRole('textbox', { name:'Trecho em destaque', exact:true })
  assert.equal(await highlight.inputValue(), 'representa você')
  await title.fill('Uma coleção para outra história')
  await highlight.fill('outra história')
  await page.getByRole('button', { name:'Cancelar edição', exact:true }).click()
  assert.equal(await page.locator('.hero-title em').innerText(), 'representa você')
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), true, 'cancelling must also restore the absence of an original highlight metadata field')
  assert.equal(mutations(calls).length, 0)
  await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click()
  await highlight.fill('')
  await page.getByRole('button', { name:'Concluir edição', exact:true }).click()
  assert.equal(await page.locator('.hero-title em').count(), 0, 'an explicitly empty highlight must override the legacy default')
  assert.equal((await page.locator('.hero-title').innerText()).replace(/\s+/g, ' '), content.hero.title)
  await saveDraft(page)
  assert.equal(saves(calls).at(-1).body.content.title_highlight, '')
  assert.equal(saves(calls).at(-1).body.content.title, content.hero.title)
})

test('unsaved edits in different sections remain visible until both are saved', async t => {
  const { page, calls } = await fixture(t)
  await edit(page, 'Título do Hero', 'Título da capa editado')
  await edit(page, 'Título das categorias', 'Encontre sua próxima peça')
  assert.equal(await page.locator('.hero-title').innerText(), 'Título da capa editado')
  assert.equal(await page.locator('[data-home-section="categories"] h2').innerText(), 'Encontre sua próxima peça')
  assert.equal(mutations(calls).length, 0)
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  assert.deepEqual(saves(calls).map(call => call.path).sort(), ['/api/admin/home/categories', '/api/admin/home/hero'])
  assert.equal(saves(calls).find(call => call.path.endsWith('/categories')).body.content.items[0].retained_metadata, 'preservar')
  assert.equal(publications(calls).length, 0)
})

for (const [sectionKey, label, selector] of [
  ['hero', 'Título do Hero', '.hero-title'],
  ['featured_products', 'Título dos destaques', '[data-home-section="featured_products"] h2']
]) test(`an empty ${sectionKey} title stays editable without storing placeholder text`, async t => {
  const { page, calls } = await fixture(t, { width: 390 })
  await edit(page, label, '')
  const trigger = page.getByRole('button', { name: 'Editar ' + label, exact: true })
  assert.equal(await trigger.innerText(), 'Clique para escrever')
  const box = await trigger.boundingBox()
  assert.ok(box.width >= 100 && box.height >= 44, 'o texto vazio precisa manter uma área clicável')
  await saveDraft(page)
  assert.equal(saves(calls).at(-1).body.content.title, '')
  await toolbar(page).getByRole('button', { name: 'Ver como cliente', exact: true }).click()
  assert.equal((await page.locator(selector).innerText()).trim(), '', 'a prévia deve manter o texto vazio sem mostrar um título antigo')
  await toolbar(page).getByRole('button', { name: 'Voltar a editar', exact: true }).click()
  await edit(page, label, 'Uma nova frase para a loja')
  await saveDraft(page)
  assert.equal(saves(calls).at(-1).body.content.title, 'Uma nova frase para a loja')
})

test('the section options restore a deleted featured heading and publish that exact text', async t => {
  const { page, calls } = await fixture(t)
  await edit(page, 'Título dos destaques', '')
  await saveDraft(page)
  await page.getByRole('button', { name: 'Opções de Produtos em destaque', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Escolher produtos em destaque', exact: true })
  const field = dialog.getByRole('textbox', { name: 'Título dos destaques', exact: true })
  assert.equal(await field.inputValue(), '')
  await field.fill('Escolhas para o seu dia')
  await dialog.getByRole('textbox', { name:'Trecho em destaque — Título dos destaques', exact:true }).fill('seu dia')
  await dialog.getByRole('button', { name: 'Concluir', exact: true }).click()
  await saveDraft(page)
  await toolbar(page).getByRole('button', { name: 'Publicar alterações', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar publicação', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Alterações publicadas na loja.' }).waitFor()
  await page.goto(baseUrl + '/')
  await page.locator('[data-home-section="featured_products"] h2').getByText('Escolhas para o seu dia', { exact: true }).waitFor()
  assert.equal(publications(calls).length, 1)
  assert.equal(saves(calls).at(-1).body.content.title, 'Escolhas para o seu dia')
  assert.equal(saves(calls).at(-1).body.content.title_highlight, 'seu dia')
  assert.equal(await page.locator('[data-home-section="featured_products"] h2 em').innerText(), 'seu dia')
})

test('Roboto is loaded locally with a lighter heading on the draft', async t => {
  const { page } = await fixture(t)
  const typography = await page.locator('.hero-title').evaluate(async title => {
    await document.fonts.load('500 24px Roboto')
    const computed = getComputedStyle(title)
    return { family: computed.fontFamily, weight: Number(computed.fontWeight), loaded: document.fonts.check('500 24px Roboto'), sources: [...document.fonts].filter(face => face.family === 'Roboto').map(face => face.status) }
  })
  assert.ok(typography.family.includes('Roboto'))
  assert.ok(typography.weight >= 400 && typography.weight <= 600)
  assert.equal(typography.loaded, true)
  assert.ok(typography.sources.includes('loaded'))
  assert.equal(await page.locator('link[rel="preload"][href="/fonts/roboto-latin-normal.woff2"]').count(), 1)
})

test('publication is a separate confirmed action after saving and never follows typing automatically', async t => {
  const { page, calls, sections } = await fixture(t)
  await edit(page, 'Título do Hero', 'Nova campanha aprovada')
  assert.equal(await toolbar(page).getByRole('button', { name:'Publicar alterações', exact:true }).isDisabled(), true)
  await saveDraft(page)
  const publish = toolbar(page).getByRole('button', { name:'Publicar alterações', exact:true })
  assert.equal(publications(calls).length, 0)
  await publish.click()
  const dialog = page.getByRole('dialog', { name:'Publicar alterações na loja?', exact:true })
  await dialog.waitFor()
  assert.equal(publications(calls).length, 0)
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/home/publish' && response.status() === 200)
  await dialog.getByRole('button', { name:'Confirmar publicação', exact:true }).click()
  await response
  assert.equal(publications(calls).length, 1)
  assert.equal(sections[0].published.title, 'Nova campanha aprovada')
})

test('partial save errors keep remaining changes and retry only the failed section without publishing', async t => {
  let categoryAttempts = 0
  const { page, calls } = await fixture(t, { handle:({ path, method }) => path === '/api/admin/home/categories' && method === 'PUT' && ++categoryAttempts === 1 ? { status:500, data:{ error:'Categorias indisponíveis no teste' } } : null })
  await edit(page, 'Título do Hero', 'Capa salva com segurança')
  await edit(page, 'Título das categorias', 'Categorias ainda por salvar')
  await saveDraft(page)
  await page.getByText('Categorias indisponíveis no teste', { exact:false }).waitFor()
  assert.equal(await toolbar(page).getByRole('button', { name:'Publicar alterações', exact:true }).isDisabled(), true)
  assert.equal(await page.locator('[data-home-section="categories"] h2').innerText(), 'Categorias ainda por salvar')
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  assert.equal(saves(calls).filter(call => call.path.endsWith('/hero')).length, 1)
  assert.equal(saves(calls).filter(call => call.path.endsWith('/categories')).length, 2)
  assert.equal(publications(calls).length, 0)
})

test('hiding and moving a section changes the draft order without removing its content', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('button', { name:'Mover Capa para baixo', exact:true }).click()
  await page.getByRole('button', { name:'Ocultar Categorias', exact:true }).click()
  assert.equal(await page.getByRole('group', { name:'Editar seção Categorias', exact:true }).getByRole('button', { name:'Mostrar Categorias', exact:true }).isVisible(), true)
  assert.deepEqual(await page.locator('[data-editor-section]').evaluateAll(elements => elements.map(element => element.dataset.editorSection)), ['utility', 'hero', ...keys.slice(2)])
  assert.equal(mutations(calls).length, 0)
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  const category = saves(calls).find(call => call.path.endsWith('/categories'))
  assert.equal(category.body.visible, false)
  assert.equal(category.body.content.items[0].title, 'Camisetas')
  assert.equal(publications(calls).length, 0)
})

test('client view previews unsaved changes and removes edit controls without submitting data', async t => {
  const { page, calls } = await fixture(t)
  await edit(page, 'Título das categorias', 'Vista a próxima coleção')
  await toolbar(page).getByRole('button', { name:'Ver como cliente', exact:true }).click()
  await page.getByRole('heading', { name:'Vista a próxima coleção', exact:true }).waitFor()
  assert.equal(await page.getByRole('button', { name:'Editar Título das categorias', exact:true }).count(), 0)
  assert.equal(await page.getByRole('button', { name:'Ocultar Categorias', exact:true }).count(), 0)
  await toolbar(page).getByRole('button', { name:'Voltar a editar', exact:true }).click()
  await page.getByRole('button', { name:'Editar Título das categorias', exact:true }).waitFor()
  assert.equal(mutations(calls).length, 0)
})

test('settings modify the displayed draft and save only the changed setting', async t => {
  const { page, calls, settings } = await fixture(t)
  await toolbar(page).getByRole('button', { name:'Configurações', exact:true }).click()
  const dialog = page.getByRole('dialog', { name:'Configurações da loja', exact:true })
  await dialog.getByRole('button', { name:'Rodapé', exact:true }).click()
  await dialog.getByLabel('Nome da loja', { exact:true }).fill('GALEO STORE OFICIAL')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state:'hidden' })
  await page.locator('.site-footer').getByText('GALEO STORE OFICIAL', { exact:true }).waitFor()
  assert.equal(mutations(calls).length, 0)
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  assert.deepEqual(saves(calls).map(call => call.path), ['/api/admin/home/settings/footer'])
  assert.deepEqual(saves(calls)[0].body.value, { brand:'GALEO STORE OFICIAL', location:'São Paulo / BR', year:'2026' })
  assert.equal(settings.find(setting => setting.key === 'footer').published.brand, 'GALEO STORE')
})

test('the visual media library updates desktop and mobile photos while retaining original metadata', async t => {
  const { page, calls } = await fixture(t)
  await page.locator('[data-home-section="hero"]').click({ position:{ x:1100, y:300 } })
  let options = page.getByRole('dialog', { name:'Fotos e vídeo da capa', exact:true })
  await options.getByRole('button', { name:'Escolher Imagem para computador', exact:true }).click()
  await page.getByRole('dialog', { name:'Escolher mídia', exact:true }).getByRole('button', { name:'Usar Foto desktop da coleção', exact:true }).click()
  options = page.getByRole('dialog', { name:'Fotos e vídeo da capa', exact:true })
  await options.getByRole('button', { name:'Escolher Imagem para celular', exact:true }).click()
  await page.getByRole('dialog', { name:'Escolher mídia', exact:true }).getByRole('button', { name:'Usar Foto mobile da coleção', exact:true }).click()
  await page.keyboard.press('Escape')
  await options.waitFor({ state:'hidden' })
  await page.waitForFunction(() => document.querySelector('.hero-full-media picture img')?.currentSrc.endsWith('visual-editor-desktop.svg'))
  assert.equal(mutations(calls).length, 0, 'escolher mídia altera apenas a prévia local')
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  const saved = saves(calls).find(call => call.path === '/api/admin/home/hero').body.content
  assert.equal(saved.desktop_media_id, 51)
  assert.equal(saved.desktop_media_url, '/images/visual-editor-desktop.svg')
  assert.equal(saved.mobile_media_id, 52)
  assert.equal(saved.mobile_media_url, '/images/visual-editor-mobile.svg')
  assert.equal(saved.video_media_url, '')
  assert.deepEqual(saved.retained_metadata, content.hero.retained_metadata)
  assert.equal(publications(calls).length, 0)
})

test('clicking menu and featured products opens their editor without a leave confirmation or lost changes', async t => {
  const { page, calls } = await fixture(t)
  const nativeDialogs = []
  page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); dialog.dismiss() })
  await edit(page, 'Título do Hero', 'Capa ainda não salva ao escolher opções')
  const originalUrl = page.url()
  await page.getByRole('navigation', { name:'Categorias principais', exact:true }).getByRole('link', { name:'Coleção', exact:true }).click()
  const menu = page.getByRole('dialog', { name:'Configurações da loja', exact:true })
  await menu.getByLabel('Nome do link 1', { exact:true }).waitFor()
  await page.keyboard.press('Escape')
  await menu.waitFor({ state:'hidden' })
  await page.locator('.product-card').click()
  const products = page.getByRole('dialog', { name:'Escolher produtos em destaque', exact:true })
  await products.getByRole('combobox', { name:/^O que mostrar na Home/ }).waitFor()
  await page.keyboard.press('Escape')
  await products.waitFor({ state:'hidden' })
  await page.locator('.category-card').click({ position:{ x:20, y:100 } })
  const category = page.getByRole('dialog', { name:'Editar categoria', exact:true })
  await category.getByLabel('Destino da categoria', { exact:true }).waitFor()
  await page.keyboard.press('Escape')
  await category.waitFor({ state:'hidden' })
  assert.equal(page.url(), originalUrl)
  assert.equal(await page.locator('.hero-title').innerText(), 'Capa ainda não salva ao escolher opções')
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), false)
  assert.deepEqual(nativeDialogs, [], 'selecionar elementos editáveis não deve pedir para abandonar a página')
  assert.equal(mutations(calls).length, 0)
})

test('discarding while typing restores the controlled textarea and does not save stale local text', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).click()
  const titleInput = page.getByRole('textbox', { name:'Título do Hero', exact:true })
  await titleInput.fill('Este texto deve ser descartado')
  await toolbar(page).getByRole('button', { name:'Desfazer alterações', exact:true }).click()
  const dialog = page.getByRole('dialog', { name:'Desfazer alterações não salvas?', exact:true })
  await dialog.getByRole('button', { name:'Confirmar desfazer', exact:true }).click()
  await dialog.waitFor({ state:'hidden' })
  assert.equal(await titleInput.inputValue(), content.hero.title)
  await page.getByRole('button', { name:'Concluir edição', exact:true }).click()
  assert.equal(await page.locator('.hero-title').innerText(), 'Vista o que\nrepresenta você')
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), true)
  assert.equal(mutations(calls).length, 0)
  await edit(page, 'Título das categorias', 'Uma alteração posterior ao desfazer')
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  assert.deepEqual(saves(calls).map(call => call.path), ['/api/admin/home/categories'])
  assert.equal(publications(calls).length, 0)
})

test('returning from client catalog waits for fresh owner drafts and initializes a clean saved baseline', async t => {
  let reads = 0, releaseReload, signalReload
  const blocked = new Promise(resolve => { releaseReload = resolve })
  const reloading = new Promise(resolve => { signalReload = resolve })
  const { page, calls } = await fixture(t, { handle:async ({ path, method, sections }) => {
    if (path === '/api/admin/home' && method === 'GET' && ++reads === 2) {
      signalReload()
      await blocked
      sections[0].draft.title = 'Rascunho recarregado do servidor'
    }
    return null
  } })
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), true)
  await toolbar(page).getByRole('button', { name:'Ver como cliente', exact:true }).click()
  const publicHome = page.waitForResponse(response => new URL(response.url()).pathname === '/api/store/home')
  await page.getByRole('navigation', { name:'Categorias principais', exact:true }).getByRole('link', { name:'Catálogo', exact:true }).click()
  await page.locator('.catalog-search').waitFor()
  await publicHome
  assert.equal(new URL(page.url()).pathname, '/shop')
  await page.goBack()
  await reloading
  assert.equal(await toolbar(page).count(), 0, 'não deve montar editor com dados públicos antigos enquanto o rascunho carrega')
  releaseReload()
  await toolbar(page).waitFor()
  assert.equal(await page.locator('.hero-title').innerText(), 'Rascunho recarregado do servidor')
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), true, 'dados recém-carregados formam a referência salva, sem falso estado alterado')
  assert.equal(calls.filter(call => call.path === '/api/admin/home' && call.method === 'GET').length, 2)
  assert.equal(mutations(calls).length, 0)
})

test('browser Back can retain unsaved editor state on cancel and discard it only after accepting', async t => {
  const { page, calls, sections } = await fixture(t, { navigate:'/admin?tab=editor' })
  await page.getByRole('link', { name:'Editar rascunho ↗', exact:true }).click()
  await toolbar(page).waitFor()
  const editorIndex = await page.evaluate(() => history.state?.idx)
  const historyLength = await page.evaluate(() => history.length)
  assert.ok(Number.isInteger(editorIndex) && editorIndex > 0, 'o link real do painel deve criar uma entrada de histórico SPA')
  await edit(page, 'Título do Hero', 'Edição mantida ao cancelar Voltar')
  await page.getByRole('button', { name:'Mover Capa para baixo', exact:true }).click()
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), false)
  const changedOrder = ['utility', 'hero', ...keys.slice(2)]
  const decisions = [false, true], nativeDialogs = []
  page.on('dialog', dialog => {
    nativeDialogs.push({ type:dialog.type(), message:dialog.message() })
    if (decisions.shift()) dialog.accept()
    else dialog.dismiss()
  })
  await page.goBack()
  await page.waitForFunction(index => new URLSearchParams(location.search).get('edit') === '1' && history.state?.idx === index, editorIndex)
  await toolbar(page).waitFor()
  assert.equal(await page.locator('.hero-title').innerText(), 'Edição mantida ao cancelar Voltar')
  assert.deepEqual(await page.locator('[data-editor-section]').evaluateAll(elements => elements.map(element => element.dataset.editorSection)), changedOrder)
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), false)
  assert.equal(await page.evaluate(() => history.length), historyLength, 'cancelar deve restaurar a posição sem acrescentar entradas falsas')
  assert.equal(mutations(calls).length, 0)
  await page.goBack()
  await page.waitForURL('**/admin?tab=editor')
  await page.getByRole('link', { name:'Editar rascunho ↗', exact:true }).waitFor()
  assert.equal(await toolbar(page).count(), 0)
  assert.deepEqual(nativeDialogs.map(dialog => dialog.type), ['confirm', 'confirm'], 'cada tentativa SPA deve exibir uma única confirmação')
  assert.ok(nativeDialogs.every(dialog => dialog.message.includes('alterações não salvas')))
  assert.equal(sections[0].draft.title, content.hero.title)
  await page.goForward()
  await toolbar(page).waitFor()
  assert.equal(await page.locator('.hero-title').innerText(), 'Vista o que\nrepresenta você')
  assert.deepEqual(await page.locator('[data-editor-section]').evaluateAll(elements => elements.map(element => element.dataset.editorSection)), keys)
  assert.equal(await toolbar(page).getByRole('button', { name:'Salvar rascunho', exact:true }).isDisabled(), true)
  assert.equal(mutations(calls).length, 0)
})

test('campaign photo additions, media selection, reorder and removal preserve campaign and slide metadata', async t => {
  const { page, calls } = await fixture(t)
  await page.getByRole('button', { name:'Editar fotos e link da campanha 1', exact:true }).click()
  const options = page.getByRole('dialog', { name:'Editar campanha', exact:true })
  await options.getByRole('textbox', { name:'Título da campanha', exact:true }).fill('Novas peças para os seus dias')
  await options.getByRole('textbox', { name:'Trecho em destaque — Título da campanha', exact:true }).fill('seus dias')
  await options.getByRole('button', { name:'+ Adicionar foto ou vídeo', exact:true }).click()
  await options.locator('.visual-campaign-slide').nth(1).getByRole('button', { name:'Escolher Para computador', exact:true }).click()
  await page.getByRole('dialog', { name:'Escolher mídia', exact:true }).getByRole('button', { name:'Usar Foto desktop da coleção', exact:true }).click()
  await options.locator('.visual-campaign-slide').nth(1).getByRole('button', { name:'Escolher Para celular (opcional)', exact:true }).click()
  await page.getByRole('dialog', { name:'Escolher mídia', exact:true }).getByRole('button', { name:'Usar Foto mobile da coleção', exact:true }).click()
  await options.getByRole('button', { name:'Mover foto 2 para cima', exact:true }).click()
  await options.getByRole('button', { name:'+ Adicionar foto ou vídeo', exact:true }).click()
  await options.getByRole('button', { name:'Remover foto 3', exact:true }).click()
  assert.equal(await options.locator('.visual-campaign-slide').count(), 2)
  await page.keyboard.press('Escape')
  await options.waitFor({ state:'hidden' })
  assert.equal(mutations(calls).length, 0)
  await saveDraft(page)
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
  assert.deepEqual(saves(calls).map(call => call.path), ['/api/admin/home/campaigns'])
  const saved = saves(calls)[0].body.content
  assert.equal(saved.retained_metadata, 'padrões da seção')
  const campaign = saved.items[0]
  assert.deepEqual(campaign.retained_metadata, { campaign_credit:'GALEO' })
  assert.deepEqual(campaign.animation, { use_default:true })
  assert.equal(campaign.button_url, '/shop')
  assert.equal(campaign.title, 'Novas peças para os seus dias')
  assert.equal(campaign.title_highlight, 'seus dias')
  assert.equal(await page.locator('[data-home-section="campaigns"] .campaign-card strong em').innerText(), 'seus dias')
  assert.equal(campaign.slides.length, 2)
  assert.equal(campaign.slides[0].media_id, 51)
  assert.equal(campaign.slides[0].media_url, '/images/visual-editor-desktop.svg')
  assert.equal(campaign.slides[0].mobile_media_id, 52)
  assert.equal(campaign.slides[0].mobile_media_url, '/images/visual-editor-mobile.svg')
  assert.equal(campaign.slides[1].id, 'original-slide')
  assert.equal(campaign.slides[1].media_id, 50)
  assert.equal(campaign.slides[1].retained_metadata, 'crédito da foto original')
  assert.equal(publications(calls).length, 0)
})

for (const role of [null, 'staff']) test((role || 'unauthenticated') + ' cannot use the owner visual editor or see draft content', async t => {
  const { page, calls } = await fixture(t, { role })
  await page.getByRole('alert').waitFor()
  assert.equal(await toolbar(page).count(), 0)
  assert.equal(await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).count(), 0)
  assert.equal(await page.getByText('Descrição exclusiva do rascunho', { exact:true }).count(), 0)
  assert.equal(mutations(calls).length, 0)
})

for (const navigate of ['/', '/?preview=draft']) test('editable controls stay absent from ' + (navigate === '/' ? 'the public Home' : 'the read-only draft preview'), async t => {
  const { page, calls } = await fixture(t, { navigate })
  await page.getByRole('heading', { name:navigate === '/' ? 'Título que está publicado' : 'Vista o que representa você', exact:true }).waitFor()
  assert.equal(await toolbar(page).count(), 0)
  assert.equal(await page.getByRole('button', { name:'Editar Título do Hero', exact:true }).count(), 0)
  assert.equal(await page.locator('[data-editor-section]').count(), 0)
  assert.equal(mutations(calls).length, 0)
})

test('mobile editing and dialogs fit a 320px screen and restore keyboard focus on Escape', async t => {
  const { page, calls } = await fixture(t, { width:320 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await edit(page, 'Título do Hero', 'Uma história da GALEO para vestir todos os dias')
  const opener = toolbar(page).getByRole('button', { name:'Configurações', exact:true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name:'Configurações da loja', exact:true })
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true)
  const bounds = await dialog.boundingBox()
  assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 321, 'o diálogo deve caber na largura do celular')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state:'hidden' })
  assert.equal(await opener.evaluate(element => element === document.activeElement), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(mutations(calls).length, 0)
})
