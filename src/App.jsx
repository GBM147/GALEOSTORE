import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import CampaignCarousel from './CampaignCarousel'
import RevealGrid from './RevealGrid'
import HeroVisual from './HeroVisual'
import NewsletterSignup, { NewsletterConfirmation } from './NewsletterSignup'
import VisualHomeEditor, { EditableSection, EditableText, EditorLink, EditorMediaButton, useVisualEditor } from './VisualHomeEditor'
import { cartCount, readCart, STORE_API_BASE } from './storeApi'
import { formatProductPrice, productHasPrice } from './productAvailability'
import { loadStorefrontJson } from './storefrontData'
import { editorialSegments, editorialType, textHighlightPath } from './editorialText'

const AdminGate = lazy(() => import('./Admin'))
const ProductPage = lazy(() => import('./ProductPage'))
const CartPage = lazy(() => import('./CartPage'))
const AccountPage = lazy(() => import('./AccountPage'))
import { activeProductVariants, compareSizes } from './productVariants'
import './product-variants.css'

const MALE_CATEGORIES = ['Camisetas', 'Calças', 'Camisas', 'Moletons', 'Bermudas', 'Casacos', 'Calçados', 'Acessórios']

const fallbackProducts = []

function PageLoading({ message = 'Carregando página…' }) {
  return <main className="section-shell page-space" style={{ minHeight:'70svh' }} aria-busy="true"><p className="page-note" role="status">{message}</p></main>
}

function RouteScroll() {
  const { pathname, hash } = useLocation()
  useLayoutEffect(() => {
    if (!hash) {
      window.scrollTo({ top:0, left:0, behavior:'instant' })
      return undefined
    }
    let target
    try { target = decodeURIComponent(hash.slice(1)) } catch { return undefined }
    const scroll = () => {
      const element = document.getElementById(target)
      if (!element) return false
      element.scrollIntoView({ block:'start', behavior:'instant' })
      return true
    }
    if (scroll()) return undefined
    const observer = new MutationObserver(() => { if (scroll()) observer.disconnect() })
    observer.observe(document.getElementById('root'), { childList:true, subtree:true })
    const timeout = window.setTimeout(() => observer.disconnect(), 5000)
    return () => { observer.disconnect(); window.clearTimeout(timeout) }
  }, [pathname, hash])
  return null
}

function KeepAliveSocket() {
  useEffect(() => {
    if (import.meta.env.VITE_RENDER_KEEPALIVE === 'false') return
    let socket = null
    let timer = null
    let reconnectTimer = null
    let stopped = false
    let retry = 1000

    const connect = () => {
      if (stopped) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(protocol + '//' + window.location.host + '/ws')

      socket.addEventListener('open', () => {
        retry = 1000
        try { socket.send(JSON.stringify({ type: 'keepalive', at: Date.now() })) } catch {}
        timer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            try { socket.send(JSON.stringify({ type: 'keepalive', at: Date.now() })) } catch {}
          }
        }, 60 * 1000)
      })

      socket.addEventListener('close', () => {
        if (timer) window.clearInterval(timer)
        timer = null
        if (stopped) return
        window.clearTimeout(reconnectTimer)
        reconnectTimer = window.setTimeout(connect, retry)
        retry = Math.min(retry * 2, 30 * 1000)
      })

      socket.addEventListener('error', () => {
        try { socket?.close() } catch {}
      })
    }

    connect()

    return () => {
      stopped = true
      if (timer) window.clearInterval(timer)
      window.clearTimeout(reconnectTimer)
      try { socket?.close() } catch {}
    }
  }, [])

  return null
}

const boundedNumber = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback

