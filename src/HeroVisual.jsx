import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

const motions = {
  zoom: [{ scale: 1 }, { scale: 1.055 }],
  'pan-horizontal': [{ scale: 1.06, xPercent: -1.5 }, { scale: 1.06, xPercent: 1.5 }],
  'pan-vertical': [{ scale: 1.06, yPercent: -1.5 }, { scale: 1.06, yPercent: 1.5 }],
  'ken-burns': [{ scale: 1.015, xPercent: -1, yPercent: -1 }, { scale: 1.065, xPercent: 1.5, yPercent: 1.5 }],
  parallax: [{ scale: 1.025, yPercent: -1.5 }, { scale: 1.055, yPercent: 1.5 }]
}
const boundedDuration = value => value !== '' && value != null && Number.isFinite(Number(value))
  ? Math.min(30, Math.max(2, Number(value))) : 6

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

export default function HeroVisual({ mediaUrl = '', mobileUrl = '', videoUrl = '', alt = '', effect = 'zoom', speed = 'slow', durationSeconds = 6, editorPaused = false }) {
  const root = useRef(null)
  const motion = useRef(null)
  const video = useRef(null)
  const videoAllowed = useRef(false)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const mobile = useMediaQuery('(max-width: 700px)')
  const paused = editorPaused || !visible || !pageVisible || reduceMotion
  const mobileFallback = mobile && Boolean(mobileUrl)
  const canPlayVideo = Boolean(videoUrl) && !paused && !mobileFallback
  const motionEffect = effect === 'static' || Object.hasOwn(motions, effect) ? effect : 'zoom'
  const speedFactor = speed === 'fast' ? 0.7 : speed === 'normal' ? 1 : 1.4
  const duration = boundedDuration(durationSeconds)
  const imageUrl = mediaUrl || mobileUrl

  useEffect(() => {
    const observed = root.current?.closest('.hero-full') || root.current
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio > 0), { threshold: 0 })
    if (observed) observer.observe(observed)
    const updateVisibility = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', updateVisibility)
    updateVisibility()
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])

  useLayoutEffect(() => {
    if (editorPaused || reduceMotion || motionEffect === 'static' || !root.current) return undefined
    gsap.registerPlugin(ScrollTrigger)
    const element = root.current
    const [from, to] = motions[motionEffect]
    const context = gsap.context(() => {
      motion.current = gsap.fromTo(element, from, motionEffect === 'parallax'
        ? {
          ...to,
          ease: 'none',
          scrollTrigger: { trigger: element.closest('.hero-full') || element, start: 'top bottom', end: 'bottom top', scrub: speedFactor }
        }
        : { ...to, duration: duration * speedFactor, repeat: -1, yoyo: true, ease: 'sine.inOut', paused: true })
    }, element)
    return () => {
      motion.current = null
      context.revert()
    }
  }, [motionEffect, speedFactor, duration, reduceMotion, editorPaused])

  useLayoutEffect(() => {
    const animation = motion.current
    if (!animation) return
    if (animation.scrollTrigger) {
      if (paused) animation.scrollTrigger.disable(false)
      else {
        animation.scrollTrigger.enable(false)
        animation.scrollTrigger.update()
      }
    } else if (paused) animation.pause()
    else animation.resume()
  }, [paused, motionEffect, speedFactor, duration, reduceMotion])

  useLayoutEffect(() => {
    videoAllowed.current = canPlayVideo
    return () => { videoAllowed.current = false }
  }, [canPlayVideo])

  useEffect(() => {
    const element = video.current
    if (!element) return undefined
    if (!canPlayVideo) element.pause()
    else {
      try {
        Promise.resolve(element.play()).then(() => {
          // A delayed play() may finish after pause/unmount. Do not stop a new
          // allowed play on the same node when an older request resolves.
          if (!videoAllowed.current || video.current !== element) element.pause()
        }).catch(() => {})
      } catch {}
    }
    return () => { element.pause() }
  }, [videoUrl, canPlayVideo])

  return <div ref={root} className="campaign-visual campaign-visual-0" data-campaign-effect={motionEffect}
    data-managed-motion="true" data-paused={paused} aria-hidden={alt ? undefined : 'true'}>
    <div className="campaign-orb" />
    <div className="campaign-line campaign-line-a" />
    <div className="campaign-line campaign-line-b" />
    {videoUrl ? <>
      <video ref={video} className={'campaign-media campaign-video' + (mobileUrl ? ' campaign-desktop-video' : '')}
        src={videoUrl} poster={mediaUrl || mobileUrl || '/images/galeo-brand.webp'} muted loop playsInline
        preload={canPlayVideo ? 'metadata' : 'none'} />
      {mobileUrl && <img src={mobileUrl} alt={alt} className="campaign-media campaign-mobile-image" loading="eager" fetchPriority="high" decoding="async" />}
    </> : imageUrl ? <picture>
      {mobileUrl && <source media="(max-width: 700px)" srcSet={mobileUrl} />}
      <img src={imageUrl} alt={alt} className="campaign-media" loading="eager" fetchPriority="high" decoding="async" />
    </picture> : <img src="/images/galeo-brand.webp" alt="" className="campaign-brand-image" fetchPriority="high" decoding="async" />}
    <div className="campaign-scan" />
  </div>
}
