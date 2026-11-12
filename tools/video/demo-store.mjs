import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as art from './garments.mjs'

// Demo store for the videos: catalog, Home, customer and Admin data served by
// Playwright in place of the real API. Prices, orders and numbers are examples.
const sizes = (list, stock) => list.map((size, index) => ({ id: 0, size, stock: stock[index] ?? 3, active: 1 }))
const catalog = [
  [101, 'Camiseta Oversized Medalha', 'Camisetas', 129.9, art.tee('#151311'), ['P', 'M', 'G', 'GG'], [4, 6, 5, 3], 'Malha 100% algodão de toque macio, modelagem oversized e a medalha GALEO estampada no peito.'],
  [102, 'Camiseta Essential Off-White', 'Camisetas', 99.9, art.tee('#efece6', { chest: true, collar: '#cfc8bb' }), ['P', 'M', 'G', 'GG'], [5, 8, 6, 2], 'O básico que combina com tudo: algodão penteado e a medalha bordada pequena no peito.'],
  [103, 'Moletom GALEO Classic', 'Moletons', 249.9, art.hoodie('#2a211b'), ['M', 'G', 'GG'], [3, 4, 2], 'Moletom flanelado com capuz, bolso canguru e a medalha GALEO em destaque.'],
  [104, 'Boné GALEO Aba Curva', 'Acessórios', 89.9, art.cap('#121212', '#1d1a17'), ['Único'], [10], 'Boné aba curva com ajuste traseiro e a medalha GALEO na frente.'],
  [105, 'Calça Jeans Street Cinza', 'Calças', 279.9, art.jeans('#58606b'), ['38', '40', '42', '44'], [2, 4, 4, 1], 'Jeans cinza de corte reto, pespontos dourados e a medalha GALEO no bolso.'],
  [106, 'Bermuda Cargo Areia', 'Bermudas', 159.9, art.shorts('#b9a98a'), ['38', '40', '42'], [3, 5, 2], 'Bermuda cargo de sarja, bolsos laterais e cintura com passantes.'],
  [107, 'Regata Leão Vermelha', 'Regatas', 89.9, art.tank('#8f1f1a'), ['P', 'M', 'G'], [4, 4, 3], 'Regata de algodão leve com a medalha do leão e do galo.'],
  [108, 'Camiseta Vinho Medalha', 'Camisetas', 129.9, art.tee('#6f1d1b', { printSize: 240 }), ['P', 'M', 'G', 'GG'], [3, 5, 4, 2], 'Camiseta vinho com a medalha GALEO grande no peito.']
]
const categoryNames = ['Camisetas', 'Moletons', 'Calças', 'Bermudas', 'Regatas', 'Acessórios']
export const categories = categoryNames.map((name, index) => ({ id: 301 + index, name, sort_order: (index + 1) * 10 }))

export const images = Object.fromEntries([...catalog.map(([id, , , , svg]) => [String(id), svg]), ['campaign', art.campaign()]])
export const imageUrl = id => '/video-demo/' + id + '.svg'

export function demoProducts() {
  let variantId = 7000
  return catalog.map(([id, name, category, price, , sizeList, stock, description]) => {
    const variants = sizes(sizeList, stock).map(variant => ({ ...variant, id: variantId++, product_id: id }))
    return {
      id, name, brand: 'GALEO', category, category_id: categories.find(item => item.name === category).id, price, cost: Math.round(price * 0.42 * 100) / 100,
      stock: variants.reduce((sum, variant) => sum + variant.stock, 0), min_stock: 2, active: 1, image: imageUrl(id), video: '', description,
      has_variants: true, sizes: sizeList, variants, created_at: '2026-11-0' + (1 + (id % 8)) + 'T12:00:00.000Z', inventory_token: 'demo-' + id
    }
  })
}

