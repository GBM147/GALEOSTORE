import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes do editor exigem servidor local; produção é recusada.')
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const keys = ['hero', 'utility', 'categories', 'featured_products', 'campaigns', 'manifesto', 'newsletter']
const content = {
  hero: { title: 'Vista o que representa você', title_highlight: 'representa você', description: 'Peças selecionadas', button_label: 'Explorar coleção', button_url: '/shop' },
  utility: { items: ['Compra segura', 'Envio para todo o Brasil'] },
  categories: { title: 'Escolha seu estilo', items: [{ title: 'Camisetas', url: '/shop?category=Camisetas' }] },
  featured_products: { title: 'Seleção da semana', source: 'latest' },
  campaigns: { items: [{ title: 'Nova coleção', button_label: 'Descobrir', button_url: '/shop' }] },
  manifesto: { text: 'Não seguimos o padrão\nCriamos o nosso' },
  newsletter: { title: 'Entre para a próxima fase', button_label: 'Entrar' }
}
const product = { id: 31, name: 'Camiseta local', category: 'Camisetas', price: 129.9, stock: 4, image: '/images/product-placeholder.svg' }
let browser

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1366 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', ...(width <= 700 ? { isMobile: true, hasTouch: true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), calls = [], errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  const sections = keys.map((key, index) => ({ key, order: (index + 1) * 10, visible: true, published_order: (index + 1) * 10, published_visible: true, draft: structuredClone(content[key]), published: structuredClone(content[key]) }))
  const settings = [
    { key: 'campaign_defaults', value: { effect: 'static', transition: 'crossfade', speed: 'slow', duration_seconds: 6 } },
    { key: 'storefront_visual_defaults', value: { theme: 'dark', interaction: { smooth_scroll: { enabled: false }, scroll_reveal: { enabled: false }, hero_text_reveal: { enabled: false } } } },
    { key: 'navigation', value: { items: [{ label: 'Catálogo', url: '/shop' }] } },
    { key: 'footer', value: { brand: 'GALEO STORE', year: '2026', whatsapp: '11999999999' } }
  ].map(item => ({ ...item, published: structuredClone(item.value) }))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null
    calls.push({ path, method, body })
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/api/auth/me') return json({ user: { id: 1, role: 'owner', email: 'owner@example.test' }, csrfToken: 'csrf-local' })
    if (path === '/api/customer/me') return json({ authenticated: false }, 401)
    if (path === '/api/store') return json({ products: [product], categories: [{ id: 1, name: 'Camisetas' }, { id: 2, name: 'Calças' }] })
    if (path === '/api/store/home') return json({ sections: sections.map(section => ({ key: section.key, order: section.published_order, visible: true, content: section.published })) })
    if (path === '/api/store/home/settings') return json({ settings: settings.map(setting => ({ key: setting.key, value: setting.published })) })
    if (path === '/api/admin/home' && method === 'GET') return json({ sections })
    if (path === '/api/admin/home/settings' && method === 'GET') return json({ settings })
    if (path === '/api/admin/products') return json([product])
    if (path === '/api/admin/media-library' && method === 'GET') return json({ items: [], total: 0 })
    if (path === '/api/admin/media-library' && method === 'POST') return json({ success: true, items: [{ id: 77, title: 'foto-nova', media_type: 'image', url: '/images/product-placeholder.svg?nova=77' }] }, 201)
    const sectionKey = path.match(/^\/api\/admin\/home\/([^/]+)$/)?.[1]
    if (keys.includes(sectionKey) && method === 'PUT') return json({ success: true, key: sectionKey, saved_as: 'draft' })
    if (/^\/api\/admin\/home\/settings\/[a-z_]+$/.test(path) && method === 'PUT') return json({ success: true, saved_as: 'draft', value: body.value })
    return json({ error: 'API não prevista: ' + method + ' ' + path }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  await page.goto(baseUrl + '/?preview=draft&edit=1')
  await page.getByRole('toolbar', { name: 'Editor visual da loja' }).waitFor()
  return { page, calls }
}

const panel = page => page.getByRole('complementary', { name: 'Painel do editor', exact: true })
const saveDraft = async page => {
  await page.getByRole('toolbar', { name: 'Editor visual da loja' }).getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Editor visual da loja"]')?.textContent.includes('Rascunho salvo'))
}
const saved = (calls, key) => calls.filter(call => call.method === 'PUT' && call.path === '/api/admin/home/' + key).at(-1)?.body

