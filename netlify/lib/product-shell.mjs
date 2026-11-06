import { fetchStaticShell, unavailable } from './payment-shell.mjs'

// Link previews (WhatsApp, Instagram, Facebook) do not run JavaScript, so the
// product page HTML itself must carry the title, description, photo and price.
const productPath = /^\/produto\/([1-9]\d{0,11})\/?$/
const fallbackImage = '/images/galeo-og.jpg'

export const productIdFromPath = pathname => Number(productPath.exec(String(pathname))?.[1] || 0)

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim()
// Descriptions may hold markup; names are plain text and only get escaped.
const plain = value => text(String(value ?? '').replace(/<[^>]*>/g, ' '))
const shorten = (value, limit) => value.length <= limit ? value : value.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…'

export function ogImage(url, origin) {
  let image
  try { image = url ? new URL(url, origin) : null } catch { image = null }
  if (!image || !['https:', 'http:'].includes(image.protocol)) return new URL(fallbackImage, origin).href
  // 1200x630 JPEG is the format link previews expect.
  if (image.hostname === 'res.cloudinary.com' && image.pathname.includes('/image/upload/')) {
    image.pathname = image.pathname.replace('/image/upload/', '/image/upload/c_fill,g_auto,w_1200,h_630,q_auto,f_jpg/')
  }
  return image.href
}

export function productMeta(product, origin) {
  const name = text(product?.name) || 'Produto'
  const brand = text(product?.brand)
  const price = Number(product?.price)
  const priced = Number.isFinite(price) && price > 0
  const url = origin + '/produto/' + Number(product?.id)
  const photo = product?.image || (Array.isArray(product?.media) ? product.media.find(item => item?.media_type === 'image')?.url : '')
  const image = ogImage(photo, origin)
  const priceText = priced ? price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''
  const description = shorten(plain(product?.description) || [name, brand].filter(Boolean).join(' — ') + (priceText ? ' por ' + priceText : '') + ' na Galeo Store.', 160)
  const structured = {
    '@context': 'https://schema.org', '@type': 'Product', name, description, image: [image], url,
    ...(brand ? { brand: { '@type': 'Brand', name: brand } } : {}),
    ...(text(product?.category) ? { category: text(product.category) } : {}),
    ...(priced ? { offers: { '@type': 'Offer', url, price: price.toFixed(2), priceCurrency: 'BRL', availability: Number(product?.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } } : {})
  }
  return { title: name + ' | Galeo Store', description, url, image, price: priced ? price.toFixed(2) : '', structured }
}

export function injectProductMeta(html, meta) {
  const tags = [
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    '<meta property="og:site_name" content="Galeo Store" />',
    '<meta property="og:locale" content="pt_BR" />',
    '<meta property="og:type" content="product" />',
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
    ...(meta.price ? [`<meta property="product:price:amount" content="${meta.price}" />`, '<meta property="product:price:currency" content="BRL" />'] : []),
    '<meta name="twitter:card" content="summary_large_image" />',
    // A data block: browsers never execute it, so CSP needs no exception.
    `<script type="application/ld+json">${JSON.stringify(meta.structured).replace(/</g, '\\u003c')}</script>`
  ]
  return String(html)
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${escapeHtml(meta.description)}" />`)
    .replace(/\s*<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>/gi, '')
    .replace(/<\/head>/i, '    ' + tags.join('\n    ') + '\n  </head>')
}

export async function productShellResponse(request, { productId, origin, loadProduct, fetchShell = fetch }) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } })
  }
  const shell = await fetchStaticShell(request, fetchShell)
  if (!shell) return unavailable()
  const { headers } = shell
  if (shell.policy) headers.set('Content-Security-Policy', shell.policy)
  let product, failed = false
  try { product = await loadProduct(productId) } catch { failed = true }
  let html = shell.html
  if (product) {
    html = injectProductMeta(html, productMeta(product, origin))
    // Shared links are fetched in bursts; let the CDN reuse the page briefly.
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
    headers.set('Netlify-CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    // Product edits in the Admin purge this tag (server/storefront-cache.js).
    headers.set('Netlify-Cache-Tag', 'galeo-storefront')
  } else if (!failed) {
    html = html.replace(/<\/head>/i, '    <meta name="robots" content="noindex" />\n  </head>')
  }
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers })
}
