import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

const boundedNumber = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback

export default function RevealGrid({ as: Tag = 'div', className, items, reveal, children, ...attributes }) {
  const container = useRef(null)
  const revealed = useRef(new WeakSet())

  useLayoutEffect(() => {
    if (reveal?.enabled === false) return undefined
    gsap.registerPlugin(ScrollTrigger)
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', (context) => {
      const root = container.current
      const pending = gsap.utils.toArray('.category-card, .product-card, .campaign-card', root)
        .filter((element) => !revealed.current.has(element))
      if (!pending.length) return undefined
      let active = true

      gsap.set(pending, { autoAlpha: 0, y: boundedNumber(reveal?.distance, 26, 0, 100) })
      context.add('enter', (batch) => {
        if (!active) return
        const targets = batch.filter((element) => root.contains(element) && !revealed.current.has(element))
        if (!targets.length) return
        targets.forEach((element) => revealed.current.add(element))
        gsap.to(targets, {
          autoAlpha: 1,
          y: 0,
          duration: boundedNumber(reveal?.duration, 0.75, 0.1, 3),
          stagger: boundedNumber(reveal?.stagger, 0.06, 0, 0.5),
          ease: 'power2.out',
          clearProps: 'transform',
          overwrite: 'auto'
        })
      })
      ScrollTrigger.batch(pending, {
        start: 'top 88%',
        interval: 0.06,
        batchMax: 4,
        once: reveal?.once !== false,
        onEnter: context.enter
      })
      ScrollTrigger.refresh()
      return () => { active = false }
    }, container)
    return () => media.revert()
  }, [items, reveal])

  return <Tag ref={container} className={className} {...attributes}>{children}</Tag>
}
