// Store links in plain words: what a button or link points to, and how to
// build it from a choice (catalog, a category, a product, WhatsApp, other).
import { whatsappUrl } from '../siteNavigation.js'

export function linkKind(value) {
  const url = String(value || '').trim()
  if (/^\/shop\/?$/.test(url)) return 'catalog'
  if (/^\/shop\?category=/.test(url)) return 'category'
  if (/^\/produto\/\d+\/?$/.test(url)) return 'product'
  if (/^https:\/\/wa\.me\/\d+/.test(url)) return 'whatsapp'
  return 'custom'
}

export function linkCategory(value) {
  try { return new URL(String(value || ''), 'https://galeo.local').searchParams.get('category') || '' } catch { return '' }
}

export const linkProductId = value => Number(String(value || '').match(/^\/produto\/(\d+)/)?.[1] || 0)

export function categoryLink(name) {
  return '/shop?category=' + encodeURIComponent(name)
}

export function describeLink(value, { products = [], whatsapp = '' } = {}) {
  const url = String(value || '').trim()
  const kind = linkKind(url)
  if (kind === 'catalog') return 'Catálogo completo'
  if (kind === 'category') return 'Categoria ' + (linkCategory(url) || 'sem nome')
  if (kind === 'product') {
    const product = products.find(item => Number(item.id) === linkProductId(url))
    return 'Produto ' + (product?.name || 'nº ' + linkProductId(url))
  }
  if (kind === 'whatsapp') return url === whatsappUrl(whatsapp) ? 'WhatsApp da loja' : 'WhatsApp ' + url.replace('https://wa.me/', '+')
  return url ? 'Endereço ' + url : 'Nenhum destino ainda'
}
