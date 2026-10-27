import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { campaignSlides, campaignTransitionSeconds, resolveCampaignAnimation } from './campaign-model'
import './CampaignCarousel.css'

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

function CampaignVideo({ url, visible, paused, reduceMotion, className }) {
  const video = useRef(null)
  useEffect(() => {
    if (!video.current) return
    if (visible && !paused && !reduceMotion) video.current.play().catch(() => {})
    else video.current.pause()
  }, [url, visible, paused, reduceMotion])
  return <video ref={video} className={'campaign-media campaign-video ' + className} src={url}
    muted loop playsInline preload={visible ? 'metadata' : 'none'} aria-hidden="true" />
}

function CampaignMedia({ slide, variant, effect, active, paused, reduceMotion }) {
  const mobile = useMediaQuery('(max-width: 700px)')
  const desktopVideo = slide.desktop_type === 'video'
  const mobileVideo = slide.mobile_type === 'video'
  const hasMobile = Boolean(slide.mobile_url)
  const renderImage = (url, className) => <img src={url} alt="" className={'campaign-media ' + className} loading="lazy" />
  return <div className={'campaign-visual campaign-visual-' + variant} data-campaign-effect={effect} data-managed-motion="true" aria-hidden="true">
    <div className="campaign-orb" />
    <div className="campaign-line campaign-line-a" />
    <div className="campaign-line campaign-line-b" />
    {!slide.desktop_url ? <img src="/images/galeo-brand.webp" alt="" className="campaign-brand-image" />
      : !desktopVideo && (!hasMobile || !mobileVideo) ? <picture>
        {hasMobile && <source media="(max-width: 700px)" srcSet={slide.mobile_url} />}
        {renderImage(slide.desktop_url, '')}
      </picture> : <>
        {desktopVideo
          ? <CampaignVideo url={slide.desktop_url} visible={active && (!mobile || !hasMobile)} paused={paused} reduceMotion={reduceMotion} className={'campaign-carousel-desktop' + (hasMobile ? ' has-mobile campaign-desktop-video' : '')} />
          : renderImage(slide.desktop_url, 'campaign-carousel-desktop' + (hasMobile ? ' has-mobile' : ''))}
        {hasMobile && (mobileVideo
          ? <CampaignVideo url={slide.mobile_url} visible={active && mobile} paused={paused} reduceMotion={reduceMotion} className="campaign-carousel-mobile" />
          : renderImage(slide.mobile_url, 'campaign-carousel-mobile campaign-mobile-image'))}
      </>}
    <div className="campaign-scan" />
    <div className="campaign-carousel-shade" />
  </div>
}

