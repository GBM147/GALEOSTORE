import { createGaleoScene } from './galeoScene.js'

// Live medallion: a slow sway the same amount to both sides of the front, plus
// a turn that follows the mouse or the finger over the banner (also the same to
// both sides). At most ~30 frames per second, and only while visible.
export function mountMedallion(container, { pose, onReady } = {}) {
  const canvas = document.createElement('canvas')
  canvas.className = 'brand-medallion-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset.brand3d = 'true'
  const area = container.closest('.hero-full') || container
  const pointer = { x: 0, y: 0 }
  const current = { ...pose }
  let scene = null, frame = 0, last = 0, start = 0, visible = true, disposed = false, dirty = true

  const measure = () => {
    const rect = container.getBoundingClientRect()
    return [Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))]
  }
  const aim = (x, y) => {
    const rect = area.getBoundingClientRect()
    pointer.x = Math.max(-1, Math.min(1, ((x - rect.left) / rect.width) * 2 - 1))
    pointer.y = Math.max(-1, Math.min(1, ((y - rect.top) / rect.height) * 2 - 1))
  }
  // Mouse and pen; a finger is followed by the touch events below.
  const move = event => { if (event.pointerType !== 'touch') aim(event.clientX, event.clientY) }
  const leave = event => { if (event?.pointerType !== 'touch') { pointer.x = 0; pointer.y = 0 } }
  // Passive touch listeners: the medallion follows the finger and the page
  // still scrolls normally. When the finger lifts, it eases back to the center.
  const touch = event => { const point = event.touches[0]; if (point) aim(point.clientX, point.clientY) }
  const release = () => { pointer.x = 0; pointer.y = 0 }
  const passive = { passive: true }
  const resize = new ResizeObserver(() => { if (scene) { scene.setSize(...measure()); dirty = true } })
  const seen = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting) })

  function loop(time) {
    frame = requestAnimationFrame(loop)
    if (!visible || document.hidden || time - last < 32) return
    last = time
    if (!start) start = time
    // The sway starts at the center (like the image it replaces) and goes
    // ±0.3 rad, about 17°, to each side.
    const sway = Math.sin((time - start) / 1000 * 0.45) * 0.3
    const target = { x: pose.x + pointer.y * 0.22, y: pose.y + sway + pointer.x * 0.42 }
    const dx = target.x - current.x, dy = target.y - current.y
    if (!dirty && Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005) return
    current.x += dx * 0.1
    current.y += dy * 0.1
    scene.setPose(current)
    canvas.dataset.tilt = current.y.toFixed(3)
    scene.render()
    dirty = false
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
    area.addEventListener('touchstart', touch, passive)
    area.addEventListener('touchmove', touch, passive)
    area.addEventListener('touchend', release, passive)
    area.addEventListener('touchcancel', release, passive)
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
    area.removeEventListener('touchstart', touch, passive)
    area.removeEventListener('touchmove', touch, passive)
    area.removeEventListener('touchend', release, passive)
    area.removeEventListener('touchcancel', release, passive)
    resize.disconnect()
    seen.disconnect()
    scene?.dispose()
    canvas.remove()
  }
}
