export class ProductImageSelectionError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'ProductImageSelectionError'
    this.status = status
  }
}

// Resolve a deliberate choice once, so later library choices cannot change a product.
export async function resolveProductImage(input, query) {
  const id = input.image_asset_id
  if (id === undefined || id === null || id === '') return String(input.image || '')
  const assetId = Number(id)
  if (!Number.isSafeInteger(assetId) || assetId <= 0 || !['number', 'string'].includes(typeof id)) {
    throw new ProductImageSelectionError('Mídia da imagem principal inválida.')
  }
  if (!['original', 'ai'].includes(input.image_variant)) {
    throw new ProductImageSelectionError('Escolha a versão original ou a versão sem fundo da imagem principal.')
  }
  const [asset] = await query('SELECT id,media_type,url,ai_url,ai_status FROM media_assets WHERE id=?', [assetId])
  if (!asset) throw new ProductImageSelectionError('Mídia da imagem principal não encontrada.', 404)
  if (asset.media_type !== 'image') throw new ProductImageSelectionError('A imagem principal deve ser uma foto.')
  if (input.image_variant === 'ai' && (asset.ai_status !== 'done' || !asset.ai_url)) {
    throw new ProductImageSelectionError('Esta foto ainda não tem uma versão sem fundo pronta.', 409)
  }
  const image = input.image_variant === 'ai' ? asset.ai_url : asset.url
  if (typeof image !== 'string' || !image || image.length > 1000) {
    throw new ProductImageSelectionError('A URL da imagem principal é inválida.')
  }
  return image
}