function StorefrontMotion({ homeSections, visualDefaults, campaignDefaults }) {
  const { pathname } = useLocation()
  const introducedHeroes = useRef(new WeakSet())
  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const root = document.querySelector('.app')
    const interaction = visualDefaults?.interaction || {}
    const smoothScroll = interaction.smooth_scroll || {}
    const reveal = interaction.scroll_reveal || {}
    const textReveal = interaction.hero_text_reveal || {}
    const campaignSection = homeSections.find((section) => section.key === 'campaigns')
    const campaign = { ...(campaignSection?.content?.defaults || {}), ...(campaignDefaults || {}) }
    const effect = ['static','zoom','pan-horizontal','pan-vertical','parallax','ken-burns'].includes(campaign.effect) ? campaign.effect : 'zoom'
    const header = root.querySelector('.site-header')
    const updateScrollChrome = ({ scroll }) => {
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress = documentHeight > 0 ? Math.min(1, Math.max(0, scroll / documentHeight)) : 0
      if (header) header.classList.toggle('is-scrolled', scroll > 24)
      document.documentElement.style.setProperty('--scroll-progress', String(progress))
    }

    const nativeScroll = () => updateScrollChrome({ scroll:window.scrollY })
    window.addEventListener('scroll', nativeScroll, { passive:true })
    nativeScroll()

    let active = true
    let refreshFrame = null
    const refreshAfterLoad = () => {
      if (!active || refreshFrame != null) return
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = null
        if (active) {
          ScrollTrigger.refresh()
          nativeScroll()
        }
      })
    }
    root.addEventListener('load', refreshAfterLoad, true)
    root.addEventListener('loadedmetadata', refreshAfterLoad, true)
    document.fonts?.ready.then(refreshAfterLoad).catch(() => {})

    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const lenis = smoothScroll.enabled === false ? null : new Lenis({
        duration: boundedNumber(smoothScroll.duration, 1.05, 0.1, 3),
        wheelMultiplier: boundedNumber(smoothScroll.wheel_multiplier, 0.95, 0.1, 3),
        smoothWheel: true,
        autoRaf: false
      })
      const raf = (time) => lenis?.raf(time * 1000)
      if (lenis) {
        lenis.on('scroll', ScrollTrigger.update)
        gsap.ticker.add(raf)
        gsap.ticker.lagSmoothing(0)
      }

      if (reveal.enabled !== false) gsap.utils.toArray('[data-reveal]').forEach((element) => {
        gsap.fromTo(
          element,
          { autoAlpha: 0, y: boundedNumber(reveal.distance, 24, 0, 100) },
          {
            autoAlpha: 1,
            y: 0,
            duration: boundedNumber(reveal.duration, 0.8, 0.1, 3),
            ease: 'power2.out',
            scrollTrigger: {
              trigger: element,
              start: 'top 86%',
              once: reveal.once !== false
            }
          }
        )
      })

      if (root.querySelector('.hero-full-content') && effect !== 'static') gsap.to('.hero-full-content', {
        y: () => window.innerWidth <= 760 ? -10 : -22,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero-full',
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          invalidateOnRefresh: true
        }
      })

      const hero = root.querySelector('.hero-full')
      if (textReveal.enabled !== false && hero && !introducedHeroes.current.has(hero)) {
        const intro = gsap.timeline({
          onStart: () => introducedHeroes.current.add(hero),
          defaults: { ease: 'power3.out', clearProps: 'transform,opacity,visibility' }
        })
        intro.from('.hero-full .hero-title-mask', {
          autoAlpha: 0,
          y: 18,
          duration: boundedNumber(textReveal.duration, 0.9, 0.1, 3),
          stagger: boundedNumber(textReveal.stagger, 0.08, 0, 0.5)
        }, 0.08)
        intro.from('.hero-full p', { autoAlpha: 0, y: 12, duration: 0.65 }, 0.32)
        intro.from('.hero-full-actions', { autoAlpha: 0, y: 12, duration: 0.65 }, 0.44)
      }

      ScrollTrigger.refresh()
      return () => {
        lenis?.off('scroll', ScrollTrigger.update)
        if (lenis) gsap.ticker.remove(raf)
        lenis?.destroy()
      }
    }, root)

    return () => {
      active = false
      if (refreshFrame != null) window.cancelAnimationFrame(refreshFrame)
      root.removeEventListener('load', refreshAfterLoad, true)
      root.removeEventListener('loadedmetadata', refreshAfterLoad, true)
      media.revert()
      window.removeEventListener('scroll', nativeScroll)
    }
  }, [pathname, homeSections, visualDefaults, campaignDefaults])

  return null
}

function ModeButton({ theme, onToggle }) {
  return (
    <button className="mode-button" type="button" onClick={onToggle} aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}>
      <span>Escolha do modo</span>
      <i>{theme === 'dark' ? '☼' : '☾'}</i>
    </button>
  )
}

