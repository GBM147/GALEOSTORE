export const HOME_SECTION_KEYS = Object.freeze(['hero', 'utility', 'categories', 'featured_products', 'campaigns', 'manifesto', 'newsletter'])
export const HOME_SETTING_KEYS = Object.freeze(['campaign_defaults', 'storefront_visual_defaults', 'navigation', 'footer'])
export const HOME_VERSION_LIMIT = 5
export const HOME_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024

export class HomeWorkflowError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const fail = (status, code, message) => { throw new HomeWorkflowError(status, code, message) }
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value
const sameKeys = (actual, expected) => actual.length === expected.length && new Set(actual).size === expected.length && expected.every(key => actual.includes(key))

export function validateHomeOrder(keys) {
  if (!Array.isArray(keys) || !sameKeys(keys, HOME_SECTION_KEYS)) fail(400, 'HOME_ORDER_INVALID', 'Informe cada seção da Home uma única vez.')
  return keys.map((key, index) => ({ key, order: (index + 1) * 10 }))
}

export function buildHomeSnapshot(sections, settings, source = 'published') {
  const draft = source === 'draft'
  const snapshot = {
    schema: 1,
    sections: sections.filter(row => HOME_SECTION_KEYS.includes(row.section_key)).map(row => ({
      key: row.section_key, type: row.section_type,
      order: Number(draft ? row.sort_order : row.published_sort_order),
      visible: Boolean(Number(draft ? row.visible : row.published_visible)),
      content: parseJson(draft ? row.draft_content : row.published_content)
    })),
    settings: settings.filter(row => HOME_SETTING_KEYS.includes(row.setting_key)).map(row => ({
      key: row.setting_key,
      value: parseJson(draft && row.draft_value != null ? row.draft_value : row.setting_value)
    }))
  }
  return validateHomeSnapshot(snapshot)
}

export function validateHomeSnapshot(value) {
  const snapshot = parseJson(value)
  if (!snapshot || snapshot.schema !== 1 || !Array.isArray(snapshot.sections) || !Array.isArray(snapshot.settings) ||
      !sameKeys(snapshot.sections.map(section => section?.key), HOME_SECTION_KEYS) ||
      !sameKeys(snapshot.settings.map(setting => setting?.key), HOME_SETTING_KEYS)) {
    fail(422, 'HOME_VERSION_INVALID', 'A versão da Home está incompleta e não pode ser restaurada.')
  }
  for (const section of snapshot.sections) {
    if (!section.content || typeof section.content !== 'object' || Array.isArray(section.content) ||
        !Number.isInteger(section.order) || section.order < 0 || section.order > 999 || typeof section.visible !== 'boolean') {
      fail(422, 'HOME_VERSION_INVALID', 'Uma seção da versão da Home contém dados inválidos.')
    }
  }
  for (const setting of snapshot.settings) {
    if (!setting.value || typeof setting.value !== 'object' || Array.isArray(setting.value)) fail(422, 'HOME_VERSION_INVALID', 'Uma configuração da versão da Home contém dados inválidos.')
  }
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > HOME_SNAPSHOT_MAX_BYTES) fail(413, 'HOME_VERSION_TOO_LARGE', 'O conteúdo completo da Home excede o limite de 2 MB.')
  return snapshot
}

