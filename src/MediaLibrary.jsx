import { useEffect, useRef, useState } from 'react'
import MediaComparison from './MediaComparison'

const estado = (item) => (
  item.ai_status === 'done' ? (item.use_ai ? 'Sem fundo em uso' : 'Original em uso')
    : item.ai_status === 'processing' ? 'IA processando…'
      : item.ai_status === 'failed' ? 'IA falhou' : 'Original em uso'
)

export default function MediaLibrary({ api, csrf, role }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState(0)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const compareTrigger = useRef(null)
  const owner = String(role).toLowerCase() === 'owner'

  const load = async (offset = 0) => {
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/admin/media-library?limit=100&offset=' + offset)
      const page = Array.isArray(data?.items) ? data.items : []
      setItems((current) => offset ? [...current, ...page.filter((item) => !current.some((old) => old.id === item.id))] : page)
      setTotal(Number(data?.total) || offset + page.length)
      setNextOffset(offset + page.length)
      return page
    } catch (err) {
      setError(err.message || 'Não foi possível carregar a biblioteca.')
      return null
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const updateItem = (item) => {
    if (item) setItems((current) => current.map((old) => old.id === item.id ? item : old))
  }
  const run = async (key, job) => {
    if (busy) return
    setBusy(key)
    setMsg('')
    setError('')
    try { await job() } catch (err) { setError(err.message || 'Não foi possível concluir a ação.') }
    finally { setBusy('') }
  }

  const upload = (files) => run('up', async () => {
    const form = new FormData()
    files.forEach((file) => form.append('media', file))
    const response = await fetch('/api/admin/media-library', {
      method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf() }, body: form
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error || 'Falha no envio.')
    await load()
    setMsg('Mídia enviada para a biblioteca.')
  })

  const ai = (item) => {
    if (item.ai_status !== 'processing' && !window.confirm('Remover o fundo com IA usa créditos do Cloudinary e roda só uma vez por foto. O original é mantido. Continuar?')) return
    run('ai' + item.id, async () => {
      const data = await api('/api/admin/media-library/' + item.id + '/ai-background', { method: 'POST', body: {} })
      updateItem(data?.item)
      if (!data?.item) await load()
      setMsg(data?.processing ? (data.message || 'A remoção de fundo está processando.') : 'Versão sem fundo pronta. Compare e escolha a versão que deseja usar.')
    })
  }

  const choose = (item, variant) => run('use-' + item.id + '-' + variant, async () => {
    const data = await api('/api/admin/media-library/' + item.id, { method: 'PATCH', body: { use_ai: variant === 'ai' } })
    if (data?.item) updateItem(data.item)
    else await load()
    setMsg((variant === 'ai' ? 'Sem fundo' : 'Original') + ' em uso na biblioteca. As capas dos produtos são escolhidas no cadastro ou na edição de cada produto.')
  })

  const remove = (item) => {
    if (window.confirm('Excluir esta mídia definitivamente (original e versão IA)?')) run('d' + item.id, async () => {
      await api('/api/admin/media-library/' + item.id, { method: 'DELETE' })
      if (selectedId === item.id) setSelectedId(null)
      await load()
    })
  }

  const selected = items.find((item) => item.id === selectedId)
  function closeComparison() {
    setSelectedId(null)
    window.requestAnimationFrame(() => compareTrigger.current?.focus())
  }

  return (
    <section className="admin-panel media-library-panel">
      <div className="admin-media-note">
        Fotos e vídeos ficam guardados no Cloudinary. A remoção de fundo por IA roda uma vez por foto; o original é mantido. Compare Original e Sem fundo e use uma versão quando quiser. Gerar a imagem não muda sua escolha.
      </div>
      <p>
        <input
          type="file" multiple disabled={Boolean(busy) || loading}
          aria-label="Enviar fotos ou vídeos à biblioteca"
          accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.jfif,.png,.webp,.avif"
          onChange={(event) => { const files = [...event.target.files]; event.target.value = ''; if (files.length) upload(files) }}
        />
      </p>
      {busy === 'up' && <p className="page-note" role="status">Enviando…</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      {msg && <p className="media-library-status" role="status">{msg}</p>}
      {selected && <MediaComparison
        item={selected}
        activeVariant={selected.use_ai && selected.ai_status === 'done' && selected.ai_url ? 'ai' : 'original'}
        disabled={Boolean(busy) || loading}
        pendingVariant={busy.startsWith('use-' + selected.id + '-') ? busy.split('-').pop() : ''}
        readOnly={!owner}
        onClose={closeComparison}
        onSelect={(variant) => choose(selected, variant)}
      />}
      <div className="media-gallery">
        {items.map((item) => (
          <div className="media-tile media-library-tile" key={item.id}>
            {item.media_type === 'video'
              ? <video src={item.url} controls muted preload="metadata" />
              : <button
                type="button"
                className="media-library-open"
                aria-label={'Comparar versões: ' + (item.title || 'Foto ' + item.id)}
                aria-expanded={selectedId === item.id}
                disabled={Boolean(busy) || loading}
                data-testid={'media-compare-' + item.id}
                onClick={(event) => { compareTrigger.current = event.currentTarget; setSelectedId(item.id) }}
              ><img src={item.url} alt={item.title || 'Foto ' + item.id} loading="lazy" /></button>}
            <div><span>{item.title || 'Sem título'}</span><span>{estado(item)}</span></div>
            <div className="media-library-tile-actions">
              {item.media_type === 'image' && owner && item.ai_status !== 'done' && (
                <button type="button" disabled={Boolean(busy) || loading} onClick={() => ai(item)}>{busy === 'ai' + item.id ? 'Verificando…' : item.ai_status === 'processing' ? 'Verificar resultado' : 'Remover fundo (IA)'}</button>
              )}
              {owner && <button type="button" disabled={Boolean(busy) || loading} onClick={() => remove(item)}>Excluir</button>}
            </div>
          </div>
        ))}
      </div>
      {loading && <p className="page-note" role="status">Carregando biblioteca…</p>}
      {!loading && !error && !items.length && <p className="page-note">Nenhuma mídia na biblioteca ainda.</p>}
      <div className="media-picker-actions">
        <button type="button" className="text-button" disabled={Boolean(busy) || loading} onClick={() => { setError(''); load() }}>Atualizar biblioteca</button>
        {nextOffset < total && <button type="button" className="text-button" disabled={Boolean(busy) || loading} onClick={() => load(nextOffset)}>Carregar mais</button>}
      </div>
    </section>
  )
}
