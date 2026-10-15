import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import gsap from 'gsap'
import './ProductGallery.css'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function GalleryIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
    {kind === 'close' ? <path d="m6 6 12 12M18 6 6 18" />
      : kind === 'previous' ? <path d="m14 5-7 7 7 7" />
        : kind === 'next' ? <path d="m10 5 7 7-7 7" />
          : <><path d="M9.5 6v7m-3.5-3.5h7m2.5 6 5 5" /><circle cx="9.5" cy="9.5" r="7" /></>}
  </svg>
}

function PhotoLightbox({ photos, initialIndex, name, onSelect, onDismiss }) {
  const dialog = useRef(null)
  const stage = useRef(null)
  const image = useRef(null)
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const [index, setIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [failedUrl, setFailedUrl] = useState(null)

  useLayoutEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      pointers.current.clear()
      gesture.current = null
      if (element.open) element.close()
      document.body.style.overflow = previousOverflow
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  function updateView(nextZoom, nextPan = panRef.current) {
    const scale = clamp(nextZoom, 1, 3)
    const rect = stage.current?.getBoundingClientRect()
    const photo = image.current
    const fit = rect && photo?.naturalWidth > 0 && photo?.naturalHeight > 0
      ? Math.min(rect.width / photo.naturalWidth, rect.height / photo.naturalHeight) : 0
    const width = fit ? photo.naturalWidth * fit : rect?.width || 0
    const height = fit ? photo.naturalHeight * fit : rect?.height || 0
    const bounded = scale <= 1 || !rect ? { x: 0, y: 0 } : {
      x: clamp(nextPan.x, -Math.max(0, (width * scale - rect.width) / 2), Math.max(0, (width * scale - rect.width) / 2)),
      y: clamp(nextPan.y, -Math.max(0, (height * scale - rect.height) / 2), Math.max(0, (height * scale - rect.height) / 2))
    }
    zoomRef.current = scale
    panRef.current = bounded
    setZoom(scale)
    setPan(bounded)
  }

  useEffect(() => {
    const handleResize = () => updateView(zoomRef.current)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (photos.length < 2) return
    const next = new Image()
    next.src = photos[(index + 1) % photos.length].url
  }, [index, photos])

  function choosePhoto(nextIndex) {
    const next = (nextIndex + photos.length) % photos.length
    pointers.current.clear()
    gesture.current = null
    setDragging(false)
    updateView(1)
    setIndex(next)
    onSelect(photos[next])
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      if (photos.length > 1) choosePhoto(index + (event.key === 'ArrowRight' ? 1 : -1))
    }
  }

  function startGesture(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    const points = [...pointers.current.values()]
    if (points.length === 2) {
      gesture.current = { kind: 'pinch', distance: Math.max(1, distance(...points)), center: midpoint(...points), zoom: zoomRef.current, pan: { ...panRef.current } }
    } else if (points.length === 1) {
      gesture.current = { kind: 'single', start: point, latest: point, zoom: zoomRef.current, pan: { ...panRef.current } }
    }
  }

  function moveGesture(event) {
    if (!pointers.current.has(event.pointerId)) return
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    const active = gesture.current
    const points = [...pointers.current.values()]
    if (active?.kind === 'pinch' && points.length >= 2) {
      const center = midpoint(points[0], points[1])
      updateView(active.zoom * distance(points[0], points[1]) / active.distance, {
        x: active.pan.x + center.x - active.center.x,
        y: active.pan.y + center.y - active.center.y
      })
    } else if (active?.kind === 'single') {
      active.latest = point
      if (zoomRef.current > 1) updateView(zoomRef.current, {
        x: active.pan.x + point.x - active.start.x,
        y: active.pan.y + point.y - active.start.y
      })
    }
  }

  function endGesture(event) {
    if (!pointers.current.has(event.pointerId)) return
    const active = gesture.current
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const points = [...pointers.current.values()]
    if (points.length === 1) {
      gesture.current = { kind: 'single', start: points[0], latest: points[0], zoom: zoomRef.current, pan: { ...panRef.current } }
    } else if (!points.length) {
      setDragging(false)
      gesture.current = null
      if (event.type !== 'pointercancel' && active?.kind === 'single' && active.zoom === 1 && zoomRef.current === 1 && photos.length > 1) {
        const dx = event.clientX - active.start.x
        const dy = event.clientY - active.start.y
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) choosePhoto(index + (dx < 0 ? 1 : -1))
      }
    }
  }

  return createPortal(<dialog ref={dialog} className="product-lightbox" aria-label={'Fotos de ' + name} data-lenis-prevent="" onCancel={(event) => { event.preventDefault(); onDismiss() }} onKeyDown={onKeyDown}>
    <div className="product-lightbox-header">
      <div className="product-lightbox-heading"><span>GALEO / DETALHES</span><strong>{name}</strong></div>
      <span className="product-lightbox-count" aria-live="polite" aria-atomic="true">{index + 1} / {photos.length}</span>
      <button type="button" className="product-lightbox-close" aria-label="Fechar galeria" onClick={onDismiss} autoFocus><GalleryIcon kind="close" /></button>
    </div>
    <div ref={stage} className="product-lightbox-stage" data-zoomed={zoom > 1} data-dragging={dragging} data-lenis-prevent="" onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onDoubleClick={() => updateView(zoomRef.current > 1 ? 1 : 2)}>
      <div className="product-lightbox-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <img ref={image} src={photos[index].url} alt={name + ' — foto ' + (index + 1)} draggable="false" onLoad={() => { setFailedUrl(null); updateView(zoomRef.current) }} onError={() => setFailedUrl(photos[index].url)} onDragStart={(event) => event.preventDefault()} />
      </div>
      {failedUrl === photos[index].url && <p className="product-photo-error" role="status">Não foi possível carregar esta foto. Você pode escolher outra imagem ou fechar a galeria.</p>}
    </div>
    <div className="product-lightbox-controls">
      <div className="product-lightbox-navigation">
        <button type="button" aria-label="Foto anterior" disabled={photos.length < 2} onClick={() => choosePhoto(index - 1)}><GalleryIcon kind="previous" /></button>
        <span>FOTOS</span>
        <button type="button" aria-label="Próxima foto" disabled={photos.length < 2} onClick={() => choosePhoto(index + 1)}><GalleryIcon kind="next" /></button>
      </div>
      <div className="product-lightbox-zoom" role="group" aria-label="Ampliação da foto">{[1, 2, 3].map((scale) => <button type="button" key={scale} aria-label={'Zoom ' + scale + 'x'} aria-pressed={Math.abs(zoom - scale) < 0.05} onClick={() => updateView(scale)}>{scale}×</button>)}</div>
      <p className="product-lightbox-help">{zoom > 1 ? 'Arraste para explorar os detalhes' : 'Deslize para trocar de foto'}</p>
    </div>
    {photos.length > 1 && <div className="product-lightbox-thumbnails" aria-label="Escolher foto">{photos.map((photo, photoIndex) => <button type="button" key={photo.url} className={photoIndex === index ? 'active' : ''} aria-label={'Abrir foto ' + (photoIndex + 1)} aria-pressed={photoIndex === index} onClick={() => choosePhoto(photoIndex)}><img src={photo.url} alt="" draggable="false" loading="lazy" /></button>)}</div>}
  </dialog>, document.body)
}

