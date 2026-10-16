import { mediaAssetView } from './media-presentation.js'

export class MediaBackgroundError extends Error {
  constructor(message, status = 500) { super(message); this.status = status }
}

export async function prepareMediaBackground(asset, deps) {
  const { query, cloudinaryConfigurado, cloudinary, audit } = deps
  if (asset.media_type !== 'image') throw new MediaBackgroundError('A IA só trata fotos.', 400)
  if (asset.ai_status === 'done' && asset.ai_url) return { status: 200, body: { success: true, reused: true, item: mediaAssetView(asset) } }
  if (!cloudinaryConfigurado()) throw new MediaBackgroundError('Cloudinary não configurado no servidor.', 503)
  let url = asset.ai_url
  if (!url) {
    const claim = await query("UPDATE media_assets SET ai_status='processing', ai_started_at=NOW(), ai_url=NULL WHERE id=? AND (ai_status IN ('none','failed') OR (ai_status='processing' AND ai_started_at < NOW() - INTERVAL 10 MINUTE))", [asset.id])
    if (!claim.affectedRows) throw new MediaBackgroundError('Esta foto já está sendo tratada. Aguarde alguns segundos.', 409)
    try {
      const result = await cloudinary.uploader.explicit(asset.public_id, {
        type:'upload', resource_type:'image', eager:[{ effect:'background_removal', fetch_format:'png' }],
        eager_async:Boolean(deps.serverless), ...(deps.serverless ? { timeout:15000 } : {})
      })
      url = result?.eager?.[0]?.secure_url || (deps.serverless && typeof cloudinary.url === 'function'
        ? cloudinary.url(asset.public_id, { secure:true, resource_type:'image', type:'upload', effect:'background_removal', fetch_format:'png' })
        : null)
      if (!url) throw new Error('O Cloudinary não devolveu a versão tratada.')
      await query('UPDATE media_assets SET ai_url=? WHERE id=?', [url, asset.id])
    } catch (error) {
      await query("UPDATE media_assets SET ai_status='failed' WHERE id=?", [asset.id])
      throw error
    }
  }
  // Cloudinary owns asynchronous processing after this request ends. The next
  // explicit status check verifies the existing derivative, without requesting
  // another transformation or replacing the original photo.
  const justSubmitted = deps.serverless && !asset.ai_url
  const ready = justSubmitted ? false : await deps.verifyAiResult(url)
  if (ready) {
    await query("UPDATE media_assets SET ai_status='done', ai_done_at=NOW() WHERE id=?", [asset.id])
    await audit(deps.actorId, 'LIBRARY_AI_BACKGROUND', 'media_assets', asset.id, { public_id:asset.public_id, automatic:Boolean(deps.automatic) })
  }
  const [row] = await query('SELECT * FROM media_assets WHERE id=?', [asset.id])
  if (!ready) return { status:202,body:{success:true,processing:true,item:mediaAssetView(row),message:'A IA ainda está processando. Aguarde um pouco e clique em "Verificar resultado". Não gasta crédito extra.'} }
  return { status:200,body:{success:true,item:mediaAssetView(row)} }
}