export async function ensureHomeWorkflowSchema(query) {
  await query(`CREATE TABLE IF NOT EXISTS home_versions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    version_number BIGINT UNSIGNED NOT NULL UNIQUE,
    snapshot JSON NOT NULL,
    published_by INT NULL,
    published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_home_version_user FOREIGN KEY (published_by) REFERENCES admin_users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
}

async function lockHome(query, conn) {
  const sections = await query('SELECT id,section_key,section_type,sort_order,visible,published_sort_order,published_visible,draft_content,published_content FROM home_sections ORDER BY id FOR UPDATE', [], conn)
  const settings = await query('SELECT setting_key,setting_value,draft_value FROM home_settings ORDER BY setting_key FOR UPDATE', [], conn)
  const versions = await query('SELECT id,version_number FROM home_versions ORDER BY id FOR UPDATE', [], conn)
  return { sections, settings, versions }
}

async function insertVersion(query, conn, snapshot, userId, previousVersions) {
  const version = previousVersions.reduce((largest, row) => Math.max(largest, Number(row.version_number)), 0) + 1
  const inserted = await query('INSERT INTO home_versions(version_number,snapshot,published_by) VALUES(?,?,?)', [version, JSON.stringify(snapshot), userId || null], conn)
  await query('DELETE FROM home_versions WHERE id NOT IN (SELECT id FROM (SELECT id FROM home_versions ORDER BY version_number DESC LIMIT 5) retained_home_versions)', [], conn)
  return { id: inserted.insertId, version }
}

async function transaction(db, work) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const result = await work(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally { conn.release() }
}

export function createHomeWorkflow({ db, query, audit }) {
  return {
    async seedPublishedVersion() {
      return transaction(db, async conn => {
        const { sections, settings, versions } = await lockHome(query, conn)
        if (versions.length) return null
        return insertVersion(query, conn, buildHomeSnapshot(sections, settings), null, versions)
      })
    },
    async reorder(keys, userId) {
      const order = validateHomeOrder(keys)
      return transaction(db, async conn => {
        const sections = await query('SELECT id,section_key FROM home_sections ORDER BY id FOR UPDATE', [], conn)
        if (!HOME_SECTION_KEYS.every(key => sections.some(section => section.section_key === key))) fail(409, 'HOME_INCOMPLETE', 'A Home está incompleta. Recarregue o editor.')
        for (const section of order) await query('UPDATE home_sections SET sort_order=?,updated_by=? WHERE section_key=?', [section.order, userId, section.key], conn)
        await audit(userId, 'REORDENAR', 'home', null, { sections: keys }, conn)
        return { success: true, order, saved_as: 'draft' }
      })
    },
    async publish(userId) {
      return transaction(db, async conn => {
        const { sections, settings, versions } = await lockHome(query, conn)
        const snapshot = buildHomeSnapshot(sections, settings, 'draft')
        // Keep the prior public Home before the first publication after upgrade.
        if (!versions.length) versions.push({ version_number: (await insertVersion(query, conn, buildHomeSnapshot(sections, settings), null, versions)).version })
        await query('UPDATE home_sections SET published_content=draft_content,published_sort_order=sort_order,published_visible=visible,published_by=?,published_at=NOW() WHERE id IS NOT NULL', [userId], conn)
        await query('UPDATE home_settings SET setting_value=draft_value WHERE draft_value IS NOT NULL', [], conn)
        const version = await insertVersion(query, conn, snapshot, userId, versions)
        await audit(userId, 'PUBLICAR', 'home', null, { version: version.version, sections: HOME_SECTION_KEYS.length }, conn)
        return { success: true, ...version, published_at: new Date().toISOString() }
      })
    },
    async versions() {
      const rows = await query('SELECT id,version_number,published_by,published_at FROM home_versions ORDER BY version_number DESC LIMIT 5')
      return { limit: HOME_VERSION_LIMIT, versions: rows.map((row, index) => ({ id: Number(row.id), version: Number(row.version_number), published_by: row.published_by, published_at: row.published_at, current: index === 0 })) }
    },
    async restore(id, userId) {
      if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) fail(400, 'HOME_VERSION_ID_INVALID', 'Escolha uma versão válida da Home.')
      return transaction(db, async conn => {
        await lockHome(query, conn)
        const versions = await query('SELECT id,version_number,snapshot FROM home_versions WHERE id=? FOR UPDATE', [Number(id)], conn)
        if (!versions.length) fail(404, 'HOME_VERSION_NOT_FOUND', 'Esta versão da Home não está mais disponível.')
        const version = versions[0], snapshot = validateHomeSnapshot(version.snapshot)
        for (const section of snapshot.sections) {
          const result = await query('UPDATE home_sections SET draft_content=?,sort_order=?,visible=?,updated_by=? WHERE section_key=?', [JSON.stringify(section.content), section.order, section.visible ? 1 : 0, userId, section.key], conn)
          if (result.affectedRows !== 1) fail(409, 'HOME_INCOMPLETE', 'Uma seção da Home não está disponível para restauração.')
        }
        for (const setting of snapshot.settings) {
          const result = await query('UPDATE home_settings SET draft_value=?,updated_by=? WHERE setting_key=?', [JSON.stringify(setting.value), userId, setting.key], conn)
          if (result.affectedRows !== 1) fail(409, 'HOME_INCOMPLETE', 'Uma configuração da Home não está disponível para restauração.')
        }
        await audit(userId, 'RESTAURAR_RASCUNHO', 'home', null, { version: Number(version.version_number) }, conn)
        return { success: true, restored_from: { id: Number(version.id), version: Number(version.version_number) }, saved_as: 'draft' }
      })
    }
  }
}

export function registerHomeWorkflow(app, { workflow, exigirLogin, exigirOwner }) {
  const handle = operation => async (req, res) => {
    try { res.json(await operation(req)) }
    catch (error) {
      if (!(error instanceof HomeWorkflowError)) console.error('Erro no fluxo da Home:', error?.code || 'INTERNAL_ERROR')
      res.status(error instanceof HomeWorkflowError ? error.status : 500).json({ code: error instanceof HomeWorkflowError ? error.code : 'HOME_WORKFLOW_FAILED', error: error instanceof HomeWorkflowError ? error.message : 'Não foi possível concluir a alteração da Home.' })
    }
  }
  // Register before /home/:key so /order cannot be mistaken for a section.
  app.put('/api/admin/home/order', exigirLogin, exigirOwner, handle(req => workflow.reorder(req.body?.keys, req.admin.id)))
  app.get('/api/admin/home/versions', exigirLogin, exigirOwner, handle(() => workflow.versions()))
  app.post('/api/admin/home/versions/:id/restore', exigirLogin, exigirOwner, handle(req => workflow.restore(req.params.id, req.admin.id)))
  app.post('/api/admin/home/publish', exigirLogin, exigirOwner, handle(req => workflow.publish(req.admin.id)))
}
