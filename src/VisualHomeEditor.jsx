import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { adminApi } from './adminApi'
import { CAMPAIGN_DEFAULTS, MAX_CAMPAIGN_SLIDES, isCampaignVideo } from './campaign-model'
import { textHighlightPath, editorialType, defaultTextHighlight } from './editorialText'
import './VisualHomeEditor.css'

const EditorContext = createContext(null)
const names = { hero:'Capa', utility:'Faixa informativa', categories:'Categorias', featured_products:'Produtos em destaque', campaigns:'Campanhas', manifesto:'Sobre a GALEO', newsletter:'Newsletter' }
const clone = (value) => JSON.parse(JSON.stringify(value))
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sectionValue = (section) => ({ content:section.content || section.draft || {}, visible:Boolean(section.visible), order:Number(section.order || 0) })
const pathParts = (path) => Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean)
const readPath = (value, path) => pathParts(path).reduce((current, key) => current?.[key], value)
function writePath(value, path, nextValue) {
  const keys = pathParts(path)
  if (!keys.length) return nextValue
  const next = Array.isArray(value) ? [...value] : { ...(value || {}) }
  next[keys[0]] = writePath(value?.[keys[0]], keys.slice(1), nextValue)
  return next
}
function deletePath(value, path) {
  const keys = pathParts(path)
  if (!keys.length || value == null) return value
  const next = Array.isArray(value) ? [...value] : { ...value }
  if (keys.length === 1) delete next[keys[0]]
  else next[keys[0]] = deletePath(value[keys[0]], keys.slice(1))
  return next
}
const sorted = (sections) => [...sections].sort((left, right) => Number(left.order) - Number(right.order))
const leaveMessage = 'Há alterações não salvas no rascunho. Sair e descartar essas alterações?'
const popGuards = new Set()
function dispatchHistoryGuard(event) {
  for (const guard of popGuards) if (guard(event) === false) break
}
// This module loads before BrowserRouter mounts. Window is the POP event's
// target, so registering first is necessary; capture alone cannot run ahead of
// a previously registered Window listener. With no editor mounted this is idle.
if (typeof window !== 'undefined') window.addEventListener('popstate',dispatchHistoryGuard)
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('popstate',dispatchHistoryGuard)
  popGuards.clear()
})
export const useVisualEditor = () => useContext(EditorContext)

function TextHighlightField({ text, value, type, onChange, label = 'Trecho em destaque', disabled = false }) {
  const hintId = useId()
  const highlight = String(value ?? defaultTextHighlight(text, type))
  const invalid = Boolean(highlight && !String(text).includes(highlight))
  return <span className="visual-highlight-options">
    <label className="visual-highlight-field"><span>{label}</span><input type="text" aria-label={label} value={highlight} disabled={disabled} aria-describedby={hintId} aria-invalid={invalid || undefined} onChange={event => onChange(event.target.value)} /></label>
    <span id={hintId} className={invalid ? 'visual-highlight-hint is-invalid' : 'visual-highlight-hint'}>{invalid ? 'Esse trecho precisa fazer parte do texto acima. Confira as palavras e as letras maiúsculas.' : 'Estas palavras ficam em dourado e itálico. Deixe vazio para usar o texto comum.'}</span>
  </span>
}

export function EditableText({ sectionKey, path, label = 'texto', value, children }) {
  const editor = useVisualEditor()
  const [active, setActive] = useState(false)
  const original = useRef(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const trigger = useRef(null)
  const input = useRef(null)
  const id = useId()
  const sectionContent = editor?.sections.find((item) => item.key === sectionKey)?.content
  const text = String(readPath(sectionContent,path) ?? value ?? '')
  const highlightPath = textHighlightPath(path)
  const highlight = highlightPath ? readPath(sectionContent, highlightPath) : undefined
  useLayoutEffect(() => {
    if (!active) return
    input.current?.focus({ preventScroll:true })
    input.current?.select()
  }, [active])
  useLayoutEffect(() => {
    if (!input.current) return
    input.current.style.height = 'auto'
    input.current.style.height = input.current.scrollHeight + 'px'
  }, [text, active])
  if (!editor?.editing) return children ?? value
  function begin(event) {
    event.preventDefault()
    event.stopPropagation()
    if (editor.busy) return
    const content = editor.sections.find((item) => item.key === sectionKey)?.content
    const current = readPath(content, path) ?? value ?? ''
    const parts = highlightPath || []
    original.current = {
      text: String(current),
      highlight: highlightPath ? readPath(content, highlightPath) : undefined,
      hasHighlight: parts.length > 0 && Object.hasOwn(readPath(content, parts.slice(0, -1)) || {}, parts.at(-1))
    }
    setActive(true)
  }
  function finish(cancel = false) {
    if (cancel) editor.updateSection(sectionKey, (content) => {
      const restored = writePath(content, path, original.current.text)
      if (!highlightPath) return restored
      return original.current.hasHighlight ? writePath(restored, highlightPath, original.current.highlight) : deletePath(restored, highlightPath)
    })
    setActive(false)
    window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll:true }))
  }
  return <span className={'visual-editable-text' + (active ? ' is-editing' : '')}>
    {active ? <span className="visual-inline-editor" onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finish(true) } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish() } }}>
      <textarea ref={input} id={id} aria-label={label} rows="1" value={text} disabled={editor.busy}
        onChange={(event) => editor.updateSection(sectionKey, (content) => writePath(content, path, event.target.value))}
        onSelect={event => setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd })} />
      {highlightPath && <>
        <span className="visual-inline-actions"><button type="button" disabled={editor.busy || selection.start === selection.end} onPointerDown={event => event.preventDefault()} onClick={() => {
          const start = input.current.selectionStart, end = input.current.selectionEnd
          if (start === end) return
          editor.updateSection(sectionKey, content => writePath(content, highlightPath, text.slice(start, end)))
          input.current.focus({ preventScroll: true })
          input.current.setSelectionRange(start, end)
        }}>Destacar seleção</button></span>
        <TextHighlightField text={text} value={highlight} type={editorialType(sectionKey, path)} disabled={editor.busy} onChange={value => editor.updateSection(sectionKey, content => writePath(content, highlightPath, value))} />
      </>}
      <span className="visual-inline-actions"><button type="button" disabled={editor.busy} onClick={() => finish()}>Concluir edição</button><button type="button" disabled={editor.busy} onClick={() => finish(true)}>Cancelar edição</button></span>
    </span> : <span ref={trigger} role="button" tabIndex={editor.busy ? -1 : 0} className={'visual-text-trigger' + (!text.trim() ? ' is-empty' : '')} aria-label={'Editar ' + label} onClick={begin}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') begin(event) }}>{text.trim() ? (children ?? value ?? text) : <span className="visual-text-placeholder">Clique para escrever</span>}</span>}
  </span>
}

