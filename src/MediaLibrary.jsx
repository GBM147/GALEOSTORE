import { useEffect, useState } from 'react'

const estado = (it) => (
  it.ai_status === 'done' ? (it.use_ai ? 'Versão IA em uso' : 'Original em uso')
    : it.ai_status === 'processing' ? 'IA processando…'
      : it.ai_status === 'failed' ? 'IA falhou' : 'Original'
)

export default function MediaLibrary({ api, csrf, role }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const owner = String(role).toLowerCase() === 'owner'

  const load = async () => {
    try { setItems((await api('/api/admin/media-library')).items || []) } catch (e) { setMsg(e.message) }
  }
  useEffect(() => { load() }, [])

  const run = async (key, job) => {
    setBusy(key); setMsg('')
    try { await job() } catch (e) { setMsg(e.message) }
    await load(); setBusy('')
  }

  const upload = (files) => run('up', async () => {
    const form = new FormData()
    files.forEach((f) => form.append('media', f))
    const r = await fetch('/api/admin/media-library', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf() }, body: form })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.error || 'Falha no envio.')
  })

  const ai = (it) => run('ai' + it.id, async () => {
    if (it.ai_status !== 'processing' && !window.confirm('Remover o fundo com IA usa créditos do Cloudinary e roda só uma vez por foto. O original é mantido. Continuar?')) return
    const d = await api('/api/admin/media-library/' + it.id + '/ai-background', { method: 'POST', body: {} })
    if (d?.processing) setMsg(d.message)
  })

  const toggle = (it) => run('t' + it.id, () => api('/api/admin/media-library/' + it.id, { method: 'PATCH', body: { use_ai: !it.use_ai } }))

  const remove = (it) => {
    if (window.confirm('Excluir esta mídia definitivamente (original e versão IA)?')) run('d' + it.id, () => api('/api/admin/media-library/' + it.id, { method: 'DELETE' }))
  }

  return (
    <section className="admin-panel">
      <div className="admin-media-note">
        Fotos e vídeos ficam guardados no Cloudinary. A remoção de fundo por IA roda uma vez por foto; o resultado é guardado e o original nunca é apagado, então dá para voltar a ele quando quiser.
      </div>
      <p>
        <input
          type="file" multiple disabled={!!busy}
          accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.jfif,.png,.webp,.avif"
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) upload(f) }}
        />
      </p>
      {busy === 'up' && <p className="page-note">Enviando…</p>}
      {msg && <p className="admin-error">{msg}</p>}
      <div className="media-gallery">
        {items.map((it) => (
          <div className="media-tile" key={it.id}>
            {it.media_type === 'video'
              ? <video src={it.url} controls muted preload="metadata" />
              : <img src={it.url} alt={it.title || ''} loading="lazy" />}
            <div><span>{it.title || 'Sem título'}</span><span>{estado(it)}</span></div>
            <div>
              {it.media_type === 'image' && owner && it.ai_status !== 'done' && (
                <button type="button" disabled={!!busy} onClick={() => ai(it)}>{it.ai_status === 'processing' ? 'Verificar resultado' : 'Remover fundo (IA)'}</button>
              )}
              {it.ai_status === 'done' && (
                <button type="button" disabled={!!busy} onClick={() => toggle(it)}>{it.use_ai ? 'Voltar ao original' : 'Usar versão IA'}</button>
              )}
              {owner && <button type="button" disabled={!!busy} onClick={() => remove(it)}>Excluir</button>}
            </div>
          </div>
        ))}
        {!items.length && <p className="page-note">Nenhuma mídia na biblioteca ainda.</p>}
      </div>
    </section>
  )
}