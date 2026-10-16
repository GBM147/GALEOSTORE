// Keep cancelled transactions readable after a mistaken product is removed.
// This runs only in explicit migrations/classic initialization, never per request.
export async function ensureProductDeletionSchema({ query, ensureColumn }) {
  await ensureColumn('sale_items', 'product_name', "VARCHAR(180) NOT NULL DEFAULT ''")
  await ensureColumn('sale_items', 'brand', "VARCHAR(120) NOT NULL DEFAULT ''")
  for (const table of ['sale_items', 'store_order_items']) {
    const [column] = await query(
      'SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
      [table, 'product_id']
    )
    if (column?.nullable === 'NO') await query('ALTER TABLE `' + table + '` MODIFY COLUMN product_id INT NULL')
  }
  await query(`UPDATE sale_items si INNER JOIN products p ON p.id=si.product_id
    SET si.product_name=p.name,si.brand=p.brand WHERE si.product_name=''`)
}
