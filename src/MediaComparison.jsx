import { useEffect, useId, useRef, useState } from 'react'

export const originalMediaUrl = (item) => item?.original_url || (!item?.use_ai ? item?.url : '') || ''

export function selectedMediaVariant(item, currentUrl) {
  if (!currentUrl) return null
  if (currentUrl === originalMediaUrl(item)) return 'original'
  if (currentUrl === item?.ai_url) return 'ai'
  return null
}

function MediaVersion({ item, variant, active, onSelect, disabled, pending }) {
  const [failedUrl, setFailedUrl] = useState('')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const label = variant === 'ai' ? 'Sem fundo' : 'Original'
  const url = variant === 'ai' ? item.ai_url : originalMediaUrl(item)
  const ready = Boolean(url) && (variant !== 'ai' || item.ai_status === 'done')
  const failed = Boolean(url) && failedUrl === url
  let unavailable = 'Esta versão ainda não está disponível. Remova o fundo na biblioteca para gerar a imagem.'
  if (item.ai_status === 'processing') unavailable = 'A remoção de fundo está processando. Verifique o resultado na biblioteca.'
  if (item.ai_status === 'failed') unavailable = 'A remoção de fundo falhou. Tente novamente na biblioteca.'
  if (variant === 'original') unavailable = 'A imagem original não está disponível.'

  return (
    <article className="media-version-card" data-testid={'media-version-' + variant}>
      <div className="media-version-heading">
        <h4>{label}</h4>
        {active && <span className="media-in-use">Em uso</span>}
      </div>
      <div className="media-version-preview media-checkerboard">
        {ready ? <>
          <img
            key={url + ':' + previewAttempt}
            src={url}
            alt={(item.title || 'Foto ' + item.id) + ' — ' + label}
            onLoad={() => { setLoadedUrl(url); setFailedUrl('') }}
            onError={() => setFailedUrl(url)}
          />
          {failed ? <div className="media-preview-state" role="status">
            <p>Não foi possível carregar a prévia.</p>
            <button type="button" className="text-button" disabled={disabled} onClick={() => {
              setFailedUrl('')
              setLoadedUrl('')
              setPreviewAttempt((attempt) => attempt + 1)
            }}>Tentar carregar novamente</button>
          </div>
            : loadedUrl !== url && <p className="media-preview-state" role="status">Carregando prévia…</p>}
        </> : <p className="media-preview-state">{unavailable}</p>}
      </div>
      <button
        type="button"
        className="button button-primary media-version-use"
        aria-label={'Usar esta versão: ' + label}
        disabled={disabled || !ready || failed || loadedUrl !== url || active}
        onClick={() => onSelect?.(variant, url)}
      >{pending ? 'Aplicando…' : 'Usar esta versão'}</button>
    </article>
  )
}

export default function MediaComparison({ item, activeVariant, onSelect, onClose, disabled = false, pendingVariant = '', readOnly = false }) {
  const titleId = useId()
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [item.id])

  return (
    <section className="media-comparison" aria-labelledby={titleId} data-testid="media-comparison" aria-busy={Boolean(pendingVariant)}>
      <div className="media-comparison-heading">
        <div>
          <h3 id={titleId} ref={heading} tabIndex="-1">Comparar versões</h3>
          <p>{item.title || 'Foto ' + item.id}</p>
        </div>
        <button type="button" className="text-button" disabled={disabled} onClick={onClose}>Voltar à biblioteca</button>
      </div>
      <div className="media-comparison-grid">
        {['original', 'ai'].map((variant) => <MediaVersion
          key={variant}
          item={item}
          variant={variant}
          active={activeVariant === variant}
          disabled={disabled || readOnly}
          pending={pendingVariant === variant}
          onSelect={onSelect}
        />)}
      </div>
      {readOnly && <p className="page-note">A escolha da versão na biblioteca é exclusiva do proprietário.</p>}
    </section>
  )
}

export function MediaLibraryPicker({ api, currentUrl, onChoose, onCancel, disabled = false }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const request = useRef(0)
  const compareTrigger = useRef(null)
  const titleId = useId()

  async function load(offset = 0) {
    const requestId = ++request.current
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/admin/media-library?limit=100&offset=' + offset)
      if (requestId !== request.current) return
      const page = Array.isArray(data?.items) ? data.items : []
      setItems((current) => offset ? [...current, ...page.filter((item) => !current.some((old) => old.id === item.id))] : page)
      setTotal(Number(data?.total) || offset + page.length)
      setNextOffset(offset + page.length)
    } catch (err) {
      if (requestId === request.current) setError(err.message || 'Não foi possível abrir a biblioteca.')
    } finally {
      if (requestId === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    return () => { request.current += 1 }
  }, [api])

  const photos = items.filter((item) => item.media_type === 'image')
  const selected = photos.find((item) => item.id === selectedId)
  function closeComparison() {
    setSelectedId(null)
    window.requestAnimationFrame(() => compareTrigger.current?.focus())
  }

  return (
    <section className="product-library-picker" aria-labelledby={titleId} data-testid="product-library-picker" aria-busy={loading}>
      <div className="media-comparison-heading">
        <h3 id={titleId}>Escolher da biblioteca</h3>
        <button type="button" className="text-button" disabled={disabled} onClick={onCancel}>Cancelar seleção</button>
      </div>
      <p className="media-picker-note">Compare as versões e escolha a capa. A alteração será salva com o produto.</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {selected && <MediaComparison
        item={selected}
        activeVariant={selectedMediaVariant(selected, currentUrl)}
        disabled={disabled || loading}
        onClose={closeComparison}
        onSelect={(variant, url) => onChoose({ id: selected.id, variant, url, title: selected.title })}
      />}
      <div className="media-picker-grid">
        {photos.map((item) => <button
          className={'media-picker-photo' + (selectedMediaVariant(item, currentUrl) ? ' is-current' : '')}
          key={item.id}
          type="button"
          disabled={disabled || loading}
          aria-label={'Comparar versões: ' + (item.title || 'Foto ' + item.id)}
          aria-expanded={selectedId === item.id}
          data-testid={'media-pick-' + item.id}
          onClick={(event) => { compareTrigger.current = event.currentTarget; setSelectedId(item.id) }}
        >
          <span className="media-picker-thumbnail media-checkerboard"><img src={item.url || originalMediaUrl(item)} alt="" loading="lazy" /></span>
          <span>{item.title || 'Foto ' + item.id}</span>
          {selectedMediaVariant(item, currentUrl) && <span className="media-in-use">Em uso</span>}
        </button>)}
      </div>
      {loading && <p className="page-note" role="status">Carregando biblioteca…</p>}
      {!loading && !error && !photos.length && <p className="page-note">Nenhuma foto disponível nesta página da biblioteca.</p>}
      <div className="media-picker-actions">
        <button type="button" className="text-button" disabled={disabled || loading} onClick={() => load()}>Atualizar biblioteca</button>
        {nextOffset < total && <button type="button" className="text-button" disabled={disabled || loading} onClick={() => load(nextOffset)}>Carregar mais</button>}
      </div>
    </section>
  )
}
