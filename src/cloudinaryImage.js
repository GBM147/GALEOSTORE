// Cloudinary serves an upload resized and in a modern format (WebP/AVIF) when the
// URL asks for it. Only plain uploads are changed: a URL that already carries
// transformations, such as the background-removed version, is kept as is, so a
// paid effect is never computed again for every new size.
const marker = '/image/upload/'
const transformationPart = /^[a-z]{1,4}_[^/,]*$/

export function cloudinaryImageUrl(url, width) {
  if (typeof url !== 'string' || !url) return url
  let parsed
  try { parsed = new URL(url) } catch { return url }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return url
  const index = parsed.pathname.indexOf(marker)
  if (index < 0) return url
  const rest = parsed.pathname.slice(index + marker.length)
  const first = rest.split('/')[0]
  if (!first || !rest.includes('/') && !/\.[a-z0-9]{2,5}$/i.test(first)) return url
  if (first.split(',').every(part => transformationPart.test(part))) return url
  const size = Math.min(4000, Math.max(16, Math.round(Number(width) || 0)))
  if (!Number.isFinite(size)) return url
  parsed.pathname = parsed.pathname.slice(0, index + marker.length) + 'f_auto,q_auto,c_limit,w_' + size + '/' + rest
  return parsed.href
}

// A still frame (Cloudinary's default, the middle of the video) of a plain
// video upload, used as a poster and by the light version instead of the video.
const videoMarker = '/video/upload/'
export function cloudinaryVideoPoster(url, width) {
  if (typeof url !== 'string' || !url) return ''
  let parsed
  try { parsed = new URL(url) } catch { return '' }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return ''
  const index = parsed.pathname.indexOf(videoMarker)
  if (index < 0) return ''
  const rest = parsed.pathname.slice(index + videoMarker.length)
  const first = rest.split('/')[0]
  if (!first || first.split(',').every(part => transformationPart.test(part)) && rest.includes('/')) return ''
  const size = Math.min(4000, Math.max(16, Math.round(Number(width) || 0)))
  const still = /\.[a-z0-9]{2,5}$/i.test(rest) ? rest.replace(/\.[a-z0-9]{2,5}$/i, '.jpg') : rest + '.jpg'
  parsed.pathname = parsed.pathname.slice(0, index + videoMarker.length) + 'q_auto,c_limit,w_' + size + '/' + still
  parsed.search = ''
  return parsed.href
}

export function cloudinarySrcSet(url, widths = []) {
  const entries = widths.map(width => [cloudinaryImageUrl(url, width), Math.round(width)]).filter(([candidate]) => candidate && candidate !== url)
  return entries.length ? entries.map(([candidate, width]) => candidate + ' ' + width + 'w').join(', ') : undefined
}

export const imageWidths = {
  card: [320, 480, 640, 960],
  thumbnail: [120, 240],
  gallery: [480, 720, 960, 1280, 1600],
  banner: [640, 960, 1280, 1600, 1920, 2560],
  bannerMobile: [480, 720, 1080, 1440]
}