const hero = { eyebrow: 'GALEO / MULTIBRAND STORE', title: 'Vista o que representa você', title_highlight: 'representa você', description: 'Peças selecionadas das marcas que movem a rua.', button_label: 'Explorar coleção', button_url: '/shop' }
export function homeSections() {
  return [
    { key: 'hero', order: 10, content: hero },
    { key: 'utility', order: 20, content: { items: ['Curadoria multimarcas', 'Compra segura', 'Envio para todo o Brasil', 'Novas peças toda semana'] } },
    { key: 'categories', order: 30, content: { title: 'Escolha seu estilo', button_label: 'Ver catálogo', button_url: '/shop', items: [['Camisetas', 101], ['Moletons', 103], ['Calças', 105], ['Acessórios', 104]].map(([title, id]) => ({ title, url: '/shop?category=' + encodeURIComponent(title), media_url: imageUrl(id) })) } },
    { key: 'featured_products', order: 40, content: { title: 'Seleção da semana', title_highlight: 'semana', source: 'latest', button_label: 'Ver todos', button_url: '/shop' } },
    { key: 'campaigns', order: 50, content: { items: [{ title: 'Nova coleção Medalha', description: 'Peças que acabaram de chegar.', button_label: 'Descobrir', button_url: '/shop', media_url: imageUrl('campaign') }] } },
    { key: 'manifesto', order: 60, content: { text: 'Não seguimos o padrão\nCriamos o nosso' } },
    { key: 'newsletter', order: 70, content: { title: 'Entre para a próxima fase', button_label: 'Entrar' } }
  ].map(section => ({ ...section, visible: true }))
}

export function settings({ motion = true } = {}) {
  return [
    { key: 'storefront_visual_defaults', value: { theme: 'dark', interaction: { smooth_scroll: { enabled: false }, scroll_reveal: { enabled: motion }, hero_text_reveal: { enabled: motion } } } },
    { key: 'footer', value: { brand: 'GALEO STORE', year: '2026', instagram: '@galeostoreofc', whatsapp: '11999999999' } },
    { key: 'navigation', value: { items: [{ label: 'Camisetas', url: '/shop?category=Camisetas' }, { label: 'Moletons', url: '/shop?category=Moletons' }, { label: 'Calças', url: '/shop?category=Cal%C3%A7as' }, { label: 'Acessórios', url: '/shop?category=Acess%C3%B3rios' }] } }
  ]
}