export default function ProductGallery({ media = [], name = 'Produto' }) {
  const root = useRef(null)
  const gallery = useMemo(() => media.filter((item) => item?.url), [media])
  const photos = useMemo(() => gallery.filter((item) => item.media_type !== 'video'), [gallery])
  const [selectedUrl, setSelectedUrl] = useState(null)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [failedUrl, setFailedUrl] = useState(null)
  const current = gallery.find((item) => item.url === selectedUrl) || photos[0] || gallery[0]
  const currentIndex = Math.max(0, gallery.indexOf(current))

  useLayoutEffect(() => {
    const motion = gsap.matchMedia()
    motion.add('(prefers-reduced-motion: no-preference)', () => {
      const image = root.current?.querySelector('.product-photo-trigger > img')
      if (image) gsap.fromTo(image, { autoAlpha: 0, scale: 1.015 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'power2.out', clearProps: 'opacity,visibility,transform' })
    }, root)
    return () => motion.revert()
  }, [current?.url])

  function openPhoto() {
    const photoIndex = photos.findIndex((photo) => photo.url === current?.url)
    if (photoIndex >= 0) setLightboxIndex(photoIndex)
  }

  return <section ref={root} className="product-gallery" aria-label="Galeria do produto">
    <div className="product-main-media">
      {current?.media_type === 'video'
        ? <video key={current.url} src={current.url} controls playsInline preload="metadata" className="product-detail-media" aria-label={'Vídeo de ' + name} />
        : current ? <button type="button" className="product-photo-trigger" aria-label={'Ampliar foto de ' + name} onClick={openPhoto}><img src={current.url} alt={name} className="product-detail-media" draggable="false" onLoad={() => setFailedUrl(null)} onError={() => setFailedUrl(current.url)} />{failedUrl === current.url && <span className="product-photo-error" role="status">Não foi possível carregar esta foto</span>}<span className="product-photo-cue"><GalleryIcon />Ampliar foto</span></button>
          : <img src="/images/product-placeholder.svg" alt={name} className="product-detail-media" />}
      {gallery.length > 1 && <span className="product-media-position" aria-hidden="true">{String(currentIndex + 1).padStart(2, '0')} / {String(gallery.length).padStart(2, '0')}</span>}
    </div>
    {gallery.length > 1 && <div className="product-thumb-grid">{gallery.map((item, index) => <button className={current?.url === item.url ? 'product-thumb active' : 'product-thumb'} type="button" key={item.url} aria-label={(item.media_type === 'video' ? 'Ver vídeo ' : 'Ver foto ') + (index + 1)} aria-pressed={current?.url === item.url} onClick={() => setSelectedUrl(item.url)}>{item.media_type === 'video' ? <span className="product-thumb-video" aria-hidden="true">▶</span> : <img src={item.url} alt="" loading="lazy" draggable="false" />}</button>)}</div>}
    <p className="product-gallery-caption"><span>Uma peça, todos os detalhes</span>{photos.length > 0 && <span>Toque na foto para ampliar ↗</span>}</p>
    {lightboxIndex !== null && photos.length > 0 && <PhotoLightbox photos={photos} initialIndex={clamp(lightboxIndex, 0, photos.length - 1)} name={name} onSelect={(photo) => setSelectedUrl(photo.url)} onDismiss={() => setLightboxIndex(null)} />}
  </section>
}
