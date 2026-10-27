import { createHash } from 'node:crypto'

// Inventory changes are made only inside the caller's business transaction.
// The product row is always locked before its stable size rows.
export class ProductVariantError extends Error {
  constructor(message, status = 400, code) { super(message); this.name = 'ProductVariantError'; this.status = status; this.code = code }
}
const fail = message => { throw new ProductVariantError(message) }
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0
const maxStock = 2147483647
const sizeKey = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleUpperCase('pt-BR')

export function inventoryToken(product) {
  const variants = [...(product.variants || [])].sort((a, b) => Number(a.id) - Number(b.id)).map(row => [
    Number(row.id), String(row.size), Number(row.stock), Boolean(Number(row.active)), Number(row.sort_order || 0)
  ])
  return createHash('sha256').update(JSON.stringify([Number(product.id), Number(product.stock), variants])).digest('base64url')
}

export function assertInventoryToken(product, token) {
  if (token === undefined) return
  if (typeof token !== 'string' || token !== inventoryToken(product)) {
    throw new ProductVariantError('O estoque mudou enquanto o produto estava aberto. Atualize as quantidades, confira os tamanhos e tente salvar novamente.', 409, 'INVENTORY_CHANGED')
  }
}

export async function ensureProductVariantSchema({ query, ensureColumn, recoveredIdFloor }) {
  if (recoveredIdFloor !== undefined && (!Number.isSafeInteger(recoveredIdFloor) || recoveredIdFloor < 1 || recoveredIdFloor > maxStock)) throw new Error('Piso de identificação inválido para recuperar tamanhos.')
  await query(`CREATE TABLE IF NOT EXISTS product_variants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    size VARCHAR(40) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_variant_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY uq_variant_product_size (product_id,size),
    INDEX idx_variant_product_order (product_id,sort_order,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` + (recoveredIdFloor === undefined ? '' : ' AUTO_INCREMENT=' + recoveredIdFloor))
  for (const table of ['sale_items', 'store_order_items', 'stock_movements']) {
    await ensureColumn(table, 'variant_id', 'INT NULL')
    await ensureColumn(table, 'size_label', "VARCHAR(40) NOT NULL DEFAULT ''")
    const constraint = 'fk_' + table + '_variant'
    const rows = await query('SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=? LIMIT 1', [table, constraint])
    if (!rows.length) await query('ALTER TABLE `' + table + '` ADD CONSTRAINT `' + constraint + '` FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL')
  }
}

export async function attachProductVariants(query, products, { publicOnly = false } = {}) {
  if (!products.length) return products
  const ids = [...new Set(products.map(product => Number(product.id)))]
  const rows = await query('SELECT id,product_id,size,stock,active,sort_order FROM product_variants WHERE product_id IN (' + ids.map(() => '?').join(',') + ') ORDER BY product_id,sort_order,id', ids)
  const byProduct = new Map()
  for (const row of rows) {
    if (!byProduct.has(Number(row.product_id))) byProduct.set(Number(row.product_id), [])
    byProduct.get(Number(row.product_id)).push({ ...row, id:Number(row.id), product_id:Number(row.product_id), stock:Number(row.stock), active:Boolean(row.active), sort_order:Number(row.sort_order) })
  }
  for (const product of products) {
    const variants = byProduct.get(Number(product.id)) || []
    product.has_variants = variants.length > 0
    product.variants = publicOnly ? variants.filter(row => row.active) : variants
    product.sizes = variants.filter(row => row.active).map(row => row.size)
    if (!publicOnly) product.inventory_token = inventoryToken({ ...product, variants })
  }
  return products
}

