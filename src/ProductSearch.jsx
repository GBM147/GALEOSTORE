import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './product-search.css'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export default function ProductSearch({ products = [], value = '', onChange, label = 'Produto', placeholder = 'Pesquisar por nome, marca ou código', allowAll = false, required = false }) {
  const id = useId()
  const input = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({})
  const selected = products.find(product => String(product.id) === String(value))
  const selectedLabel = selected ? [selected.name, selected.brand].filter(Boolean).join(' · ') : allowAll ? 'Todos os produtos' : ''
  const options = useMemo(() => {
    const term = normalize(query)
    const matches = products.filter(product => normalize([product.name, product.brand, product.id].join(' ')).includes(term))
      .map(product => ({ id: String(product.id), label: [product.name, product.brand].filter(Boolean).join(' · '), code: product.id }))
    return allowAll ? [{ id: '', label: 'Todos os produtos' }, ...matches] : matches
  }, [products, query, allowAll])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const bounds = input.current?.getBoundingClientRect()
      if (!bounds) return
      const below = window.innerHeight - bounds.bottom - 12
      const above = bounds.top - 12
      const placeBelow = below >= 140 || below >= above
      const maxHeight = Math.min(280, Math.max(placeBelow ? below : above, 80))
      setPosition({ left: bounds.left, width: bounds.width, maxHeight,
        ...(placeBelow ? { top:bounds.bottom + 4 } : { bottom:window.innerHeight - bounds.top + 4 }) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  function choose(option) {
    onChange(option.id)
    setOpen(false)
    setQuery('')
    input.current?.focus({ preventScroll: true })
  }

  function keyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive(current => Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (options[active]) choose(options[active])
    }
  }

  return <div className="product-search">
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={id + '-options'} aria-activedescendant={open && options[active] ? id + '-option-' + active : undefined}
      autoComplete="off" required={required} placeholder={placeholder} value={open ? query : selectedLabel}
      onFocus={() => { setQuery(''); setActive(0); setOpen(true) }}
      onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }}
      onKeyDown={keyDown} onBlur={() => setOpen(false)} />
    {open && createPortal(<div className="product-search-options" style={position} role="listbox" id={id + '-options'} aria-label={label}>
      {options.map((option, index) => <div key={option.id || 'all'} id={id + '-option-' + index} role="option"
        aria-selected={String(value) === option.id} className={index === active ? 'is-active' : ''}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
        <span>{option.label}</span>{option.code && <small>Código {option.code}</small>}
      </div>)}
      {!options.length && <p className="product-search-empty">Nenhum produto encontrado</p>}
    </div>, document.body)}
  </div>
}
