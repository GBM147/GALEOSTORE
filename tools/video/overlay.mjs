// Tutorial layer injected into every recorded page: caption, cursor, highlight
// ring and chapter cards. It never takes clicks (pointer-events: none).
export const overlaySource = String.raw`(() => {
  if (window.__tour) return
  const css = '' +
    '#tour-layer{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:Inter,Arial,sans-serif}' +
    '#tour-caption{position:absolute;left:50%;bottom:var(--tour-bottom,42px);transform:translate(-50%,12px);max-width:min(1180px,calc(100vw - 48px));padding:16px 26px;border-left:4px solid #e2c27f;border-radius:14px;background:rgba(8,7,6,.86);color:#f6efe2;font-size:var(--tour-font,28px);font-weight:500;line-height:1.35;letter-spacing:-.005em;box-shadow:0 18px 50px rgba(0,0,0,.45);opacity:0;transition:opacity .25s ease,transform .25s ease;text-wrap:balance;text-align:left}' +
    '#tour-caption.on{opacity:1;transform:translate(-50%,0)}' +
    '#tour-cursor{position:absolute;left:0;top:0;width:30px;height:30px;transform:translate(-4px,-2px);filter:drop-shadow(0 3px 6px rgba(0,0,0,.45));transition:opacity .2s}' +
    '#tour-ring{position:absolute;border:3px solid #e2c27f;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 26px rgba(226,194,127,.65);opacity:0;transition:all .35s cubic-bezier(.2,.8,.2,1)}' +
    '#tour-ring.on{opacity:1}' +
    '.tour-ripple{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:3px solid #e2c27f;animation:tour-ripple .6s ease-out forwards}' +
    '@keyframes tour-ripple{to{transform:scale(3.2);opacity:0}}' +
    '#tour-chapter{position:absolute;inset:0;display:grid;place-content:center;gap:14px;background:radial-gradient(circle at 70% 35%,rgba(226,194,127,.16),transparent 55%),#050505;color:#f2eadb;text-align:center;opacity:0;transition:opacity .45s ease}' +
    '#tour-chapter.on{opacity:1}' +
    '#tour-chapter img{width:120px;height:120px;margin:0 auto 8px}' +
    '#tour-chapter small{color:#e2c27f;font-size:20px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}' +
    '#tour-chapter strong{font-family:"Bodoni Moda",Georgia,serif;font-size:72px;font-weight:500;line-height:1.05;letter-spacing:-.01em}' +
    '#tour-chapter span{max-width:900px;color:#cfc4b2;font-size:26px;line-height:1.4}'
  function mount() {
    if (document.getElementById('tour-layer')) return
    const style = document.createElement('style'); style.textContent = css
    const layer = document.createElement('div'); layer.id = 'tour-layer'
    layer.innerHTML = '<div id="tour-ring"></div><div id="tour-caption"></div><div id="tour-chapter"></div>' +
      '<svg id="tour-cursor" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.4 20.6 L12 14.2 L18.5 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    document.documentElement.append(style, layer)
    const pos = window.__tourCursor || { x: innerWidth * .6, y: innerHeight * .55 }
    place(pos.x, pos.y)
  }
  const $ = id => { mount(); return document.getElementById(id) }
  function place(x, y) { const c = document.getElementById('tour-cursor'); if (c) { c.style.left = x + 'px'; c.style.top = y + 'px' } window.__tourCursor = { x, y } }
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  window.__tour = {
    caption(text, options = {}) {
      const el = $('tour-caption')
      if (options.bottom) el.style.setProperty('--tour-bottom', options.bottom + 'px')
      if (options.font) el.style.setProperty('--tour-font', options.font + 'px')
      if (!text) { el.classList.remove('on'); return }
      el.textContent = text; el.classList.add('on')
    },
    move(x, y, ms = 700) {
      mount()
      const from = window.__tourCursor || { x, y }, start = performance.now()
      return new Promise(resolve => {
        const step = now => {
          const t = Math.min(1, (now - start) / ms), k = ease(t)
          place(from.x + (x - from.x) * k, from.y + (y - from.y) * k)
          t < 1 ? requestAnimationFrame(step) : resolve()
        }
        requestAnimationFrame(step)
      })
    },
    set(x, y) { mount(); place(x, y) },
    cursor(visible) { $('tour-cursor').style.opacity = visible ? '1' : '0' },
    ripple() {
      const p = window.__tourCursor || { x: 0, y: 0 }, r = document.createElement('div')
      r.className = 'tour-ripple'; r.style.left = p.x + 'px'; r.style.top = p.y + 'px'
      $('tour-layer').append(r); setTimeout(() => r.remove(), 700)
    },
    ring(rect, pad = 8) {
      const el = $('tour-ring')
      if (!rect) { el.classList.remove('on'); return }
      Object.assign(el.style, { left: rect.x - pad + 'px', top: rect.y - pad + 'px', width: rect.width + pad * 2 + 'px', height: rect.height + pad * 2 + 'px' })
      el.classList.add('on')
    },
    chapter(kicker, title, text) {
      const el = $('tour-chapter')
      if (!title) { el.classList.remove('on'); return }
      el.innerHTML = '<img src="/images/galeo-logo-128.webp" alt=""><small></small><strong></strong><span></span>'
      el.querySelector('small').textContent = kicker || ''
      el.querySelector('strong').textContent = title
      el.querySelector('span').textContent = text || ''
      el.classList.add('on')
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount()
})()`
