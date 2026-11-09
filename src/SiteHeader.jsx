import { useCallback, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BagIcon, MenuIcon, MoonIcon, SearchIcon, SunIcon, UserIcon } from './icons'
import MobileMenu from './MobileMenu'
import { navigationLinks } from './siteNavigation'
import { useVisualEditor } from './VisualHomeEditor'

function ModeButton({ theme, onToggle }) {
  const label = theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'
  return <button className="header-icon mode-button" type="button" onClick={onToggle} aria-label={label} title={label}>
    {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
  </button>
}

export default function SiteHeader({ theme, onToggle, navigation = null, cartItemsCount = 0 }) {
  const editor = useVisualEditor()
  const navigate = useNavigate()
  const { pathname, search: query } = useLocation()
  const searchTrigger = useRef(null)
  const menuTrigger = useRef(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const links = navigationLinks(navigation)
  const editing = Boolean(editor?.editing)
  const editMenu = event => { event.preventDefault(); editor.select({ kind:'settings', tab:'navigation' }) }
  const toggleTheme = editing ? () => editor.updateSetting('storefront_visual_defaults', current => ({ ...current, theme:theme === 'dark' ? 'light' : 'dark' })) : onToggle

  const isActive = useCallback(url => {
    try {
      const target = new URL(url, 'https://galeo.invalid')
      return target.pathname === pathname && target.search === query
    } catch { return false }
  }, [pathname, query])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    menuTrigger.current?.focus({ preventScroll:true })
  }, [])

  function startNavigationAtTop(event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    window.scrollTo({ top:0, left:0, behavior:'instant' })
  }

  function submitSearch(event) {
    event.preventDefault()
    if (editing) return
    if (editor?.confirmLeave && !editor.confirmLeave()) return
    const value = search.trim()
    navigate(value ? '/shop?q=' + encodeURIComponent(value) : '/shop')
    setSearchOpen(false)
    // A header search may change only the query string while the customer is
    // near the bottom of the catalog. Start the new results at the top.
    window.scrollTo({ top:0, left:0, behavior:'instant' })
  }

  function handleSearchKeyDown(event) {
    if (!searchOpen || event.key !== 'Escape') return
    event.preventDefault()
    setSearchOpen(false)
    searchTrigger.current?.focus({ preventScroll:true })
  }

  const linkProps = { 'data-editor-spa-link': editor ? 'true' : undefined, onClick: editing ? editMenu : startNavigationAtTop }

  return <>
    <header className={'site-header' + (editing ? ' is-editing' : '')} onKeyDown={handleSearchKeyDown}>
      <button ref={menuTrigger} type="button" className="header-icon menu-trigger" aria-label="Abrir menu" aria-expanded={menuOpen}
        aria-controls="galeo-mobile-menu" onClick={editing ? editMenu : () => setMenuOpen(true)}><MenuIcon /></button>

      <Link className="brand" to="/" aria-label="Galeo Store" {...linkProps}>
        <span className="brand-logo-wrap">
          <img className="brand-logo" src="/images/galeo-logo-128.webp" width="128" height="128" alt="GALEO" />
        </span>
        <span className="brand-wordmark">GALEO</span>
      </Link>

      <nav className="desktop-nav" aria-label="Categorias principais">
        {links.map(link => <Link key={link.id} to={link.url} aria-current={isActive(link.url) ? 'page' : undefined} {...linkProps}>{link.name}</Link>)}
        <Link to="/shop" aria-current={isActive('/shop') ? 'page' : undefined} {...linkProps}>{editing ? 'Editar menu' : 'Catálogo'}</Link>
      </nav>

      <div className="header-actions">
        <button ref={searchTrigger} className="header-icon search-trigger" type="button" disabled={editing}
          onClick={() => setSearchOpen(value => !value)} aria-expanded={searchOpen}
          aria-controls={searchOpen ? 'galeo-header-search' : undefined}
          aria-label={searchOpen ? 'Fechar busca' : 'Abrir busca'} title={searchOpen ? 'Fechar busca' : 'Buscar produtos'}><SearchIcon /></button>
        <ModeButton theme={theme} onToggle={toggleTheme} />
        <Link className="header-icon account-link" to="/conta" aria-label="Conta" title="Minha conta" data-editor-spa-link={editor ? 'true' : undefined}
          aria-disabled={editing || undefined} onClick={editing ? event => event.preventDefault() : undefined}><UserIcon /></Link>
        <Link className="header-icon bag-link" to="/carrinho" aria-label={'Carrinho, ' + cartItemsCount + (cartItemsCount === 1 ? ' item' : ' itens')}
          title="Carrinho" data-editor-spa-link={editor ? 'true' : undefined} aria-disabled={editing || undefined}
          onClick={editing ? event => event.preventDefault() : undefined}>
          <BagIcon /><span className="bag-count" data-empty={cartItemsCount === 0 || undefined}>{cartItemsCount}</span>
        </Link>
      </div>

      {searchOpen && <form id="galeo-header-search" className="header-search" onSubmit={submitSearch}>
        <div className="header-search-row">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por produto, marca ou categoria" autoFocus aria-label="Buscar produtos" />
          <button type="submit">Buscar ↗</button>
        </div>
      </form>}
    </header>
    <MobileMenu open={menuOpen} onClose={closeMenu} links={links} isActive={isActive} theme={theme} onToggleTheme={toggleTheme} cartItemsCount={cartItemsCount} />
  </>
}
