import { adminApi as api, getAdminCsrfToken } from '../adminApi'
import { directUploadsEnabled, uploadDirectMedia } from '../directUpload'

// Sends photos and videos of one product to the media storage (directly to
// Cloudinary when enabled, otherwise through the server in batches of 8).
export const uploadProductMedia = async (productId, files, onProgress) => {
  if (!productId) throw new Error('Salve o produto antes de enviar as imagens.')
  if (!files.length) return { success: true, media: [] }
  if (directUploadsEnabled) {
    const data = await uploadDirectMedia({ api, url: '/api/admin/products/' + productId + '/media', files, onProgress })
    if (!Array.isArray(data?.media)) throw new Error('O servidor não confirmou o envio das imagens.')
    return data
  }

  const batchSize = 8
  const results = []

  for (let start = 0; start < files.length; start += batchSize) {
    const batch = files.slice(start, start + batchSize)
    const formData = new FormData()
    batch.forEach((file) => formData.append('media', file))

    const headers = {}
    const csrfToken = getAdminCsrfToken()
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const response = await fetch('/api/admin/products/' + productId + '/media', {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers
    })

    const raw = await response.text()
    let data = null
    try { data = raw ? JSON.parse(raw) : null } catch {}

    if (!response.ok) {
      if (response.status === 401 || data?.code === 'ADMIN_OWNER_REQUIRED') {
        window.dispatchEvent(new Event('galeo-admin-auth-required'))
      }
      throw new Error(data?.error || 'Não foi possível enviar a mídia.')
    }

    if (!Array.isArray(data?.media)) {
      throw new Error('O servidor não confirmou o envio das imagens.')
    }

    results.push(...data.media)
    onProgress?.(Math.min(start + batch.length, files.length), files.length)
  }

  return { success: true, media: results }
}
