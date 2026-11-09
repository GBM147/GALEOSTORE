import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes da Home exigem servidor local; produção é recusada.')
}
const products = [{ id:1, name:'Peça local', brand:'Marca local', category:'Camisetas', category_id:1, price:99.9, stock:4, image:'/images/product-placeholder.svg' }]
const quietMotion = { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }
const sections = hero => [
  { key:'hero', visible:true, order:10, content:{ title:'Vista o que representa você', description:'Curadoria local', button_label:'Comprar', ...hero } },
  { key:'utility', visible:true, order:20, content:{ items:['Envio para todo o Brasil', 'Compra segura', 'Novas peças toda semana', 'Atendimento humano'] } },
  { key:'categories', visible:true, order:30, content:{ title:'Categorias', items:[{ title:'Camisetas', url:'/shop?category=Camisetas' }, { title:'Calças', url:'/shop?category=Cal%C3%A7as' }, { title:'Bonés', url:'/shop?category=Bon%C3%A9s' }, { title:'Moletons', url:'/shop?category=Moletons' }, { title:'Acessórios', url:'/shop' }] } },
  { key:'campaigns', visible:true, order:50, content:{ items:[{ title:'Sem foto um', button_label:'Ver', button_url:'/shop' }, { title:'Sem foto dois', button_label:'Ver', button_url:'/shop' }, { title:'Sem foto três', button_label:'Ver', button_url:'/shop' }] } }
]
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280, hero = {} } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(width <= 700 ? { hasTouch:true, isMobile:true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/store') return json({ products, categories:[] })
    if (path === '/api/store/home') return json({ sections:sections(hero) })
    if (path === '/api/store/home/settings') return json({ settings:[quietMotion] })
    return json({ error:'API não prevista.' }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  return page
}

const contrast = (page, selector, backgroundSelector) => page.evaluate(([selector, backgroundSelector]) => {
  const parse = value => (String(value).match(/[\d.]+/g) || []).slice(0, 3).map(Number)
  const luminance = rgb => { const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const pick = sel => { const el = document.querySelector(sel); if (!el) throw new Error('faltou ' + sel); return el }
  const fg = parse(getComputedStyle(pick(selector)).color)
  // Brand panels use gradients; sample their first color stop.
  const bgStyle = getComputedStyle(pick(backgroundSelector))
  const bg = bgStyle.backgroundImage && bgStyle.backgroundImage !== 'none' ? parse(bgStyle.backgroundImage.slice(bgStyle.backgroundImage.indexOf('rgb'))) : parse(bgStyle.backgroundColor)
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}, [selector, backgroundSelector])

test('banner mostra o selo do CMS e o atalho para o catálogo só quando o botão leva a outro lugar', async t => {
  const page = await fixture(t, { hero:{ eyebrow:'GALEO / MULTIBRAND STORE', button_url:'/produto/1' } })
  await page.goto(baseUrl + '/')
  await page.getByRole('heading', { level:1 }).waitFor()
  assert.equal((await page.locator('.hero-eyebrow').innerText()).trim(), 'GALEO / MULTIBRAND STORE')
  assert.equal(await page.locator('.hero-full-actions').getByRole('link', { name:'Ver catálogo' }).getAttribute('href'), '/shop')
  const plain = await fixture(t, { hero:{ button_url:'/shop' } })
  await plain.goto(baseUrl + '/')
  await plain.getByRole('heading', { level:1 }).waitFor()
  assert.equal(await plain.locator('.hero-eyebrow').count(), 0)
  assert.equal(await plain.locator('.hero-full-actions a').count(), 1)
})

test('campanhas sem foto viram painéis da marca e a arte do leão fica só no banner', async t => {
  const page = await fixture(t)
  await page.goto(baseUrl + '/')
  await page.locator('[data-home-section="campaigns"]').waitFor()
  assert.equal(await page.locator('.campaign-brand-image').count(), 1)
  assert.equal(await page.locator('.hero-full .campaign-brand-image').count(), 1)
  assert.equal(await page.locator('.campaign-fallback').count(), 3)
  assert.deepEqual(await page.locator('[data-home-section="campaigns"] .campaign-carousel').evaluateAll(items => items.map(item => item.dataset.hasMedia)), ['false', 'false', 'false'])
  for (const variant of ['1', '2', '3']) {
    const ratio = await contrast(page, `.campaign-carousel[data-variant="${variant}"] .campaign-card-copy strong`, `.campaign-carousel[data-variant="${variant}"] .campaign-fallback`)
    assert.ok(ratio >= 4.5, 'campanha ' + variant + ' contraste ' + ratio.toFixed(2))
  }
})

test('diferenciais ganham ícones pelo texto e categorias cabem em 320px', async t => {
  const page = await fixture(t, { width:320 })
  await page.goto(baseUrl + '/')
  await page.locator('[data-home-section="utility"]').waitFor()
  assert.equal(await page.locator('.utility-strip svg.utility-icon').count(), 4)
  await page.locator('.category-card').first().waitFor()
  assert.deepEqual(await page.locator('.category-card').evaluateAll(cards => cards.map(card => card.dataset.initial)), ['C', 'C', 'B', 'M', 'A'])
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
})

test('categorias ocupam a largura toda no computador, sem card esticado sozinho', async t => {
  const page = await fixture(t, { width:1366 })
  await page.goto(baseUrl + '/')
  await page.locator('.category-card').first().waitFor()
  const widths = await page.locator('.category-card').evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().width)))
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 2, 'larguras ' + widths.join(','))
})
