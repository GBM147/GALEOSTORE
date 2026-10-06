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

const view = (r) => ({
  id: r.id, title: r.title, media_type: r.media_type, width: r.width, height: r.height,
  original_url: r.url, ai_url: r.ai_url, ai_status: r.ai_status, use_ai: !!r.use_ai,
  url: r.use_ai && r.ai_url ? r.ai_url : r.url, created_at: r.created_at
})

export function registerMediaLibrary(app, deps) {
  const { query, audit, exigirLogin, exigirOwner, mediaUpload, enviarParaCloudinary, cloudinaryConfigurado, cloudinary } = deps
  const base = '/api/admin/media-library'
  let ready
  const ensure = () => (ready ??= query(DDL).catch((e) => { ready = undefined; throw e }))
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
      await ensure()
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 48, 1), 100)
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)
      const rows = await query(`SELECT * FROM media_assets ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`)
      const [{ total }] = await query('SELECT COUNT(*) AS total FROM media_assets')
      res.json({ items: rows.map(view), total: Number(total) })
    } catch (e) { fail(res, e, 'Não foi possível carregar a biblioteca de mídia.') }
  })

  app.post(base, exigirLogin, mediaUpload.array('media', 8), async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Selecione pelo menos um arquivo.' })
    if (!cloudinaryConfigurado()) return semCloudinary(res)
    try {
      await ensure()
      const items = []
      for (const f of req.files) {
        const type = String(f.mimetype).startsWith('video/') ? 'video' : 'image'
        const r = await enviarParaCloudinary(f.buffer, { folder: 'galeo-store/library', resource_type: type, type: 'upload' })
        const nome = Buffer.from(String(f.originalname || ''), 'latin1').toString('utf8').replace(/\.[^.]+$/, '').slice(0, 160)
        const ins = await query(
          'INSERT INTO media_assets(public_id,url,media_type,width,height,bytes,title,created_by) VALUES(?,?,?,?,?,?,?,?)',
          [r.public_id, r.secure_url || r.url, type, r.width || null, r.height || null, r.bytes || null, nome || null, req.admin.id || null]
        )
        const [row] = await query('SELECT * FROM media_assets WHERE id=?', [ins.insertId])
        items.push(view(row))
      }
      await audit(req.admin.id, 'LIBRARY_UPLOAD', 'media_assets', null, { count: items.length })
      res.status(201).json({ success: true, items })
    } catch (e) { fail(res, e, 'Não foi possível enviar para a biblioteca de mídia.') }
  })

  app.patch(base + '/:id', exigirLogin, async (req, res) => {
    try {
      const a = await find(req, res); if (!a) return
      const b = req.body || {}
      const title = b.title === undefined ? a.title : (String(b.title).trim().slice(0, 160) || null)
      let useAi = a.use_ai
      if (b.use_ai !== undefined) {
        if (b.use_ai && !(a.ai_status === 'done' && a.ai_url)) return res.status(409).json({ error: 'Esta mídia ainda não tem versão tratada pela IA.' })
        useAi = b.use_ai ? 1 : 0
      }
      await query('UPDATE media_assets SET title=?, use_ai=? WHERE id=?', [title, useAi, a.id])
      await audit(req.admin.id, 'LIBRARY_UPDATE', 'media_assets', a.id, { title: b.title, use_ai: b.use_ai })
      const [row] = await query('SELECT * FROM media_assets WHERE id=?', [a.id])
      res.json({ success: true, item: view(row) })
    } catch (e) { fail(res, e, 'Não foi possível atualizar a mídia.') }
  })

  // 3A — uma execução por foto: o resultado é guardado e reaproveitado; o original nunca é apagado
  app.post(base + '/:id/ai-background', exigirLogin, exigirOwner, async (req, res) => {
    try {
      const a = await find(req, res); if (!a) return
      if (a.media_type !== 'image') return res.status(400).json({ error: 'A IA só trata fotos.' })
      if (a.ai_status === 'done') return res.json({ success: true, reused: true, item: view(a) })
      if (!cloudinaryConfigurado()) return semCloudinary(res)

      let aiUrl = a.ai_status === 'processing' && a.ai_age < 600 ? a.ai_url : null
      if (!aiUrl) {
        const claim = await query(
          "UPDATE media_assets SET ai_status='processing', ai_started_at=NOW(), ai_url=NULL WHERE id=? AND (ai_status IN ('none','failed') OR (ai_status='processing' AND ai_started_at < NOW() - INTERVAL 10 MINUTE))",
          [a.id]
        )
        if (!claim.affectedRows) return res.status(409).json({ error: 'Esta foto já está sendo tratada. Aguarde alguns segundos.' })
        try {
          const r = await cloudinary.uploader.explicit(a.public_id, {
            type: 'upload', resource_type: 'image', eager: [{ effect: 'background_removal', fetch_format: 'png' }], eager_async: false
          })
          aiUrl = r?.eager?.[0]?.secure_url
          if (!aiUrl) throw new Error('O Cloudinary não devolveu a versão tratada.')
          await query('UPDATE media_assets SET ai_url=? WHERE id=?', [aiUrl, a.id])
        } catch (e) {
          await query("UPDATE media_assets SET ai_status='failed' WHERE id=?", [a.id])
          throw e
        }
      }

      let pronto = false
      for (let i = 0; i < 6 && !pronto; i++) {
        const head = await fetch(aiUrl, { method: 'HEAD' }).catch(() => null)
        pronto = head?.status === 200
        if (!pronto) await new Promise((r) => setTimeout(r, i < 5 ? 4000 : 0))
      }
      if (!pronto) return res.status(202).json({ success: true, processing: true, message: 'A IA ainda está processando. Aguarde um pouco e clique em "Verificar resultado". Não gasta crédito extra.' })

      await query("UPDATE media_assets SET ai_status='done', ai_done_at=NOW(), use_ai=1 WHERE id=?", [a.id])
      await audit(req.admin.id, 'LIBRARY_AI_BACKGROUND', 'media_assets', a.id, { public_id: a.public_id })
      const [row] = await query('SELECT * FROM media_assets WHERE id=?', [a.id])
      res.json({ success: true, item: view(row) })
    } catch (e) { fail(res, e, 'Não foi possível tratar a foto com IA.') }
  })

  app.delete(base + '/:id', exigirLogin, exigirOwner, async (req, res) => {
    try {
      const a = await find(req, res); if (!a) return
      if (cloudinaryConfigurado()) {
        await cloudinary.uploader.destroy(a.public_id, { resource_type: a.media_type, invalidate: true }).catch((e) => console.error('Cloudinary destroy:', e))
      }
      await query('DELETE FROM media_assets WHERE id=?', [a.id])
      await audit(req.admin.id, 'LIBRARY_DELETE', 'media_assets', a.id, { public_id: a.public_id })
      res.json({ success: true })
    } catch (e) { fail(res, e, 'Não foi possível excluir a mídia.') }
  })

  ensure().catch((e) => console.error('media_assets:', e))
}