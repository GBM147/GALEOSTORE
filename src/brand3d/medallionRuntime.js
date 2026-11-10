import { createGaleoScene } from './galeoScene.js'

// Live medallion: slow sway plus a tilt that follows the pointer over the
// banner. It renders at most ~30 frames per second, only while visible.
export function mountMedallion(container, { pose, onReady } = {}) {
  const canvas = document.createElement('canvas')
  canvas.className = 'brand-medallion-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset.brand3d = 'true'
  const area = container.closest('.hero-full') || container
  const pointer = { x: 0, y: 0 }
  const current = { ...pose }
  let scene = null, frame = 0, last = 0, visible = true, disposed = false

  const measure = () => {
    const rect = container.getBoundingClientRect()
    return [Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))]
  }
  const move = event => {
    const rect = area.getBoundingClientRect()
    pointer.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1))
    pointer.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1))
  }
  const leave = () => { pointer.x = 0; pointer.y = 0 }
  const resize = new ResizeObserver(() => { if (scene) scene.setSize(...measure()) })
  const seen = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting) })

  function loop(time) {
    frame = requestAnimationFrame(loop)
    if (!visible || document.hidden || time - last < 32) return
    last = time
    const seconds = time / 1000
    const target = { x: pose.x + pointer.y * 0.22, y: pose.y + Math.sin(seconds * 0.45) * 0.3 + pointer.x * 0.42 }
    current.x += (target.x - current.x) * 0.08
    current.y += (target.y - current.y) * 0.08
    scene.setPose(current)
    canvas.dataset.tilt = current.y.toFixed(3)
    scene.render()
  }

  const [width, height] = measure()
  createGaleoScene(canvas, { width, height, pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) }).then(created => {
    if (disposed) return created.dispose()
    scene = created
    scene.setPose(current)
    scene.render()
    container.appendChild(canvas)
    area.addEventListener('pointermove', move)
    area.addEventListener('pointerleave', leave)
    resize.observe(container)
    seen.observe(container)
    frame = requestAnimationFrame(loop)
    onReady?.()
  }).catch(() => {})

  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    area.removeEventListener('pointermove', move)
    area.removeEventListener('pointerleave', leave)
    resize.disconnect()
    seen.disconnect()
    scene?.dispose()
    canvas.remove()
  }
}
