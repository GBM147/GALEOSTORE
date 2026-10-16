import { useEffect, useId, useRef, useState } from 'react'
import MediaComparison from './MediaComparison'
import MediaManagement, { MediaLibraryPreferences } from './MediaManagement'
import { directUploadsEnabled, uploadDirectMedia } from './directUpload'

const estado = (item) => (
  item.ai_status === 'done' ? (item.use_ai ? (item.presentation === 'galeo' ? 'Fundo GALEO em uso' : 'Sem fundo em uso') : 'Original em uso')
    : item.ai_status === 'processing' ? 'IA processando…'
      : item.ai_status === 'failed' ? 'IA falhou' : 'Original em uso'
)

const referenceLocation = (reference) => {
  if (reference.type === 'home_version') return 'Histórico da Home'
  if (reference.type === 'product_media') return 'Galeria do produto'
  if (reference.type === 'product') {
    const fields = Array.isArray(reference.fields) ? reference.fields : []
    const locations = []
    if (fields.some((field) => ['image', 'image_asset_id'].includes(field))) locations.push('Capa do produto')
    if (fields.includes('video')) locations.push('Vídeo do produto')
    return locations.join(' · ') || 'Produto'
  }
  return reference.type === 'home_setting' ? 'Configuração da Home' : 'Seção da Home'
}

function MediaUsagePanel({ item, usage, onRefresh, onClose, disabled, panelId }) {
  const titleId = useId()
  const panel = useRef(null)
  const heading = useRef(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView({ block: 'nearest' })
  }, [item.id])

  return (
    <section className="media-usage-panel" id={panelId} ref={panel} aria-labelledby={titleId} aria-busy={Boolean(usage?.loading)} data-testid="media-usage-panel">
      <div className="media-comparison-heading">
        <div>
          <h3 id={titleId} ref={heading} tabIndex="-1">Onde esta mídia é usada</h3>
          <p>{item.title || (item.media_type === 'video' ? 'Vídeo' : 'Foto')}</p>
        </div>
        <button type="button" className="text-button" disabled={disabled} onClick={onClose}>Fechar lista de uso</button>
      </div>
      {usage?.loading && <p className="page-note" role="status">Consultando onde a mídia é usada…</p>}
      {usage?.error && <p className="admin-error" role="alert">{usage.error}</p>}
      {usage?.in_use && <p className="media-usage-warning" role="status">Esta mídia está em uso e não pode ser excluída. Remova os vínculos nos locais abaixo e atualize a consulta.</p>}
      {Boolean(usage?.references?.length) && <ul className="media-usage-list">
        {usage.references.map((reference, index) => <li key={[reference.type, reference.id, reference.state, index].join('-')}>
          <div>
            <strong>{reference.name || (String(reference.type || '').startsWith('product') ? 'Produto' : 'Home')}</strong>
            <span>{referenceLocation(reference)}</span>
          </div>
          <div className="media-usage-labels">
            {reference.state && <span className="media-in-use">{reference.state === 'version' ? 'Versão guardada' : reference.state === 'published' ? 'Publicado' : 'Rascunho'}</span>}
            {reference.active === false && <span className="media-usage-hidden">Produto oculto</span>}
          </div>
        </li>)}
      </ul>}
      {usage?.checked && !usage.loading && !usage.error && !usage.in_use && <p className="page-note" role="status">Nenhum uso encontrado.</p>}
      <button type="button" className="text-button" disabled={disabled || usage?.loading} onClick={onRefresh}>Atualizar uso</button>
    </section>
  )
}

