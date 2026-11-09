import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes do topo e do rodapé exigem servidor local; produção é recusada.')
}
const products = [{ id:1, name:'Peça local', brand:'Marca local', category:'Camisetas', category_id:1, price:99.9, stock:4, image:'/images/product-placeholder.svg' }]
const navigation = { items:[{ label:'Novidades', url:'/shop?q=novo' }, { label:'Camisetas', url:'/shop?category=Camisetas' }] }
const quietMotion = { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280, touch = false, footer = { brand:'GALEO STORE', year:'2026' }, cart } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(touch ? { hasTouch:true, isMobile:true } : {}) })
  t.after(() => context.close())
  if (cart) await context.addInitScript(items => { localStorage.setItem('galeo-cart-v2', JSON.stringify(items)) }, cart)
  const page = await context.newPage(), errors = [], unexpected = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (request.method() !== 'GET') { unexpected.push(request.method() + ' ' + path); return json({}, 400) }
    if (path === '/api/store') return json({ products, categories:[{ id:1, name:'Camisetas', sort_order:10 }] })
    if (path === '/api/store/home') return json({ sections:[{ key:'hero', visible:true, order:10, content:{ title:'Topo novo', description:'Descrição', button_label:'Ver peças', button_url:'/shop' } }] })
    if (path === '/api/store/home/settings') return json({ settings:[quietMotion, { key:'navigation', value:navigation }, { key:'footer', value:footer }] })
    if (path === '/api/auth/me') return json({ authenticated:false }, 401)
    unexpected.push('GET ' + path)
    return json({ error:'API não prevista.' }, 404)
  })
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []) })
  return page
}

const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('celular: o menu lateral mostra as categorias do CMS, navega, fecha e devolve o foco', async t => {
  const page = await fixture(t, { width:390, touch:true })
  await page.goto(baseUrl + '/')
  await page.getByRole('heading', { level:1, name:'Topo novo' }).waitFor()
  assert.equal(await page.locator('.desktop-nav').isVisible(), false)
  const trigger = page.getByRole('button', { name:'Abrir menu' })
  await trigger.click()
  const menu = page.getByRole('dialog', { name:'Menu' })
  await menu.waitFor()
  assert.deepEqual(await menu.getByRole('navigation', { name:'Categorias' }).getByRole('link').allInnerTexts().then(names => names.map(name => name.trim().toLowerCase())),
    ['novidades', 'camisetas', 'ver catálogo completo'])
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
  assert.ok(await noHorizontalScroll(page))
  await page.keyboard.press('Escape')
  await menu.waitFor({ state:'hidden' })
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Abrir menu')
  await trigger.click()
  await menu.getByRole('link', { name:'Camisetas' }).click()
  await page.waitForURL(/\/shop\?category=Camisetas$/)
  await menu.waitFor({ state:'hidden' })
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('menu-open')), false)
  // Account, theme and the light version live in the menu on phones.
  await trigger.click()
  await menu.getByRole('button', { name:'Ativar modo claro' }).click()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light')
  await menu.getByRole('link', { name:'Minha conta' }).waitFor()
})

test('320px: topo cabe sem rolagem lateral e mantém busca e sacola', async t => {
  const page = await fixture(t, { width:320, touch:true })
  await page.goto(baseUrl + '/')
  await page.getByRole('heading', { level:1, name:'Topo novo' }).waitFor()
  for (const name of ['Abrir menu', 'Abrir busca']) await page.getByRole('button', { name }).waitFor()
  await page.locator('.site-header').getByRole('link', { name:/^Carrinho/ }).waitFor()
  assert.ok(await noHorizontalScroll(page))
  const box = await page.locator('.site-header').boundingBox()
  assert.ok(box.height <= 70, 'topo compacto no celular: ' + box.height)
})