export function EditorLink({ sectionKey, labelPath = 'button_label', urlPath = 'button_url', children, ...props }) {
  const editor = useVisualEditor()
  if (!editor?.editing) return <Link {...props} data-editor-spa-link={props.reloadDocument ? undefined : 'true'}>{children}</Link>
  return <button {...Object.fromEntries(Object.entries(props).filter(([key]) => !['to','target','rel','onClick'].includes(key)))} type="button" disabled={editor.busy}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); editor.select({ kind:'link', sectionKey, labelPath, urlPath }) }}>{children}</button>
}

export function EditorMediaButton({ sectionKey, kind = 'media', itemIndex, label = 'Trocar imagem' }) {
  const editor = useVisualEditor()
  if (!editor?.editing) return null
  return <button className="visual-media-button" type="button" disabled={editor.busy} onClick={(event) => { event.preventDefault(); event.stopPropagation(); editor.select({ sectionKey, kind, itemIndex }) }}>{label}</button>
}

export function EditableSection({ sectionKey, children }) {
  const editor = useVisualEditor()
  if (!editor?.editing) return children
  const section = editor.sections.find((item) => item.key === sectionKey)
  if (!section) return children
  const title = names[sectionKey] || sectionKey
  const ordered = sorted(editor.sections)
  const index = ordered.findIndex((item) => item.key === sectionKey)
  function move(direction) {
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const next = [...ordered]
    ;[next[index], next[target]] = [next[target], next[index]]
    editor.reorder(next.map((item) => item.key))
  }
  return <div className={'visual-editable-section' + (!section.visible ? ' is-hidden' : '')} data-editor-section={sectionKey}>
    <div className="visual-section-toolbar" role="group" aria-label={'Editar seção ' + title}>
      <strong>{title}</strong>
      <button type="button" aria-label={'Mover ' + title + ' para cima'} disabled={editor.busy || index === 0} onClick={() => move(-1)}>↑</button>
      <button type="button" aria-label={'Mover ' + title + ' para baixo'} disabled={editor.busy || index === ordered.length - 1} onClick={() => move(1)}>↓</button>
      <button type="button" aria-label={(section.visible ? 'Ocultar ' : 'Mostrar ') + title} disabled={editor.busy} onClick={() => editor.setVisibility(sectionKey, !section.visible)}>{section.visible ? 'Ocultar' : 'Mostrar'}</button>
      <button type="button" aria-label={'Opções de ' + title} disabled={editor.busy} onClick={() => editor.select({ sectionKey, kind:'section' })}>Opções</button>
    </div>
    {section.visible ? children : <div className="visual-hidden-section"><p>Esta seção está oculta na loja.</p><button type="button" disabled={editor.busy} onClick={() => editor.setVisibility(sectionKey, true)}>Mostrar {title}</button></div>}
  </div>
}

function EditorDialog({ title, children, onClose, busy }) {
  const dialog = useRef(null)
  const headingId = useId()
  useLayoutEffect(() => {
    const opener = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.showModal()
    return () => {
      if (dialog.current?.open) dialog.current.close()
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus({ preventScroll:true })
    }
  }, [])
  return createPortal(<dialog ref={dialog} className="visual-editor-dialog" aria-labelledby={headingId} data-lenis-prevent=""
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2 id={headingId}>{title}</h2><button autoFocus type="button" aria-label="Fechar opções" disabled={busy} onClick={onClose}>×</button></header>
    <div className="visual-dialog-content" data-lenis-prevent="">{children}</div>
    <footer><p>Você está alterando o rascunho.</p><button type="button" disabled={busy} onClick={onClose}>Concluir</button></footer>
  </dialog>, document.body)
}

