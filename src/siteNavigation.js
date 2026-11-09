// Menu and footer data shared by the storefront and the server.

// Without menu items in the CMS (Configurações → Menu), the main categories show.
export const DEFAULT_MENU = ['Camisetas', 'Calças', 'Camisas', 'Moletons']

export function navigationLinks(navigation, limit = 8) {
  const items = Array.isArray(navigation?.items) ? navigation.items.filter(item => item && typeof item.label === 'string' && item.label.trim()) : []
  const links = items.length
    ? items.map((item, index) => ({ id: 'cms-menu-' + index, name: item.label, url: item.url || '/shop' }))
    : DEFAULT_MENU.map((name, index) => ({ id: 'menu-' + index, name, url: '/shop?category=' + encodeURIComponent(name) }))
  return links.slice(0, limit)
}

// Only a real Instagram profile becomes a link: a handle (@galeo) or an
// https address on instagram.com. Anything else is ignored.
export function instagramUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  const handle = text.match(/^@?([A-Za-z0-9._]{1,30})$/)
  if (handle) return 'https://www.instagram.com/' + handle[1] + '/'
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || url.username || url.password || !['instagram.com', 'www.instagram.com'].includes(url.hostname)) return ''
    const [profile] = url.pathname.split('/').filter(Boolean)
    return profile && /^[A-Za-z0-9._]{1,30}$/.test(profile) ? 'https://www.instagram.com/' + profile + '/' : ''
  } catch {
    return ''
  }
}

// A Brazilian WhatsApp number with area code, with or without +55.
export function whatsappNumber(value) {
  let digits = typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\D/g, '') : ''
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits
  // Area code 11–99, then a mobile (9 + 8 digits) or a landline (2–5 + 7 digits).
  return /^55[1-9][1-9](?:9\d{8}|[2-5]\d{7})$/.test(digits) ? digits : ''
}

export const whatsappUrl = value => {
  const number = whatsappNumber(value)
  return number ? 'https://wa.me/' + number : ''
}

// Stored footer settings keep only known, bounded fields.
export function normalizeFooterSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const text = (input, max) => typeof input === 'string' ? input.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
  const location = text(source.location, 80)
  return {
    brand: text(source.brand, 60),
    year: text(source.year, 10),
    ...(location ? { location } : {}),
    instagram: instagramUrl(source.instagram),
    whatsapp: whatsappNumber(source.whatsapp)
  }
}
