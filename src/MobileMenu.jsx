import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { ArrowIcon, BagIcon, CloseIcon, LiteIcon, MoonIcon, SunIcon, UserIcon } from './icons'
import { setLiteMode, useLiteMode } from './liteMode'

// Side menu for phones and tablets, where the category bar does not fit.
export default function MobileMenu({ open, onClose, links, isActive, theme, onToggleTheme, cartItemsCount = 0 }) {
  const dialog = useRef(null)
  const lite = useLiteMode()
  const { key } = useLocation()
  const lastKey = useRef(key)

  useEffect(() => {
    const element = dialog.current
    if (!element) return undefined
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
    document.documentElement.classList.toggle('menu-open', open)
    return () => document.documentElement.classList.remove('menu-open')
  }, [open])

  // Any navigation (a link here, back/forward) closes the menu.
  useEffect(() => {
    if (lastKey.current !== key && open) onClose()
    lastKey.current = key
  }, [key, open, onClose])

  return createPortal(<dialog ref={dialog} id="galeo-mobile-menu" className="mobile-menu" aria-label="Menu" data-lenis-prevent=""
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === dialog.current) onClose() }}>
    <div className="mobile-menu-panel">
      <div className="mobile-menu-head">
        <span className="mobile-menu-title">Menu</span>
        <button type="button" className="header-icon" onClick={onClose} aria-label="Fechar menu"><CloseIcon /></button>
      </div>
      <nav aria-label="Categorias">
        <ul className="mobile-menu-categories">
          {links.map(link => <li key={link.id}>
            <Link to={link.url} aria-current={isActive(link.url) ? 'page' : undefined} onClick={onClose}>{link.name}<ArrowIcon /></Link>
          </li>)}
        </ul>
        <Link className="mobile-menu-all" to="/shop" onClick={onClose}>Ver catálogo completo</Link>
      </nav>
      <div className="mobile-menu-secondary">
        <Link to="/conta" onClick={onClose}><UserIcon />Minha conta</Link>
        <Link to="/carrinho" onClick={onClose}><BagIcon />Carrinho ({cartItemsCount})</Link>
        <button type="button" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}{theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
        <button type="button" onClick={() => setLiteMode(!lite)}><LiteIcon />Modo leve: {lite ? 'ligado' : 'desligado'}</button>
      </div>
    </div>
  </dialog>, document.body)
}
