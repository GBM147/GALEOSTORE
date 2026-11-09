import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const { chromium } = createRequire(import.meta.url)('playwright')
const baseUrl = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5173'
const base = new URL(baseUrl)
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Os testes do catálogo exigem servidor local; produção é recusada.')
}
const shirt = { id:41, name:'Camiseta local com grade', brand:'Marca local', category:'Camisetas', category_id:1, price:129.9, stock:3, active:1, image:'/images/product-placeholder.svg', video:'', description:'Peça local.', has_variants:true, sizes:['P', 'M'], variants:[{ id:401, product_id:41, size:'P', stock:0, active:1 }, { id:402, product_id:41, size:'M', stock:3, active:1 }] }
const pants = { id:42, name:'Calça local', brand:'Outra marca', category:'Calças', category_id:2, price:199.9, stock:2, active:1, image:'/images/product-placeholder.svg', video:'', description:'', has_variants:false, sizes:[], variants:[] }
const quietMotion = { key:'storefront_visual_defaults', value:{ interaction:{ smooth_scroll:{ enabled:false }, scroll_reveal:{ enabled:false }, hero_text_reveal:{ enabled:false } } } }
let browser

before(async () => {
  browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close() })

async function fixture(t, { width = 1280 } = {}) {
  const context = await browser.newContext({ viewport:{ width, height:900 }, reducedMotion:'reduce', ...(width <= 700 ? { hasTouch:true, isMobile:true } : {}) })
  t.after(() => context.close())
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = (data, status = 200) => route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
    if (path === '/api/store') return json({ products:[shirt, pants], categories:[] })
    if (path === '/api/store/home') return json({ sections:[] })
    if (path === '/api/store/home/settings') return json({ settings:[quietMotion] })
    if (path === '/api/store/products/41') return json({ product:shirt, related:[pants] })
    return json({ error:'API não prevista.' }, 404)
  })
  t.after(() => assert.deepEqual(errors, []))
  return page
}

// Size, corners, typed text and border contrast of every visible field inside a selector.
const fieldReport = (page, selector) => page.evaluate(selector => {
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently:true })
  const rgb = value => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = '#000'; canvas.fillStyle = value; canvas.fillRect(0, 0, 1, 1); return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3) }
  const luminance = color => { const [r, g, b] = color.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (a + 0.05) / (b + 0.05) }
  const page = rgb(getComputedStyle(document.body).backgroundColor)
  return [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length).map(node => {
    const style = getComputedStyle(node), box = node.getBoundingClientRect()
    return { name:node.getAttribute('aria-label') || node.name || node.tagName, height:Math.round(box.height), radius:parseFloat(style.borderTopLeftRadius), fontSize:parseFloat(style.fontSize), border:parseFloat(style.borderTopWidth), contrast:Number(ratio(rgb(style.borderTopColor), page).toFixed(2)) }
  })
}, selector)

for (const theme of ['dark', 'light']) {
  test(`campos do catálogo são caixas finas e arredondadas no tema ${theme === 'dark' ? 'escuro' : 'claro'}`, async t => {
    const page = await fixture(t, { width:390 })
    await page.goto(baseUrl + '/shop?theme=' + theme)
    await page.locator('.product-card').first().waitFor()
    const fields = await fieldReport(page, '.catalog-search input, .catalog-refinements select')
    assert.equal(fields.length, 5)
    for (const field of fields) {
      assert.ok(field.height >= 44, `${field.name}: altura ${field.height}px`)
      assert.ok(field.radius >= 8, `${field.name}: cantos retos`)
      assert.equal(field.fontSize, 16, `${field.name}: texto menor que 16px dá zoom no iPhone`)
      assert.equal(field.border, 1, `${field.name}: borda precisa ser fina`)
      assert.ok(field.contrast >= 3, `${field.name}: contraste da borda ${field.contrast}`)
    }
    await page.getByRole('button', { name:'Abrir busca', exact:true }).click()
    const [header] = await fieldReport(page, '.header-search input')
    assert.ok(header.height >= 44 && header.radius >= 8 && header.contrast >= 3, JSON.stringify(header))
  })
}