test('computador: ícones com nomes claros, contador da sacola e categoria ativa', async t => {
  const page = await fixture(t, { cart:[{ id:1, name:'Peça local', quantity:2, price:99.9 }] })
  await page.goto(baseUrl + '/shop?category=Camisetas')
  await page.locator('.site-header').waitFor()
  const header = page.locator('.site-header')
  for (const name of ['Abrir busca', 'Ativar modo claro']) assert.equal(await header.getByRole('button', { name }).isVisible(), true, name)
  assert.equal(await header.getByRole('link', { name:'Conta' }).isVisible(), true)
  assert.equal(await header.getByRole('link', { name:'Carrinho, 2 itens' }).isVisible(), true)
  assert.equal(await header.locator('.bag-count').innerText(), '2')
  assert.equal(await header.getByRole('button', { name:'Abrir menu' }).isVisible(), false)
  assert.equal(await header.getByRole('link', { name:'Camisetas' }).getAttribute('aria-current'), 'page')
  assert.equal(await header.getByRole('link', { name:'Novidades' }).getAttribute('aria-current'), null)
  assert.equal(await page.locator('header').getByText('Escolha do modo').count(), 0)
})

test('rodapé: links, formas de pagamento e redes só quando configuradas com endereço seguro', async t => {
  const page = await fixture(t, { footer:{ brand:'GALEO STORE', year:'2026', instagram:'@galeo.store', whatsapp:'javascript:alert(1)' } })
  await page.goto(baseUrl + '/')
  const footer = page.locator('footer.site-footer')
  await footer.waitFor()
  for (const name of ['Catálogo', 'Novidades', 'Camisetas', 'Minha conta', 'Carrinho']) await footer.getByRole('link', { name, exact:true }).waitFor()
  assert.deepEqual(await footer.locator('.payment-badges li').allInnerTexts().then(items => items.map(item => item.toLowerCase())), ['pix', 'crédito', 'débito'])
  const instagram = footer.getByRole('link', { name:'Instagram' })
  assert.equal(await instagram.getAttribute('href'), 'https://www.instagram.com/galeo.store/')
  assert.equal(await instagram.getAttribute('rel'), 'noopener noreferrer')
  assert.equal(await footer.getByRole('link', { name:'WhatsApp' }).count(), 0)
  await footer.getByRole('button', { name:/^Modo leve/ }).waitFor()

  const plain = await fixture(t, { footer:{ brand:'GALEO STORE', year:'2026' } })
  await plain.goto(baseUrl + '/')
  await plain.locator('footer.site-footer').waitFor()
  assert.equal(await plain.getByRole('navigation', { name:'Redes sociais' }).count(), 0)
})

test('textos do topo e do rodapé têm contraste de leitura nos modos claro e escuro', async t => {
  for (const theme of ['dark', 'light']) {
    const page = await fixture(t)
    await page.goto(baseUrl + '/?theme=' + theme)
    await page.locator('footer.site-footer').waitFor()
    // The theme is applied after the first paint; read colors once the color transitions end.
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {}))))
    const ratios = await page.evaluate(() => {
      const parse = value => {
        const text = String(value).trim()
        if (text.startsWith('#')) {
          const hex = text.length === 4 ? text.slice(1).split('').map(c => c + c).join('') : text.slice(1, 7)
          return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
        }
        const srgb = text.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/)
        if (srgb) return srgb.slice(1, 4).map(n => Math.round(Number(n) * 255))
        return (text.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
      }
      const luminance = rgb => {
        const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (fg, bg) => { const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05) }
      const page = parse(getComputedStyle(document.documentElement).getPropertyValue('--bg'))
      const footerBg = parse(getComputedStyle(document.querySelector('.site-footer')).backgroundColor)
      const color = selector => parse(getComputedStyle(document.querySelector(selector)).color)
      return {
        nav: ratio(color('.desktop-nav a'), page),
        footerLink: ratio(color('.site-footer-grid a'), footerBg),
        footerHeading: ratio(color('.site-footer-grid h2'), footerBg),
        footerBottom: ratio(color('.site-footer-bottom'), footerBg)
      }
    })
    for (const [name, value] of Object.entries(ratios)) assert.ok(value >= 4.5, theme + ' ' + name + ' contraste ' + value.toFixed(2))
  }
})
