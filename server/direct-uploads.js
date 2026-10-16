import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const DIRECT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
const MAX_FILES = 8
const TICKET_LIFETIME_MS = 10 * 60 * 1000
const formats = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/avif': ['avif'],
  'video/mp4': ['mp4'], 'video/webm': ['webm'], 'video/quicktime': ['mov']
}
// Only this module can create these handles. A submitted JSON object cannot impersonate
// the Cloudinary metadata verified through the authenticated provider API.
const verifiedAssets = new WeakMap()
export const getVerifiedDirectAsset = (handle) => handle && typeof handle === 'object' ? verifiedAssets.get(handle) : undefined

function fail(message, status = 400) { const error = new Error(message); error.status = status; return error }
function equal(left, right) {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right))
  return a.length === b.length && timingSafeEqual(a, b)
}
function owner(req) {
  if (!Number.isSafeInteger(Number(req.admin?.id)) || Number(req.admin.id) <= 0) throw fail('Entre novamente no painel.', 401)
  if (String(req.admin.role).toLowerCase() !== 'owner') throw fail('Somente os donos podem enviar mídia.', 403)
  return Number(req.admin.id)
}
function target(purpose, value) {
  if (purpose === 'library' && (value === null || value === undefined)) return { purpose, id: null, folder: 'galeo-store/library' }
  const id = Number(value)
  if (!['product', 'replacement'].includes(purpose) || !Number.isSafeInteger(id) || id <= 0) throw fail('Destino de mídia inválido.')
  return { purpose, id, folder: purpose === 'product' ? 'galeo-store/products/' + id : 'galeo-store/library' }
}
function requestTarget(req) {
  const pathname = String(req.originalUrl || req.url || '').split('?')[0]
  if (pathname === '/api/admin/media-library') return target('library', null)
  let match = pathname.match(/^\/api\/admin\/products\/([1-9]\d*)\/media$/)
  if (match) return target('product', match[1])
  match = pathname.match(/^\/api\/admin\/media-library\/([1-9]\d*)\/replacement$/)
  if (match) return target('replacement', match[1])
  throw fail('Destino de mídia inválido.')
}
function descriptor(file) {
  if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 || /[\u0000-\u001f\u007f]/.test(file.name)) throw fail('Nome de arquivo inválido.')
  if (!Object.hasOwn(formats, file.type)) throw fail('Arquivo não suportado. Use JPG, PNG, WebP ou AVIF; MP4, WebM ou MOV.')
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > DIRECT_UPLOAD_MAX_BYTES) throw fail('Cada arquivo deve ter até 25 MB.')
  return { name: file.name, mime: file.type, bytes: file.size, resource: file.type.startsWith('video/') ? 'video' : 'image' }
}

