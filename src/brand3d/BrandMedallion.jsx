import { useEffect, useRef, useState } from 'react'

export const BASE_POSE = { x: 0.05, y: -0.3 }

function canAnimate() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  if (!window.matchMedia('(min-width: 900px)').matches) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (document.documentElement.dataset.lite === 'true') return false
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch { return false }
}

// The GALEO mark on the banner. Everyone first sees the 3D image (rendered
// from the same scene). On a computer, once the page is idle, the 3D scene is
// loaded on its own and the medallion sways slowly and follows the mouse.
// Phones, the light mode and reduced motion keep the image only.
export default function BrandMedallion({ fetchPriority }) {
  const wrap = useRef(null)
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (!canAnimate()) return undefined
    let cancelled = false, unmount = null
    const start = () => import('./medallionRuntime.js').then(({ mountMedallion }) => {
      if (!cancelled && wrap.current) unmount = mountMedallion(wrap.current, { pose: BASE_POSE, onReady: () => { if (!cancelled) setLive(true) } })
    }).catch(() => {})
    const idle = window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 2500 }) : window.setTimeout(start, 1200)
    return () => {
      cancelled = true
      if (window.cancelIdleCallback && window.requestIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
      unmount?.()
    }
  }, [])
  return <div ref={wrap} className="campaign-brand-image brand-medallion" data-live={live ? 'true' : 'false'}>
    <img className="brand-medallion-image" src="/images/galeo-logo-3d.webp" srcSet="/images/galeo-logo-3d-640.webp 640w, /images/galeo-logo-3d.webp 1100w"
      sizes="(max-width: 760px) min(78vw, 340px), min(46vw, 620px)" alt="" width="1100" height="1100" decoding="async" fetchPriority={fetchPriority} />
  </div>
}
