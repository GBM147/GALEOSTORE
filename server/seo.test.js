import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicOrigin, registerSeoRoutes, robotsTxt, sitemapXml, storeIndexable } from './seo.js'

test('homologação nunca é indexada e a produção publica o sitemap', () => {
  assert.equal(storeIndexable({ MERCADO_PAGO_MODE: 'production', DB_NAME: 'galeo_store' }), true)
  assert.equal(storeIndexable({ MERCADO_PAGO_MODE: 'disabled', DB_NAME: 'galeo_store' }), true)
  assert.equal(storeIndexable({ MERCADO_PAGO_MODE: 'test', DB_NAME: 'galeo_store' }), false)
  assert.equal(storeIndexable({ MERCADO_PAGO_MODE: 'disabled', DB_NAME: 'galeo_store_test' }), false)
  assert.equal(robotsTxt({ origin: 'https://loja.test', indexable: false }), 'User-agent: *\nDisallow: /\n')
  const robots = robotsTxt({ origin: 'https://loja.test', indexable: true })
  for (const line of ['Disallow: /admin', 'Disallow: /conta', 'Disallow: /carrinho', 'Disallow: /pagamento/', 'Disallow: /api/', 'Sitemap: https://loja.test/sitemap.xml']) assert.ok(robots.includes(line + '\n'), line)
  assert.equal(robots.includes('Disallow: /\n'), false)
})

test('origem pública vem somente de APP_URL http(s)', () => {
  assert.equal(publicOrigin({ APP_URL: 'https://galeo-store.netlify.app/' }), 'https://galeo-store.netlify.app')
  assert.equal(publicOrigin({ APP_URL: 'javascript:alert(1)' }), '')
  assert.equal(publicOrigin({}), '')
})

test('sitemap lista início, catálogo e produtos com XML escapado', () => {
  const sitemap = sitemapXml({ origin: 'https://loja.test', productIds: [3, 1] })
  assert.match(sitemap, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/)
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), ['https://loja.test/', 'https://loja.test/shop', 'https://loja.test/produto/3', 'https://loja.test/produto/1'])
  assert.match(sitemapXml({ origin: 'https://a.test/?x=1&y=2', productIds: [] }), /<loc>https:\/\/a\.test\/\?x=1&amp;y=2\/<\/loc>/)
})

test('rotas usam a mesma regra de visibilidade do catálogo e não expõem homologação', async () => {
  const routes = {}, queries = []
  const app = { get: (path, handler) => { routes[path] = handler } }
  const response = () => { const res = { statusCode: 200, headers: {}, body: '' }; res.status = code => { res.statusCode = code; return res }; res.type = value => { res.headers['content-type'] = value; return res }; res.send = body => { res.body = body; return res }; return res }
  registerSeoRoutes(app, { env: { APP_URL: 'https://loja.test', MERCADO_PAGO_MODE: 'disabled', DB_NAME: 'galeo_store' }, query: async sql => { queries.push(sql); return [{ id: 7 }, { id: 'x' }] } })
  const sitemap = response(); await routes['/sitemap.xml']({}, sitemap)
  assert.equal(sitemap.statusCode, 200)
  assert.equal(sitemap.headers['content-type'], 'application/xml; charset=utf-8')
  assert.deepEqual(queries, ['SELECT id FROM products WHERE active=1 ORDER BY id DESC'])
  assert.ok(sitemap.body.includes('<loc>https://loja.test/produto/7</loc>'))
  assert.equal(sitemap.body.includes('produto/x'), false)
  const robots = response(); routes['/robots.txt']({}, robots)
  assert.ok(robots.body.includes('Sitemap: https://loja.test/sitemap.xml'))

  const stage = {}
  registerSeoRoutes({ get: (path, handler) => { stage[path] = handler } }, { env: { APP_URL: 'https://homolog.test', MERCADO_PAGO_MODE: 'test', DB_NAME: 'galeo_store_test' }, query: async () => { throw new Error('não deveria consultar') } })
  const hidden = response(); await stage['/sitemap.xml']({}, hidden)
  assert.equal(hidden.statusCode, 404)
  const blocked = response(); stage['/robots.txt']({}, blocked)
  assert.equal(blocked.body, 'User-agent: *\nDisallow: /\n')

  const failing = {}
  registerSeoRoutes({ get: (path, handler) => { failing[path] = handler } }, { env: { APP_URL: 'https://loja.test', DB_NAME: 'galeo_store' }, query: async () => { throw new Error('db') } })
  const unavailable = response(); await failing['/sitemap.xml']({}, unavailable)
  assert.equal(unavailable.statusCode, 503)
})