export function createDirectUploads({ multipartUpload, cloudinary, query, sessionSecret, cloudinaryConfigurado, now = Date.now, uuid = randomUUID }) {
  if (!sessionSecret) throw new Error('A assinatura de mídia exige SESSION_SECRET.')
  const key = createHmac('sha256', sessionSecret).update('galeo:direct-media-upload:v1').digest()
  const mac = (value) => createHmac('sha256', key).update(value).digest('base64url')
  const pack = (value) => { const body = Buffer.from(JSON.stringify(value)).toString('base64url'); return body + '.' + mac(body) }
  const unpack = (ticket) => {
    if (typeof ticket !== 'string' || ticket.length > 4096) throw fail('Autorização de mídia inválida.')
    const parts = ticket.split('.')
    if (parts.length !== 2 || !equal(mac(parts[0]), parts[1])) throw fail('Autorização de mídia inválida.')
    let value
    try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch { throw fail('Autorização de mídia inválida.') }
    if (value.v !== 1 || !Number.isSafeInteger(value.issued) || !Number.isSafeInteger(value.expires) || value.issued > now() + 30000 || value.expires <= now() || value.expires - value.issued > TICKET_LIFETIME_MS) throw fail('O envio expirou. Selecione o arquivo novamente.')
    return value
  }
  const config = () => {
    if (!cloudinaryConfigurado()) throw fail('Cloudinary não configurado no servidor.', 503)
    const c = cloudinary.config()
    if (!c?.cloud_name || !c.api_key || !c.api_secret) throw fail('Cloudinary não configurado no servidor.', 503)
    return c
  }
  const checkTarget = async (destination) => {
    if (destination.purpose === 'library') return
    const table = destination.purpose === 'product' ? 'products' : 'media_assets'
    const rows = await query('SELECT id' + (table === 'media_assets' ? ',media_type' : '') + ' FROM ' + table + ' WHERE id=? LIMIT 1', [destination.id])
    if (!rows.length) throw fail(destination.purpose === 'product' ? 'Produto não encontrado.' : 'Mídia original não encontrada.', 404)
    return rows[0]
  }
  const respondError = (res, error) => res.status(error.status || 502).json({ error: error.status ? error.message : 'Não foi possível verificar o arquivo no armazenamento. Tente novamente.' })
  const sign = async (req, res) => {
    try {
      const actor = owner(req), c = config(), body = req.body || {}
      const destination = target(body.purpose, body.target_id)
      if (!Array.isArray(body.files) || !body.files.length || body.files.length > (destination.purpose === 'replacement' ? 1 : MAX_FILES)) throw fail('Selecione de 1 a 8 arquivos por envio.')
      const files = body.files.map(descriptor)
      const existing = await checkTarget(destination)
      if (existing && files.some(file => existing.media_type && existing.media_type !== file.resource)) throw fail('Substitua uma foto por outra foto, ou um vídeo por outro vídeo.')
      const issued = now(), expires = issued + TICKET_LIFETIME_MS
      const uploads = files.map((file) => {
        const nonce = uuid(), publicId = destination.folder + '/' + nonce
        const params = { timestamp: Math.floor(issued / 1000), folder: destination.folder, public_id: nonce, overwrite: false, unique_filename: false, allowed_formats: formats[file.mime], type: 'upload' }
        return {
          ticket: pack({ v: 1, actor, purpose: destination.purpose, target: destination.id, folder: destination.folder, publicId, ...file, issued, expires }),
          upload_url: 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(c.cloud_name) + '/' + file.resource + '/upload',
          api_key: c.api_key, params, signature: cloudinary.utils.api_sign_request(params, c.api_secret)
        }
      })
      res.json({ uploads, expires_at: new Date(expires).toISOString() })
    } catch (error) { respondError(res, error) }
  }
  const receive = (single, field, count) => async (req, res, next) => {
    if (!req.is('application/json')) return (single ? multipartUpload.single(field) : multipartUpload.array(field, count))(req, res, next)
    try {
      const actor = owner(req), c = config(), destination = requestTarget(req)
      const uploads = req.body?.uploads
      if (!Array.isArray(uploads) || !uploads.length || uploads.length > (single ? 1 : Math.min(count || MAX_FILES, MAX_FILES))) throw fail('Selecione de 1 a 8 arquivos por envio.')
      await checkTarget(destination)
      const seen = new Set()
      // At most eight independent provider reads share the same 15-second window;
      // serial verification could exceed the serverless execution budget.
      const files = await Promise.all(uploads.map(async (uploaded) => {
        const claim = unpack(uploaded?.ticket)
        if (claim.actor !== actor || claim.purpose !== destination.purpose || claim.target !== destination.id || claim.folder !== destination.folder || claim.publicId !== uploaded.public_id || !claim.publicId.startsWith(destination.folder + '/') || seen.has(claim.publicId)) throw fail('Este arquivo não foi autorizado para este destino.')
        seen.add(claim.publicId)
        const file = descriptor({ name: claim.name, type: claim.mime, size: claim.bytes })
        if (file.resource !== claim.resource) throw fail('Tipo de arquivo inválido.')
        if (!Number.isSafeInteger(uploaded.version) || uploaded.version <= 0) throw fail('Versão de mídia inválida.')
        if (uploaded.signature !== undefined && (typeof uploaded.signature !== 'string' || !equal(uploaded.signature, cloudinary.utils.api_sign_request({ public_id: uploaded.public_id, version: uploaded.version }, c.api_secret)))) throw fail('A confirmação do armazenamento é inválida.')
        const asset = await cloudinary.api.resource(claim.publicId, { resource_type: claim.resource, type: 'upload', timeout: 15000 })
        if (asset.public_id !== claim.publicId || asset.version !== uploaded.version || asset.resource_type !== claim.resource || asset.type !== 'upload' || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > DIRECT_UPLOAD_MAX_BYTES || asset.bytes !== claim.bytes || !formats[claim.mime].includes(String(asset.format || '').toLowerCase())) throw fail('O arquivo recebido não corresponde ao envio autorizado.')
        let url
        try { url = new URL(asset.secure_url) } catch { throw fail('O armazenamento não confirmou uma URL segura.') }
        if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password || !url.pathname.startsWith('/' + c.cloud_name + '/' + claim.resource + '/upload/')) throw fail('O armazenamento não confirmou uma URL segura.')
        const handle = Object.freeze({})
        verifiedAssets.set(handle, Object.freeze({ ...asset }))
        // Legacy middleware exposed Latin-1 originalname; preserve its existing decoding.
        return { fieldname: field, originalname: Buffer.from(claim.name, 'utf8').toString('latin1'), mimetype: claim.mime, size: asset.bytes, buffer: handle }
      }))
      if (single) req.file = files[0]
      else req.files = files
      next()
    } catch (error) { respondError(res, error) }
  }
  return {
    mediaUpload: { array: (field, count = MAX_FILES) => receive(false, field, count), single: (field) => receive(true, field, 1) },
    register(app, { exigirLogin, exigirOwner }) { app.post('/api/admin/media-upload/sign', exigirLogin, exigirOwner, sign) }
  }
}
