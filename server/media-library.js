import { loadMediaUsage } from './media-usage.js'
import { mediaAssetView } from './media-presentation.js'
import { createMediaManagement } from './media-management.js'
import { MediaBackgroundError, prepareMediaBackground } from './media-background.js'

// Fase 3 + 3A — Biblioteca de mídia e tratamento de fotos por IA (Cloudinary)
const DDL = `CREATE TABLE IF NOT EXISTS media_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(255) NOT NULL UNIQUE,
  url VARCHAR(1200) NOT NULL,
  media_type ENUM('image','video') NOT NULL,
  width INT NULL,
  height INT NULL,
  bytes INT NULL,
  title VARCHAR(160) NULL,
  ai_status ENUM('none','processing','done','failed') NOT NULL DEFAULT 'none',
  ai_url VARCHAR(1200) NULL,
  ai_started_at TIMESTAMP NULL DEFAULT NULL,
  ai_done_at TIMESTAMP NULL DEFAULT NULL,
  use_ai TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

const view = mediaAssetView

export function registerMediaLibrary(app, deps) {
  const { query, audit, exigirLogin, exigirOwner, mediaUpload, enviarParaCloudinary, cloudinaryConfigurado, cloudinary } = deps
  const verifyAiResult = deps.verifyAiResult || (async (url) => {
    if (deps.serverless) {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) }).catch(() => null)
      return head?.status === 200
    }
    for (let i = 0; i < 6; i++) {
      const head = await fetch(url, { method: 'HEAD' }).catch(() => null)
      if (head?.status === 200) return true
      if (i < 5) await new Promise((resolve) => setTimeout(resolve, 4000))
    }
    return false
  })
  const base = '/api/admin/media-library'
  let ready
  const ensure = () => (ready ??= query(deps.schemaManaged
    ? 'SELECT id,public_id,url,media_type,ai_status,ai_url FROM media_assets LIMIT 0'
    : DDL).catch((e) => { ready = undefined; throw e }))
  const defer = promise => deps.deferBackgroundPromise
    ? deps.deferBackgroundPromise(promise)
    : promise.catch(error => console.error('Preparação automática:', error?.code || 'MEDIA_PREPARATION_FAILED'))
  let management
  const prepareNewPhotos = async (rows) => {
    if (!management || !(await management.preferences()).auto_prepare) return
    const photos = rows.filter(row => row.media_type === 'image')
    const prepare = async asset => {
      try {
        await prepareMediaBackground(asset, { ...deps, verifyAiResult, actorId:asset.created_by, automatic:true })
      } catch (error) { console.error('Preparação automática da foto:', error?.message || 'Falha desconhecida') }
    }
    if (deps.serverless) await Promise.all(photos.map(prepare))
    else for (const asset of photos) await prepare(asset)
  }
  if (deps.db) {
    management = createMediaManagement({ ...deps, ensureLibrary:ensure, prepareNewPhotos })
    management.register(app)
  }
  const fail = (res, e, msg) => { console.error(msg, e); res.status(500).json({ error: msg }) }
  const semCloudinary = (res) => res.status(503).json({ error: 'Cloudinary não configurado no servidor.' })
  const find = async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Mídia inválida.' }); return null }
    await ensure()
    const [row] = await query('SELECT *, TIMESTAMPDIFF(SECOND, ai_started_at, NOW()) AS ai_age FROM media_assets WHERE id=?', [id])
    if (!row) { res.status(404).json({ error: 'Mídia não encontrada.' }); return null }
    return row
  }

  app.get(base, exigirLogin, async (req, res) => {
    try {
      await (management ? management.ensure() : ensure())
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 48, 1), 100)
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)
      const rows = await query(`SELECT * FROM media_assets ORDER BY sort_order,id DESC LIMIT ${limit} OFFSET ${offset}`)
      const [{ total }] = await query('SELECT COUNT(*) AS total FROM media_assets')
      res.json({ items: rows.map(view), total: Number(total) })
    } catch (e) { fail(res, e, 'Não foi possível carregar a biblioteca de mídia.') }
  })

  app.get(base + '/:id/usage', exigirLogin, exigirOwner, async (req, res) => {
    try {
      const asset = await find(req, res); if (!asset) return
      const references = await loadMediaUsage(asset, query)
      res.json({ in_use: references.length > 0, references })
    } catch (error) {
      console.error('Erro ao verificar uso da mídia:', error?.message || 'Falha desconhecida')
      res.status(500).json({ error: 'Não foi possível verificar onde esta mídia está em uso.', code: 'MEDIA_USAGE_CHECK_FAILED' })
    }
  })

  app.post(base, exigirLogin, mediaUpload.array('media', 8), async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Selecione pelo menos um arquivo.' })
    if (!cloudinaryConfigurado()) return semCloudinary(res)
    try {
      await (management ? management.ensure() : ensure())
      const items = []
      const insertedRows = []
      for (const f of req.files) {
        const type = String(f.mimetype).startsWith('video/') ? 'video' : 'image'
        const r = await enviarParaCloudinary(f.buffer, { folder: 'galeo-store/library', resource_type: type, type: 'upload' })
        const nome = Buffer.from(String(f.originalname || ''), 'latin1').toString('utf8').replace(/\.[^.]+$/, '').slice(0, 160)
        const ins = await query(
          'INSERT INTO media_assets(public_id,url,media_type,width,height,bytes,title,created_by) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
          [r.public_id, r.secure_url || r.url, type, r.width || null, r.height || null, r.bytes || null, nome || null, req.admin.id || null]
        )
        const [row] = await query('SELECT * FROM media_assets WHERE id=?', [ins.insertId])
        items.push(view(row))
        if (ins.affectedRows === 1) insertedRows.push(row)
      }
      if (insertedRows.length) await audit(req.admin.id, 'LIBRARY_UPLOAD', 'media_assets', null, { count: insertedRows.length })
      res.status(201).json({ success: true, items })
      defer(prepareNewPhotos(insertedRows))
    } catch (e) { fail(res, e, 'Não foi possível enviar para a biblioteca de mídia.') }
  })

  app.patch(base + '/:id', exigirLogin, exigirOwner, async (req, res) => {
    try {
      const a = await find(req, res); if (!a) return
      const b = req.body || {}
      const title = b.title === undefined ? a.title : (String(b.title).trim().slice(0, 160) || null)
      if (b.use_ai !== undefined) {
        if (typeof b.use_ai !== 'boolean') return res.status(400).json({ error: 'Escolha explicitamente a versão original ou a versão sem fundo.' })
        if (b.use_ai && a.media_type !== 'image') return res.status(400).json({ error: 'A versão sem fundo está disponível apenas para fotos.' })
        if (b.use_ai && !(a.ai_status === 'done' && a.ai_url)) return res.status(409).json({ error: 'Esta mídia ainda não tem versão tratada pela IA.' })
        await (management ? management.ensure() : ensure())
        const presentation = management ? ", presentation='" + (b.use_ai ? 'ai' : 'original') + "'" : ''
        if (b.title === undefined) {
          await query('UPDATE media_assets SET use_ai=?' + presentation + ' WHERE id=?', [b.use_ai ? 1 : 0, a.id])
        } else {
          await query('UPDATE media_assets SET title=?, use_ai=?' + presentation + ' WHERE id=?', [title, b.use_ai ? 1 : 0, a.id])
        }
      } else {
        // Editing a title must not replace a version chosen by another request.
        await query('UPDATE media_assets SET title=? WHERE id=?', [title, a.id])
      }
      await audit(req.admin.id, 'LIBRARY_UPDATE', 'media_assets', a.id, { title: b.title, use_ai: b.use_ai })
      const [row] = await query('SELECT * FROM media_assets WHERE id=?', [a.id])
      res.json({ success: true, item: view(row) })
    } catch (e) { fail(res, e, 'Não foi possível atualizar a mídia.') }
  })

  // 3A — uma execução por foto: o resultado é guardado e reaproveitado; o original nunca é apagado
  app.post(base + '/:id/ai-background', exigirLogin, exigirOwner, async (req, res) => {
    try {
      const a = await find(req, res); if (!a) return
      const result = await prepareMediaBackground(a, { ...deps, verifyAiResult, actorId:req.admin.id })
      res.status(result.status).json(result.body)
    } catch (e) {
      if (e instanceof MediaBackgroundError) return res.status(e.status).json({ error:e.message })
      fail(res, e, 'Não foi possível tratar a foto com IA.')
    }
  })

  app.delete(base + '/:id', exigirLogin, exigirOwner, async (req, res) => {
    let conn
    let phase = 'verification'
    try {
      const id = Number(req.params.id)
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Mídia inválida.' })
      await ensure()
      conn = await deps.db.getConnection()
      await conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await conn.beginTransaction()
      const [assets] = await conn.execute('SELECT * FROM media_assets WHERE id=? FOR UPDATE', [id])
      const asset = assets[0]
      if (!asset) {
        await conn.rollback()
        return res.status(404).json({ error: 'Mídia não encontrada.' })
      }
      const references = await loadMediaUsage(asset, (sql, params = []) => query(sql, params, conn), { lock: true })
      if (references.length) {
        await conn.rollback()
        return res.status(409).json({ error: 'Esta mídia está em uso. Retire as referências antes de excluí-la.', code: 'MEDIA_IN_USE', in_use: true, references })
      }
      if (asset.ai_status === 'processing') {
        await conn.rollback()
        return res.status(409).json({ error: 'Aguarde a conclusão do processamento antes de excluir esta mídia.', code: 'MEDIA_PROCESSING' })
      }
      if (!cloudinaryConfigurado()) {
        await conn.rollback()
        return res.status(503).json({ error: 'Cloudinary não configurado no servidor. A mídia foi mantida na biblioteca.', code: 'MEDIA_PROVIDER_UNAVAILABLE' })
      }
      // Verify the audit write before an irreversible remote deletion; commit it together.
      phase = 'audit'
      await audit(req.admin.id, 'LIBRARY_DELETE', 'media_assets', asset.id, { public_id: asset.public_id }, conn)
      phase = 'provider'
      const result = await cloudinary.uploader.destroy(asset.public_id, { resource_type: asset.media_type, type: 'upload', invalidate: true, timeout: 15000 })
      if (!['ok', 'not found'].includes(result?.result)) throw new Error('Exclusão remota não confirmada.')
      phase = 'commit'
      const deleted = await query('DELETE FROM media_assets WHERE id=?', [asset.id], conn)
      if (deleted.affectedRows !== 1) throw new Error('A mídia não pôde ser removida da biblioteca.')
      await conn.commit()
      res.json({ success: true })
    } catch (error) {
      if (conn) await conn.rollback().catch(() => {})
      console.error('Erro ao excluir mídia:', error?.message || 'Falha desconhecida')
      if (phase === 'verification') return res.status(500).json({ error: 'Não foi possível verificar onde esta mídia está em uso. A exclusão foi bloqueada.', code: 'MEDIA_USAGE_CHECK_FAILED' })
      if (phase === 'provider') return res.status(502).json({ error: 'O Cloudinary não confirmou a exclusão. A mídia foi mantida na biblioteca.', code: 'MEDIA_PROVIDER_DELETE_FAILED' })
      res.status(500).json({ error: 'Não foi possível concluir a exclusão da mídia.', code: 'MEDIA_DELETE_FAILED' })
    } finally {
      if (conn) conn.release()
    }
  })

  if (!deps.schemaManaged) (management ? management.ensure() : ensure()).catch((e) => console.error('media_assets:', e?.message || 'Falha desconhecida'))
  const rememberProductMedia = async (items, userId, prepare = true) => {
    await (management ? management.ensure() : ensure())
    const remembered = []
    for (const item of items) {
      if (!item.public_id || !item.url) continue
      await query('INSERT IGNORE INTO media_assets(public_id,url,media_type,width,height,title,created_by) VALUES(?,?,?,?,?,?,?)', [item.public_id,item.url,item.media_type,item.width || null,item.height || null,'Foto de produto',userId || null])
      const [row] = await query('SELECT * FROM media_assets WHERE public_id=?', [item.public_id])
      if (row) remembered.push(row)
    }
    if (prepare) defer(prepareNewPhotos(remembered))
    return remembered
  }
  return {
    async initialize({ migrate = !deps.schemaManaged } = {}) {
      if (!migrate) return management ? management.ensure() : ensure()
      ready = query(DDL).catch(error => { ready = undefined; throw error })
      await ready
      await (management ? management.initialize() : ensure())
      // Retain existing product files in the library before any destructive action.
      await query("INSERT IGNORE INTO media_assets(public_id,url,media_type,width,height,title) SELECT public_id,url,media_type,width,height,'Foto de produto' FROM product_media WHERE public_id IS NOT NULL AND public_id<>'' AND url<>'' ORDER BY id")
    },
    rememberProductMedia
  }

}
