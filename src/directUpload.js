export const directUploadsEnabled = import.meta.env?.VITE_DIRECT_UPLOADS === 'true'

const MAX_BYTES = 25 * 1024 * 1024
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime'])

function destination(url) {
  if (url === '/api/admin/media-library') return { purpose: 'library', target_id: null }
  let match = url.match(/^\/api\/admin\/products\/([1-9]\d*)\/media$/)
  if (match) return { purpose: 'product', target_id: Number(match[1]) }
  match = url.match(/^\/api\/admin\/media-library\/([1-9]\d*)\/replacement$/)
  if (match) return { purpose: 'replacement', target_id: Number(match[1]) }
  throw new Error('Destino de mídia inválido.')
}

// The application only receives a small signed confirmation. File bytes travel from
// the owner's browser directly to Cloudinary, outside the hosting request limit.
export async function uploadDirectMedia({ api, csrf, url, files, onProgress }) {
  const target = destination(url)
  files = [...files]
  if (!files.length) throw new Error('Selecione pelo menos um arquivo.')
  if (target.purpose === 'replacement' && files.length !== 1) throw new Error('Selecione somente o novo arquivo.')
  for (const file of files) {
    if (!TYPES.has(file.type)) throw new Error('Arquivo não suportado. Use JPG, PNG, WebP ou AVIF; MP4, WebM ou MOV.')
    if (!file.size || file.size > MAX_BYTES) throw new Error('Cada arquivo deve ter até 25 MB.')
  }
  async function send(path, body) {
    if (api) return api(path, { method: 'POST', body })
    const token = typeof csrf === 'function' ? csrf() : csrf
    const headers = { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) }
    const response = await fetch(path, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401 || data?.code === 'ADMIN_OWNER_REQUIRED') window.dispatchEvent(new Event('galeo-admin-auth-required'))
      throw new Error(data?.error || 'Não foi possível confirmar o envio da mídia.')
    }
    return data
  }
  const media = [], items = []
  let result
  for (let start = 0; start < files.length; start += 8) {
    const batch = files.slice(start, start + 8)
    const signed = await send('/api/admin/media-upload/sign', { ...target, files: batch.map(file => ({ name: file.name, type: file.type, size: file.size })) })
    if (!Array.isArray(signed?.uploads) || signed.uploads.length !== batch.length) throw new Error('O servidor não autorizou todos os arquivos. Tente novamente.')
    const uploads = []
    for (let index = 0; index < batch.length; index++) {
      const authorization = signed.uploads[index]
      if (!/^https:\/\/api\.cloudinary\.com\/v1_1\/[^/?#]+\/(image|video)\/upload$/.test(authorization?.upload_url || '') || !authorization.ticket || !authorization.api_key || !authorization.signature || !authorization.params) throw new Error('O servidor não confirmou um destino seguro para a mídia.')
      const form = new FormData()
      form.append('file', batch[index])
      for (const [key, value] of Object.entries(authorization.params)) form.append(key, String(value))
      form.append('api_key', authorization.api_key)
      form.append('signature', authorization.signature)
      const response = await fetch(authorization.upload_url, { method: 'POST', body: form, credentials: 'omit', redirect: 'error' })
      const uploaded = await response.json().catch(() => null)
      if (!response.ok || !uploaded?.public_id || !Number.isSafeInteger(uploaded.version)) throw new Error('Não foi possível enviar o arquivo ao armazenamento. Tente novamente.')
      uploads.push({ ticket: authorization.ticket, public_id: uploaded.public_id, version: uploaded.version, signature: uploaded.signature })
    }
    result = await send(url, { uploads })
    if (!result?.success) throw new Error('O servidor não confirmou o envio da mídia.')
    if (Array.isArray(result.media)) media.push(...result.media)
    if (Array.isArray(result.items)) items.push(...result.items)
    onProgress?.(Math.min(start + batch.length, files.length), files.length)
  }
  return { ...result, ...(Array.isArray(result.media) ? { media } : {}), ...(Array.isArray(result.items) ? { items } : {}) }
}
