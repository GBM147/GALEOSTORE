import serverless from 'serverless-http'
import { apiPath, lambdaEvent, webResponse } from '../lib/http.mjs'
import { isPaymentShellPath, paymentShellResponse } from '../lib/payment-shell.mjs'
import { productIdFromPath, productShellResponse } from '../lib/product-shell.mjs'
import { publicOrigin } from '../../server/seo.js'
import { PURGE_HEADER, purgeStorefrontCache } from '../../server/storefront-cache.js'

// This must precede the dynamic import: the classic server also supports npm start.
process.env.GALEO_SERVERLESS = 'true'
let runtimePromise
const runtime = () => (runtimePromise ??= import('../../server/index.js').then(module => ({
  ...module,
  handle: serverless(module.app)
})).catch(error => {
  runtimePromise = undefined
  throw error
}))

// Reads a product through the public store route, so a shared link shows
// exactly what the catalog shows. Returns null for missing or hidden products.
async function loadPublicProduct(request, context, productId) {
  const api = await runtime()
  return api.withRequestTasks(async () => {
    try {
      await api.initializeRuntime()
      const lookup = new Request(new URL('/api/store/products/' + productId, request.url), { headers: { Accept: 'application/json' } })
      const result = await api.handle(await lambdaEvent(lookup, context), { callbackWaitsForEmptyEventLoop: false })
      if (result.statusCode === 404) return null
      if (result.statusCode !== 200) throw new Error('PRODUCT_LOOKUP_FAILED')
      return JSON.parse(result.isBase64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body).product || null
    } finally {
      await api.drainBackgroundTasks()
    }
  })
}

// An Admin change must show on the store right away. A failed purge is only
// logged: the cached copies still expire within a minute.
async function refreshStorefront(context) {
  try {
    const result = await purgeStorefrontCache({ siteId: context?.site?.id || process.env.SITE_ID, token: process.env.NETLIFY_PURGE_API_TOKEN })
    if (!result.purged && result.status) console.error('Cache da loja não renovado:', 'HTTP_' + result.status)
  } catch (error) {
    console.error('Cache da loja não renovado:', typeof error?.name === 'string' ? error.name : 'PURGE_FAILED')
  }
}

export default async function apiRequest(request, context) {
  const path = apiPath(new URL(request.url).pathname)
  // The payment page shell needs no database or Express runtime.
  if (isPaymentShellPath(path)) return paymentShellResponse(request)
  const productId = productIdFromPath(path)
  if (productId) {
    return productShellResponse(request, { productId, origin: publicOrigin() || new URL(request.url).origin,
      loadProduct: id => loadPublicProduct(request, context, id) })
  }
  try {
    const api = await runtime()
    return await api.withRequestTasks(async () => {
      try {
        await api.initializeRuntime()
        const result = await api.handle(await lambdaEvent(request, context), { callbackWaitsForEmptyEventLoop: false })
        const response = webResponse(result)
        if (response.headers.has(PURGE_HEADER)) {
          response.headers.delete(PURGE_HEADER)
          await refreshStorefront(context)
        }
        return response
      } finally {
        await api.drainBackgroundTasks()
      }
    })
  } catch (error) {
    // Connection errors can include credentials. Log only a non-sensitive category.
    console.error('GALEO API indisponível:', typeof error?.code === 'string' ? error.code : 'RUNTIME_ERROR')
    return Response.json({ success: false, error: 'A loja está temporariamente indisponível. Tente novamente em instantes.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' }
    })
  }
}