const customer = { id: 7, name: 'Ana Souza', email: 'ana.souza@exemplo.com', phone: '11987654321' }
const address = { postal_code: '01310-100', street: 'Avenida Paulista', number: '1000', complement: 'Apto 52', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP' }
const quotes = [{ id: '1', name: 'PAC', company: 'Correios', price: 19.9, delivery_days: 6, token: 'demo-pac' }, { id: '2', name: 'SEDEX', company: 'Correios', price: 32.5, delivery_days: 2, token: 'demo-sedex' }, { id: '3', name: '.Package', company: 'Jadlog', price: 17.4, delivery_days: 5, token: 'demo-jadlog' }]

function demoOrders(products) {
  const line = (product, size, quantity) => ({ id: product.id * 10 + quantity, product_id: product.id, product_name: product.name, brand: 'GALEO', size_label: size, quantity, unit_price: product.price, line_total: Math.round(product.price * quantity * 100) / 100 })
  const make = (id, code, items, status, payment, method, daysAgo, name) => {
    const subtotal = items.reduce((sum, item) => sum + item.line_total, 0)
    const created = new Date(Date.UTC(2026, 10, 12 - daysAgo, 14, 20)).toISOString()
    return { id, code, customer_id: 7, customer_name: name, customer_email: name.toLowerCase().replace(/\s+/g, '.') + '@exemplo.com', customer_phone: '11987654321', status, payment_status: payment, payment_provider: 'MERCADO_PAGO', payment_method: method, subtotal, shipping_fee: 19.9, total: Math.round((subtotal + 19.9) * 100) / 100, ...address, created_at: created, updated_at: created, paid_at: payment === 'APPROVED' ? created : null, terms_version: '2026-11-12', terms_accepted_at: created, items, shipping_details: JSON.stringify({ name: 'PAC', company: 'Correios', delivery_days: 6, price: 19.9 }) }
  }
  return [
    make(503, 'GALEO-7Q2KX-4F1A', [line(products[0], 'M', 1), line(products[3], 'Único', 1)], 'CONFIRMED', 'APPROVED', 'pix', 0, 'Ana Souza'),
    make(502, 'GALEO-7PZ11-9C3B', [line(products[2], 'G', 1)], 'RECEIVED', 'PENDING', 'pix', 1, 'Bruno Lima'),
    make(501, 'GALEO-7NX88-2D7E', [line(products[4], '40', 1), line(products[1], 'G', 2)], 'SHIPPED', 'APPROVED', 'credit_card', 3, 'Carla Mendes')
  ]
}

// Stateful handler for every /api/** request of a recorded page.
export function createDemoApi({ adminLoggedIn = false, customerLoggedIn = true, motion = true } = {}) {
  const state = {
    products: demoProducts(), sections: homeSections(), settings: settings({ motion }),
    admin: adminLoggedIn, customer: customerLoggedIn, nextProduct: 120, nextMedia: 1, media: new Map(),
    sales: [
      { id: 801, created_at: '2026-11-12T13:10:00.000Z', customer_name: 'Cliente na loja', total: 219.8, payment_method: 'PIX', items: [{ product_name: 'Camiseta Oversized Medalha', quantity: 1, unit_price: 129.9 }, { product_name: 'Boné GALEO Aba Curva', quantity: 1, unit_price: 89.9 }] },
      { id: 800, created_at: '2026-11-11T17:45:00.000Z', customer_name: 'Cliente na loja', total: 249.9, payment_method: 'CREDITO', items: [{ product_name: 'Moletom GALEO Classic', quantity: 1, unit_price: 249.9 }] }
    ],
    expenses: [{ id: 1, description: 'Embalagens e etiquetas', amount: 86.4, date: '2026-11-10' }, { id: 2, description: 'Fotos da nova coleção', amount: 350, date: '2026-11-05' }],
    recurring: [{ id: 101, description: 'Aluguel do estoque', amount: 1200, due_day: 10, active: 1, current_month_recorded: true }, { id: 102, description: 'Internet da loja', amount: 120, due_day: 15, active: 1, current_month_recorded: false }],
    calls: []
  }
  state.orders = demoOrders(state.products)
  state.library = state.products.map((product, index) => ({ id: 900 + index, title: product.name, media_type: 'image', url: product.image, original_url: product.image, ai_status: 'none', presentation: 'original', usage_count: 1, created_at: product.created_at }))
  const published = () => state.products.filter(product => product.active)

  return {
    state,
    async handle({ path, method, body, query }) {
      state.calls.push({ path, method, body })
      // Store
      if (path === '/api/store') return { data: { products: published(), categories } }
      if (path === '/api/store/categories') return { data: categories }
      if (path === '/api/store/home') return { data: { sections: state.sections.map(section => ({ ...section, content: section.content })) } }
      if (path === '/api/store/home/settings') return { data: { settings: state.settings } }
      let match = path.match(/^\/api\/store\/products\/(\d+)$/)
      if (match) {
        const product = state.products.find(item => item.id === Number(match[1]))
        if (!product) return { status: 404, data: { error: 'Produto não encontrado.' } }
        return { data: { product: { ...product, media: [] }, related: published().filter(item => item.id !== product.id && item.category === product.category).concat(published().filter(item => item.category !== product.category)).slice(0, 4) } }
      }
      if (path === '/api/customer/me') return state.customer ? { data: { authenticated: true, user: customer, csrfToken: 'demo-csrf' } } : { status: 401, data: { authenticated: false } }
      if (path === '/api/customer/registration-status') return { data: { registration_available: true } }
      if (path === '/api/customer/login' && method === 'POST') { state.customer = true; return { data: { success: true, user: customer, csrfToken: 'demo-csrf' } } }
      if (path === '/api/customer/orders') return { data: { orders: state.orders.filter(order => order.customer_name === 'Ana Souza').map(order => ({ ...order, status_label: { RECEIVED: 'Recebido', CONFIRMED: 'Confirmado', SHIPPED: 'Enviado' }[order.status] })) } }
      if (path.startsWith('/api/store/postal-codes/')) return { data: { postal_code: '01310100', street: 'Avenida Paulista', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP' } }
      if (path === '/api/store/shipping/config') return { data: { configured: true, connected: true, available: true } }
      if (path === '/api/store/shipping/quotes') return { data: { quotes, expires_at: new Date(Date.now() + 600000).toISOString() } }
      if (path === '/api/store/orders' && method === 'POST') {
        const order = { id: 504, code: 'GALEO-7R5MT-8A2C', total: 0, status: 'RECEIVED', payment_status: 'PENDING', customer_email: customer.email }
        return { data: { success: true, payment_configured: true, order } }
      }
      if (path === '/api/store/payments/config') return { data: { available: true, mode: 'test', public_key: 'TEST-demo-public-key', methods: ['pix', 'card'] } }
      match = path.match(/^\/api\/store\/orders\/(\d+)\/payment$/)
      if (match) {
        const order = { id: Number(match[1]), code: 'GALEO-7R5MT-8A2C', total: 149.8, subtotal: 129.9, shipping_fee: 19.9, status: 'RECEIVED', payment_status: 'PENDING', customer_email: customer.email, items: [{ product_name: 'Camiseta Oversized Medalha', size_label: 'M', quantity: 1, unit_price: 129.9, line_total: 129.9 }] }
        if (method === 'POST') state.payment = { provider_reference: 'DEMO-PIX', status: 'PENDING', method: 'pix', qr_code: '00020126580014br.gov.bcb.pix0136demo-pix-galeo-exemplo520400005303986540514980', qr_code_base64: QR_PNG }
        return { data: { success: true, order, payment: state.payment || null } }
      }
      if (path === '/api/store/newsletter/subscribe') return { data: { status: 'pending' } }

      // Admin
      if (path === '/api/auth/me') return state.admin ? { data: { user: { id: 1, email: 'dono@galeostore.com.br', role: 'owner' }, csrfToken: 'demo-csrf' } } : { status: 401, data: { authenticated: false } }
      if (path === '/api/auth/login' && method === 'POST') { state.admin = true; return { data: { success: true, user: { id: 1, email: 'dono@galeostore.com.br', role: 'owner' }, csrfToken: 'demo-csrf' } } }
      if (path === '/api/auth/logout') { state.admin = false; return { data: { success: true } } }
      if (path === '/api/admin/dashboard') return { data: { products: { count: state.products.length, active_count: published().length, stock: state.products.reduce((sum, product) => sum + product.stock, 0), low_stock: 2 }, sales: { count: 14, total: 2486.6 }, income: 2486.6, expense: 1556.4, payable: 120, receivable: 0, stock: { entradas: 48, saidas: 21 } } }
      if (path === '/api/admin/products' && method === 'GET') return { data: state.products }
      if (path === '/api/admin/products' && method === 'POST') {
        const product = { id: state.nextProduct++, brand: '', description: '', image: '', video: '', min_stock: 0, ...body, variants: (body.variants || []).map((variant, index) => ({ ...variant, id: 7600 + index, active: 1 })), inventory_token: 'demo-new' }
        product.stock = product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0) || Number(body.stock || 0)
        state.products.unshift(product)
        state.media.set(product.id, [])
        return { status: 201, data: product }
      }
      match = path.match(/^\/api\/admin\/products\/(\d+)$/)
      if (match && method === 'PUT') {
        const index = state.products.findIndex(item => item.id === Number(match[1]))
        const current = state.products[index]
        const variants = body.variants ? body.variants.filter(variant => variant.active !== false).map((variant, i) => ({ ...variant, id: variant.id || 7700 + i, active: 1 })) : current.variants
        state.products[index] = { ...current, ...body, variants, stock: variants?.length ? variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0) : Number(body.stock ?? current.stock), inventory_token: 'demo-' + Date.now() }
        return { data: state.products[index] }
      }
      match = path.match(/^\/api\/admin\/products\/(\d+)\/media$/)
      if (match && method === 'GET') return { data: state.media.get(Number(match[1])) || [] }
      if (match && method === 'POST') {
        const productId = Number(match[1]), id = state.nextMedia++
        const url = imageUrl(['101', '108', '103'][(id - 1) % 3])
        const item = { id, product_id: productId, media_type: 'image', url, public_id: 'demo-' + id, sort_order: id, asset: { id: 950 + id, title: 'Foto ' + id, media_type: 'image', original_url: url, ai_status: 'none', presentation: 'original', url } }
        state.media.set(productId, [...(state.media.get(productId) || []), item])
        const product = state.products.find(entry => entry.id === productId)
        if (product && !product.image) product.image = url
        return { status: 201, data: { success: true, media: [item] } }
      }
      match = path.match(/^\/api\/admin\/products\/(\d+)\/media\/order$/)
      if (match) return { data: { success: true, ids: body?.ids || [] } }
      if (path === '/api/admin/store-orders' && method === 'GET') return { data: state.orders.map(order => ({ ...order, payment_available: order.payment_status !== 'APPROVED', status_label: { RECEIVED: 'Recebido', CONFIRMED: 'Confirmado', PREPARING: 'Em preparação', SHIPPED: 'Enviado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado' }[order.status] })) }
      match = path.match(/^\/api\/admin\/store-orders\/(\d+)(\/status)?$/)
      if (match) {
        const order = state.orders.find(item => item.id === Number(match[1]))
        if (match[2] && body?.status) order.status = body.status
        return { data: { ...order, success: true } }
      }
      if (path === '/api/admin/sales' && method === 'GET') return { data: state.sales }
      if (path === '/api/admin/sales' && method === 'POST') {
        const total = (body.items || []).reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0), 0)
        const sale = { id: 802, created_at: new Date().toISOString(), customer_name: body.customer_name || 'Cliente na loja', total, payment_method: body.payment_method || 'PIX', items: body.items || [] }
        state.sales.unshift(sale)
        return { status: 201, data: { success: true, sale, id: sale.id } }
      }
      if (path === '/api/admin/expenses' && method === 'GET') return { data: state.expenses }
      if (path === '/api/admin/expenses' && method === 'POST') { const expense = { ...body, id: 10 + state.expenses.length }; state.expenses.unshift(expense); return { status: 201, data: expense } }
      if (path === '/api/admin/finance/recurring' && method === 'GET') return { data: state.recurring }
      match = path.match(/^\/api\/admin\/finance\/recurring\/(\d+)\/record$/)
      if (match) { const row = state.recurring.find(item => item.id === Number(match[1])); row.current_month_recorded = true; state.expenses.unshift({ id: 99, description: row.description, amount: row.amount, date: body?.date || '2026-11-12' }); return { status: 201, data: { success: true } } }
      if (path === '/api/admin/media-library' && method === 'GET') return { data: { items: state.library, total: state.library.length } }
      if (path === '/api/admin/media-library-preferences') return { data: { preferences: {} } }
      if (path === '/api/admin/home' && method === 'GET') return { data: { sections: state.sections.map(section => ({ ...section, draft: structuredClone(section.content), published: structuredClone(section.content), published_order: section.order, published_visible: true })) } }
      if (path === '/api/admin/home/settings' && method === 'GET') return { data: { settings: state.settings.map(setting => ({ ...setting, published: structuredClone(setting.value) })) } }
      if (/^\/api\/admin\/home\/[a-z_]+$/.test(path) && method === 'PUT') return { data: { success: true, saved_as: 'draft' } }
      if (/^\/api\/admin\/home\/settings\/[a-z_]+$/.test(path) && method === 'PUT') return { data: { success: true, saved_as: 'draft', value: body?.value } }
      if (path === '/api/admin/home/publish') return { data: { success: true } }
      if (path === '/api/admin/home/versions') return { data: { versions: [] } }
      if (path === '/api/admin/shipping') return { data: { configured: true, connected: true, environment: 'production', account: 'GALEO STORE', origin_postal_code: '01310-100' } }
      if (path.startsWith('/api/admin/errors')) return { data: { items: [], total: 0 } }
      if (path.startsWith('/api/admin/')) return { data: [] }
      return { status: 404, data: { error: 'Demonstração: ' + method + ' ' + path } }
    }
  }
}

// A QR-like picture for the demo Pix (not a real payment code).
const QR_PNG = readFileSync(fileURLToPath(new URL('./assets/pix-demo.png', import.meta.url))).toString('base64')