export default function CampaignCarousel({ item, variant = 1, defaults, sectionDefaults, children, editorPaused = false, editorNavigation = false, onEdit }) {
  const slides = useMemo(() => campaignSlides(item), [item])
  const settings = resolveCampaignAnimation(item, defaults, sectionDefaults)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const root = useRef(null)
  const motion = useRef(null)
  const [current, setCurrent] = useState(0)
  const [previous, setPrevious] = useState(null)
  const [direction, setDirection] = useState(1)
  const [transitioning, setTransitioning] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  const [announcement, setAnnouncement] = useState('')
  const paused = editorPaused || userPaused || hovered || focused || !visible || !pageVisible || reduceMotion
  const currentIndex = Math.min(current, slides.length - 1)
  const slideSignature = slides.map((slide) => [slide.desktop_url,slide.mobile_url,slide.desktop_type,slide.mobile_type].join('|')).join('\n')
  const label = item.title || 'Campanha GALEO'

  useEffect(() => {
    setCurrent(0)
    setPrevious(null)
    setTransitioning(false)
  }, [slideSignature])

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.1), { threshold:0.1 })
    if (root.current) observer.observe(root.current)
    const updateVisibility = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', updateVisibility) }
  }, [])

  const selectSlide = (next, nextDirection = 1, manual = false) => {
    if (transitioning || next === currentIndex || slides.length < 2) return
    setDirection(nextDirection)
    setPrevious(currentIndex)
    setCurrent((next + slides.length) % slides.length)
    setTransitioning(!reduceMotion)
    if (manual) setAnnouncement('Mídia ' + (((next + slides.length) % slides.length) + 1) + ' de ' + slides.length)
  }

  useEffect(() => {
    if (paused || transitioning || slides.length < 2) return undefined
    const timer = window.setTimeout(() => selectSlide(currentIndex + 1, 1), settings.duration_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [currentIndex, slides.length, paused, transitioning, settings.duration_seconds])

  useLayoutEffect(() => {
    const container = root.current
    if (editorPaused || !container) return undefined
    const incoming = container.querySelector('[data-slide-index="' + currentIndex + '"]')
    const outgoing = previous == null ? null : container.querySelector('[data-slide-index="' + previous + '"]')
    const ctx = gsap.context(() => {
      gsap.set(container.querySelectorAll('.campaign-carousel-slide'), { opacity:0, xPercent:0 })
      if (!outgoing || reduceMotion) {
        gsap.set(incoming, { opacity:1, xPercent:0 })
        if (previous != null) setPrevious(null)
        setTransitioning(false)
        return
      }
      const duration = campaignTransitionSeconds(settings.speed)
      gsap.set(outgoing, { opacity:1 })
      const timeline = gsap.timeline({ onComplete:() => { setPrevious(null); setTransitioning(false) } })
      if (settings.transition === 'slide') {
        timeline.fromTo(incoming, { opacity:0, xPercent:direction * 10 }, { opacity:1, xPercent:0, duration, ease:'power2.inOut' }, 0)
          .to(outgoing, { opacity:0, xPercent:direction * -10, duration, ease:'power2.inOut' }, 0)
      } else if (settings.transition === 'fade') {
        timeline.to(outgoing, { opacity:0, duration:duration / 2, ease:'sine.in' }, 0)
          .fromTo(incoming, { opacity:0 }, { opacity:1, duration:duration / 2, ease:'sine.out' }, duration / 2)
      } else {
        timeline.fromTo(incoming, { opacity:0 }, { opacity:1, duration, ease:'sine.inOut' }, 0)
          .to(outgoing, { opacity:0, duration, ease:'sine.inOut' }, 0)
      }
    }, container)
    return () => ctx.revert()
  }, [currentIndex, previous, direction, settings.transition, settings.speed, reduceMotion, slideSignature, editorPaused])

  useLayoutEffect(() => {
    if (editorPaused || reduceMotion || settings.effect === 'static' || !root.current) return undefined
    gsap.registerPlugin(ScrollTrigger)
    const layer = root.current.querySelector('[data-slide-index="' + currentIndex + '"] .campaign-motion-layer')
    const motions = {
      zoom:[{ scale:1 }, { scale:1.055 }],
      'pan-horizontal':[{ scale:1.06, xPercent:-1.5 }, { scale:1.06, xPercent:1.5 }],
      'pan-vertical':[{ scale:1.06, yPercent:-1.5 }, { scale:1.06, yPercent:1.5 }],
      'ken-burns':[{ scale:1.015, xPercent:-1, yPercent:-1 }, { scale:1.065, xPercent:1.5, yPercent:1.5 }],
      parallax:[{ scale:1.025, yPercent:-1.5 }, { scale:1.055, yPercent:1.5 }]
    }
    const [from, to] = motions[settings.effect]
    const factor = { slow:1.4, normal:1, fast:0.7 }[settings.speed]
    const ctx = gsap.context(() => {
      motion.current = gsap.fromTo(layer, from, settings.effect === 'parallax'
        ? { ...to, ease:'none', scrollTrigger:{ trigger:root.current, start:'top bottom', end:'bottom top', scrub:factor } }
        : { ...to, duration:settings.duration_seconds * factor, repeat:-1, yoyo:true, ease:'sine.inOut', paused })
    }, root.current)
    return () => { motion.current = null; ctx.revert() }
  }, [currentIndex, settings.effect, settings.speed, settings.duration_seconds, reduceMotion, slideSignature, editorPaused])

  useEffect(() => {
    const animation = motion.current
    if (!animation) return
    if (animation.scrollTrigger) {
      if (paused) animation.scrollTrigger.disable(false)
      else animation.scrollTrigger.enable(false)
    } else if (paused) animation.pause()
    else animation.resume()
  }, [paused, currentIndex, settings.effect, settings.speed, settings.duration_seconds, reduceMotion])

  return <div ref={root} className={'campaign-carousel campaign-carousel-managed' + (slides.length > 1 ? ' has-slides' : '')}
    data-testid="campaign-carousel" data-current-slide={currentIndex + 1} data-slide-count={slides.length}
    data-transition={settings.transition} data-effect={settings.effect} data-use-default={settings.use_default}
    data-paused={paused} data-transitioning={transitioning}
    onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHovered(true) }} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    {editorPaused ? <div className="campaign-carousel-link" onClick={onEdit}>
      <div className="campaign-carousel-viewport" aria-hidden="true">
        <div className="campaign-carousel-slide" data-active="true" style={{ opacity:1 }}><div className="campaign-motion-layer">
          <CampaignMedia slide={slides[currentIndex]} variant={variant} effect="static" active paused reduceMotion />
        </div></div>
      </div>
      {children}
    </div> : <Link className="campaign-carousel-link" data-editor-spa-link={editorNavigation ? 'true' : undefined} to={item.button_url || '/shop'}>
      <div className="campaign-carousel-viewport" aria-hidden="true">
        {slides.map((slide, index) => <div key={index} className="campaign-carousel-slide" data-slide-index={index} data-active={index === currentIndex}>
          {(index === currentIndex || index === previous) && <div className="campaign-motion-layer">
            <CampaignMedia slide={slide} variant={variant} effect={settings.effect} active={index === currentIndex} paused={paused} reduceMotion={reduceMotion} />
          </div>}
        </div>)}
      </div>
      {children}
    </Link>}
    {slides.length > 1 && !editorPaused && <div className="campaign-carousel-controls" role="group" aria-label={'Mídias de ' + label}>
      <button type="button" onClick={() => selectSlide(currentIndex - 1, -1, true)} disabled={transitioning} aria-label={'Mídia anterior de ' + label}>←</button>
      <span className="campaign-carousel-count" aria-live="off">{currentIndex + 1} / {slides.length}</span>
      <button type="button" onClick={() => selectSlide(currentIndex + 1, 1, true)} disabled={transitioning} aria-label={'Próxima mídia de ' + label}>→</button>
      {!reduceMotion && <button className="campaign-carousel-pause" type="button" onClick={() => setUserPaused((value) => !value)} aria-pressed={userPaused}
        aria-label={(userPaused ? 'Retomar' : 'Pausar') + ' rotação de ' + label}>{userPaused ? 'Retomar' : 'Pausar'}</button>}
    </div>}
    <span className="campaign-carousel-announcement" role="status">{announcement}</span>
  </div>
}
