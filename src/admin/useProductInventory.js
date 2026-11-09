import { useRef, useState } from 'react'
import { productHasVariants } from '../productVariants'

// Stock of one product, with or without sizes. A product may sell while its
// form stays open, so the stock is only sent when the owner changed it, with
// the token of the balance the form started from.
export const inventoryFormValue = (enabled, variants, stock) => JSON.stringify({
  enabled: Boolean(enabled),
  stock: enabled ? null : Number(stock || 0),
  variants: enabled ? variants.map(row => ({
    id: Number(row.id) || null, size: String(row.size || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR'),
    stock: Number(row.stock || 0), active: row.active !== false && Number(row.active ?? 1) !== 0
  })) : []
})

const rowsFrom = variants => (variants || []).map(variant => ({ ...variant, _key: 'saved-' + variant.id, active: variant.active !== false && Number(variant.active ?? 1) !== 0 }))
const sameSize = (a, b) => String(a || '').trim().toLocaleUpperCase('pt-BR') === String(b || '').trim().toLocaleUpperCase('pt-BR')

export default function useProductInventory(product) {
  const [sizesEnabled, setSizesEnabled] = useState(() => productHasVariants(product))
  const [savedHasSizes, setSavedHasSizes] = useState(() => productHasVariants(product))
  const [rows, setRows] = useState(() => rowsFrom(product?.variants))
  const [stock, setStock] = useState(() => Number(product?.stock || 0))
  const [conflict, setConflict] = useState(false)
  const baseline = useRef({
    value: inventoryFormValue(productHasVariants(product), product?.variants || [], product?.stock),
    token: product?.inventory_token
  })
  const total = rows.filter(row => row.active).reduce((sum, row) => sum + Math.max(0, Number(row.stock) || 0), 0)

  function remember(saved) {
    const enabled = productHasVariants(saved)
    const savedRows = rowsFrom(saved.variants)
    baseline.current = { value: inventoryFormValue(enabled, savedRows, saved.stock), token: saved.inventory_token }
    setStock(Number(saved.stock || 0))
    setSizesEnabled(enabled)
    setSavedHasSizes(enabled)
    setRows(savedRows)
    setConflict(false)
  }

  const changed = isNew => isNew || inventoryFormValue(sizesEnabled, rows, stock) !== baseline.current.value

  // Fields for the product request; empty when the stock was not touched.
  function requestFields(isNew) {
    if (!changed(isNew)) return {}
    if (sizesEnabled && (!rows.some(row => row.active) || rows.some(row => !String(row.size || '').trim()))) {
      throw new Error('Dê um nome a cada tamanho (por exemplo P, M ou 40) ou remova os que ficaram vazios.')
    }
    const fields = { stock: sizesEnabled ? total : Number(stock || 0) }
    if (sizesEnabled || savedHasSizes) {
      fields.variants = sizesEnabled ? rows.map(row => ({ ...(row.id ? { id: Number(row.id) } : {}), size: String(row.size || '').trim(), stock: Number(row.stock || 0), active: row.active })) : []
    }
    if (!isNew && baseline.current.token) fields.inventory_token = baseline.current.token
    return fields
  }

  function enableSizes(enabled) {
    setSizesEnabled(enabled)
  }

  function addSize(size = '') {
    setRows(current => {
      const existing = size && current.find(row => sameSize(row.size, size))
      if (existing) return existing.active ? current : current.map(row => row === existing ? { ...row, active: true } : row)
      return [...current, { _key: crypto.randomUUID(), size, stock: 0, active: true }]
    })
  }

  const hasSize = size => rows.some(row => row.active && sameSize(row.size, size))

  function changeRow(key, field, value) {
    setRows(current => current.map(row => row._key === key ? { ...row, [field]: value } : row))
  }

  // Returns an error message when the size still has units.
  function removeRow(row) {
    if (row.id && Number(row.stock) > 0) return 'Zere a quantidade desse tamanho antes de tirá-lo da venda.'
    setRows(current => row.id ? current.map(item => item._key === row._key ? { ...item, active: false, stock: 0 } : item) : current.filter(item => item._key !== row._key))
    return ''
  }

  return { sizesEnabled, enableSizes, rows, addSize, hasSize, changeRow, removeRow, stock, setStock, total, remember, requestFields, conflict, setConflict }
}
