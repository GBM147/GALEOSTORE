import { useEffect, useId, useRef, useState } from 'react'
import './HomeWorkflow.css'

const dateTime = (value) => {
  if (!value) return 'Ainda não salvo'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : date.toLocaleString('pt-BR')
}

const fieldNames = {
  eyebrow:'Texto acima do título', title:'Título', description:'Descrição', text:'Texto',
  button_label:'Texto do botão', button_url:'Destino do botão', url:'Link', label:'Nome',
  desktop_media_url:'Imagem desktop', mobile_media_url:'Mídia mobile', video_media_url:'Vídeo',
  mobile_video_media_url:'Vídeo mobile', media_url:'Imagem / vídeo', brand:'Nome da loja',
  location:'Localização', year:'Ano', theme:'Tema', background:'Fundo', surface:'Superfície',
  muted:'Texto secundário', accent:'Destaque', accent_soft:'Destaque suave', accent_deep:'Destaque profundo',
  effect:'Movimento', transition:'Transição', speed:'Velocidade', duration_seconds:'Duração', source:'Seleção de produtos'
}
const valueNames = {
  static:'Nenhum', zoom:'Zoom suave', 'pan-horizontal':'Movimento horizontal', 'pan-vertical':'Movimento vertical',
  parallax:'Parallax', 'ken-burns':'Ken Burns', fade:'Fade', slide:'Slide', crossfade:'Crossfade',
  slow:'Lenta', normal:'Normal', fast:'Rápida', dark:'Escuro', light:'Claro', latest:'Mais recentes', manual:'Seleção manual'
}

function rowsFromContent(content, products, mediaItems) {
  const rows = []
  const add = (key, label, value, media = false) => rows.push({ key, label, value:String(value ?? ''), media })
  function walk(value, path = '', prefix = '') {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      const fieldPath = path ? path + '.' + key : key
      if (key === 'product_ids' && Array.isArray(child)) {
        add(fieldPath, prefix + 'Produtos', child.map((id) => products.find((item) => Number(item.id) === Number(id))?.name || 'Produto indisponível').join(', '))
      } else if (key === 'use_default') {
        add(fieldPath, prefix + 'Animação', child !== false ? 'Usar padrão da GALEO' : 'Personalizada')
      } else if (Array.isArray(child)) {
        child.forEach((item, index) => {
          const itemLabel = key === 'slides' ? 'Foto ' : key === 'items' ? 'Item ' : 'Opção '
          if (typeof item === 'object' && item) walk(item, fieldPath + '.' + index, prefix + itemLabel + (index + 1) + ' · ')
          else add(fieldPath + '.' + index, prefix + itemLabel + (index + 1), item)
        })
      } else if (child && typeof child === 'object') {
        walk(child, fieldPath, prefix)
      } else if (fieldNames[key]) {
        const isMedia = key.includes('media_url')
        const title = isMedia ? mediaItems.find((item) => item.url === child || item.ai_url === child)?.title : null
        add(fieldPath, prefix + fieldNames[key], title || valueNames[child] || (key === 'duration_seconds' ? child + ' segundos' : child), isMedia)
        if (isMedia && child) rows[rows.length - 1].url = child
      }
    }
  }
  walk(content || {})
  return rows
}

