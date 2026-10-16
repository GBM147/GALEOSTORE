import { randomUUID } from 'node:crypto'
import { getVerifiedDirectAsset } from './direct-uploads.js'
import { galeoBackgroundUrl, mediaAssetView, moveMedia } from './media-presentation.js'

const PREFERENCES_DDL = `CREATE TABLE IF NOT EXISTS media_library_preferences (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  auto_prepare TINYINT(1) NOT NULL DEFAULT 0,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

export function createMediaManagement(deps) {
  const { query, db, audit, exigirLogin, exigirOwner, mediaUpload, enviarParaCloudinary, cloudinaryConfigurado, cloudinary } = deps
  let ready
  const migrate = async () => {
    await deps.ensureLibrary()
    await query(PREFERENCES_DDL)
    const columns = await query('SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', ['media_assets'])
    const known = new Set(columns.map(row => row.name))
    for (const [name, definition] of [
      ['sort_order', 'INT NOT NULL DEFAULT 0'],
      ['presentation', "ENUM('original','ai','galeo') NOT NULL DEFAULT 'original'"],
      ['replaces_id', 'INT NULL']
    ]) if (!known.has(name)) {
      try { await query(`ALTER TABLE media_assets ADD COLUMN ${name} ${definition}`) }
      catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
    }
    await query('INSERT IGNORE INTO media_library_preferences(id,auto_prepare) VALUES(1,0)')
  }
  const validate = async () => {
    await deps.ensureLibrary()
    await query('SELECT id,sort_order,presentation,replaces_id FROM media_assets LIMIT 0')
    const rows = await query('SELECT id,auto_prepare FROM media_library_preferences WHERE id=1')
    if (!rows.length) throw new Error('Prepare as preferências de mídia pelo comando de migração.')
  }
  const ensure = () => ready ??= (deps.schemaManaged ? validate() : migrate()).catch(error => { ready = undefined; throw error })
  const initialize = () => ready = migrate().catch(error => { ready = undefined; throw error })

  const preferences = async () => {
    await ensure()
    const [row] = await query('SELECT auto_prepare FROM media_library_preferences WHERE id=1')
    return { auto_prepare: Boolean(row?.auto_prepare) }
  }
  const failure = (res, error, message) => {
    console.error(message, error?.message || 'Falha desconhecida')
    res.status(500).json({ error: message })
  }

  function register(app) {
    app.get('/api/admin/media-library-preferences', exigirLogin, exigirOwner, async (req, res) => {
      try { res.json(await preferences()) } catch (error) { failure(res, error, 'Não foi possível carregar as preferências de mídia.') }
    })
    app.put('/api/admin/media-library-preferences', exigirLogin, exigirOwner, async (req, res) => {
      if (typeof req.body?.auto_prepare !== 'boolean') return res.status(400).json({ error: 'Escolha se as novas fotos devem ser preparadas automaticamente.' })
      if (req.body.auto_prepare && !cloudinaryConfigurado()) return res.status(503).json({ error: 'Configure o Cloudinary antes de ativar a preparação automática.' })
      let conn
      try {
        await ensure()
        conn = await db.getConnection()
        await conn.beginTransaction()
        await query('UPDATE media_library_preferences SET auto_prepare=?, updated_by=? WHERE id=1', [req.body.auto_prepare ? 1 : 0, req.admin.id], conn)
        await audit(req.admin.id, 'LIBRARY_PREFERENCES', 'media_library_preferences', 1, { auto_prepare: req.body.auto_prepare }, conn)
        await conn.commit()
        res.json({ success: true, auto_prepare: req.body.auto_prepare })
      } catch (error) { if (conn) await conn.rollback(); failure(res, error, 'Não foi possível salvar as preferências de mídia.') }
      finally { conn?.release() }
    })

    app.patch('/api/admin/media-library-order', exigirLogin, exigirOwner, async (req, res) => {
      const body = req.body || {}
      if (!Number.isSafeInteger(body.id) || body.id <= 0 ||
        (Object.hasOwn(body, 'before_id') === Object.hasOwn(body, 'after_id')) ||
        !Number.isSafeInteger(body.before_id ?? body.after_id)) return res.status(400).json({ error: 'Escolha a mídia e um destino válido para a ordenação.' })
      let conn
      try {
        await ensure()
        conn = await db.getConnection()
        await conn.beginTransaction()
        const rows = await query('SELECT id,sort_order FROM media_assets ORDER BY sort_order,id DESC FOR UPDATE', [], conn)
        const ids = rows.map(row => Number(row.id))
        let moved
        try { moved = moveMedia(ids, body) } catch (error) { await conn.rollback(); return res.status(400).json({ error: error.message }) }
        const byId = new Map(rows.map(row => [Number(row.id), Number(row.sort_order)]))
        for (let index = 0; index < moved.length; index++) if (byId.get(moved[index]) !== index + 1) {
          await query('UPDATE media_assets SET sort_order=? WHERE id=?', [index + 1, moved[index]], conn)
        }
        await audit(req.admin.id, 'LIBRARY_REORDER', 'media_assets', body.id, { before_id: body.before_id, after_id: body.after_id }, conn)
        await conn.commit()
        res.json({ success: true, ids: moved })
      } catch (error) { if (conn) await conn.rollback(); failure(res, error, 'Não foi possível salvar a ordem da biblioteca.') }
      finally { conn?.release() }
    })

    app.patch('/api/admin/media-library/:id/presentation', exigirLogin, exigirOwner, async (req, res) => {
      const id = Number(req.params.id)
      const variant = req.body?.variant
      if (!Number.isSafeInteger(id) || id <= 0 || !['original','ai','galeo'].includes(variant)) return res.status(400).json({ error: 'Escolha uma versão válida da foto.' })
      let conn
      try {
        await ensure()
        conn = await db.getConnection()
        await conn.beginTransaction()
        const [asset] = await query('SELECT * FROM media_assets WHERE id=? FOR UPDATE', [id], conn)
        if (!asset) { await conn.rollback(); return res.status(404).json({ error: 'Mídia não encontrada.' }) }
        if (variant !== 'original' && (asset.media_type !== 'image' || asset.ai_status !== 'done' || !asset.ai_url)) {
          await conn.rollback(); return res.status(409).json({ error: 'Prepare a versão sem fundo antes de usar este acabamento.' })
        }
        if (variant === 'galeo' && !galeoBackgroundUrl(asset.ai_url)) {
          await conn.rollback(); return res.status(409).json({ error: 'O Fundo GALEO exige uma versão sem fundo hospedada no Cloudinary.' })
        }
        await query('UPDATE media_assets SET presentation=?, use_ai=? WHERE id=?', [variant, variant === 'original' ? 0 : 1, id], conn)
        await audit(req.admin.id, 'LIBRARY_VERSION', 'media_assets', id, { variant }, conn)
        await conn.commit()
        res.json({ success: true, item: mediaAssetView({ ...asset, presentation: variant, use_ai: variant === 'original' ? 0 : 1 }) })
      } catch (error) { if (conn) await conn.rollback(); failure(res, error, 'Não foi possível aplicar esta versão da foto.') }
      finally { conn?.release() }
    })

    app.post('/api/admin/media-library/:id/replacement', exigirLogin, exigirOwner, mediaUpload.single('media'), async (req, res) => {
      const id = Number(req.params.id)
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Mídia inválida.' })
      if (!req.file) return res.status(400).json({ error: 'Escolha o novo arquivo.' })
      if (!cloudinaryConfigurado()) return res.status(503).json({ error: 'Cloudinary não configurado. O arquivo original foi mantido.' })
      let conn, uploadedId
      let commitAttempted = false
      try {
        await ensure()
        const [original] = await query('SELECT * FROM media_assets WHERE id=?', [id])
        if (!original) return res.status(404).json({ error: 'Mídia original não encontrada.' })
        const type = String(req.file.mimetype).startsWith('video/') ? 'video' : 'image'
        if (type !== original.media_type) return res.status(400).json({ error: 'Substitua uma foto por outra foto, ou um vídeo por outro vídeo.' })
        const uploaded = await enviarParaCloudinary(req.file.buffer, {
          folder: 'galeo-store/library', public_id: randomUUID(), overwrite: false, resource_type: type, type: 'upload'
        })
        if (!uploaded?.public_id || uploaded.public_id === original.public_id || !uploaded.secure_url) throw new Error('O provedor não confirmou um novo arquivo independente.')
        uploadedId = uploaded.public_id
        conn = await db.getConnection()
        await conn.beginTransaction()
        const [current] = await query('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [id], conn)
        if (!current) throw new Error('A mídia original foi removida enquanto o novo arquivo era enviado.')
        const [previous] = await query('SELECT * FROM media_assets WHERE public_id=? FOR UPDATE', [uploaded.public_id], conn)
        if (previous) {
          if (Number(previous.replaces_id) !== id) throw new Error('Este arquivo já pertence a outra mídia.')
          await conn.commit()
          return res.status(201).json({ success: true, item: mediaAssetView(previous), replaces_id: id,
            message: 'Nova versão salva separadamente. Os usos atuais e o original foram mantidos.' })
        }
        const title = String(original.title || (type === 'image' ? 'Foto' : 'Vídeo')).slice(0, 146) + ' — nova versão'
        const inserted = await query('INSERT INTO media_assets(public_id,url,media_type,width,height,bytes,title,created_by,replaces_id) VALUES(?,?,?,?,?,?,?,?,?)',
          [uploaded.public_id, uploaded.secure_url, type, uploaded.width || null, uploaded.height || null, uploaded.bytes || null, title, req.admin.id, id], conn)
        await audit(req.admin.id, 'LIBRARY_REPLACEMENT', 'media_assets', inserted.insertId, { replaces_id: id }, conn)
        const [row] = await query('SELECT * FROM media_assets WHERE id=?', [inserted.insertId], conn)
        commitAttempted = true
        await conn.commit()
        res.status(201).json({ success: true, item: mediaAssetView(row), replaces_id: id,
          message: 'Nova versão salva separadamente. Escolha esta foto no produto ou no rascunho da Home; os usos atuais e o original foram mantidos.' })
        const preparation = deps.prepareNewPhotos?.([row])
        if (preparation) {
          if (deps.deferBackgroundPromise) deps.deferBackgroundPromise(preparation)
          else preparation.catch(error => console.error('Não foi possível preparar nova foto:', error?.message))
        }
      } catch (error) {
        if (conn) await conn.rollback().catch(() => {})
        // Never compensate after an uncertain commit: the new asset may already be stored.
        // This ID belongs to an independent, non-overwriting upload, never the original.
        if (uploadedId && !commitAttempted && !getVerifiedDirectAsset(req.file.buffer) && cloudinary?.uploader?.destroy) {
          await cloudinary.uploader.destroy(uploadedId, { resource_type: String(req.file.mimetype).startsWith('video/') ? 'video' : 'image', type:'upload', invalidate:true, timeout:15000 }).catch(cleanupError => console.error('Nova mídia não salva aguardando limpeza:', cleanupError?.message))
        }
        failure(res, error, 'Não foi possível enviar a nova versão. O arquivo original foi mantido.')
      }
      finally { conn?.release() }
    })
  }
  return { ensure, initialize, preferences, register }
}