export default function MediaLibrary({ api, csrf, role }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState(0)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [dragTarget, setDragTarget] = useState(null)
  const editTrigger = useRef(null)
  const [usageId, setUsageId] = useState(null)
  const [usageById, setUsageById] = useState({})
  const compareTrigger = useRef(null)
  const usageTrigger = useRef(null)
  const usageButtons = useRef(new Map())
  const refreshTrigger = useRef(null)
  const usageRequests = useRef(new Map())
  const operationInFlight = useRef(false)
  const usagePanelId = useId()
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
    if (operationInFlight.current) return
    operationInFlight.current = true
    setBusy(key)
    setMsg('')
    setError('')
    try { await job() } catch (err) { setError(err.message || 'Não foi possível concluir a ação.') }
    finally { operationInFlight.current = false; setBusy('') }
  }

  const requestUsage = (item) => {
    if (usageRequests.current.has(item.id)) return usageRequests.current.get(item.id)
    setUsageById((current) => ({ ...current, [item.id]: { ...current[item.id], loading: true, error: '' } }))
    const request = (async () => {
      try {
        const data = await api('/api/admin/media-library/' + item.id + '/usage')
        if (!Array.isArray(data?.references) || typeof data.in_use !== 'boolean') {
          throw new Error('Não foi possível confirmar onde esta mídia é usada. Atualize a consulta antes de excluir.')
        }
        const usage = { references: data.references, in_use: data.in_use || data.references.length > 0, checked: true, loading: false, error: '' }
        setUsageById((current) => ({ ...current, [item.id]: usage }))
        return usage
      } catch (err) {
        setUsageById((current) => ({ ...current, [item.id]: {
          ...current[item.id], loading: false,
          error: err.message || 'Não foi possível consultar o uso. Atualize a consulta antes de excluir.'
        } }))
        throw err
      } finally {
        usageRequests.current.delete(item.id)
      }
    })()
    usageRequests.current.set(item.id, request)
    return request
  }

  function showUsage(item, trigger) {
    if (trigger) usageTrigger.current = trigger
    setUsageId(item.id)
    requestUsage(item).catch(() => {})
  }

  function closeUsage() {
    const currentUsageId = usageId
    setUsageId(null)
    window.requestAnimationFrame(() => {
      const targets = [usageTrigger.current, usageButtons.current.get(currentUsageId), refreshTrigger.current]
      targets.find((target) => target?.isConnected && !target.disabled)?.focus()
    })
  }

  const upload = (files) => run('up', async () => {
    if (directUploadsEnabled) await uploadDirectMedia({ api, csrf, url: '/api/admin/media-library', files })
    else {
      const form = new FormData()
      files.forEach((file) => form.append('media', file))
      const response = await fetch('/api/admin/media-library', {
        method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf() }, body: form
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Falha no envio.')
    }
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
    const data = await api('/api/admin/media-library/' + item.id + (variant === 'galeo' ? '/presentation' : ''), { method:'PATCH', body: variant === 'galeo' ? {variant} : {use_ai:variant === 'ai'} })
    if (data?.item) updateItem(data.item)
    else await load()
    setMsg((variant === 'galeo' ? 'Fundo GALEO' : variant === 'ai' ? 'Sem fundo' : 'Original') + ' em uso na biblioteca. As capas dos produtos são escolhidas no cadastro ou na edição de cada produto.')
  })

  const remove = (item, trigger) => {
    if (operationInFlight.current || usageById[item.id]?.in_use) return
    if (trigger) usageTrigger.current = trigger
    run('d' + item.id, async () => {
      setUsageId(item.id)
      const usage = await requestUsage(item)
      if (usage.in_use) return
      if (!window.confirm('Excluir esta mídia definitivamente (original e versão IA)?')) return
      try {
        await api('/api/admin/media-library/' + item.id, { method: 'DELETE' })
      } catch (err) {
        if (err.status === 409 && (err.code === 'MEDIA_IN_USE' || err.data?.in_use === true)) {
          setUsageById((current) => ({ ...current, [item.id]: {
            references: Array.isArray(err.data?.references) ? err.data.references : [],
            in_use: true, checked: true, loading: false, error: ''
          } }))
          setUsageId(item.id)
        }
        throw err
      }
      if (selectedId === item.id) setSelectedId(null)
      setUsageId(null)
      setUsageById((current) => { const next = { ...current }; delete next[item.id]; return next })
      await load()
      window.requestAnimationFrame(() => refreshTrigger.current?.focus())
    })
  }

  const move = (item, anchor, direction) => anchor && run('move' + item.id, async () => {
    const data = await api('/api/admin/media-library-order', {method:'PATCH',body:{id:item.id,[direction === 'before' ? 'before_id' : 'after_id']:anchor.id}})
    if (Array.isArray(data.ids)) {
      const byId = new Map(items.map(row => [row.id,row]))
      setItems(data.ids.map(id => byId.get(id)).filter(Boolean))
    } else await load()
    setMsg('Ordem da biblioteca salva.')
  })
  const editing = items.find(item => item.id === editingId)
  function closeEditing() {
    setEditingId(null)
    window.requestAnimationFrame(() => editTrigger.current?.focus())
  }
  const selected = items.find((item) => item.id === selectedId)
  const usageItem = items.find((item) => item.id === usageId)
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
      {owner && <MediaLibraryPreferences api={api} disabled={Boolean(busy) || loading} onMessage={setMsg} onError={setError} />}
      {editing && <MediaManagement
        item={editing} api={api} csrf={csrf} run={run} disabled={Boolean(busy) || loading}
        onClose={closeEditing}
        onUpdate={(item) => { updateItem(item); setMsg('Nome da mídia salvo.') }}
        onReplacement={async (item, message) => { await load(); setEditingId(null); setSelectedId(item.media_type === 'image' ? item.id : null); setMsg(message); window.requestAnimationFrame(() => refreshTrigger.current?.focus()) }}
      />}
      {usageItem && <MediaUsagePanel
        panelId={usagePanelId}
        item={usageItem}
        usage={usageById[usageItem.id]}
        onRefresh={() => showUsage(usageItem)}
        onClose={closeUsage}
        disabled={Boolean(busy) || loading}
      />}
      {selected && <MediaComparison
        item={selected}
        activeVariant={selected.use_ai && selected.ai_status === 'done' && selected.ai_url ? (selected.presentation === 'galeo' ? 'galeo' : 'ai') : 'original'}
        disabled={Boolean(busy) || loading}
        pendingVariant={busy.startsWith('use-' + selected.id + '-') ? busy.split('-').pop() : ''}
        readOnly={!owner}
        onClose={closeComparison}
        onSelect={(variant) => choose(selected, variant)}
      />}
      {owner && items.length > 1 && <p className="media-order-note">Arraste as mídias para organizar a biblioteca ou use Mover antes / Mover depois. A ordem dos produtos e das seções da Home é definida nos seus próprios editores.</p>}
      <div className="media-gallery">
        {items.map((item, index) => (
          <div className={'media-tile media-library-tile' + (dragId === item.id ? ' is-dragging' : '') + (dragTarget === item.id ? ' is-drag-target' : '')} key={item.id}
            draggable={owner && !busy && !loading}
            onDragStart={(event) => { if (event.target.closest('button,input,video')) { event.preventDefault(); return }; setDragId(item.id); event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',String(item.id)) }}
            onDragOver={(event) => { if (dragId && dragId !== item.id) { event.preventDefault(); event.dataTransfer.dropEffect='move'; setDragTarget(item.id) } }}
            onDragEnd={() => { setDragId(null); setDragTarget(null) }}
            onDrop={(event) => { event.preventDefault(); const dragged=items.find(row => row.id === dragId); setDragId(null); setDragTarget(null); if (dragged && dragged.id !== item.id) move(dragged,item,'before') }}
          >
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
            {item.replaces_id && <p className="media-replacement-label">Nova versão · original preservado</p>}
            {owner && <div className="media-order-actions">
              <button type="button" disabled={Boolean(busy) || loading} aria-label={'Editar mídia: ' + (item.title || 'Sem título')} onClick={(event) => { editTrigger.current=event.currentTarget; setEditingId(item.id) }}>Editar mídia</button>
              <button type="button" disabled={Boolean(busy) || loading || index === 0} aria-label={'Mover antes: ' + (item.title || 'Sem título')} onClick={() => move(item,items[index-1],'before')}>Mover antes</button>
              <button type="button" disabled={Boolean(busy) || loading || index === items.length-1} aria-label={'Mover depois: ' + (item.title || 'Sem título')} onClick={() => move(item,items[index+1],'after')}>Mover depois</button>
            </div>}
            <div className="media-library-usage-action">
              <button type="button" ref={(node) => { if (node) usageButtons.current.set(item.id, node); else usageButtons.current.delete(item.id) }} disabled={Boolean(busy) || loading || usageById[item.id]?.loading} aria-expanded={usageId === item.id} aria-controls={usageId === item.id ? usagePanelId : undefined} data-testid={'media-usage-' + item.id} onClick={(event) => showUsage(item, event.currentTarget)}>Onde esta mídia é usada</button>
              {usageById[item.id]?.in_use && <span className="media-in-use">Em uso</span>}
            </div>
            <div className="media-library-tile-actions">
              {item.media_type === 'image' && owner && item.ai_status !== 'done' && (
                <button type="button" disabled={Boolean(busy) || loading} onClick={() => ai(item)}>{busy === 'ai' + item.id ? 'Verificando…' : item.ai_status === 'processing' ? 'Verificar resultado' : 'Remover fundo (IA)'}</button>
              )}
              {owner && <button type="button" disabled={Boolean(busy) || loading || usageById[item.id]?.loading || usageById[item.id]?.in_use} data-testid={'media-delete-' + item.id} onClick={(event) => remove(item, event.currentTarget)}>{busy === 'd' + item.id ? 'Verificando uso…' : 'Excluir'}</button>}
            </div>
            {usageById[item.id]?.in_use && <p className="media-library-delete-note">Vinculada a produtos ou à Home. Consulte os locais de uso antes de remover os vínculos.</p>}
          </div>
        ))}
      </div>
      {loading && <p className="page-note" role="status">Carregando biblioteca…</p>}
      {!loading && !error && !items.length && <p className="page-note">Nenhuma mídia na biblioteca ainda.</p>}
      <div className="media-picker-actions">
        <button type="button" className="text-button" ref={refreshTrigger} disabled={Boolean(busy) || loading} onClick={() => { setError(''); load() }}>Atualizar biblioteca</button>
        {nextOffset < total && <button type="button" className="text-button" disabled={Boolean(busy) || loading} onClick={() => load(nextOffset)}>Carregar mais</button>}
      </div>
    </section>
  )
}