export function HomeSectionOrder({ sections, meta, selectedKey, active, disabled, onSelect, onReorder }) {
  const [draggedKey, setDraggedKey] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const movePending = useRef(false)
  const ordered = [...sections].sort((left, right) => Number(left.order) - Number(right.order))
  async function move(fromKey, toIndex) {
    if (disabled || movePending.current) return
    const fromIndex = ordered.findIndex((item) => item.key === fromKey)
    if (fromIndex < 0 || toIndex < 0 || toIndex >= ordered.length || fromIndex === toIndex) return
    const next = ordered.map((item) => item.key)
    next.splice(toIndex, 0, next.splice(fromIndex, 1)[0])
    movePending.current = true
    try {
      await onReorder(next)
      setAnnouncement((meta[fromKey]?.[0] || 'Seção') + ' movida para a posição ' + (toIndex + 1) + ' no rascunho')
    } catch (error) {
      setAnnouncement(error.message || 'Não foi possível salvar a ordem')
    } finally {
      movePending.current = false
      setDraggedKey('')
    }
  }
  return <div className="home-section-order" aria-label="Ordem das seções da Home">
    <p className="home-workflow-help">Arraste pelo botão de mover ou use as setas. A ordem muda no rascunho.</p>
    {ordered.map((section, index) => {
      const title = meta[section.key]?.[0] || 'Seção'
      return <div key={section.key} data-section-key={section.key} className={'home-section-order-row' + (draggedKey === section.key ? ' dragging' : '')}
        onDragOver={(event) => { if (!disabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
        onDrop={(event) => { event.preventDefault(); move(event.dataTransfer.getData('text/plain') || draggedKey, index) }}>
        <button type="button" className={active && selectedKey === section.key ? 'home-editor-nav active' : 'home-editor-nav'} onClick={() => onSelect(section.key)}>
          <span>{title}</span><small>{section.visible ? 'Visível' : 'Oculta'}</small>
        </button>
        <div className="home-section-order-controls">
          <button type="button" className="home-section-drag" aria-label={'Arrastar ' + title} draggable={!disabled} disabled={disabled}
            onDragStart={(event) => { event.dataTransfer.setData('text/plain', section.key); event.dataTransfer.effectAllowed = 'move'; setDraggedKey(section.key) }} onDragEnd={() => setDraggedKey('')}>↕</button>
          <button type="button" aria-label={'Mover ' + title + ' para cima'} disabled={disabled || index === 0} onClick={() => move(section.key, index - 1)}>↑</button>
          <button type="button" aria-label={'Mover ' + title + ' para baixo'} disabled={disabled || index === ordered.length - 1} onClick={() => move(section.key, index + 1)}>↓</button>
        </div>
      </div>
    })}
    <p className="home-workflow-live" role="status">{announcement}</p>
  </div>
}

export function HomeDraftComparison({ section, setting, title, products = [], mediaItems = [], unsaved = false }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const saved = section?.draft ?? setting?.value ?? {}
  const published = section?.published ?? setting?.published ?? section?.content ?? {}
  const draftRows = rowsFromContent(saved, products, mediaItems)
  const publishedRows = rowsFromContent(published, products, mediaItems)
  const keys = [...new Set([...draftRows, ...publishedRows].map((row) => row.key))]
  const mapRows = (rows) => new Map(rows.map((row) => [row.key, row]))
  const draftMap = mapRows(draftRows)
  const publishedMap = mapRows(publishedRows)
  const metadataChanged = section && (Number(section.order) !== Number(section.published_order ?? section.order) || Boolean(section.visible) !== Boolean(section.published_visible ?? section.visible))
  const changed = keys.some((key) => draftMap.get(key)?.value !== publishedMap.get(key)?.value || draftMap.get(key)?.url !== publishedMap.get(key)?.url) || metadataChanged
  return <section className="home-draft-comparison" aria-label={'Comparação de ' + title}>
    <button type="button" className="home-workflow-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      <span>Comparar com publicado</span><small>{changed ? 'Há alterações no rascunho salvo' : 'Rascunho salvo igual ao publicado'}</small>
    </button>
    {open && <div id={id} className="home-comparison-content">
      {unsaved && <p className="home-workflow-note">Você tem alterações ainda não salvas. Salve o rascunho para incluí-las nesta comparação e na prévia.</p>}
      <div className="home-comparison-columns">
        {[['published', 'Publicado atualmente', publishedMap], ['draft', 'Conteúdo do rascunho', draftMap]].map(([state, label, rows]) => <article key={state} className="home-comparison-version" data-testid={'home-compare-' + state}>
          <h3>{label}</h3><p>{dateTime(state === 'draft' ? (section?.updated_at || setting?.updated_at) : (section?.published_at || setting?.published_at))}</p>
          {section && <dl className="home-comparison-metadata"><dt>Visibilidade</dt><dd>{(state === 'draft' ? section.visible : (section.published_visible ?? section.visible)) ? 'Visível' : 'Oculta'}</dd><dt>Posição</dt><dd>{state === 'draft' ? section.order : (section.published_order ?? section.order)}</dd></dl>}
          <dl>{keys.map((key) => {
            const row = rows.get(key)
            const other = (state === 'draft' ? publishedMap : draftMap).get(key)
            return <div key={key} className={'home-comparison-field' + (row?.value !== other?.value || row?.url !== other?.url ? ' changed' : '')}>
              <dt>{row?.label || other?.label}</dt><dd>{row?.value || 'Não definido'}{row?.url && !/\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(row.url) && <img src={row.url} alt={row.label} loading="lazy" />}</dd>
            </div>
          })}</dl>
          {!keys.length && <p>Esta seção ainda não tem conteúdo.</p>}
        </article>)}
      </div>
      <div className="home-workflow-links"><a className="text-button" href="/" target="_blank" rel="noopener noreferrer">Abrir Home publicada ↗</a><a className="text-button" href={'/?preview=draft&ts=' + Date.now()} target="_blank" rel="noopener noreferrer">Abrir rascunho salvo ↗</a></div>
    </div>}
  </section>
}

export function HomeVersionHistory({ api, disabled = false, refreshKey = 0, onRestore, onBusy }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const id = useId()
  useEffect(() => {
    if (!open) return
    let current = true
    setLoading(true)
    setError('')
    api('/api/admin/home/versions').then((data) => { if (current) setVersions(Array.isArray(data?.versions) ? data.versions : []) })
      .catch((err) => { if (current) setError(err.message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [open, refreshKey, api])
  async function restore(version) {
    if (pending.current || disabled) return
    pending.current = true
    onBusy?.(true)
    setRestoring(version.id)
    setError('')
    try {
      const result = await api('/api/admin/home/versions/' + version.id + '/restore', { method:'POST' })
      await onRestore(result)
    } catch (err) { setError(err.message) }
    finally { setRestoring(null); pending.current = false; onBusy?.(false) }
  }
  return <section className="home-version-history home-editor-publish-card" aria-label="Versões da Home">
    <button className="home-workflow-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}><span>Versões da Home</span><small>Voltar a uma publicação anterior</small></button>
    {open && <div id={id}>
      <p>Restaurar cria um rascunho. A loja só muda quando você publicar a Home.</p>
      {loading && <p role="status">Carregando versões…</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      {!loading && !error && !versions.length && <p>As próximas publicações aparecerão aqui.</p>}
      <ol className="home-version-list">{versions.map((version) => <li key={version.id}>
        <div><strong>Versão {version.version}</strong><small>{dateTime(version.published_at)}</small>{version.current && <span className="home-version-current">Publicada atual</span>}</div>
        <button className="text-button" type="button" disabled={disabled || restoring !== null} onClick={() => restore(version)}>{restoring === version.id ? 'Restaurando…' : 'Restaurar no rascunho'}</button>
      </li>)}</ol>
    </div>}
  </section>
}
