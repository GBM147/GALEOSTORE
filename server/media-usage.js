const URL_FIELD = /^(?:urls?|src|image|video|poster|background_image)$|(?:_urls?|Urls?)$/
const ID_FIELD = /^(?:media_ids?|media_asset_id|image_asset_id)$|_media_ids?$/
const PUBLIC_ID_FIELD = /^public_ids?$|_public_ids?$/
const MEDIA_EXTENSION = /\.(?:avif|bmp|gif|ico|jp2|jpe?g|jxl|png|svg|tiff?|webp|mp4|webm|mov|m4v|avi|mkv|mp3|wav|ogg|m3u8|pdf)$/i
const TRANSFORMATION = /^(?:[a-z]{1,3}_|\$[a-z]\w*_).+$/i
const SECTION_NAMES = Object.freeze({ hero: 'Hero / capa', utility: 'Faixa de informações', categories: 'Categorias', featured_products: 'Produtos em destaque', campaigns: 'Campanhas', manifesto: 'Manifesto', newsletter: 'Newsletter' })
const SETTING_NAMES = Object.freeze({ navigation: 'Menu principal', footer: 'Rodapé', storefront_visual_defaults: 'Visual da loja', campaign_defaults: 'Animações' })

function parsedUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null
  } catch { return null }
}

function cloudinaryIdentity(value) {
  const url = parsedUrl(value)
  if (url?.hostname !== 'res.cloudinary.com') return null
  let parts
  try { parts = decodeURIComponent(url.pathname).split('/').filter(Boolean) } catch { return null }
  const [cloud, resourceType, deliveryType, ...delivery] = parts
  if (!cloud || !['image', 'video', 'raw'].includes(resourceType) || !deliveryType || !delivery.length) return null
  if (/^s--[\w-]+--$/.test(delivery[0])) delivery.shift()
  return { cloud, resourceType, deliveryType, path: delivery }
}

function sameCloudinaryResource(a, b) {
  if (!a || !b || a.cloud !== b.cloud || a.resourceType !== b.resourceType || a.deliveryType !== b.deliveryType || typeof a.publicId !== 'string' || !a.publicId) return false
  const path = b.path.join('/').replace(MEDIA_EXTENSION, '')
  if (path !== a.publicId && !path.endsWith('/' + a.publicId)) return false
  const prefix = path.slice(0, path.length - a.publicId.length).split('/').filter(Boolean)
  if (/^v\d+$/.test(prefix.at(-1))) prefix.pop()
  return prefix.every(segment => TRANSFORMATION.test(segment))
}

function urlMatcher(asset) {
  const urls = [asset.url, asset.ai_url].filter(Boolean)
  // public_id is authoritative when a folder name resembles a transformation.
  const known = urls.map(cloudinaryIdentity).filter(Boolean).map(identity => ({ ...identity, publicId: asset.public_id }))
  const exact = urls.map(parsedUrl).filter(Boolean).map(url => { url.hash = ''; return url.href })
  return value => {
    const url = parsedUrl(value)
    if (!url) return false
    url.hash = ''
    if (exact.includes(url.href)) return true
    const identity = cloudinaryIdentity(value)
    return known.some(original => sameCloudinaryResource(original, identity))
  }
}

function jsonFields(value, asset, matchesUrl) {
  const content = typeof value === 'string' ? JSON.parse(value) : value
  const fields = []
  const pending = [{ value: content, path: '', key: '' }]
  while (pending.length) {
    const item = pending.pop()
    if (Array.isArray(item.value)) {
      item.value.forEach((child, index) => pending.push({ value: child, path: item.path + '[' + index + ']', key: item.key }))
    } else if (item.value && typeof item.value === 'object') {
      Object.entries(item.value).forEach(([key, child]) => pending.push({ value: child, path: item.path ? item.path + '.' + key : key, key }))
    } else if (
      (ID_FIELD.test(item.key) && ['number', 'string'].includes(typeof item.value) && Number(item.value) === Number(asset.id)) ||
      (URL_FIELD.test(item.key) && matchesUrl(item.value)) ||
      (PUBLIC_ID_FIELD.test(item.key) && typeof item.value === 'string' && item.value === asset.public_id)
    ) fields.push(item.path)
  }
  return fields.sort()
}

// Inspect only reference fields; titles and prose containing IDs or URLs are not uses.
export function findMediaUsage(asset, { products = [], productMedia = [], homeSections = [], homeSettings = [] } = {}) {
  const references = []
  const matchesUrl = urlMatcher(asset)
  for (const product of products) {
    const fields = ['image', 'video'].filter(field => matchesUrl(product[field]))
    if (fields.length) references.push({ type: 'product', id: product.id, name: product.name, active: Boolean(Number(product.active)), fields })
  }
  for (const media of productMedia) {
    const fields = []
    if (matchesUrl(media.url)) fields.push('url')
    if (media.media_type === asset.media_type && media.public_id === asset.public_id) fields.push('public_id')
    if (fields.length) references.push({ type: 'product_media', id: media.id, product_id: media.product_id, name: media.product_name, active: Boolean(Number(media.active)), fields })
  }
  for (const section of homeSections) {
    for (const [column, state] of [['draft_content', 'draft'], ['published_content', 'published']]) {
      const fields = jsonFields(section[column], asset, matchesUrl)
      if (fields.length) references.push({ type: 'home_section', id: section.section_key, name: Object.hasOwn(SECTION_NAMES, section.section_key) ? SECTION_NAMES[section.section_key] : 'Seção da Home', state, fields })
    }
  }
  for (const setting of homeSettings) {
    for (const [column, state] of [['draft_value', 'draft'], ['setting_value', 'published']]) {
      const fields = jsonFields(setting[column], asset, matchesUrl)
      if (fields.length) references.push({ type: 'home_setting', id: setting.setting_key, name: Object.hasOwn(SETTING_NAMES, setting.setting_key) ? SETTING_NAMES[setting.setting_key] : 'Configuração da Home', state, fields })
    }
  }
  return references
}

export async function loadMediaUsage(asset, query, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE' : ''
  // Lock every row/range during deletion: URL/JSON references have no foreign keys.
  const products = await query('SELECT id,name,image,video,active FROM products ORDER BY id' + suffix)
  const productMedia = await query('SELECT pm.id,pm.product_id,pm.media_type,pm.url,pm.public_id,p.name AS product_name,p.active FROM product_media pm LEFT JOIN products p ON p.id=pm.product_id ORDER BY pm.id' + suffix)
  const homeSections = await query('SELECT section_key,draft_content,published_content FROM home_sections ORDER BY id' + suffix)
  const homeSettings = await query('SELECT setting_key,setting_value,draft_value FROM home_settings ORDER BY setting_key' + suffix)
  return findMediaUsage(asset, { products, productMedia, homeSections, homeSettings })
}
