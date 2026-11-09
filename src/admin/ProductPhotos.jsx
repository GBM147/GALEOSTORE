import { useEffect, useRef, useState } from 'react'
import { adminApi as api } from '../adminApi'
import { MediaLibraryPicker, originalMediaUrl, selectedMediaVariant } from '../MediaComparison'
import { uploadProductMedia } from './productMedia'
import { preparePhoto } from './resizeImage'

const photoTypes = 'image/*,.jpg,.jpeg,.jfif,.png,.webp,.avif'
const videoTypes = 'video/mp4,video/webm,video/quicktime'
const backgrounds = [['original', 'Original'], ['ai', 'Sem fundo'], ['galeo', 'Fundo GALEO']]
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const coverOf = item => item.asset
  ? { image: originalMediaUrl(item.asset) || item.url, image_asset_id: item.asset.id, image_variant: 'original' }
  : { image: item.url, image_asset_id: null, image_variant: null }
const isCover = (item, url) => Boolean(url) && (item.url === url || (item.asset && [originalMediaUrl(item.asset), item.asset.ai_url, item.asset.galeo_url].includes(url)))

// Photos of one product: pick (camera, gallery or drag), see them at once,
// choose the cover and its background, reorder and delete. Every file is
// sent as soon as it is picked; the product already exists as a draft.
export default function ProductPhotos({ productId, role, form, setForm, disabled, onBusy }) {
  const [media, setMedia] = useState([])
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [background, setBackground] = useState({ pending: '', note: '' })
  const [, setTick] = useState(0)
  const queue = useRef([])
  const running = useRef(false)
  const formRef = useRef(form)
  formRef.current = form
  const galleryInput = useRef(null), cameraInput = useRef(null), videoInput = useRef(null), libraryTrigger = useRef(null)

  const setQueue = change => { queue.current = change(queue.current); setTick(value => value + 1) }

  async function load() {
    try {
      const data = await api('/api/admin/products/' + productId + '/media')
      const items = Array.isArray(data) ? data : []
      setMedia(items)
      setLoadError('')
      // The server makes the first photo the cover when the product had none.
      const firstPhoto = items.find(item => item.media_type === 'image')
      if (!formRef.current.image && firstPhoto) setForm(current => ({ ...current, ...coverOf(firstPhoto) }))
      if (!formRef.current.video) {
        const firstVideo = items.find(item => item.media_type === 'video')
        if (firstVideo) setForm(current => ({ ...current, video: firstVideo.url }))
      }
      return items
    } catch (error) {
      setLoadError(error.message)
      return null
    }
  }

  useEffect(() => { if (productId) load() }, [productId])
  useEffect(() => () => queue.current.forEach(item => item.preview && URL.revokeObjectURL(item.preview)), [])

  async function run() {
    if (running.current) return
    running.current = true
    onBusy?.(true)
    try {
      for (;;) {
        const next = queue.current.find(item => item.status === 'waiting')
        if (!next) break
        const update = fields => setQueue(items => items.map(item => item.key === next.key ? { ...item, ...fields } : item))
        try {
          update({ status: next.kind === 'image' ? 'preparing' : 'sending' })
          const file = next.kind === 'image' ? await preparePhoto(next.file) : next.file
          update({ status: 'sending' })
          await uploadProductMedia(productId, [file])
          if (next.preview) URL.revokeObjectURL(next.preview)
          setQueue(items => items.filter(item => item.key !== next.key))
          await load()
        } catch (error) {
          update({ status: 'failed', error: error.message || 'Não foi possível enviar.' })
        }
      }
    } finally {
      running.current = false
      onBusy?.(false)
    }
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(file => /^(image|video)\//.test(file.type) || /\.(jpe?g|jfif|png|webp|avif|mp4|webm|mov)$/i.test(file.name))
    if (!files.length) return setMessage('Escolha arquivos de foto (JPG, PNG, WebP) ou vídeo (MP4, WebM, MOV).')
    setMessage('')
    setQueue(items => [...items, ...files.map(file => {
      const kind = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name) ? 'video' : 'image'
      return { key: crypto.randomUUID(), file, kind, name: file.name, preview: kind === 'image' ? URL.createObjectURL(file) : '', status: 'waiting' }
    })])
    run()
  }

  function retry(key) {
    setQueue(items => items.map(item => item.key === key ? { ...item, status: 'waiting', error: '' } : item))
    run()
  }

  function discard(key) {
    setQueue(items => items.filter(item => {
      if (item.key === key && item.preview) URL.revokeObjectURL(item.preview)
      return item.key !== key
    }))
  }

  async function move(index, offset) {
    const next = [...media]
    const [item] = next.splice(index, 1)
    next.splice(index + offset, 0, item)
    const previous = media
    setMedia(next)
    try {
      await api('/api/admin/products/' + productId + '/media/order', { method: 'PUT', body: { ids: next.map(entry => entry.id) } })
    } catch (error) {
      setMedia(previous)
      setMessage(error.message)
      if (/mudaram/.test(error.message)) load()
    }
  }

  async function remove(item, label) {
    if (!window.confirm('Excluir ' + label.toLowerCase() + ' deste produto?')) return
    try {
      await api('/api/admin/products/' + productId + '/media/' + item.id, { method: 'DELETE' })
      const wasCover = isCover(item, formRef.current.image)
      if (wasCover) setForm(current => ({ ...current, image: '', image_asset_id: null, image_variant: null }))
      if (item.media_type === 'video' && formRef.current.video === item.url) setForm(current => ({ ...current, video: '' }))
      await load()
    } catch (error) { setMessage(error.message) }
  }

  const coverItem = media.find(item => item.media_type === 'image' && isCover(item, form.image))
  const coverAsset = coverItem?.asset
  const currentBackground = coverAsset ? (Number(form.image_asset_id) === coverAsset.id && form.image_variant) || selectedMediaVariant(coverAsset, form.image) || 'original' : 'original'

  function useBackground(asset, variant) {
    const url = variant === 'galeo' ? asset.galeo_url : variant === 'ai' ? asset.ai_url : originalMediaUrl(asset)
    if (!url) return false
    setForm(current => ({ ...current, image: url, image_asset_id: asset.id, image_variant: variant }))
    return true
  }

  async function chooseBackground(variant) {
    if (!coverItem || !coverAsset) return
    if (variant === 'original' || (coverAsset.ai_status === 'done' && useBackground(coverAsset, variant))) {
      if (variant === 'original') useBackground(coverAsset, 'original')
      return setBackground({ pending: '', note: '' })
    }
    setBackground({ pending: variant, note: 'Tirando o fundo da foto… isso pode levar até um minuto.' })
    try {
      let asset = coverAsset
      for (let attempt = 0; attempt < 12; attempt++) {
        const result = await api('/api/admin/media-library/' + coverAsset.id + '/ai-background', { method: 'POST' })
        asset = result?.item || asset
        if (asset.ai_status === 'done' || asset.ai_status === 'failed') break
        await wait(5000)
      }
      setMedia(items => items.map(item => item.id === coverItem.id ? { ...item, asset } : item))
      if (asset.ai_status !== 'done') throw new Error('Não foi possível tirar o fundo desta foto agora. Tente de novo em alguns minutos.')
      if (!useBackground(asset, variant)) throw new Error(variant === 'galeo' ? 'O Fundo GALEO não está disponível para esta foto. Use "Sem fundo".' : 'A versão sem fundo não ficou pronta. Tente de novo.')
      setBackground({ pending: '', note: '' })
    } catch (error) {
      setBackground({ pending: '', note: error.message })
    }
  }

  function closeLibrary() {
    setLibraryOpen(false)
    window.requestAnimationFrame(() => libraryTrigger.current?.focus({ preventScroll: true }))
  }

  const photos = media.filter(item => item.media_type === 'image')
  let photoNumber = 0, videoNumber = 0
  const labelOf = item => item.media_type === 'video' ? 'Vídeo ' + (++videoNumber) : 'Foto ' + (++photoNumber)
  const busy = disabled || queue.current.some(item => item.status !== 'failed')

  return (
    <div className="product-photos">
      <section className="photo-cover" aria-label="Foto de capa">
        <div className="photo-cover-preview media-checkerboard" data-testid="product-cover-preview">
          {form.image ? <img src={form.image} alt="Capa atual do produto" /> : <p>Nenhuma foto ainda. A primeira foto que você enviar vira a capa.</p>}
        </div>
        <div className="photo-cover-text">
          <h4>Foto de capa</h4>
          <p>É a foto que aparece no catálogo da loja. Para trocar, toque em "Usar como capa" em outra foto.</p>
          {coverAsset && role === 'owner' && <fieldset className="photo-background" disabled={disabled || Boolean(background.pending)}>
            <legend>Fundo da capa</legend>
            <div className="wizard-segmented">
              {backgrounds.map(([variant, label]) => <button key={variant} type="button" aria-pressed={currentBackground === variant} onClick={() => chooseBackground(variant)}>{background.pending === variant ? 'Aguarde…' : label}</button>)}
            </div>
          </fieldset>}
          {background.note && <p className="wizard-note" role="status">{background.note}</p>}
        </div>
      </section>

      <div
        className={'photo-drop' + (dragging ? ' is-dragging' : '')}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) addFiles(event.dataTransfer.files) }}
      >
        <p className="photo-drop-hint"><strong>Arraste as fotos para cá</strong> ou use os botões. Dá para escolher várias de uma vez.</p>
        <div className="photo-pick">
          <button type="button" className="button button-primary photo-camera" disabled={disabled} onClick={() => cameraInput.current?.click()}>Tirar foto</button>
          <button type="button" className="button button-primary" disabled={disabled} onClick={() => galleryInput.current?.click()}>Escolher fotos</button>
        </div>
        <input ref={galleryInput} type="file" accept={photoTypes} multiple hidden aria-label="Escolher fotos do produto" onChange={event => { addFiles(event.target.files); event.target.value = '' }} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden aria-label="Tirar foto do produto" onChange={event => { addFiles(event.target.files); event.target.value = '' }} />
        <small>Fotos grandes são reduzidas automaticamente para enviar mais rápido.</small>
      </div>
      {message && <p className="wizard-error" role="alert">{message}</p>}
      {loadError && <p className="wizard-error" role="alert">{loadError} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></p>}

      {(media.length > 0 || queue.current.length > 0) && <ul className="photo-grid" aria-label="Fotos e vídeos do produto">
        {media.map((item, index) => {
          const label = labelOf(item)
          const cover = item.media_type === 'image' && isCover(item, form.image)
          return <li key={item.id} className={'photo-tile' + (cover ? ' is-cover' : '')}>
            <div className="photo-tile-media media-checkerboard">
              {item.media_type === 'video' ? <video src={item.url} muted preload="metadata" aria-label={label} /> : <img src={cover ? form.image : item.url} alt={label + (cover ? ' (capa)' : '')} loading="lazy" />}
              {cover && <span className="photo-badge">Capa</span>}
            </div>
            <div className="photo-tile-actions">
              {item.media_type === 'image' && !cover && <button type="button" disabled={disabled} onClick={() => setForm(current => ({ ...current, ...coverOf(item) }))}>Usar como capa</button>}
              <div className="photo-tile-row">
                <button type="button" aria-label={'Mover ' + label.toLowerCase() + ' para trás'} disabled={disabled || index === 0} onClick={() => move(index, -1)}>◀</button>
                <button type="button" aria-label={'Mover ' + label.toLowerCase() + ' para frente'} disabled={disabled || index === media.length - 1} onClick={() => move(index, 1)}>▶</button>
                <button type="button" className="photo-delete" aria-label={'Excluir ' + label.toLowerCase()} disabled={disabled} onClick={() => remove(item, label)}>Excluir</button>
              </div>
            </div>
          </li>
        })}
        {queue.current.map(item => <li key={item.key} className={'photo-tile is-pending' + (item.status === 'failed' ? ' is-failed' : '')}>
          <div className="photo-tile-media media-checkerboard">
            {item.preview ? <img src={item.preview} alt={item.name} /> : <span className="photo-video-name">{item.name}</span>}
            {item.status !== 'failed' && <span className="photo-progress" aria-hidden="true" />}
          </div>
          <div className="photo-tile-actions" role="status">
            {item.status === 'failed' ? <>
              <span className="photo-state">{item.error}</span>
              <div className="photo-tile-row"><button type="button" onClick={() => retry(item.key)}>Tentar de novo</button><button type="button" className="photo-delete" onClick={() => discard(item.key)}>Descartar</button></div>
            </> : <span className="photo-state">{item.status === 'preparing' ? 'Preparando…' : item.status === 'sending' ? 'Enviando…' : 'Na fila'}</span>}
          </div>
        </li>)}
      </ul>}

      <div className="photo-extra">
        <button type="button" className="button button-ghost" disabled={disabled} onClick={() => videoInput.current?.click()}>Adicionar vídeo (opcional)</button>
        <input ref={videoInput} type="file" accept={videoTypes} multiple hidden aria-label="Adicionar vídeo do produto" onChange={event => { addFiles(event.target.files); event.target.value = '' }} />
        <button type="button" className="button button-ghost" ref={libraryTrigger} aria-expanded={libraryOpen} disabled={disabled || busy} onClick={() => setLibraryOpen(open => !open)}>Usar foto que já está na loja</button>
      </div>
      {libraryOpen && <MediaLibraryPicker api={api} currentUrl={form.image} disabled={disabled} onChoose={item => { setForm(current => ({ ...current, image: item.url, image_asset_id: item.id, image_variant: item.variant })); closeLibrary() }} onCancel={closeLibrary} />}

      <details className="wizard-more">
        <summary>Avançado: endereço da foto ou do vídeo</summary>
        <div className="wizard-row">
          <label>URL da foto principal<input value={form.image} disabled={disabled} onChange={event => setForm(current => ({ ...current, image: event.target.value, image_asset_id: null, image_variant: null }))} placeholder="https://..." /></label>
          <label>URL do vídeo<input value={form.video} disabled={disabled} onChange={event => setForm(current => ({ ...current, video: event.target.value }))} placeholder="https://..." /></label>
        </div>
      </details>
    </div>
  )
}
