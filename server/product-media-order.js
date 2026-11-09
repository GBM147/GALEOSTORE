// A new order for a product's photos and videos must list exactly the media the
// product has now, each once. Anything else means the gallery changed meanwhile.
export class ProductMediaOrderError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function productMediaOrder(currentIds, requestedIds) {
  if (!Array.isArray(requestedIds) || !requestedIds.length) throw new ProductMediaOrderError('Envie a nova ordem das fotos.')
  const ids = requestedIds.map(Number)
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new ProductMediaOrderError('A nova ordem tem uma foto inválida.')
  if (new Set(ids).size !== ids.length) throw new ProductMediaOrderError('A nova ordem repete uma foto.')
  const current = new Set(currentIds.map(Number))
  if (ids.length !== current.size || ids.some(id => !current.has(id))) {
    throw new ProductMediaOrderError('As fotos do produto mudaram. Atualize a tela e tente de novo.', 409)
  }
  return ids
}
