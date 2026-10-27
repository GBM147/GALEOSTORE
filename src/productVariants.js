export function productHasVariants(product) {
  return (product?.has_variants === true || Number(product?.has_variants) === 1) || (Array.isArray(product?.variants) && product.variants.length > 0)
}

export function activeProductVariants(product) {
  return (Array.isArray(product?.variants) ? product.variants : [])
    .filter(variant => variant.active !== false && Number(variant.active ?? 1) !== 0)
}

export function findProductVariant(product, id) {
  const value = Number(id)
  return Number.isSafeInteger(value) && value > 0
    ? activeProductVariants(product).find(variant => Number(variant.id) === value)
    : undefined
}

export function productForVariant(product, id) {
  if (!productHasVariants(product)) return { ...product, variant_id: null, size_label: '' }
  const variant = findProductVariant(product, id)
  return {
    ...product,
    stock: Math.max(0, Number(variant?.stock || 0)),
    variant_id: variant ? Number(variant.id) : null,
    size_label: variant?.size || ''
  }
}

export function cartLineKey(item) {
  return String(Number(item?.product_id ?? item?.id)) + ':' + String(Number(item?.variant_id) || 'base')
}

const clothingOrder = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'XXG', 'XXXG']
export function compareSizes(left, right) {
  const a = String(left || '').trim().toUpperCase(), b = String(right || '').trim().toUpperCase()
  const ai = clothingOrder.indexOf(a), bi = clothingOrder.indexOf(b)
  if (ai >= 0 && bi >= 0) return ai - bi
  if (ai >= 0 || bi >= 0) return ai >= 0 ? -1 : 1
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
}
