import { PRIVATE_FIELD_MAP } from './database-privacy.js'

export const REQUIRED_RUNTIME_COLUMNS = Object.freeze({
  admin_users: ['id', 'email', 'password_hash', 'role', 'active'],
  categories: ['id', 'name', 'sort_order'],
  products: ['id', 'name', 'stock', 'image', 'video', 'active'],
  product_media: ['id', 'product_id', 'public_id', 'url', 'sort_order'],
  sessions: ['session_id', 'expires', 'data'],
  stock_movements: ['id', 'product_id', 'reason'],
  financial_accounts: ['id', 'name'],
  financial_categories: ['id', 'name', 'type'],
  financial_entries: ['id', 'reference_id', 'description'],
  recurring_expenses: ['id', 'description', 'active'],
  sales: ['id', 'client_reference', 'customer_name', 'notes'],
  sale_items: ['id', 'sale_id', 'product_id'],
  audit_logs: ['id', 'details', 'created_at'],
  customers: ['id', 'email', 'email_verified_at'],
  customer_email_verifications: ['customer_id', 'token_hash', 'expires_at'],
  store_orders: ['id', 'customer_id', 'payment_status', 'payment_url', 'sale_id'],
  store_order_items: ['id', 'order_id', 'product_id'],
  payments: ['id', 'payment_url', 'raw_payload'],
  integration_events: ['id', 'payload'],
  home_sections: ['id', 'section_key', 'draft_content', 'published_content', 'published_sort_order', 'published_visible'],
  home_settings: ['setting_key', 'setting_value', 'draft_value'],
  home_versions: ['id', 'version_number', 'snapshot'],
  media_assets: ['id', 'public_id', 'url', 'sort_order', 'presentation', 'replaces_id'],
  media_library_preferences: ['id', 'auto_prepare'],
  newsletter_subscriptions: ['id', 'email', 'email_lookup', 'private_data', 'status'],
  rate_limit_counters: ['bucket_key', 'hits', 'reset_at']
})

function migrationRequired() {
  const error = new Error('O banco precisa ser preparado pelo comando de migração antes de iniciar a API.')
  error.code = 'SCHEMA_MIGRATION_REQUIRED'
  return error
}

export async function validateRuntimeSchema({ db, privacy, protection }) {
  const [rows] = await db.execute('SELECT TABLE_NAME AS table_name,COLUMN_NAME AS column_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()')
  const known = new Map()
  for (const row of rows) {
    if (!known.has(row.table_name)) known.set(row.table_name, new Set())
    known.get(row.table_name).add(row.column_name)
  }
  for (const [table, columns] of Object.entries(REQUIRED_RUNTIME_COLUMNS)) {
    const required = [...columns, ...(Object.hasOwn(PRIVATE_FIELD_MAP, table) ? ['private_data', ...PRIVATE_FIELD_MAP[table]] : [])]
    if (required.some(column => !known.get(table)?.has(column))) throw migrationRequired()
  }
  // Check key continuity without a full-table migration or any startup writes.
  // Individual rows are authenticated again whenever the application reads them.
  for (const table of Object.keys(PRIVATE_FIELD_MAP)) {
    const [sample] = await db.execute('SELECT id,private_data FROM `' + table + '` WHERE private_data IS NOT NULL LIMIT 1')
    if (sample.length) privacy.decodeRow(table, sample[0])
    if (privacy.enabled) {
      const [plaintext] = await db.execute('SELECT id FROM `' + table + '` WHERE private_data IS NULL LIMIT 1')
      if (plaintext.length) throw migrationRequired()
    }
  }
  const [sessions] = await db.execute("SELECT session_id,data FROM sessions WHERE JSON_CONTAINS_PATH(data,'one','$.protected_session')=1 LIMIT 1")
  for (const row of sessions) {
    if (!protection) throw migrationRequired()
    const value = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    protection.decryptJSON(value.protected_session, { table: 'sessions', field: 'data', rowId: row.session_id })
  }
  if (protection) {
    const [plaintext] = await db.execute("SELECT session_id FROM sessions WHERE JSON_CONTAINS_PATH(data,'one','$.protected_session')=0 LIMIT 1")
    if (plaintext.length) throw migrationRequired()
  }
  return { schema: 'ready' }
}