function Header({ theme, onToggle, categories = [], navigation = null, cartItemsCount = 0 }) {
  const editor = useVisualEditor()
  const navigate = useNavigate()
  const searchTrigger = useRef(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')

  const primaryCategories = Array.isArray(navigation?.items) && navigation.items.length ? navigation.items.slice(0, 8).map((item, index) => ({ id: 'cms-menu-' + index, name: item.label, url: item.url || '/shop' })) : MALE_CATEGORIES.slice(0, 4).map((name, index) => ({ id: 'menu-' + index, name, url: '/shop?category=' + encodeURIComponent(name) }))

  function startNavigationAtTop(event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    window.scrollTo({ top:0, left:0, behavior:'instant' })
  }

  function submitSearch(event) {
    event.preventDefault()
    if (editor?.editing) return
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

  return (
    <header className="site-header" onKeyDown={handleSearchKeyDown}>
      <Link className="brand" to="/" aria-label="Galeo Store" data-editor-spa-link={editor ? 'true' : undefined} onClick={editor?.editing ? event => { event.preventDefault(); editor.select({ kind:'settings', tab:'navigation' }) } : startNavigationAtTop}>
        <span className="brand-logo-wrap">
          <img className="brand-logo" src="/images/galeo-brand.webp" alt="GALEO" />
        </span>
        <span className="brand-wordmark">GALEO</span>
      </Link>

      <nav className="desktop-nav" aria-label="Categorias principais">
        {primaryCategories.map((category) => (
          <Link key={category.id} to={category.url} data-editor-spa-link={editor ? 'true' : undefined} onClick={editor?.editing ? event => { event.preventDefault(); editor.select({ kind:'settings', tab:'navigation' }) } : startNavigationAtTop}>
            {category.name}
          </Link>
        ))}
        <Link to="/shop" data-editor-spa-link={editor ? 'true' : undefined} onClick={editor?.editing ? event => { event.preventDefault(); editor.select({ kind:'settings', tab:'navigation' }) } : startNavigationAtTop}>{editor?.editing ? 'Editar menu' : 'Catálogo'}</Link>
      </nav>

      <div className="header-actions">
        <button
          ref={searchTrigger}
          className={'search-trigger' + (searchOpen ? ' is-open' : '')}
          type="button"
          disabled={editor?.editing}
          onClick={() => setSearchOpen(value => !value)}
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? 'galeo-header-search' : undefined}
          aria-label={searchOpen ? 'Fechar busca' : 'Abrir busca'}
          title={searchOpen ? 'Fechar busca' : 'Buscar produtos'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l5 5" />
          </svg>
        </button>
        <ModeButton theme={theme} onToggle={editor?.editing ? () => editor.updateSetting('storefront_visual_defaults', current => ({ ...current, theme:theme === 'dark' ? 'light' : 'dark' })) : onToggle} />
        <Link className="bag-link" to="/carrinho" data-editor-spa-link={editor ? 'true' : undefined} aria-disabled={editor?.editing || undefined} onClick={editor?.editing ? event => event.preventDefault() : undefined}>Carrinho <span>{cartItemsCount}</span></Link>
        <Link className="header-link" to="/conta" data-editor-spa-link={editor ? 'true' : undefined} aria-disabled={editor?.editing || undefined} onClick={editor?.editing ? event => event.preventDefault() : undefined}>Conta</Link>
      </div>

      {searchOpen && (
        <form id="galeo-header-search" className="header-search" onSubmit={submitSearch}>
          <div className="header-search-row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por produto, marca ou categoria"
              autoFocus
              aria-label="Buscar produtos"
            />
            <button type="submit">Buscar ↗</button>
          </div>
        </form>
      )}
    </header>
  )
}

function homeSectionContent(sections, key, loaded = false) {
  const section = Array.isArray(sections) ? sections.find((item) => item.key === key) : null
  return { ...(section?.content || {}), __visible: section ? section.visible !== false : !loaded }
}

function EditorialTitle({ text, highlight, type = 'generic' }) {
  return editorialSegments(text, highlight, type).map((part, index) => part.type === 'break'
    ? <br key={index} />
    : part.type === 'highlight' ? <em className="editorial-highlight" key={index}>{part.text}</em> : part.text)
}

function HeroTitle({ text, highlight }) {
  if (highlight === undefined && text === 'Vista o que representa você') return <>
    <span className="hero-title-mask">Vista o que</span><br />
    <span className="hero-title-mask"><em className="editorial-highlight">representa você</em></span>
  </>
  return <span className="hero-title-mask"><EditorialTitle text={text} highlight={highlight} type="hero" /></span>
}

function Home({ products = fallbackProducts, homeSections = [], homeLoaded = false, campaignDefaults, visualDefaults }) {
  const editor = useVisualEditor()
  const editing = Boolean(editor?.editing)
  const hero = homeSectionContent(homeSections, 'hero', homeLoaded)
  const utility = homeSectionContent(homeSections, 'utility', homeLoaded)
  const categorySection = homeSectionContent(homeSections, 'categories', homeLoaded)
  const featured = homeSectionContent(homeSections, 'featured_products', homeLoaded)
  const campaigns = homeSectionContent(homeSections, 'campaigns', homeLoaded)
  const manifesto = homeSectionContent(homeSections, 'manifesto', homeLoaded)
  const newsletter = homeSectionContent(homeSections, 'newsletter', homeLoaded)
  const text = (value, fallback) => typeof value === 'string' ? value : fallback
  const contents = { hero, utility, categories:categorySection, featured_products:featured, campaigns, manifesto, newsletter }
  const field = (key, path, label, value) => {
    const highlightPath = textHighlightPath(path)
    const highlight = highlightPath?.reduce((current, part) => current?.[part], contents[key])
    const children = key === 'hero' && path === 'title'
      ? <HeroTitle text={value} highlight={highlight} />
      : highlightPath ? <EditorialTitle text={value} highlight={highlight} type={editorialType(key, path)} /> : value
    return <EditableText sectionKey={key} path={path} label={label} value={value}>{children}</EditableText>
  }
  const shownProducts = featured?.source === 'manual' && Array.isArray(featured.product_ids)
    ? featured.product_ids.map(id => products.find(product => Number(product.id) === Number(id))).filter(Boolean).slice(0, 8)
    : products.slice(0, 8)
  const campaignItems = (Array.isArray(campaigns.items) ? campaigns.items : [
    { title:'Peças que marcam presença', button_label:'Descobrir agora', button_url:'/shop', media_url:'' },
    { title:'Seu estilo, sem rótulo', button_label:'Ver seleção', button_url:'/shop', media_url:'' },
    { title:'Feito para ser notado', button_label:'Explorar', button_url:'/shop', media_url:'' }
  ]).filter(item => item && typeof item === 'object' && !Array.isArray(item))
  const heroTitle = text(hero.title, 'Vista o que representa você')
  const heroDescription = text(hero.description, 'Curadoria de marcas, peças e estilos para quem não precisa seguir o mesmo caminho')
  const categoryItems = Array.isArray(categorySection.items) ? categorySection.items : MALE_CATEGORIES.slice(0,3).map(title => ({ title, url:'/shop?category=' + encodeURIComponent(title) }))
  const effect = campaignDefaults?.effect || campaigns.defaults?.effect || 'zoom'
  const reveal = editing ? { enabled:false } : visualDefaults?.interaction?.scroll_reveal
  const defaultOrder = ['hero','utility','categories','featured_products','campaigns','manifesto','newsletter']
  const sections = {
    hero: (editing || hero.__visible !== false) && <section data-home-section="hero" className="hero-full section-shell" onClick={editing ? event => { if (!event.target.closest('button,a,[role="button"],textarea,input')) editor.select({sectionKey:'hero',kind:'media'}) } : undefined}>
      <div className="hero-full-media"><HeroVisual mediaUrl={hero.desktop_media_url || ''} mobileUrl={hero.mobile_media_url || ''} videoUrl={hero.video_media_url || ''} effect={effect} speed={campaignDefaults?.speed ?? campaigns.defaults?.speed ?? 'slow'} durationSeconds={campaignDefaults?.duration_seconds ?? campaigns.defaults?.duration_seconds ?? 6} editorPaused={editing} /><div className="hero-full-shade" /></div>
      <EditorMediaButton sectionKey="hero" label="Trocar imagem ou vídeo do Hero" />
      <div className="hero-full-content">
        <h1 className="hero-title"><span className="hero-title-line">{field('hero','title','Título do Hero',heroTitle)}</span></h1>
        <p>{field('hero','description','Descrição do Hero',heroDescription)}</p>
        <div className="hero-full-actions"><EditorLink sectionKey="hero" labelPath="button_label" urlPath="button_url" className="button button-primary" to={hero.button_url || '/shop'}>{text(hero.button_label,'Explorar coleção')} <span>↗</span></EditorLink></div>
      </div>
    </section>,
    utility: (editing || utility.__visible !== false) && <section data-home-section="utility" className="utility-strip section-shell" aria-label="Diferenciais">
      {(Array.isArray(utility.items) ? utility.items : ['Curadoria multimarcas','Compra segura','Envio para todo o Brasil','Novas peças toda semana']).map((item,index) => <span key={index}>{field('utility',['items',index],'Mensagem ' + (index + 1),item)}</span>)}
    </section>,
    categories: (editing || categorySection.__visible !== false) && <section data-home-section="categories" className="section-shell section-block">
      <div className="section-heading row-heading" data-reveal><div><h2>{field('categories','title','Título das categorias',text(categorySection.title,'Escolha seu movimento'))}</h2></div><EditorLink sectionKey="categories" labelPath="button_label" urlPath="button_url" className="text-link" to={categorySection.button_url || '/shop'}>{text(categorySection.button_label,'Ver catálogo')} ↗</EditorLink></div>
      <RevealGrid className="category-grid" items={categoryItems} reveal={reveal}>{categoryItems.map((item,index) => {
        const content = <>{item.media_url && <img className="category-media" src={item.media_url} alt="" loading="lazy" />}<strong>{field('categories',['items',index,'title'],'Nome da categoria ' + (index + 1),text(item.title,'Categoria'))}</strong><small>Explorar ↗</small></>
        const className = 'category-card category-card-' + (index % 3)
        return editing ? <article key={item.id || index} className={className} onClick={() => editor.select({sectionKey:'categories',kind:'category',itemIndex:index})}>{content}<EditorMediaButton sectionKey="categories" kind="category" itemIndex={index} label={'Editar categoria ' + (index + 1)} /></article> : <Link key={item.id || index} className={className} data-editor-spa-link={editor ? 'true' : undefined} to={item.url || '/shop'}>{content}</Link>
      })}</RevealGrid>
    </section>,
    featured_products: (editing || featured.__visible !== false) && (editing || shownProducts.length > 0) && <section data-home-section="featured_products" className="section-shell section-block featured-selection" id="destaques">
      <div className="section-heading row-heading" data-reveal><div><h2>{field('featured_products','title','Título dos destaques',text(featured.title,'Seleção multimarcas'))}</h2></div><EditorLink sectionKey="featured_products" labelPath="button_label" urlPath="button_url" className="text-link" to={featured.button_url || '/shop'}>{text(featured.button_label,'Ver todos')} ↗</EditorLink></div>
      <EditorMediaButton sectionKey="featured_products" kind="products" label="Escolher produtos em destaque" />
      <RevealGrid className="product-grid product-grid-editorial" items={shownProducts} reveal={reveal}>{shownProducts.map((product,index) => <ProductCard key={product.id || index} product={product} />)}</RevealGrid>
      {editing && shownProducts.length === 0 && <p className="visual-editor-empty">Escolha os produtos que aparecerão nesta seção.</p>}
    </section>,
    campaigns: (editing || campaigns.__visible !== false) && <RevealGrid as="section" data-home-section="campaigns" className="section-shell campaign-grid" aria-label="Campanhas" items={campaignItems} reveal={reveal}>
      {campaignItems.map((item,index) => <article className={index === 0 ? 'campaign-card campaign-card-wide' : 'campaign-card'} key={index}>
        <CampaignCarousel item={item} variant={index + 1} defaults={campaignDefaults} sectionDefaults={campaigns.defaults} editorPaused={editing} editorNavigation={Boolean(editor)} onEdit={() => editor?.select({ sectionKey:'campaigns',kind:'campaign',itemIndex:index })}>
          <div className="campaign-card-copy">
            <strong>{field('campaigns',['items',index,'title'],'Título da campanha ' + (index + 1),text(item.title,'Nova campanha'))}</strong>
            <small>{field('campaigns',['items',index,'button_label'],'Texto do botão da campanha ' + (index + 1),text(item.button_label,'Explorar'))} ↗</small>
          </div>
        </CampaignCarousel>
        <EditorMediaButton sectionKey="campaigns" kind="campaign" itemIndex={index} label={'Editar fotos e link da campanha ' + (index + 1)} />
      </article>)}
      {editing && campaignItems.length === 0 && <p className="visual-editor-empty">Use “Opções” da seção para adicionar a primeira campanha.</p>}
    </RevealGrid>,
    manifesto: (editing || manifesto.__visible !== false) && <section data-home-section="manifesto" className="manifesto section-shell" id="sobre" data-reveal>
      <p>{field('manifesto','text','Texto do manifesto',text(manifesto.text,'Não seguimos o padrão\nCriamos o nosso'))}</p>
    </section>,
    newsletter: (editing || newsletter.__visible !== false) && <section data-home-section="newsletter" className="newsletter section-shell" data-reveal>
      <div><h2>{field('newsletter','title','Título da newsletter',text(newsletter.title,'Entre para a próxima fase'))}</h2></div>
      {editing ? <div className="newsletter-signup"><div className="visual-editor-newsletter"><input type="email" placeholder="Seu melhor e-mail" aria-label="Prévia do campo de e-mail" disabled /><span>{field('newsletter','button_label','Texto do botão da newsletter',text(newsletter.button_label,'Entrar'))} ↗</span></div><small>Prévia do formulário de novidades</small></div> : <NewsletterSignup buttonLabel={text(newsletter.button_label,'Entrar')} />}
    </section>
  }
  const orderedKeys = homeLoaded ? [...homeSections].sort((a,b) => Number(a.order || 0) - Number(b.order || 0)).map(section => section.key).filter(key => defaultOrder.includes(key)) : defaultOrder
  return <main>{orderedKeys.map(key => <EditableSection key={key} sectionKey={key}>{sections[key]}</EditableSection>)}</main>
}

function StorefrontMotionGate(props) {
  const editor = useVisualEditor()
  return editor?.editing ? null : <StorefrontMotion {...props} />
}

function StoreFooter({ footer }) {
  const editor = useVisualEditor()
  return <footer className="site-footer">
    <span>{footer?.brand || 'GALEO STORE'}</span><span>© {footer?.year || '2026'}</span>
    {editor?.editing && <button type="button" className="visual-editor-footer-button" onClick={() => editor.select({kind:'settings',tab:'footer'})}>Editar rodapé</button>}
  </footer>
}

function ProductCard({ product }) {
  const editor = useVisualEditor()
  const image = product?.image || '/images/product-placeholder.svg'
  return (
    <Link className="product-card" to={'/produto/' + product.id} data-editor-spa-link={editor ? 'true' : undefined} onClick={editor?.editing ? event => { event.preventDefault(); editor.select({sectionKey:'featured_products',kind:'products'}) } : undefined}>
      <div className="product-image">
        <img src={image} alt="" loading="lazy" />
        <span className="product-arrow">↗</span>
      </div>
      <div className="product-meta">
        <span>{product?.category || 'Sem categoria'}</span>
        <strong>{product?.name || 'Produto'}</strong>
        <b>{formatProductPrice(product?.price)}</b>
      </div>
    </Link>
  )
}

const normalizeSearchText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

function Shop({ products = fallbackProducts, categories = [], visualDefaults }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCategory = searchParams.get('category') || 'Todos'
  const selectedBrand = searchParams.get('brand') || ''
  const selectedSize = searchParams.get('size') || ''
  const onlyAvailable = searchParams.get('stock') === 'available'
  const query = searchParams.get('q') || ''
  const [searchInput, setSearchInput] = useState(query)
  const [sort, setSort] = useState('latest')
  const availableBrands = useMemo(() => [...new Set(products.map(product => String(product.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [products])
  const availableSizes = useMemo(() => [...new Set(products.flatMap(product => activeProductVariants(product).filter(variant => Number(variant.stock) > 0).map(variant => variant.size)))].sort(compareSizes), [products])

  useEffect(() => {
    setSearchInput(query)
  }, [query])

  const availableCategories = useMemo(() => MALE_CATEGORIES.map((name, index) => (
    categories.find(category => normalizeSearchText(category.name) === normalizeSearchText(name)) || {
      id: 'catalog-' + index,
      name,
      sort_order: (index + 1) * 10
    }
  )), [categories])

  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)

    const result = products.filter((product) => {
      const categoryMatch = selectedCategory === 'Todos' || normalizeSearchText(product?.category) === normalizeSearchText(selectedCategory)
      if (!categoryMatch) return false
      if (selectedBrand && normalizeSearchText(product.brand) !== normalizeSearchText(selectedBrand)) return false
      if (selectedSize && !activeProductVariants(product).some(variant => normalizeSearchText(variant.size) === normalizeSearchText(selectedSize) && Number(variant.stock) > 0)) return false
      if (onlyAvailable && Number(product.stock) < 1) return false
      if (!normalizedQuery) return true

      const haystack = [
        product?.name,
        product?.brand,
        product?.category,
        product?.description
      ].map(normalizeSearchText).join(' ')

      return haystack.includes(normalizedQuery)
    })

    return [...result].sort((a, b) => {
      if (sort === 'size-asc' || sort === 'size-desc') {
        const sizeOf = product => activeProductVariants(product).filter(variant => Number(variant.stock) > 0).map(variant => variant.size).sort(compareSizes)[0]
        const aSize = sizeOf(a), bSize = sizeOf(b)
        if (Boolean(aSize) !== Boolean(bSize)) return aSize ? -1 : 1
        if (aSize && bSize) return compareSizes(aSize, bSize) * (sort === 'size-desc' ? -1 : 1)
      }
      if (sort === 'price-asc' || sort === 'price-desc') {
        if (productHasPrice(a) !== productHasPrice(b)) return productHasPrice(a) ? -1 : 1
      }
      if (sort === 'price-asc') return Number(a.price || 0) - Number(b.price || 0)
      if (sort === 'price-desc') return Number(b.price || 0) - Number(a.price || 0)
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
      if (sort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''), 'pt-BR')
      if (sort === 'brand') return String(a.brand || '').localeCompare(String(b.brand || ''), 'pt-BR')
      if (sort === 'stock-desc') return Number(b.stock || 0) - Number(a.stock || 0)
      return Number(b.id || 0) - Number(a.id || 0)
    })
  }, [products, selectedCategory, selectedBrand, selectedSize, onlyAvailable, query, sort])

  function selectRefinement(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  function selectCategory(category) {
    const next = new URLSearchParams(searchParams)
    if (category === 'Todos') next.delete('category')
    else next.set('category', category)
    setSearchParams(next)
  }

  function submitSearch(event) {
    event.preventDefault()
    const value = searchInput.trim()
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value)
    else next.delete('q')
    setSearchParams(next)
  }

  function clearSearch() {
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchInput('')
    setSearchParams(next)
  }

  return (
    <main className="section-shell page-space">
      <div className="page-heading" data-reveal>
        <h1>Descubra<br /><em>seu próximo kit</em></h1>
      </div>

      <form className="catalog-search" onSubmit={submitSearch} data-reveal>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l5 5" />
        </svg>
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Buscar produto, marca ou categoria"
          aria-label="Buscar produto, marca ou categoria"
        />
        {searchInput && (
          <button type="button" className="catalog-search-clear" onClick={clearSearch} aria-label="Limpar busca">×</button>
        )}
        <button type="submit">Buscar ↗</button>
      </form>

      <div className="catalog-summary" aria-live="polite">
        <span>{filteredProducts.length} produto(s)</span>
        {query && <strong>Busca: “{query}”</strong>}
      </div>

      <div className="filters" data-reveal>
        <button
          type="button"
          className={selectedCategory === 'Todos' ? 'filter-active' : ''}
          onClick={() => selectCategory('Todos')}
        >
          Todos
        </button>
        {availableCategories.map((category) => (
          <button
            type="button"
            key={category.id}
            className={normalizeSearchText(selectedCategory) === normalizeSearchText(category.name) ? 'filter-active' : ''}
            onClick={() => selectCategory(category.name)}
          >
            {category.name}
          </button>
        ))}
        <span />
        <label className="catalog-sort">
          <span>Ordenar</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Ordenar produtos">
            <option value="latest">Mais recentes</option>
            <option value="name">Nome</option>
            <option value="name-desc">Nome: Z a A</option>
            <option value="brand">Marca</option>
            <option value="price-asc">Menor preço</option>
            <option value="price-desc">Maior preço</option>
            <option value="stock-desc">Maior disponibilidade</option>
            <option value="size-asc">Tamanho: menor ao maior</option>
            <option value="size-desc">Tamanho: maior ao menor</option>
          </select>
        </label>
      </div>

      <div className="catalog-refinements">
        <label>Marca<select aria-label="Filtrar por marca" value={selectedBrand} onChange={event => selectRefinement('brand', event.target.value)}><option value="">Todas as marcas</option>{availableBrands.map(brand => <option key={brand} value={brand}>{brand}</option>)}</select></label>
        <label>Tamanho disponível<select aria-label="Filtrar por tamanho" value={selectedSize} onChange={event => selectRefinement('size', event.target.value)} disabled={!availableSizes.length && !selectedSize}><option value="">Todos os tamanhos</option>{selectedSize && !availableSizes.includes(selectedSize) && <option value={selectedSize}>{selectedSize}</option>}{availableSizes.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <label>Disponibilidade<select aria-label="Filtrar por disponibilidade" value={onlyAvailable ? 'available' : ''} onChange={event => selectRefinement('stock', event.target.value)}><option value="">Todos os produtos</option><option value="available">Com estoque</option></select></label>
      </div>

      {filteredProducts.length > 0 ? (
        <RevealGrid className="product-grid" items={filteredProducts} reveal={visualDefaults?.interaction?.scroll_reveal}>
          {filteredProducts.map((product) => <ProductCard key={product.id} product={product} />)}
        </RevealGrid>
      ) : (
        <div className="empty-catalog" data-reveal>
          <h2>Nada encontrado.</h2>
          <p>Tente outra busca ou escolha uma categoria diferente.</p>
          <button type="button" className="button button-primary" onClick={() => {
            setSearchInput('')
            setSearchParams({})
          }}>
            Limpar filtros ↗
          </button>
        </div>
      )}
    </main>
  )
}

function PlaceholderPage({ title }) {
  return (
    <main className="section-shell page-space">
      <h1>{title}</h1>
      <p className="page-note">Estrutura preparada para a próxima etapa do projeto.</p>
    </main>
  )
}

export default function App() {
  const { pathname, key:visitKey } = useLocation()
  const adminRoute = /^\/admin(?:\/|$)/i.test(pathname)
  const previewMode = new URLSearchParams(window.location.search).get('preview') === 'draft'
  const visualMode = previewMode && pathname === '/' && new URLSearchParams(window.location.search).get('edit') === '1'
  const [previewDenied, setPreviewDenied] = useState(false)
  const [themePreference, setThemePreference] = useState(() => {
    if (visualMode) return null
    const requestedTheme = new URLSearchParams(window.location.search).get('theme')
    if (requestedTheme === 'light' || requestedTheme === 'dark') return requestedTheme
    try {
      const savedTheme = localStorage.getItem('galeo-theme')
      return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : null
    } catch { return null }
  })
  const [catalog, setCatalog] = useState([])
  const [categories, setCategories] = useState([])
  const [catalogError, setCatalogError] = useState('')
  const [homeSections, setHomeSections] = useState([])
  const [homeLoaded, setHomeLoaded] = useState(false)
  const [homeSource, setHomeSource] = useState(null)
  const [homeVisit, setHomeVisit] = useState(null)
  const [homeError, setHomeError] = useState('')
  const [homeAttempt, setHomeAttempt] = useState(0)
  const [siteSettings, setSiteSettings] = useState({})
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsSource, setSettingsSource] = useState(null)
  const defaultTheme = siteSettings.storefront_visual_defaults?.theme
  const theme = themePreference || (defaultTheme === 'light' ? 'light' : 'dark')
  const [cartItemsCount, setCartItemsCount] = useState(() => cartCount(readCart()))
  const needsCatalog = !adminRoute && (pathname === '/' || pathname === '/shop')
  const needsHome = !adminRoute && pathname === '/'
  const homeVisitKey = needsHome ? (previewMode ? 'draft:' : 'published:') + visitKey : null
  const homeReady = homeLoaded && homeVisit === homeVisitKey && homeSource === (previewMode ? 'draft' : 'published')

  useEffect(() => {
    const syncCart = () => setCartItemsCount(cartCount(readCart()))
    window.addEventListener('galeo-cart-updated', syncCart)
    return () => window.removeEventListener('galeo-cart-updated', syncCart)
  }, [])

  useEffect(() => {
    if (!needsCatalog) return undefined
    let active = true
    async function loadCatalog() {
      setCatalogError('')
      const catalogPath = '/api/store'
      const endpoints = [...new Set([STORE_API_BASE + catalogPath, catalogPath])]
      for (const endpoint of endpoints) {
        try {
          const data = await loadStorefrontJson(endpoint)
          if (!active) return
          setCatalog(Array.isArray(data?.products) ? data.products : [])
          setCategories(Array.isArray(data?.categories) ? data.categories : [])
          return
        } catch {}
      }
      if (active) {
        setCatalog([])
        setCategories([])
        setCatalogError('Não foi possível carregar o catálogo agora.')
      }
    }
    loadCatalog()
    return () => { active = false }
  }, [needsCatalog])

  useEffect(() => {
    // When leaving the owner preview, replace its in-memory data with the public
    // document too. Ordinary catalog/product visits do not fetch the Home.
    if (!needsHome && (previewMode || homeSource !== 'draft' || adminRoute)) return undefined
    let active = true
    const source = previewMode ? 'draft' : 'published'
    setHomeError('')
    setHomeLoaded(false)
    if (previewMode) setPreviewDenied(false)
    async function loadHome() {
      try {
        const data = await loadStorefrontJson(previewMode ? '/api/admin/home' : '/api/store/home', { credentials:'include' })
        if (!active) return
        const sections = Array.isArray(data?.sections) ? data.sections : []
        setHomeSections(previewMode ? sections.map(section => ({ ...section, content:section.draft })) : sections)
        setHomeSource(source)
        setHomeVisit(homeVisitKey)
        setHomeLoaded(true)
      } catch {
        if (!active) return
        if (previewMode) setPreviewDenied(true)
        else setHomeError('Não foi possível carregar a página inicial. Tente novamente.')
      }
    }
    loadHome()
    return () => { active = false }
  }, [homeVisitKey, previewMode, homeAttempt])

  useEffect(() => {
    if (adminRoute) return undefined
    let active = true
    setSettingsLoaded(false)
    loadStorefrontJson(previewMode ? '/api/admin/home/settings' : '/api/store/home/settings', { credentials:'include' })
      .then(data => {
        if (active) {
          setSiteSettings(Object.fromEntries((Array.isArray(data?.settings) ? data.settings : []).map(item => [item.key, item.value])))
          setSettingsSource(previewMode ? 'draft' : 'published')
          setSettingsLoaded(true)
        }
      })
      .catch(() => { if (active && previewMode) setPreviewDenied(true) })
    return () => { active = false }
  }, [adminRoute, previewMode])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (themePreference) {
      try { localStorage.setItem('galeo-theme', themePreference) } catch {}
    }
  }, [theme, themePreference])

  useEffect(() => {
    const palette = siteSettings.storefront_visual_defaults?.palette || {}
    const root = document.documentElement
    const vars = { background:'--bg', surface:'--surface', surface_alt:'--surface-2', text:'--text', muted:'--muted', accent:'--accent', accent_soft:'--accent-soft', accent_deep:'--accent-deep', line:'--line' }

    if (theme === 'light') {
      Object.values(vars).forEach((cssVar) => root.style.removeProperty(cssVar))
      return
    }

    Object.entries(vars).forEach(([key, cssVar]) => {
      if (palette[key]) root.style.setProperty(cssVar, palette[key])
    })
  }, [siteSettings, theme])

  const storefront = (
    <div className="app">
      <RouteScroll />
      {!adminRoute && <div className="scroll-progress" aria-hidden="true"><span /></div>}
      {!adminRoute && catalogError && <div className="catalog-global-error" role="status">{catalogError}</div>}
      {previewDenied && previewMode && (
        <div className="draft-preview-denied" role="alert">
          <strong>Pré-visualização indisponível</strong>
          <span>Abra esta visualização enquanto estiver conectado ao painel administrativo como proprietário</span>
        </div>
      )}
      {previewMode && !visualMode && !previewDenied && (
        <div className="draft-preview-bar" role="status">
          <span><strong>RASCUNHO</strong> esta versão ainda não está publicada</span>
          <a href="/admin?tab=editor">Voltar ao editor</a>
          <a href="/?preview=draft&edit=1">Editar nesta página</a>
        </div>
      )}

      <KeepAliveSocket />
      {!adminRoute && (!needsHome || homeReady) && <StorefrontMotionGate homeSections={homeSections} visualDefaults={siteSettings.storefront_visual_defaults} campaignDefaults={siteSettings.campaign_defaults} />}
      {!adminRoute && <Header
        theme={theme}
        categories={categories}
        navigation={siteSettings.navigation}
        cartItemsCount={cartItemsCount}
        onToggle={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
      />}
      <Suspense fallback={<PageLoading />}><Routes>
        <Route path="/admin/*" element={<AdminGate />} />
        <Route path="/" element={homeReady ? <Home products={catalog} homeSections={homeSections} homeLoaded={homeLoaded} campaignDefaults={siteSettings.campaign_defaults} visualDefaults={siteSettings.storefront_visual_defaults} /> : homeError ? <main className="section-shell page-space" style={{ minHeight:'70svh' }}><p className="page-note" role="alert">{homeError}</p><button type="button" className="button button-primary" onClick={() => setHomeAttempt(attempt => attempt + 1)}>Tentar novamente</button></main> : <PageLoading message="Carregando loja…" />} />
        <Route path="/shop" element={<Shop products={catalog} categories={categories} visualDefaults={siteSettings.storefront_visual_defaults} />} />
        <Route path="/produto/:id" element={<ProductPage />} />
        <Route path="/conta" element={<AccountPage />} />
        <Route path="/newsletter" element={<NewsletterConfirmation />} />
        <Route path="/carrinho" element={<CartPage />} />
      </Routes></Suspense>
      {!adminRoute && <StoreFooter footer={siteSettings.footer} />}
    </div>
  )
  if (!visualMode) return storefront
  if (previewDenied) return <main className="section-shell page-space"><h1>Editor indisponível</h1><p role="alert">Entre no painel com a conta de proprietário para editar o rascunho.</p><a className="button button-primary" href="/admin">Entrar no painel</a></main>
  if (!homeReady || !settingsLoaded || settingsSource !== 'draft') return <main className="section-shell page-space"><p role="status">Carregando o rascunho da loja…</p></main>
  return <VisualHomeEditor sections={homeSections} settings={siteSettings} products={catalog} onSectionsChange={setHomeSections} onSettingsChange={next => { setThemePreference(null); setSiteSettings(next) }}>{storefront}</VisualHomeEditor>
}
