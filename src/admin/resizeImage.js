// Phone photos often have 5–12 MB. Before sending, large JPEG, PNG and WebP
// photos are reduced to at most 2000 px on the longest side, which keeps them
// sharp on the store and makes the upload fast on mobile data. Anything that
// cannot be reduced safely is sent as it is.
export const MAX_PHOTO_SIDE = 2000
const SMALL_ENOUGH = 1.5 * 1024 * 1024

export function scaledSize(width, height, max = MAX_PHOTO_SIDE) {
  if (!(width > 0) || !(height > 0)) return null
  const ratio = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * ratio), height: Math.round(height * ratio), scaled: ratio < 1 }
}

const outputType = type => type === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
const renamed = (name, type) => String(name || 'foto').replace(/\.[^.]+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.webp')

export async function preparePhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file?.type || '') || typeof createImageBitmap !== 'function') return file
  let bitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { return file }
  try {
    const size = scaledSize(bitmap.width, bitmap.height)
    if (!size || (!size.scaled && file.size <= SMALL_ENOUGH)) return file
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, size.width, size.height)
    const type = outputType(file.type)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, type === 'image/jpeg' ? 0.86 : 0.9))
    // Browsers without WebP encoding return PNG; then the original is kept.
    if (!blob || blob.type !== type || blob.size >= file.size) return file
    return new File([blob], renamed(file.name, type), { type, lastModified: file.lastModified })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
