import { useLayoutEffect } from 'react'

const pixels = value => Number.parseFloat(value) || 0

function minimumHeroHeight(hero, value) {
  // Chromium can retain min()/calc() in a computed min-height. Resolve that
  // length independently of the Hero's content, which may already have grown.
  if (/^\d+(?:\.\d+)?px$/.test(value)) return pixels(value)
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  Object.assign(probe.style, {
    position: 'absolute', width: '0', height: value, minHeight: '0',
    maxHeight: 'none', padding: '0', margin: '0', border: '0',
    visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden'
  })
  hero.appendChild(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return height
}

function fitTitle(hero) {
  const title = hero.querySelector('.hero-title')
  const content = hero.querySelector('.hero-full-content')
  if (!title || !content || !content.clientWidth || content.querySelector('textarea')) return

  title.style.removeProperty('--hero-title-fit')
  const maximum = pixels(getComputedStyle(title).fontSize)
  if (!maximum) return
  const minimum = Math.min(maximum, window.innerWidth <= 760 ? 28 : 36)
  const heroStyle = getComputedStyle(hero)
  const contentStyle = getComputedStyle(content)
  const titleStyle = getComputedStyle(title)
  const children = [...content.children].filter(element => getComputedStyle(element).display !== 'none')
  const siblingsHeight = children.filter(element => element !== title).reduce((height, element) => {
    const style = getComputedStyle(element)
    return height + element.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom)
  }, 0)
  const available = minimumHeroHeight(hero, heroStyle.minHeight)
    - pixels(heroStyle.borderTopWidth) - pixels(heroStyle.borderBottomWidth)
    - pixels(contentStyle.paddingTop) - pixels(contentStyle.paddingBottom)
    - pixels(titleStyle.marginTop) - pixels(titleStyle.marginBottom)
    - siblingsHeight - pixels(contentStyle.rowGap) * Math.max(0, children.length - 1) - 2
  const fits = () => Math.max(title.scrollHeight, title.getBoundingClientRect().height) <= available
    && title.scrollWidth <= title.clientWidth + 1
  const setSize = size => title.style.setProperty('--hero-title-fit', size.toFixed(2) + 'px')

  if (fits()) return
  setSize(minimum)
  // Keep a readable floor. Normal document flow then lets the banner grow for
  // unusually long text instead of cutting content or reducing it indefinitely.
  if (!fits()) return
  let low = minimum, high = maximum
  for (let iteration = 0; iteration < 8; iteration++) {
    const middle = (low + high) / 2
    setSize(middle)
    if (fits()) low = middle
    else high = middle
  }
  setSize(Math.floor(low * 100) / 100)
}

export function useHeroTitleFit(heroRef, dependencies) {
  useLayoutEffect(() => {
    const hero = heroRef.current
    const content = hero?.querySelector('.hero-full-content')
    if (!hero || !content) return
    let active = true, frame = null
    const schedule = () => {
      if (!active || frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (active) fitTitle(hero)
      })
    }
    fitTitle(hero)
    const widths = new WeakMap()
    const resize = new ResizeObserver(entries => {
      if (entries.some(entry => {
        const before = widths.get(entry.target)
        widths.set(entry.target, entry.contentRect.width)
        return before !== entry.contentRect.width
      })) schedule()
    })
    resize.observe(hero)
    resize.observe(content)
    // Inline editing changes child elements without rerendering Home. Observe
    // those changes, but never our style attribute or animation attributes.
    const mutations = new MutationObserver(schedule)
    mutations.observe(content, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', schedule)
    document.fonts?.ready.then(schedule).catch(() => {})
    document.fonts?.addEventListener('loadingdone', schedule)
    return () => {
      active = false
      if (frame !== null) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      document.fonts?.removeEventListener('loadingdone', schedule)
      hero.querySelector('.hero-title')?.style.removeProperty('--hero-title-fit')
    }
  }, [heroRef, ...dependencies])
}
