// The public catalog, Home and product data are the same for every visitor.
// Netlify's CDN keeps them for a minute and keeps serving the previous copy
// while it refreshes, so most visits never wait for a cold function or the
// database. Any change made in the Admin purges them at once.
export const STOREFRONT_CACHE_TAG = 'galeo-storefront'
export const STOREFRONT_CDN_CACHE = 'public, durable, s-maxage=60, stale-while-revalidate=300'
export const PURGE_HEADER = 'x-galeo-cache-purge'
const PURGE_URL = 'https://api.netlify.com/api/v1/purge'

// Only a successful response without a session cookie is shared.
export function cachePublicResponse(req, res, next) {
  const json = res.json.bind(res)
  res.json = body => {
    if (res.statusCode === 200 && !res.get('Set-Cookie')) {
      res.set('Cache-Control', 'public, max-age=0, must-revalidate')
      res.set('Netlify-CDN-Cache-Control', STOREFRONT_CDN_CACHE)
      res.set('Netlify-Cache-Tag', STOREFRONT_CACHE_TAG)
    }
    return json(body)
  }
  next()
}

// Marks successful Admin writes; the Netlify adapter removes the mark and
// purges the cached storefront before answering the owner.
export function markStorefrontChanges(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const writeHead = res.writeHead
  res.writeHead = function (statusCode, ...rest) {
    const status = typeof statusCode === 'number' ? statusCode : this.statusCode
    if (status < 400 && !this.headersSent) this.setHeader(PURGE_HEADER, STOREFRONT_CACHE_TAG)
    return writeHead.call(this, statusCode, ...rest)
  }
  next()
}

export async function purgeStorefrontCache({ siteId, token, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (!siteId || !token) return { purged: false, reason: 'not-on-netlify' }
  const response = await fetchImpl(PURGE_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ site_id: siteId, cache_tags: [STOREFRONT_CACHE_TAG] }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  return { purged: response.ok, status: response.status }
}