test('no computador, o painel lista as partes na ordem e abre a capa ao lado da página', async t => {
  const { page, calls } = await fixture(t)
  const parts = panel(page).locator('.visual-parts-list').first().locator('.visual-part-open strong')
  assert.deepEqual(await parts.allTextContents(), ['Capa', 'Faixa informativa', 'Categorias', 'Produtos em destaque', 'Campanhas', 'Sobre a GALEO', 'Newsletter'])
  const [panelBox, pageBox] = await Promise.all([panel(page).boundingBox(), page.locator('.visual-editor-canvas').boundingBox()])
  assert.ok(pageBox.x >= panelBox.x + panelBox.width - 1, 'a página fica ao lado do painel')
  await panel(page).getByRole('button', { name: /^Mover Capa para baixo$/ }).click()
  assert.deepEqual(await parts.allTextContents(), ['Faixa informativa', 'Capa', 'Categorias', 'Produtos em destaque', 'Campanhas', 'Sobre a GALEO', 'Newsletter'])
  await panel(page).getByRole('button', { name: /Capa/ }).first().click()
  await page.getByRole('dialog', { name: 'Fotos e vídeo da capa', exact: true }).waitFor()
  await page.locator('[data-editor-section="hero"].is-current').getByText('Editando: Capa', { exact: true }).waitFor()
  const words = page.getByRole('group', { name: 'Palavras em dourado — Título da capa' })
  assert.deepEqual(await words.locator('[aria-pressed="true"]').allTextContents(), ['representa', 'você'])
  await words.getByRole('button', { name: 'Vista', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Trecho em destaque — Título da capa', exact: true }).inputValue(), 'Vista o que representa você')
  await page.getByRole('combobox', { name: 'Para onde o botão leva', exact: true }).selectOption('category')
  await page.getByRole('combobox', { name: 'Para onde o botão leva — categoria', exact: true }).selectOption('Calças')
  await page.getByText('Leva para: Categoria Calças').waitFor()
  await saveDraft(page)
  const hero = saved(calls, 'hero')
  assert.equal(hero.content.title_highlight, 'Vista o que representa você')
  assert.equal(hero.content.button_url, '/shop?category=Cal%C3%A7as')
  assert.ok(saved(calls, 'utility').order < hero.order, 'a nova ordem vai para o rascunho')
})

test('a foto nova é enviada dentro do editor e já entra na capa', async t => {
  const { page, calls } = await fixture(t)
  await panel(page).getByRole('button', { name: /Capa/ }).first().click()
  await page.getByRole('button', { name: 'Escolher Imagem para computador', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Escolher mídia', exact: true })
  await picker.getByLabel('Enviar arquivo para Imagem para computador').setInputFiles({ name: 'foto-nova.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('dialog', { name: 'Fotos e vídeo da capa', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.hero-full-media picture img, .hero-full-media img')?.getAttribute('src')?.includes('nova=77'))
  assert.equal(calls.filter(call => call.path === '/api/admin/media-library' && call.method === 'POST').length, 1)
  await saveDraft(page)
  const hero = calls.filter(call => call.method === 'PUT' && call.path === '/api/admin/home/hero').at(-1).body.content
  assert.equal(hero.desktop_media_id, 77)
  assert.equal(hero.button_url, '/shop')
})

test('o destino do botão é escolhido sem digitar endereço e salvo no rascunho', async t => {
  const { page, calls } = await fixture(t)
  await panel(page).getByRole('button', { name: /Capa/ }).first().click()
  await page.getByRole('combobox', { name: 'Para onde o botão leva', exact: true }).selectOption('category')
  await page.getByRole('combobox', { name: 'Para onde o botão leva — categoria', exact: true }).selectOption('Calças')
  await page.getByText('Leva para: Categoria Calças').waitFor()
  await page.getByRole('combobox', { name: 'Para onde o botão leva', exact: true }).selectOption('whatsapp')
  await page.getByText('Leva para: WhatsApp da loja').waitFor()
  await page.getByRole('combobox', { name: 'Para onde o botão leva', exact: true }).selectOption('category')
  await saveDraft(page)
  const hero = calls.filter(call => call.method === 'PUT' && call.path === '/api/admin/home/hero').at(-1).body.content
  assert.equal(hero.button_url, '/shop?category=Camisetas')
})

for (const width of [390, 320]) {
  test(`no celular de ${width}px o painel abre em tela cheia, edita e volta para a página sem rolagem lateral`, async t => {
    const { page } = await fixture(t, { width })
    assert.equal(await panel(page).isVisible(), false, 'o painel começa fechado no celular')
    const toggle = page.getByRole('button', { name: 'Partes da página', exact: true })
    await toggle.click()
    await panel(page).waitFor()
    const box = await panel(page).boundingBox()
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1)
    await panel(page).getByRole('button', { name: /Categorias/ }).first().click()
    await page.getByRole('dialog', { name: 'Organizar categorias', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Concluir', exact: true }).click()
    await panel(page).getByRole('button', { name: 'Ver na página', exact: true }).click()
    assert.equal(await panel(page).isVisible(), false)
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  })
}

test('Dados da empresa: o editor avisa o que falta e salva no rascunho', async t => {
  const { page, calls } = await fixture(t)
  const company = panel(page).getByRole('button', { name: /Dados da empresa/ })
  assert.match(await company.innerText(), /Falta: razão social, CNPJ, endereço, cidade, e-mail de atendimento/)
  await company.click()
  await panel(page).getByText(/Preencha os Dados da empresa antes de divulgar a loja/).waitFor()
  for (const [label, value] of [['Razão social', 'GALEO Comércio de Roupas LTDA'], ['CNPJ', '11.222.333/0001-81'], ['Rua', 'Rua Augusta'], ['Número', '100'], ['Bairro', 'Consolação'], ['Cidade', 'São Paulo'], ['UF', 'SP'], ['CEP', '01304-000'], ['E-mail de atendimento', 'contato@galeo.test']]) {
    await panel(page).getByLabel(label, { exact: true }).fill(value)
  }
  assert.equal(await panel(page).getByText(/Preencha os Dados da empresa/).count(), 0)
  await saveDraft(page)
  const saved = calls.filter(call => call.method === 'PUT' && call.path === '/api/admin/home/settings/company').at(-1)?.body.value
  assert.equal(saved.legal_name, 'GALEO Comércio de Roupas LTDA')
  assert.equal(saved.cnpj, '11.222.333/0001-81')
  assert.equal(saved.email, 'contato@galeo.test')
})