export function normalizeVariants(input) {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.length > 64) fail('Cadastre até 64 tamanhos por produto.')
  const sizes = new Set(), ids = new Set()
  let total = 0
  return input.map((row, sort_order) => {
    if (!row || typeof row !== 'object') fail('Tamanho inválido.')
    const size = String(row.size || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR')
    const stock = Number(row.stock)
    if (!size || size.length > 40 || /[\u0000-\u001f\u007f]/.test(size)) fail('Informe um tamanho com até 40 caracteres.')
    if (sizes.has(sizeKey(size))) fail('Não repita o mesmo tamanho na grade.')
    sizes.add(sizeKey(size))
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > maxStock) fail('A quantidade de cada tamanho deve ser um inteiro não negativo.')
    total += stock
    if (total > maxStock) fail('A soma das quantidades da grade é muito grande.')
    if (row.active !== undefined && typeof row.active !== 'boolean') fail('O estado do tamanho é inválido.')
    if (row.active === false && stock) fail('Zere o estoque do tamanho antes de desativá-lo.')
    const variantId = row.id === undefined || row.id === null || row.id === '' ? null : id(row.id)
    if (variantId === 0 || (variantId && ids.has(variantId))) fail('Identificação de tamanho inválida ou repetida.')
    if (variantId) ids.add(variantId)
    const stock_before=row.stock_before === undefined ? undefined : Number(row.stock_before)
    if (stock_before !== undefined && (!Number.isSafeInteger(stock_before) || stock_before < 0 || stock_before > maxStock)) fail('O estoque anterior do tamanho é inválido.')
    return { id:variantId, size, stock, active:row.active, sort_order, stock_before }
  })
}

export async function lockProductInventory(conn, productIds) {
  const ids = [...new Set(productIds.map(Number))].sort((a,b) => a-b)
  if (!ids.length) return new Map()
  const marks = ids.map(() => '?').join(',')
  const [products] = await conn.execute('SELECT * FROM products WHERE id IN (' + marks + ') ORDER BY id FOR UPDATE', ids)
  const [variants] = await conn.execute('SELECT * FROM product_variants WHERE product_id IN (' + marks + ') ORDER BY product_id,id FOR UPDATE', ids)
  const byId = new Map(products.map(product => [Number(product.id), { ...product, variants:[] }]))
  for (const variant of variants) byId.get(Number(variant.product_id))?.variants.push(variant)
  return byId
}

export function inventorySelection(product, variantId, { restoring = false } = {}) {
  if (!product) fail('Produto não encontrado.')
  const selectedId = variantId === undefined || variantId === null || variantId === '' ? null : id(variantId)
  if (selectedId === 0) fail('Tamanho inválido.')
  if (!product.variants.length) {
    if (selectedId) fail('Este produto não possui esse tamanho.')
    return { variant:null, variant_id:null, size_label:'', stock:Number(product.stock) }
  }
  if (!selectedId) fail('Escolha o tamanho de ' + product.name + '.')
  const variant = product.variants.find(row => Number(row.id) === selectedId)
  if (!variant || (!restoring && !Number(variant.active))) fail('O tamanho escolhido não está disponível para ' + product.name + '.')
  return { variant, variant_id:Number(variant.id), size_label:variant.size, stock:Number(variant.stock) }
}

export async function changeInventory(conn, product, variantId, delta, { restoring = false } = {}) {
  if (!Number.isSafeInteger(delta)) fail('Quantidade inválida.')
  const selection = inventorySelection(product, variantId, { restoring })
  const before = selection.stock, after = before + delta
  const totalBefore = Number(product.stock), totalAfter = totalBefore + delta
  if (after < 0) fail('Estoque insuficiente para ' + product.name + (selection.size_label ? ' no tamanho ' + selection.size_label : '') + '.')
  if (after > maxStock || totalAfter < 0 || totalAfter > maxStock) fail('Quantidade fora do limite permitido.')
  if (selection.variant) {
    // An inactive size cannot silently receive stock that would disappear from
    // the storefront. Retirement is already blocked while returns are possible.
    if (!Number(selection.variant.active) && after > 0) fail('Reative o tamanho ' + selection.size_label + ' antes de devolver o estoque.')
    await conn.execute('UPDATE product_variants SET stock=? WHERE id=? AND product_id=?', [after, selection.variant_id, product.id])
    selection.variant.stock = after
  }
  await conn.execute('UPDATE products SET stock=? WHERE id=?', [totalAfter, product.id])
  product.stock = totalAfter
  return { ...selection, before, after, totalBefore, totalAfter }
}

export async function recordInventoryMovement(conn, insertPrivateBusiness, productId, change, details) {
  const quantity = details.type === 'AJUSTE' ? change.after - change.before : Math.abs(change.after - change.before)
  if (!quantity) return
  await insertPrivateBusiness(conn, 'stock_movements',
    'INSERT INTO stock_movements(product_id,variant_id,size_label,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [productId, change.variant_id, change.size_label, details.type, quantity, change.before, change.after, details.reason || '', details.referenceId || null, Number(details.unitCost || 0), details.userId ?? null],
    { reason:7 })
}

