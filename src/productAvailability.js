export function productHasPrice(product) {
  const price = Number(product?.price)
  return Number.isFinite(price) && price > 0
}

export function productCanBePurchased(product) {
  const stock = Number(product?.stock)
  return productHasPrice(product) && Number.isFinite(stock) && stock > 0
}

export function formatProductPrice(value) {
  const price = Number(value)
  return Number.isFinite(price) && price > 0
    ? price.toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
    : 'Preço a definir'
}
