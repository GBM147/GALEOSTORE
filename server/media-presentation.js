// A branded canvas reuses the already isolated garment. It never runs AI again.
export function galeoBackgroundUrl(aiUrl) {
  if (typeof aiUrl !== 'string') return null
  try {
    const url = new URL(aiUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password) return null
    const match = url.pathname.match(/^\/([^/]+)\/image\/upload\/(.+)$/)
    if (!match || /^s--/.test(match[2])) return null
    // A fragment is never sent to Cloudinary: reuse the cached transparent PNG.
    url.hash = '_galeo_background'
    return url.href
  } catch { return null }
}

export function mediaAssetView(row) {
  const galeoUrl = row.ai_status === 'done' ? galeoBackgroundUrl(row.ai_url) : null
  const presentation = row.use_ai ? (row.presentation === 'galeo' && galeoUrl ? 'galeo' : 'ai') : 'original'
  return {
    id: row.id, title: row.title, media_type: row.media_type, width: row.width, height: row.height,
    original_url: row.url, ai_url: row.ai_url, galeo_url: galeoUrl,
    ai_status: row.ai_status, use_ai: Boolean(row.use_ai), presentation,
    url: presentation === 'galeo' ? galeoUrl : presentation === 'ai' && row.ai_url ? row.ai_url : row.url,
    created_at: row.created_at, sort_order: Number(row.sort_order || 0), replaces_id: row.replaces_id || null
  }
}

export function moveMedia(ids, { id, before_id, after_id }) {
  if (!Number.isSafeInteger(id) || id <= 0 || !ids.includes(id)) throw new Error('Mídia não encontrada para mover.')
  if (Number.isSafeInteger(before_id) === Number.isSafeInteger(after_id)) throw new Error('Escolha um único destino para mover a mídia.')
  const anchor = before_id ?? after_id
  if (!Number.isSafeInteger(anchor) || anchor <= 0 || anchor === id || !ids.includes(anchor)) throw new Error('Destino da ordenação inválido.')
  const next = ids.filter(value => value !== id)
  const index = next.indexOf(anchor) + (after_id !== undefined ? 1 : 0)
  next.splice(index, 0, id)
  return next
}