function Field({ label, value, onChange, multiline = false, ...props }) {
  return <label className="visual-field"><span>{label}</span>{multiline ? <textarea {...props} rows="3" value={value ?? ''} onChange={(event) => onChange(event.target.value)} /> : <input {...props} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />}</label>
}

function MediaPicker({ target, onPick, onBack, busy }) {
  const [items, setItems] = useState([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  const heading = useRef(null)
  async function load(nextOffset = 0) {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    setError('')
    try {
      const data = await adminApi('/api/admin/media-library?limit=24&offset=' + nextOffset)
      if (!mounted.current) return
      const page = Array.isArray(data?.items) ? data.items : []
      setItems((current) => nextOffset ? [...current, ...page.filter((item) => !current.some((old) => old.id === item.id))] : page)
      setOffset(nextOffset + page.length)
      setTotal(Number(data.total) || nextOffset + page.length)
    } catch (err) { if (mounted.current) setError(err.message || 'Não foi possível abrir a biblioteca.') }
    finally { pending.current = false; if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false } }, [])
  useLayoutEffect(() => { heading.current?.focus({ preventScroll:true }) }, [])
  const filtered = items.filter((item) => !target.type || item.media_type === target.type)
  return <div className="visual-media-picker">
    <button className="visual-back" type="button" onClick={onBack}>← Voltar às opções</button><h3 ref={heading} tabIndex="-1">Escolher mídia</h3><p>{target.label}. Escolha uma foto ou um vídeo da biblioteca.</p>
    {error && <p className="visual-error" role="alert">{error}<button type="button" onClick={() => load(offset)}>Tentar novamente</button></p>}
    <div className="visual-media-grid">{filtered.map((item) => <button type="button" key={item.id} disabled={busy} aria-label={'Usar ' + (item.title || (item.media_type === 'video' ? 'vídeo' : 'foto'))} onClick={() => onPick(item)}>
      {item.media_type === 'video' ? <video src={item.url} muted playsInline preload="metadata" /> : <img src={item.url} alt="" loading="lazy" />}
      <span>{item.title || (item.media_type === 'video' ? 'Vídeo' : 'Foto')}</span><small>{item.media_type === 'video' ? 'Vídeo' : 'Foto'}</small>
    </button>)}</div>
    {!loading && !filtered.length && <p>Nenhuma mídia deste tipo nesta página. Você pode carregar mais ou adicionar fotos pela Biblioteca de mídia no painel.</p>}
    {loading && <p role="status">Carregando mídias…</p>}
    {offset < total && <button type="button" disabled={loading || busy} onClick={() => load(offset)}>Carregar mais mídias</button>}
    <a href="/admin?tab=library" target="_blank" rel="noopener noreferrer">Abrir Biblioteca de mídia ↗</a>
  </div>
}

function MediaSlot({ label, url, type, onChoose, onClear }) {
  return <div className="visual-media-slot">
    <div className="visual-slot-preview">{url ? (type === 'video' || isCampaignVideo(url) ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" loading="lazy" />) : <span>Sem mídia</span>}</div>
    <div><strong>{label}</strong><button type="button" onClick={onChoose}>{'Escolher ' + label}</button>{url && <button type="button" onClick={onClear}>{'Remover ' + label}</button>}</div>
  </div>
}

const effects = [['static','Nenhum'],['zoom','Zoom suave'],['pan-horizontal','Horizontal'],['pan-vertical','Vertical'],['parallax','Parallax'],['ken-burns','Ken Burns']]
const transitions = [['fade','Fade'],['slide','Slide'],['crossfade','Crossfade']]
const speeds = [['slow','Lenta'],['normal','Normal'],['fast','Rápida']]
function AnimationFields({ value, onChange }) {
  const current = { ...CAMPAIGN_DEFAULTS, ...value }
  return <div className="visual-field-grid">{[['effect','Movimento',effects],['transition','Transição',transitions],['speed','Velocidade',speeds]].map(([key,label,options]) => <label className="visual-field" key={key}><span>{label}</span><select value={current[key]} onChange={(event) => onChange({ ...current, [key]:event.target.value })}>{options.map(([value,text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}<Field label="Duração em segundos" type="number" min="2" max="30" value={current.duration_seconds} onChange={(value) => onChange({ ...current, duration_seconds:value === '' ? '' : Number(value) })} /></div>
}

function SelectionPanel({ selection, editor, onClose }) {
  const [picker, setPicker] = useState(null)
  const [tab, setTab] = useState(selection.tab || 'navigation')
  const section = editor.sections.find((item) => item.key === selection.sectionKey)
  const content = section?.content || {}
  const itemIndex = Number(selection.itemIndex || 0)
  const items = Array.isArray(content.items) ? content.items : []
  const item = items[itemIndex]
  const kind = selection.kind === 'section' ? ({ hero:'media', categories:'categories', campaigns:'campaigns', featured_products:'products', utility:'utility' }[section?.key] || 'section') : selection.kind
  const titles = { media:'Fotos e vídeo da capa', category:'Editar categoria', categories:'Organizar categorias', campaign:'Editar campanha', campaigns:'Organizar campanhas', products:'Escolher produtos em destaque', link:'Editar botão ou link', settings:'Configurações da loja', utility:'Mensagens da faixa', section:'Opções de ' + (names[section?.key] || 'seção') }
  const textFields = ['media','products','categories','section'].includes(kind) ? ({
    hero:[['title','Título da capa'],['description','Descrição da capa',true]],
    categories:[['title','Título das categorias']],
    featured_products:[['title','Título dos destaques']],
    manifesto:[['text','Texto do manifesto',true]],
    newsletter:[['title','Título da newsletter']]
  }[section?.key] || []) : []
  function update(path, value) { editor.updateSection(section.key, (old) => writePath(old, path, value)) }
  function updateItem(next) { update(['items',itemIndex], next) }
  function moveItem(index, direction) {
    const next = [...items]
    if (index + direction < 0 || index + direction >= next.length) return
    ;[next[index],next[index + direction]] = [next[index + direction],next[index]]
    update('items', next)
  }
  function newItem() {
    const value = section.key === 'categories' ? { title:'Nova categoria', url:'/shop', media_url:'', media_id:null } : section.key === 'campaigns' ? { title:'Nova campanha', button_label:'Explorar', button_url:'/shop', animation:{ use_default:true }, slides:[{ media_url:'', media_type:'image', mobile_media_url:'' }] } : 'Nova mensagem'
    update('items',[...items,value])
  }
  function chooseTarget(target) { setPicker({ ...target, sectionKey:section.key }) }
  function closePicker() {
    const label = picker?.label
    setPicker(null)
    window.requestAnimationFrame(() => Array.from(document.querySelectorAll('.visual-editor-dialog button')).find((button) => button.textContent === 'Escolher ' + label)?.focus({ preventScroll:true }))
  }
  function applyAsset(asset) {
    const fields = picker.prefix ? { [picker.prefix + '_media_id']:asset ? Number(asset.id) : null, [picker.prefix + '_media_url']:asset?.url || '' } : { media_id:asset ? Number(asset.id) : null, media_url:asset?.url || '', media_type:asset?.media_type || 'image' }
    if (picker.campaign) {
      const campaign = items[picker.campaignIndex]
      const slides = campaignSlides(campaign)
      const prefix = picker.mobile ? 'mobile_' : ''
      const changed = slides.map((slide,index) => index === picker.slideIndex ? { ...slide, [prefix + 'media_id']:asset ? Number(asset.id) : null, [prefix + 'media_url']:asset?.url || '', [prefix + 'media_type']:asset?.media_type || 'image', [prefix + 'video_media_id']:null, [prefix + 'video_media_url']:'' } : slide)
      update(['items',picker.campaignIndex], withSlides(campaign,changed))
    } else editor.updateSection(section.key, (old) => picker.itemPath ? writePath(old,picker.itemPath,{ ...readPath(old,picker.itemPath), ...fields }) : { ...old,...fields })
    closePicker()
  }
  const dialogTitle = picker ? 'Escolher mídia' : titles[kind] || 'Editar rascunho'
  return <EditorDialog title={dialogTitle} onClose={onClose} busy={editor.busy}>
    {picker ? <MediaPicker target={picker} onPick={applyAsset} onBack={closePicker} busy={editor.busy} /> : <fieldset disabled={editor.busy} className="visual-panel-fields">
      {textFields.map(([path,label,multiline]) => <span className="visual-formatted-field" key={path}><Field label={label} multiline={multiline} value={readPath(content,path)} onChange={(value) => update(path,value)} /><TextHighlightField label={'Trecho em destaque — ' + label} text={readPath(content,path) || ''} value={readPath(content,textHighlightPath(path))} type={editorialType(section.key,path)} onChange={value => update(textHighlightPath(path),value)} /></span>)}
      {kind === 'media' && <><p>Troque a imagem principal, a versão para celular ou o vídeo da capa. O vídeo tem prioridade sobre a foto.</p>{[['desktop','Imagem para computador','image'],['mobile','Imagem para celular','image'],['video','Vídeo da capa','video']].map(([prefix,label,type]) => <MediaSlot key={prefix} label={label} type={type} url={content[prefix + '_media_url']} onChoose={() => chooseTarget({prefix,label,type})} onClear={() => editor.updateSection(section.key,(old) => ({ ...old,[prefix + '_media_id']:null,[prefix + '_media_url']:'' }))} />)}</>}
      {kind === 'link' && <><Field label="Texto do botão" value={readPath(content,selection.labelPath)} onChange={(value) => update(selection.labelPath,value)} /><Field label="Destino do botão" value={readPath(content,selection.urlPath)} placeholder="Ex.: /shop" onChange={(value) => update(selection.urlPath,value)} /><p>Use /shop para o catálogo ou cole o endereço de uma página.</p></>}
      {kind === 'category' && item && <><Field label="Nome da categoria" value={item.title} onChange={(value) => updateItem({ ...item,title:value })} /><TextHighlightField label="Trecho em destaque — Nome da categoria" text={item.title || ''} value={item.title_highlight} type="generic" onChange={value => updateItem({ ...item,title_highlight:value })} /><Field label="Destino da categoria" value={item.url} onChange={(value) => updateItem({ ...item,url:value })} /><MediaSlot label="Foto da categoria" url={item.media_url} onChoose={() => chooseTarget({itemPath:['items',itemIndex],label:'Foto da categoria',type:'image'})} onClear={() => updateItem({ ...item,media_id:null,media_url:'' })} /></>}
      {['categories','campaigns','utility'].includes(kind) && <><p>Organize o que aparece nesta seção. Todas as mudanças ficam no rascunho.</p><div className="visual-item-list">{items.map((value,index) => <div key={index} className="visual-list-row">{kind === 'utility' ? <Field label={'Mensagem ' + (index + 1)} value={value} onChange={(text) => update(['items',index],text)} /> : <button className="visual-list-select" type="button" onClick={() => editor.select({ sectionKey:section.key,kind:kind === 'categories' ? 'category' : 'campaign',itemIndex:index })}>{value.title || 'Item ' + (index + 1)} <span>Editar →</span></button>}<div className="visual-row-actions"><button type="button" aria-label={'Mover item ' + (index + 1) + ' para cima'} disabled={index === 0} onClick={() => moveItem(index,-1)}>↑</button><button type="button" aria-label={'Mover item ' + (index + 1) + ' para baixo'} disabled={index === items.length - 1} onClick={() => moveItem(index,1)}>↓</button><button type="button" aria-label={'Remover item ' + (index + 1)} onClick={() => update('items',items.filter((_,current) => current !== index))}>Remover</button></div></div>)}</div><button type="button" onClick={newItem}>+ {kind === 'categories' ? 'Adicionar categoria' : kind === 'campaigns' ? 'Adicionar campanha' : 'Adicionar mensagem'}</button></>}
      {kind === 'campaign' && item && <CampaignOptions item={item} defaults={editor.settings.campaign_defaults} onChange={updateItem} onChoose={(target) => chooseTarget({ ...target,campaign:true,campaignIndex:itemIndex })} />}
      {kind === 'products' && <ProductChoices content={content} products={editor.products} onChange={(value) => editor.updateSection(section.key,() => value)} />}
      {kind === 'section' && <><p>Clique nos textos desta seção para editar diretamente na página.</p>{section?.key === 'newsletter' && <Field label="Texto do botão da newsletter" value={content.button_label} onChange={(value) => update('button_label',value)} />}</>}
      {kind === 'settings' && <><div className="visual-settings-tabs" role="group" aria-label="Áreas de configurações">{[['navigation','Menu'],['footer','Rodapé'],['visual','Cores e tema'],['campaign','Movimento']].map(([key,label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div><SettingsOptions tab={tab} settings={editor.settings} update={editor.updateSetting} /><a href="/admin?tab=editor&mode=advanced">Mais opções e histórico de versões ↗</a></>}
      {(kind === 'category' || kind === 'campaign') && !item && <p>Este item foi removido. Feche as opções e escolha outro.</p>}
    </fieldset>}
  </EditorDialog>
}

function campaignSlides(item) {
  if (Array.isArray(item.slides) && item.slides.length) return item.slides
  return [{ media_id:item.media_id || null, media_url:item.video_media_url || item.media_url || '', media_type:item.video_media_url ? 'video' : (item.media_type || (isCampaignVideo(item.media_url) ? 'video' : 'image')), mobile_media_id:item.mobile_media_id || null, mobile_media_url:item.mobile_video_media_url || item.mobile_media_url || '', mobile_media_type:item.mobile_video_media_url ? 'video' : (item.mobile_media_type || 'image') }]
}
function withSlides(item,slides) { return { ...item,media_id:null,media_url:'',video_media_id:null,video_media_url:'',mobile_media_id:null,mobile_media_url:'',mobile_video_media_id:null,mobile_video_media_url:'',slides } }
function CampaignOptions({ item, defaults, onChange, onChoose }) {
  const slides = campaignSlides(item)
  const animation = item.animation || { use_default:true }
  function changeSlides(next) { onChange(withSlides(item,next)) }
  function move(index,direction) { const next = [...slides]; [next[index],next[index + direction]] = [next[index + direction],next[index]]; changeSlides(next) }
  return <><Field label="Título da campanha" value={item.title} onChange={(value) => onChange({ ...item,title:value })} /><TextHighlightField label="Trecho em destaque — Título da campanha" text={item.title || ''} value={item.title_highlight} type="campaign" onChange={value => onChange({ ...item,title_highlight:value })} /><Field label="Texto do botão" value={item.button_label} onChange={(value) => onChange({ ...item,button_label:value })} /><Field label="Destino do botão" value={item.button_url} onChange={(value) => onChange({ ...item,button_url:value })} />
    {slides.map((slide,index) => <section className="visual-campaign-slide" key={index}><h3>Foto ou vídeo {index + 1}</h3>{[[false,'Para computador'],[true,'Para celular (opcional)']].map(([mobile,label]) => <MediaSlot key={label} label={label} url={mobile ? slide.mobile_video_media_url || slide.mobile_media_url : slide.video_media_url || slide.media_url} onChoose={() => onChoose({slideIndex:index,mobile,label})} onClear={() => { const prefix = mobile ? 'mobile_' : ''; changeSlides(slides.map((old,current) => current === index ? { ...old,[prefix + 'media_id']:null,[prefix + 'media_url']:'',[prefix + 'video_media_id']:null,[prefix + 'video_media_url']:'' } : old)) }} />)}<div className="visual-row-actions"><button type="button" aria-label={'Mover foto ' + (index + 1) + ' para cima'} disabled={!index} onClick={() => move(index,-1)}>↑</button><button type="button" aria-label={'Mover foto ' + (index + 1) + ' para baixo'} disabled={index === slides.length - 1} onClick={() => move(index,1)}>↓</button><button type="button" disabled={slides.length === 1} onClick={() => changeSlides(slides.filter((_,current) => current !== index))}>{'Remover foto ' + (index + 1)}</button></div></section>)}
    <button type="button" disabled={slides.length >= MAX_CAMPAIGN_SLIDES} onClick={() => changeSlides([...slides,{media_url:'',media_type:'image',mobile_media_url:''}])}>+ Adicionar foto ou vídeo</button>
    <details className="visual-advanced-options"><summary>Movimento da campanha</summary><label className="visual-checkbox"><input type="checkbox" checked={animation.use_default !== false} onChange={(event) => onChange({ ...item,animation:{ ...CAMPAIGN_DEFAULTS,...defaults,...animation,use_default:event.target.checked } })} /> Usar padrão da GALEO</label>{animation.use_default === false && <AnimationFields value={animation} onChange={(value) => onChange({ ...item,animation:{ ...value,use_default:false } })} />}</details>
  </>
}

function ProductChoices({ content, products, onChange }) {
  const [search,setSearch] = useState('')
  const selected = Array.isArray(content.product_ids) ? content.product_ids.map(Number) : []
  const filtered = products.filter((product) => String(product.name || '').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
  return <><label className="visual-field"><span>O que mostrar na Home</span><select value={content.source || 'latest'} onChange={(event) => onChange({ ...content,source:event.target.value })}><option value="latest">Produtos mais recentes</option><option value="manual">Escolher produtos</option></select></label>{content.source === 'manual' && <><Field label="Buscar produto" type="search" value={search} onChange={setSearch} /><p>{selected.length} produto(s) selecionado(s). A ordem de seleção será usada na Home.</p><div className="visual-product-grid">{filtered.map((product) => <label key={product.id} className="visual-product-choice"><input type="checkbox" checked={selected.includes(Number(product.id))} onChange={(event) => onChange({ ...content,product_ids:event.target.checked ? [...selected,Number(product.id)] : selected.filter((id) => id !== Number(product.id)) })} /><img src={product.image || '/images/product-placeholder.svg'} alt="" loading="lazy" /><span>{product.name}</span></label>)}</div>{!filtered.length && <p>Nenhum produto encontrado. Cadastre seus produtos no painel para selecionar aqui.</p>}</>}</>
}

function SettingsOptions({ tab,settings,update }) {
  if (tab === 'navigation') {
    const current = settings.navigation || {items:[]}
    const items = current.items || []
    function setItem(index,fields) { update('navigation',(old) => ({ ...old,items:items.map((item,currentIndex) => currentIndex === index ? { ...item,...fields } : item) })) }
    return <><p>Links que aparecem no menu da loja.</p>{items.map((item,index) => <div className="visual-list-row" key={index}><Field label={'Nome do link ' + (index + 1)} value={item.label} onChange={(value) => setItem(index,{label:value})} /><Field label={'Destino do link ' + (index + 1)} value={item.url} onChange={(value) => setItem(index,{url:value})} /><button type="button" onClick={() => update('navigation',() => ({ ...current,items:items.filter((_,currentIndex) => currentIndex !== index) }))}>{'Remover link ' + (index + 1)}</button></div>)}<button type="button" disabled={items.length >= 8} onClick={() => update('navigation',() => ({ ...current,items:[...items,{label:'Novo link',url:'/shop'}] }))}>+ Adicionar link</button></>
  }
  if (tab === 'footer') return <>{[['brand','Nome da loja'],['year','Ano']].map(([key,label]) => <Field key={key} label={label} value={settings.footer?.[key]} onChange={(value) => update('footer',(old) => ({ ...old,[key]:value }))} />)}</>
  if (tab === 'campaign') return <><p>Este padrão é aplicado às campanhas automaticamente.</p><AnimationFields value={settings.campaign_defaults} onChange={(value) => update('campaign_defaults',() => value)} /></>
  const current = settings.storefront_visual_defaults || {}
  return <><label className="visual-field"><span>Tema inicial da loja</span><select value={current.theme || 'dark'} onChange={(event) => update('storefront_visual_defaults',(old) => ({ ...old,theme:event.target.value }))}><option value="dark">Escuro</option><option value="light">Claro</option></select></label><p>A loja e o painel usam Roboto, com pesos leves para facilitar a leitura.</p><div className="visual-color-grid">{[['background','Fundo'],['surface','Superfícies'],['text','Texto'],['muted','Texto secundário'],['accent','Destaque'],['accent_soft','Destaque suave']].map(([key,label]) => <Field key={key} type="color" label={label} value={/^#[\da-f]{6}$/i.test(current.palette?.[key] || '') ? current.palette[key] : '#000000'} onChange={(value) => update('storefront_visual_defaults',(old) => ({ ...old,palette:{ ...old.palette,[key]:value } }))} />)}</div></>
}

export default function VisualHomeEditor({ sections = [], settings = {}, products = [], onSectionsChange, onSettingsChange, children }) {
  const location = useLocation()
  const [authorized,setAuthorized] = useState(null)
  const [editing,setEditing] = useState(true)
  const [busy,setBusy] = useState(false)
  const [status,setStatus] = useState('')
  const [error,setError] = useState('')
  const [selection,setSelection] = useState(null)
  const [baselineVersion,setBaselineVersion] = useState(0)
  const baseline = useRef(null)
  const operation = useRef(false)
  const historyPosition = useRef(window.history.state?.idx)
  const restoringHistory = useRef(null)
  const dirtyRef = useRef(false)
  useLayoutEffect(() => { historyPosition.current = window.history.state?.idx }, [location.key])
  if (!baseline.current && sections.length) baseline.current = { sections:Object.fromEntries(sections.map((item) => [item.key,clone(sectionValue(item))])),settings:clone(settings) }
  useEffect(() => {
    let active = true
    let revoked = false
    function authRequired() { revoked = true; setAuthorized(false); setSelection(null) }
    window.addEventListener('galeo-admin-auth-required',authRequired)
    adminApi('/api/auth/me').then((data) => { if (active && !revoked) setAuthorized(String(data?.user?.role).toLowerCase() === 'owner') }).catch(() => { if (active) setAuthorized(false) })
    return () => { active = false; window.removeEventListener('galeo-admin-auth-required',authRequired) }
  }, [])
  const dirtySections = sections.filter((item) => !same(sectionValue(item),baseline.current?.sections[item.key]))
  const dirtySettings = Object.keys(settings).filter((key) => !same(settings[key],baseline.current?.settings[key]))
  const dirty = dirtySections.length + dirtySettings.length > 0
  dirtyRef.current = dirty
  const publishedDifference = sections.some((section) => !same(section.content || {},section.published || {}) || Boolean(section.visible) !== Boolean(section.published_visible ?? section.visible) || Number(section.order) !== Number(section.published_order ?? section.order))
  useEffect(() => {
    if (!dirty) return
    const guard = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload',guard)
    return () => window.removeEventListener('beforeunload',guard)
  }, [dirty])
  useEffect(() => {
    function guardPop(event) {
      const target = window.history.state?.idx
      const source = historyPosition.current
      if (restoringHistory.current !== null) {
        // React Router never saw the cancelled POP. Suppress the matching return
        // POP too, so its current route and the browser history stay in sync.
        event.stopImmediatePropagation()
        const expected = restoringHistory.current
        if (target === expected) { restoringHistory.current = null; historyPosition.current = expected }
        else if (Number.isInteger(target)) window.history.go(expected - target)
        return false
      }
      if (!dirtyRef.current || target === source || !Number.isInteger(source) || !Number.isInteger(target)) { historyPosition.current = target; return }
      if (window.confirm(leaveMessage)) { historyPosition.current = target; return }
      event.stopImmediatePropagation()
      restoringHistory.current = source
      window.history.go(source - target)
      return false
    }
    // No synthetic entries are added, so cancelling preserves the Forward stack.
    popGuards.add(guardPop)
    return () => popGuards.delete(guardPop)
  }, [])
  useEffect(() => {
    if (!dirty) return
    function guard(event) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const anchor = event.target.closest?.('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      if (editing && anchor.matches('.site-header a,.product-card')) return
      // Ordinary anchors leave the document and use the native beforeunload
      // prompt. SPA links need this guard because they keep the document alive.
      if (anchor.dataset.editorSpaLink !== 'true') return
      const next = new URL(anchor.href,window.location.href)
      if (next.origin !== window.location.origin) return
      if (next.pathname === window.location.pathname && next.search === window.location.search) return
      if (!window.confirm(leaveMessage)) { event.preventDefault(); event.stopPropagation() }
    }
    document.addEventListener('click',guard,true)
    return () => document.removeEventListener('click',guard,true)
  }, [dirty,editing])
  function updateSection(key,updater) {
    if (operation.current) return
    onSectionsChange((current) => current.map((item) => item.key === key ? { ...item,content:updater(item.content || item.draft || {}) } : item))
    setStatus('')
  }
  function updateSetting(key,updater) {
    if (operation.current) return
    onSettingsChange((current) => ({ ...current,[key]:updater(current[key] || {}) }))
    setStatus('')
  }
  async function save() {
    if (operation.current || !dirty || !authorized) return
    operation.current = true; setBusy(true); setError(''); setStatus('Salvando rascunho…')
    let completed = 0
    try {
      for (const section of dirtySections) {
        const value = clone(sectionValue(section))
        await adminApi('/api/admin/home/' + section.key,{method:'PUT',body:value})
        baseline.current.sections[section.key] = value
        completed += 1
        setBaselineVersion((value) => value + 1)
      }
      for (const key of dirtySettings) {
        const value = clone(settings[key])
        await adminApi('/api/admin/home/settings/' + key,{method:'PUT',body:{value}})
        baseline.current.settings[key] = value
        completed += 1
        setBaselineVersion((value) => value + 1)
      }
      setStatus('Rascunho salvo. A loja pública ainda não mudou.')
    } catch (err) {
      setStatus('')
      setError((completed ? 'Parte do rascunho foi salva. As alterações restantes continuam nesta tela. ' : '') + (err.message || 'Não foi possível salvar. Tente novamente.'))
    } finally { operation.current = false; setBusy(false) }
  }
  async function publish() {
    if (operation.current || dirty || !authorized) return
    operation.current = true; setBusy(true); setError('')
    try {
      await adminApi('/api/admin/home/publish',{method:'POST'})
      onSectionsChange((current) => current.map((item) => ({ ...item,published:clone(item.content || {}),published_visible:item.visible,published_order:item.order })))
      setSelection(null)
      setStatus('Alterações publicadas na loja.')
    } catch (err) { setError(err.message || 'Não foi possível publicar. Seu rascunho continua salvo.') }
    finally { operation.current = false; setBusy(false) }
  }
  function discard() {
    onSectionsChange((current) => current.map((item) => ({ ...item,...clone(baseline.current.sections[item.key]) })))
    onSettingsChange(clone(baseline.current.settings))
    setSelection(null); setStatus('Alterações locais desfeitas. O rascunho salvo foi mantido.'); setError('')
  }
  const context = useMemo(() => ({ editing:editing && authorized === true, busy,sections,settings,products,select:(value) => { if (!operation.current) { setSelection(value); setError('') } },updateSection,updateSetting,
    confirmLeave:() => !dirtyRef.current || window.confirm(leaveMessage),
    setVisibility:(key,visible) => { if (!operation.current) onSectionsChange((current) => current.map((item) => item.key === key ? { ...item,visible } : item)) },
    reorder:(keys) => { if (!operation.current) onSectionsChange((current) => keys.map((key,index) => ({ ...current.find((item) => item.key === key),order:(index + 1) * 10 }))) }
  }),[editing,authorized,busy,sections,settings,products,baselineVersion])
  if (authorized === null) return <div className="visual-editor-access" role="status">Verificando acesso ao editor…</div>
  if (!authorized) return <div className="visual-editor-access"><h1>Entre com a conta de proprietário</h1><p>O editor da loja está disponível somente para os donos.</p><Link to="/admin">Entrar no painel</Link></div>
  return <EditorContext.Provider value={context}><div className="visual-home-editor" data-editing={editing ? 'true' : 'false'}>
    <div className="visual-editor-toolbar" role="toolbar" aria-label="Editor visual da loja" data-lenis-prevent="">
      <div className="visual-editor-identity"><strong>Editor da loja</strong><small>{dirty ? 'Alterações não salvas' : 'Rascunho salvo'}</small></div>
      <div className="visual-editor-top-actions"><button type="button" disabled={busy} onClick={() => setEditing((value) => !value)}>{editing ? 'Ver como cliente' : 'Voltar a editar'}</button><button type="button" disabled={busy || !dirty} onClick={save}>{busy ? 'Aguarde…' : 'Salvar rascunho'}</button><button className="visual-publish-button" type="button" disabled={busy || dirty} title={dirty ? 'Salve o rascunho antes de publicar' : undefined} onClick={() => { setError(''); setSelection({kind:'publish'}) }}>Publicar alterações</button></div>
      {editing && <div className="visual-editor-secondary"><p>Clique nos textos e nas fotos da página para editar.</p><div><button type="button" disabled={busy || !dirty} onClick={() => setSelection({kind:'discard'})}>Desfazer alterações</button><button type="button" disabled={busy} onClick={() => setSelection({kind:'settings'})}>Configurações</button><Link to="/admin" data-editor-spa-link="true">Painel ↗</Link></div></div>}
      {(status || error) && <div className={error ? 'visual-toolbar-message visual-error' : 'visual-toolbar-message'} role={error ? 'alert' : 'status'}>{error || status}</div>}
      {!editing && <p className="visual-client-note">Prévia do rascunho{dirty ? ', incluindo suas alterações não salvas' : ''}. A loja só muda ao publicar.</p>}
    </div>
    {children}
    {selection?.kind === 'publish' ? <EditorDialog title="Publicar alterações na loja?" onClose={() => setSelection(null)} busy={busy}><p>O rascunho salvo passará a aparecer para todos os clientes, incluindo textos, fotos, ordem das seções e configurações.</p>{!publishedDifference && <p>O conteúdo das seções está igual à última publicação. As configurações salvas também serão publicadas.</p>}<button className="visual-publish-button" type="button" disabled={busy || dirty} onClick={publish}>Confirmar publicação</button>{error && <p className="visual-error" role="alert">{error}</p>}</EditorDialog>
      : selection?.kind === 'discard' ? <EditorDialog title="Desfazer alterações não salvas?" onClose={() => setSelection(null)} busy={busy}><p>Esta tela voltará ao último rascunho salvo. A loja pública não será alterada.</p><button type="button" onClick={discard}>Confirmar desfazer</button></EditorDialog>
      : selection && <SelectionPanel key={[selection.kind,selection.sectionKey,selection.itemIndex,selection.tab].join('-')} selection={selection} editor={context} onClose={() => setSelection(null)} />}
  </div></EditorContext.Provider>
}
