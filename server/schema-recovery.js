// Recover structural deletion without reintroducing the deleted business data.
export const OPERATIONAL_TABLES = Object.freeze([
  'recurring_expenses', 'payments', 'store_order_items', 'sale_items',
  'stock_movements', 'financial_entries', 'store_orders', 'sales',
  'customer_email_verifications', 'customers', 'product_media', 'products',
  'integration_events', 'newsletter_subscriptions'
])
export const RECOVERED_ID_FLOOR = 1000000000
const MAX_SIGNED_ID = 2147483647
const object = value => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Estrutura preservada inválida durante recuperação.')
  return parsed
}
const positiveId = value => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

export async function inspectOperationalRecovery(query) {
  const rows = await query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')
  const names = new Set(rows.map(row => row.name))
  // First installation has no surviving store configuration to recover.
  const active = names.has('admin_users') && names.has('home_sections')
  const missingTables = active ? OPERATIONAL_TABLES.filter(name => !names.has(name)) : []
  return { missingTables, existingTables: [...names], customersMissing: missingTables.includes('customers'), productsMissing: missingTables.includes('products'), nextId: RECOVERED_ID_FLOOR }
}

export function stripDeletedProductSelections(value) {
  const content = object(value)
  const copy = structuredClone(content)
  const pending = [copy]
  let highestId = 0, changed = false
  while (pending.length) {
    const node = pending.pop()
    for (const [key, child] of Object.entries(node)) {
      if (key === 'product_ids') {
        if (!Array.isArray(child)) throw new Error('Seleção de produtos preservada inválida.')
        for (const id of child) highestId = Math.max(highestId, positiveId(id))
        if (child.length) { node[key] = []; changed = true }
      } else if (child && typeof child === 'object') pending.push(child)
    }
  }
  return { content: copy, highestId, changed }
}

export async function restoreOperationalReferences({ db, query, state, protection = null }) {
  if (!state.missingTables.length) return { removedCustomerSessions: 0, detachedCustomerSessions: 0, clearedProductSelections: 0 }
  const conn = await db.getConnection()
  const result = { removedCustomerSessions: 0, detachedCustomerSessions: 0, clearedProductSelections: 0 }
  let highestId = 0
  try {
    await conn.beginTransaction()
    const execute = (sql, params = []) => query(sql, params, conn)
    if (state.customersMissing && state.existingTables.includes('sessions')) {
      const admins = await execute("SELECT id FROM admin_users WHERE role='owner' AND active=1")
      const ownerIds = new Set(admins.map(row => positiveId(row.id)))
      const sessions = await execute('SELECT session_id,data FROM sessions ORDER BY session_id FOR UPDATE')
      const changes = []
      for (const row of sessions) {
        const stored = object(row.data)
        const encrypted = Object.hasOwn(stored, 'protected_session')
        if (encrypted && !protection) throw new Error('Sessões protegidas exigem a chave atual para recuperação.')
        const context = { table:'sessions', field:'data', rowId:row.session_id }
        const value = encrypted ? object(protection.decryptJSON(stored.protected_session, context)) : stored
        if (!Object.hasOwn(value, 'customerId')) continue
        highestId = Math.max(highestId, positiveId(value.customerId))
        if (ownerIds.has(positiveId(value.userId))) {
          const retained = { ...value }; delete retained.customerId
          const updated = encrypted ? { ...stored, protected_session:protection.encryptJSON(retained, context) } : retained
          if (encrypted) protection.decryptJSON(updated.protected_session, context)
          changes.push({ id:row.session_id, data:JSON.stringify(updated) })
        } else changes.push({ id:row.session_id, data:null })
      }
      for (const change of changes) {
        if (change.data === null) { await execute('DELETE FROM sessions WHERE session_id=?', [change.id]); result.removedCustomerSessions++ }
        else { await execute('UPDATE sessions SET data=? WHERE session_id=?', [change.data, change.id]); result.detachedCustomerSessions++ }
      }
    }
    if (state.productsMissing) {
      const sections = await execute('SELECT id,draft_content,published_content FROM home_sections ORDER BY id FOR UPDATE')
      for (const row of sections) {
        const draft = stripDeletedProductSelections(row.draft_content), published = stripDeletedProductSelections(row.published_content)
        highestId = Math.max(highestId, draft.highestId, published.highestId)
        if (draft.changed || published.changed) {
          await execute('UPDATE home_sections SET draft_content=?,published_content=?,updated_at=updated_at WHERE id=?', [JSON.stringify(draft.content),JSON.stringify(published.content),row.id])
          result.clearedProductSelections++
        }
      }
      if (state.existingTables.includes('home_versions')) {
        const versions = await execute('SELECT id,snapshot FROM home_versions ORDER BY id FOR UPDATE')
        for (const row of versions) {
          const snapshot = stripDeletedProductSelections(row.snapshot)
          highestId = Math.max(highestId, snapshot.highestId)
          if (snapshot.changed) { await execute('UPDATE home_versions SET snapshot=? WHERE id=?', [JSON.stringify(snapshot.content),row.id]); result.clearedProductSelections++ }
        }
      }
    }
    if (state.existingTables.includes('audit_logs')) {
      const [row] = await execute("SELECT COALESCE(MAX(CAST(entity_id AS UNSIGNED)),0) AS highest_id FROM audit_logs WHERE entity_id REGEXP '^[0-9]+$'")
      highestId = Math.max(highestId, positiveId(row.highest_id))
    }
    state.nextId = Math.max(RECOVERED_ID_FLOOR, highestId + 1)
    if (state.nextId >= MAX_SIGNED_ID) throw new Error('As sequências antigas exigem recuperação específica antes de reabrir a loja.')
    await conn.commit()
    return result
  } catch {
    await conn.rollback().catch(() => {})
    throw new Error('Não foi possível recuperar as referências operacionais. A transação foi revertida; confira os dados preservados antes de continuar.')
  }
  finally { conn.release() }
}

export async function recoverOperationalSequences(query, state) {
  if (!state.missingTables.length) return
  const columns = await query("SELECT TABLE_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='id' AND EXTRA LIKE '%auto_increment%'")
  const autoTables = new Set(columns.map(row => row.name))
  for (const table of state.missingTables) {
    if (!OPERATIONAL_TABLES.includes(table)) throw new Error('Tabela de recuperação inválida.')
    const [row] = await query('SELECT COUNT(*) AS total FROM `' + table + '`')
    if (Number(row.total) !== 0) throw new Error('Uma tabela recriada recebeu dados durante a recuperação. Confira antes de continuar.')
    if (autoTables.has(table)) await query('ALTER TABLE `' + table + '` AUTO_INCREMENT=' + state.nextId)
  }
}
