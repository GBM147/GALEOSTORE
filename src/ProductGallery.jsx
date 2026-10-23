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

// The photo transition owns the outer plane; zoom/pan owns its inner view.
// Keeping these transforms separate prevents a swipe from overwriting zoom.
function PhotoScene({ photo, alt, direction = 1, viewTransform, imageRef, imageClassName, onLoad, onError, animate = true }) {
  const root = useRef(null)
  const currentImage = useRef(null)
  const committed = useRef({ photo, alt, viewTransform })
  const [frame, setFrame] = useState({ url: photo.url, previous: null, direction })

  // Retain exactly one outgoing photo before React commits the new source.
  // A new selection replaces an interrupted transition instead of queuing it.
  if (frame.url !== photo.url) setFrame({
    url: photo.url,
    previous: !currentImage.current?.naturalWidth && frame.previous ? frame.previous : committed.current,
    direction
  })

  useLayoutEffect(() => { committed.current = { photo, alt, viewTransform } })

  useLayoutEffect(() => {
    if (!frame.previous) return
    let disposed = false
    const finish = () => {
      if (!disposed) setFrame(active => active === frame ? { ...active, previous: null } : active)
    }
    if (!animate) { finish(); return }

    const motion = gsap.matchMedia()
    motion.add({ reduced: '(prefers-reduced-motion: reduce)', full: '(prefers-reduced-motion: no-preference)' }, context => {
      if (context.conditions.reduced) { finish(); return }
      const incoming = root.current.querySelector('[data-current="true"]')
      const outgoing = root.current.querySelector('[data-current="false"]')
      const image = currentImage.current
      const sign = frame.direction < 0 ? -1 : 1
      gsap.set(incoming, { autoAlpha: 0, xPercent: sign * 52, rotationY: -sign * 58, z: -200 })
      gsap.set(outgoing, { autoAlpha: 1, xPercent: 0, rotationY: 0, z: 0 })
      const timeline = gsap.timeline({ paused: true, defaults: { duration: 0.78, ease: 'power2.inOut' }, onComplete: finish })
      timeline.to(outgoing, { xPercent: -sign * 52, rotationY: sign * 58, z: -200, autoAlpha: 0 }, 0)
        .to(incoming, { xPercent: 0, rotationY: 0, z: 0, autoAlpha: 1 }, 0)
      // Keep the old photo visible until the selected image has loaded. A
      // cached image can start immediately; errors still leave navigation usable.
      const start = () => timeline.play(0)
      const fail = () => finish()
      if (image.complete) {
        if (image.naturalWidth > 0) start()
        else fail()
      } else {
        image.addEventListener('load', start, { once: true })
        image.addEventListener('error', fail, { once: true })
      }
      return () => {
        image.removeEventListener('load', start)
        image.removeEventListener('error', fail)
      }
    }, root)
    return () => { disposed = true; motion.revert() }
  }, [frame, animate])

  return <div ref={root} className="product-photo-scene" data-transitioning={Boolean(frame.previous)}>
    <div className="product-photo-slide" data-current="true">
      <div className={viewTransform ? 'product-lightbox-transform' : 'product-photo-view'} style={viewTransform ? { transform: viewTransform } : undefined}>
        <img ref={node => { currentImage.current = node; if (imageRef) imageRef.current = node }} src={photo.url} alt={alt} className={imageClassName} draggable="false" onLoad={onLoad} onError={onError} onDragStart={event => event.preventDefault()} />
      </div>
    </div>
    {frame.previous && <div key={frame.previous.photo.url} className="product-photo-slide" data-current="false" aria-hidden="true">
      <div className="product-photo-outgoing-view" style={frame.previous.viewTransform ? { transform: frame.previous.viewTransform } : undefined}>
        <img src={frame.previous.photo.url} alt="" draggable="false" />
      </div>
    </div>}
  </div>
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
  const [direction, setDirection] = useState(1)
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
    for (const offset of [-1, 1]) {
      const adjacent = new Image()
      adjacent.src = photos[(index + offset + photos.length) % photos.length].url
    }
  }, [index, photos])

  function choosePhoto(nextIndex) {
    const next = (nextIndex + photos.length) % photos.length
    pointers.current.clear()
    gesture.current = null
    setDragging(false)
    updateView(1)
    if (next === index) return
    setDirection(nextIndex < index ? -1 : 1)
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
      <div className="product-lightbox-heading"><strong>{name}</strong></div>
      <span className="product-lightbox-count" aria-live="polite" aria-atomic="true">{index + 1} / {photos.length}</span>
      <button type="button" className="product-lightbox-close" aria-label="Fechar galeria" onClick={onDismiss} autoFocus><GalleryIcon kind="close" /></button>
    </div>
    <div ref={stage} className="product-lightbox-stage" data-zoomed={zoom > 1} data-dragging={dragging} data-lenis-prevent="" onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onDoubleClick={() => updateView(zoomRef.current > 1 ? 1 : 2)}>
      <PhotoScene photo={photos[index]} alt={name + ' — foto ' + (index + 1)} direction={direction} imageRef={image} viewTransform={`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`} onLoad={() => { setFailedUrl(null); updateView(zoomRef.current) }} onError={() => setFailedUrl(photos[index].url)} />
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
  const gallery = useMemo(() => media.filter((item) => item?.url), [media])
  const photos = useMemo(() => gallery.filter((item) => item.media_type !== 'video'), [gallery])
  const [selectedUrl, setSelectedUrl] = useState(null)
  const [direction, setDirection] = useState(1)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [failedUrl, setFailedUrl] = useState(null)
  const current = gallery.find((item) => item.url === selectedUrl) || photos[0] || gallery[0]
  const currentIndex = Math.max(0, gallery.indexOf(current))

  function openPhoto() {
    const photoIndex = photos.findIndex((photo) => photo.url === current?.url)
    if (photoIndex >= 0) setLightboxIndex(photoIndex)
  }

  return <section className="product-gallery" aria-label="Galeria do produto">
    <div className="product-main-media">
      {current?.media_type === 'video'
        ? <video key={current.url} src={current.url} controls playsInline preload="metadata" className="product-detail-media" aria-label={'Vídeo de ' + name} />
        : current ? <button type="button" className="product-photo-trigger" aria-label={'Ampliar foto de ' + name} onClick={openPhoto}><PhotoScene photo={current} alt={name} direction={direction} imageClassName="product-detail-media" animate={lightboxIndex === null} onLoad={() => setFailedUrl(null)} onError={() => setFailedUrl(current.url)} />{failedUrl === current.url && <span className="product-photo-error" role="status">Não foi possível carregar esta foto</span>}<span className="product-photo-cue"><GalleryIcon />Ampliar foto</span></button>
          : <img src="/images/product-placeholder.svg" alt={name} className="product-detail-media" />}
      {gallery.length > 1 && <span className="product-media-position" aria-hidden="true">{String(currentIndex + 1).padStart(2, '0')} / {String(gallery.length).padStart(2, '0')}</span>}
    </div>
    {gallery.length > 1 && <div className="product-thumb-grid">{gallery.map((item, index) => <button className={current?.url === item.url ? 'product-thumb active' : 'product-thumb'} type="button" key={item.url} aria-label={(item.media_type === 'video' ? 'Ver vídeo ' : 'Ver foto ') + (index + 1)} aria-pressed={current?.url === item.url} onClick={() => { setDirection(index < currentIndex ? -1 : 1); setSelectedUrl(item.url) }}>{item.media_type === 'video' ? <span className="product-thumb-video" aria-hidden="true">▶</span> : <img src={item.url} alt="" loading="lazy" draggable="false" />}</button>)}</div>}
    {photos.length > 0 && <p className="product-gallery-caption"><span>Toque na foto para ampliar ↗</span></p>}
    {lightboxIndex !== null && photos.length > 0 && <PhotoLightbox photos={photos} initialIndex={clamp(lightboxIndex, 0, photos.length - 1)} name={name} onSelect={(photo) => setSelectedUrl(photo.url)} onDismiss={() => setLightboxIndex(null)} />}
  </section>
}
