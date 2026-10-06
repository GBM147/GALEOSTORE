import { useEffect, useRef, useState } from 'react'
import './intro.css'

const CDN = 'https://res.cloudinary.com/ovbsocaw/image/upload'
const ID = 'v1791245015/galeo-store/branding/galeo-logo-photo.webp'
const SET = [1280, 1920, 2560, 3840].map(w => `${CDN}/q_auto:best,w_${w}/${ID} ${w}w`).join(', ')

export default function Intro() {
  const root = useRef(null)
  const canvas = useRef(null)
  const img = useRef(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth) setLoaded(true)
  }, [])

  useEffect(() => {
    const el = root.current
    const cv = canvas.current
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData) return
    const ctx = cv.getContext('2d')
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const dots = Array.from({ length: innerWidth < 700 ? 40 : 90 }, () => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + 0.5, v: Math.random() * 0.05 + 0.02, p: Math.random() * 6.28
    }))
    let w = 0, h = 0, tx = 0, ty = 0, x = 0, y = 0, last = 0, raf = 0, on = true
    const fit = () => { w = cv.width = el.clientWidth * dpr; h = cv.height = el.clientHeight * dpr }
    const move = e => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5 }
    const draw = t => {
      raf = requestAnimationFrame(draw)
      if (!on) return
      const dt = Math.min((t - last) / 1000, 0.05); last = t
      x += (tx - x) * 0.06; y += (ty - y) * 0.06
      el.style.setProperty('--ry', `${(x * 16 + Math.sin(t / 2400) * 9).toFixed(2)}deg`)
      el.style.setProperty('--rx', `${(-y * 12 + Math.cos(t / 3000) * 4).toFixed(2)}deg`)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#e5c98f'
      for (const d of dots) {
        d.y -= d.v * dt
        if (d.y < -0.02) { d.y = 1.02; d.x = Math.random() }
        ctx.globalAlpha = 0.2 + 0.6 * Math.abs(Math.sin(t / 1100 + d.p))
        ctx.beginPath(); ctx.arc((d.x + x * 0.04 * d.r) * w, d.y * h, d.r * dpr, 0, 6.283); ctx.fill()
      }
    }
    const io = new IntersectionObserver(([e]) => { on = e.isIntersecting })
    io.observe(el); fit()
    addEventListener('resize', fit); addEventListener('pointermove', move)
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); io.disconnect(); removeEventListener('resize', fit); removeEventListener('pointermove', move) }
  }, [])

  return (
    <section className="gx" ref={root} aria-label="Abertura GALEO">
      <canvas className="gx-dust" ref={canvas} aria-hidden="true" />
      <i className="gx-scan" aria-hidden="true" />
      <div className="gx-hud" aria-hidden="true"><span>GALEO / SYS 001</span><span>4K · ONLINE</span></div>
      <div className="gx-stage">
        <div className="gx-enter">
          <div className="gx-tilt">
            <i className="gx-ring" /><i className="gx-ring" />
            <div className="gx-face">
              <img
                ref={img}
                className={loaded ? 'gx-img is-loaded' : 'gx-img'}
                src={`${CDN}/q_auto:best,w_1920/${ID}`}
                srcSet={SET}
                sizes="(min-width: 1200px) 100vw, 92vw"
                alt="GALEO"
                fetchPriority="high"
                decoding="async"
                onLoad={() => setLoaded(true)}
              />
              <span className="gx-shine" />
            </div>
          </div>
        </div>
      </div>
      <button className="gx-cta" type="button" onClick={() => root.current?.nextElementSibling?.scrollIntoView()}>Entrar na loja <span>↓</span></button>
    </section>
  )
}