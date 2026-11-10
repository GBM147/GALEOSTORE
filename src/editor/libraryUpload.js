import { adminApi, getAdminCsrfToken } from '../adminApi'
import { directUploadsEnabled, uploadDirectMedia } from '../directUpload'
import { preparePhoto } from '../admin/resizeImage'

// Sends one photo or video from the editor to the media library and returns
// the new library item, so it can be used right away. Large photos are
// reduced first.
export async function uploadToLibrary(file) {
  const prepared = String(file?.type || '').startsWith('image/') ? await preparePhoto(file) : file
  let data
  if (directUploadsEnabled) {
    data = await uploadDirectMedia({ api: adminApi, url: '/api/admin/media-library', files: [prepared] })
  } else {
    const form = new FormData()
    form.append('media', prepared)
    const token = getAdminCsrfToken()
    const response = await fetch('/api/admin/media-library', { method: 'POST', credentials: 'include', headers: token ? { 'X-CSRF-Token': token } : {}, body: form })
    data = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401 || data?.code === 'ADMIN_OWNER_REQUIRED') window.dispatchEvent(new Event('galeo-admin-auth-required'))
      throw new Error(data?.error || 'Não foi possível enviar. Tente de novo.')
    }
  }
  const item = Array.isArray(data?.items) ? data.items[0] : null
  if (!item) throw new Error('O servidor não confirmou o envio. Tente de novo.')
  return item
}