async function activeVariantReferences(conn, productId, variantId = undefined) {
  const where = variantId === undefined ? '' : ' AND i.variant_id=?'
  const params = variantId === undefined ? [productId] : [productId, variantId]
  const [sales] = await conn.execute("SELECT i.id FROM sale_items i INNER JOIN sales s ON s.id=i.sale_id WHERE i.product_id=?" + where + " AND s.status<>'CANCELADA' LIMIT 1", params)
  const [orders] = await conn.execute("SELECT i.id FROM store_order_items i INNER JOIN store_orders o ON o.id=i.order_id WHERE i.product_id=?" + where + " AND (o.status<>'CANCELLED' OR o.payment_status='APPROVED') LIMIT 1", params)
  return sales.length || orders.length
}

// The product and its variants must already be locked. Missing input preserves
// the existing grade, and old clients cannot overwrite its aggregate stock.
export async function saveProductVariants(conn, product, input, { record } = {}) {
  const normalized = normalizeVariants(input)
  if (normalized === undefined) return { stock:Number(product.stock), hasVariants:product.variants.length > 0 }
  const existing = new Map(product.variants.map(row => [Number(row.id), row]))
  if (!existing.size && !normalized.length) return { stock:Number(product.stock), hasVariants:false }
  if (!existing.size && normalized.length && await activeVariantReferences(conn, product.id)) {
    fail('Este produto tem vendas ou pedidos sem tamanho que ainda podem ser cancelados. Finalize essas operações antes de ativar a grade, ou cadastre as novas peças em outro produto.')
  }
  const ids = new Set(normalized.map(row => row.id).filter(Boolean))
  for (const row of normalized) {
    if (row.id && !existing.has(row.id)) fail('Um tamanho informado não pertence a este produto.')
    const previous = row.id ? existing.get(row.id) : null
    if (previous && row.stock_before !== undefined && Number(previous.stock)!==row.stock_before) {
      throw new ProductVariantError('O estoque do tamanho '+previous.size+' mudou enquanto o produto estava aberto. Atualize o cadastro e confira as quantidades antes de salvar.',409,'INVENTORY_CHANGED')
    }
    if (previous && (previous.size !== row.size || row.active === false) && await activeVariantReferences(conn, product.id, row.id)) {
      fail('O tamanho ' + previous.size + ' possui vendas ou pedidos ativos. Preserve o cadastro até finalizar ou cancelar essas operações.')
    }
  }
  for (const previous of existing.values()) {
    if (ids.has(Number(previous.id))) continue
    if (Number(previous.stock) !== 0 || await activeVariantReferences(conn, product.id, Number(previous.id))) fail('Zere o estoque e finalize as operações do tamanho ' + previous.size + ' antes de removê-lo.')
    await conn.execute('DELETE FROM product_variants WHERE id=?', [previous.id])
  }
  // Renaming to another existing label cannot recycle that label's stable ID.
  const previousNames = new Map(product.variants.map(row => [sizeKey(row.size), Number(row.id)]))
  for (const row of normalized) {
    const occupied = previousNames.get(sizeKey(row.size))
    if (occupied && occupied !== row.id && ids.has(occupied)) fail('Cada tamanho deve manter sua identificação. Altere um nome de cada vez.')
    const previous = row.id ? existing.get(row.id) : null
    const active = row.active === undefined ? (previous ? Boolean(previous.active) : true) : row.active
    if (!active && row.stock) fail('Um tamanho desativado deve ter estoque zero.')
    if (row.id) {
      await conn.execute('UPDATE product_variants SET size=?,stock=?,active=?,sort_order=? WHERE id=? AND product_id=?', [row.size,row.stock,active ? 1 : 0,row.sort_order,row.id,product.id])
    } else {
      const [created] = await conn.execute('INSERT INTO product_variants(product_id,size,stock,active,sort_order) VALUES(?,?,?,?,?)', [product.id,row.size,row.stock,active ? 1 : 0,row.sort_order])
      row.id = created.insertId
    }
    const before = Number(previous?.stock || 0)
    if (record && before !== row.stock) await record({ variant_id:Number(row.id),size_label:row.size,before,after:row.stock })
  }
  const stock = normalized.reduce((sum,row) => sum + row.stock, 0)
  await conn.execute('UPDATE products SET stock=? WHERE id=?', [stock,product.id])
  product.stock = stock
  return { stock, hasVariants:normalized.length > 0 }
}
