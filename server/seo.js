// robots.txt and sitemap.xml for the public storefront. Homologation (test
// database or Mercado Pago test mode) is never indexed.
export function storeIndexable(env = process.env) {
  return env.MERCADO_PAGO_MODE !== 'test' && !/_test$/.test(String(env.DB_NAME || ''))
}

export function publicOrigin(env = process.env) {
  try {
    const url = new URL(String(env.APP_URL || ''))
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : ''
  } catch { return '' }
}

const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function robotsTxt({ origin, indexable }) {
  if (!indexable || !origin) return 'User-agent: *\nDisallow: /\n'
  return ['User-agent: *', 'Disallow: /admin', 'Disallow: /conta', 'Disallow: /carrinho', 'Disallow: /pagamento/', 'Disallow: /api/', '', 'Sitemap: ' + origin + '/sitemap.xml', ''].join('\n')
}

export function sitemapXml({ origin, productIds }) {
  const urls = [origin + '/', origin + '/shop', ...productIds.map(id => origin + '/produto/' + id)]
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(url => '  <url><loc>' + xml(url) + '</loc></url>').join('\n') + '\n</urlset>\n'
}

export function registerSeoRoutes(app, { query, env = process.env }) {
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain; charset=utf-8').send(robotsTxt({ origin: publicOrigin(env), indexable: storeIndexable(env) }))
  })
  app.get('/sitemap.xml', async (_req, res) => {
    const origin = publicOrigin(env)
    if (!storeIndexable(env) || !origin) return res.status(404).type('text/plain; charset=utf-8').send('Sitemap indisponível.')
    try {
      // Same visibility rule as the public catalog (GET /api/store).
      const rows = await query('SELECT id FROM products WHERE active=1 ORDER BY id DESC')
      res.type('application/xml; charset=utf-8').send(sitemapXml({ origin, productIds: rows.map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0) }))
    } catch {
      res.status(503).type('text/plain; charset=utf-8').send('Sitemap temporariamente indisponível.')
    }
  })
}