for (const width of [390, 320]) {
  test(`busca do catálogo fica em uma linha em ${width}px e a página não rola para o lado`, async t => {
    const page = await fixture(t, { width })
    await page.goto(baseUrl + '/shop?q=camiseta')
    await page.locator('.product-card').first().waitFor()
    const form = await page.locator('.catalog-search').boundingBox()
    const input = await page.getByRole('textbox', { name:'Buscar produto, marca ou categoria', exact:true }).boundingBox()
    const submit = await page.locator('.catalog-search').getByRole('button', { name:'Buscar ↗', exact:true }).boundingBox()
    const clear = await page.getByRole('button', { name:'Limpar busca', exact:true }).boundingBox()
    assert.ok(form.height <= 64, `busca com ${form.height}px de altura`)
    assert.ok(Math.abs(input.y - submit.y) <= 2, 'o botão Buscar desceu para outra linha')
    assert.ok(clear.x > input.x && clear.x + clear.width <= input.x + input.width, 'Limpar busca fica dentro do campo')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'rolagem lateral no catálogo')
  })
}

test('categoria escolhida fica marcada como pílula preenchida', async t => {
  const page = await fixture(t)
  await page.goto(baseUrl + '/shop')
  const group = page.getByRole('group', { name:'Categorias', exact:true })
  const all = group.getByRole('button', { name:'Todos', exact:true })
  const shirts = group.getByRole('button', { name:'Camisetas', exact:true })
  assert.equal(await all.getAttribute('aria-pressed'), 'true')
  assert.equal(await shirts.getAttribute('aria-pressed'), 'false')
  await shirts.click()
  await page.waitForURL(/category=Camisetas/)
  // The URL changes before React commits the new state.
  await group.locator('button[aria-pressed="true"]', { hasText:'Camisetas' }).waitFor()
  assert.equal(await all.getAttribute('aria-pressed'), 'false')
  const [active, idle] = await Promise.all([shirts, all].map(button => button.evaluate(node => ({ background:getComputedStyle(node).backgroundColor, radius:parseFloat(getComputedStyle(node).borderTopLeftRadius) }))))
  assert.notEqual(active.background, idle.background)
  assert.ok(active.radius >= 20, 'categorias são pílulas')
  assert.deepEqual(await page.locator('.product-meta strong').allInnerTexts(), ['Camiseta local com grade'])
})

test('página do produto usa o card do catálogo nos relacionados e mostra confiança com ícones', async t => {
  const page = await fixture(t)
  await page.goto(baseUrl + '/shop')
  const signature = locator => locator.evaluate(node => [...node.querySelectorAll('*')].map(child => child.tagName + '.' + [...child.classList].join('.')).join(' '))
  const catalogCard = await signature(page.locator('.product-card').filter({ hasText:'Calça local' }))
  await page.goto(baseUrl + '/produto/41')
  await page.getByRole('heading', { name:'Camiseta local com grade', level:1 }).waitFor()
  const related = page.locator('.related-products .product-card')
  assert.equal(await related.count(), 1)
  assert.equal(await signature(related), catalogCard)
  const notes = page.locator('.product-detail-notes > div')
  assert.deepEqual(await notes.locator('.product-note-copy span').allInnerTexts(), ['PEDIDO', 'ENTREGA', 'ATENDIMENTO'])
  assert.equal(await notes.locator('.product-note-icon[aria-hidden="true"] svg').count(), 3)
  const soldOut = page.locator('.product-size-option').filter({ has:page.getByRole('radio', { name:'Tamanho P', exact:true }) })
  assert.equal(await soldOut.locator('span').evaluate(node => getComputedStyle(node).textDecorationLine), 'line-through')
  const chosen = page.locator('.product-size-option').filter({ has:page.getByRole('radio', { name:'Tamanho M', exact:true }) })
  const before = await chosen.evaluate(node => getComputedStyle(node).borderTopColor)
  await page.getByRole('radio', { name:'Tamanho M', exact:true }).check({ force:true })
  assert.notEqual(await chosen.evaluate(node => getComputedStyle(node).borderTopColor), before, 'o tamanho escolhido precisa se destacar')
  const add = await page.getByRole('button', { name:/Adicionar ao carrinho/ }).boundingBox()
  assert.ok(add.height >= 52, `botão de compra com ${add.height}px`)
})

test('página do produto não rola para o lado em 320px', async t => {
  const page = await fixture(t, { width:320 })
  await page.goto(baseUrl + '/produto/41')
  await page.getByRole('heading', { name:'Camiseta local com grade', level:1 }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
})
