import { useEffect, useMemo, useState } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import AdminGate from './Admin'
import ProductPage from './ProductPage'
import CartPage from './CartPage'
import AccountPage from './AccountPage'
import { cartCount, readCart } from './storeApi'

const PUBLIC_API_BASE = 'https://galeo-api-go.onrender.com'

const MALE_CATEGORIES = ['Camisetas', 'Calças', 'Camisas', 'Moletons', 'Bermudas', 'Casacos', 'Calçados', 'Acessórios']

const fallbackProducts = [
  { id: 1, name: 'Camiseta Essential', category: 'Camisetas', price: 129.9, image: '/images/product-placeholder.svg' },
  { id: 2, name: 'Moletom Galeo Core', category: 'Moletons', price: 219.9, image: '/images/product-placeholder.svg' },
  { id: 3, name: 'Camiseta Oversized', category: 'Camisetas', price: 149.9, image: '/images/product-placeholder.svg' },
  { id: 4, name: 'Shoulder Bag', category: 'Acessórios', price: 99.9, image: '/images/product-placeholder.svg' },
  { id: 5, name: 'Calça Essential', category: 'Calças', price: 189.9, image: '/images/product-placeholder.svg' },
  { id: 6, name: 'Tênis Urban', category: 'Tênis', price: 299.9, image: '/images/product-placeholder.svg' }
]

function StorefrontMotion() {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return undefined

    gsap.registerPlugin(ScrollTrigger)

    const lenis = new Lenis({
      duration: 1.05,
      wheelMultiplier: 0.95,
      smoothWheel: true,
      autoRaf: false
    })

    const header = document.querySelector('.site-header')
    const updateScrollChrome = ({ scroll }) => {
      if (header) header.classList.toggle('is-scrolled', scroll > 24)

      const documentHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress = documentHeight > 0 ? Math.min(1, Math.max(0, scroll / documentHeight)) : 0
      document.documentElement.style.setProperty('--scroll-progress', String(progress))
    }

    lenis.on('scroll', updateScrollChrome)
    const raf = (time) => lenis.raf(time * 1000)
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)

    const ctx = gsap.context(() => {
      gsap.utils.toArray('[data-reveal]').forEach((element) => {
        gsap.fromTo(
          element,
          { autoAlpha: 0, y: 24 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.8,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: element,
              start: 'top 86%',
              once: true
            }
          }
        )
      })

      const staggerGroups = ['.category-card', '.product-card', '.campaign-card']
      staggerGroups.forEach((selector) => {
        const elements = gsap.utils.toArray(selector)
        if (!elements.length) return
        gsap.fromTo(
          elements,
          { autoAlpha: 0, y: 26 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.75,
            stagger: 0.06,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: elements[0],
              start: 'top 88%',
              once: true
            }
          }
        )
      })

      gsap.to('.hero-full-media', {
        yPercent: 5,
        scale: 1.045,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero-full',
          start: 'top top',
          end: 'bottom top',
          scrub: true
        }
      })

      gsap.to('.hero-full-content', {
        y: -22,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero-full',
          start: 'top top',
          end: 'bottom top',
          scrub: true
        }
      })

      gsap.from('.hero-full .hero-title-mask', {
        yPercent: 120,
        duration: 0.9,
        stagger: 0.08,
        ease: 'power4.out',
        delay: 0.12
      })

      gsap.from('.hero-full .eyebrow, .hero-full p, .hero-full-actions, .hero-full-meta', {
        autoAlpha: 0,
        y: 18,
        duration: 0.7,
        stagger: 0.08,
        ease: 'power2.out',
        delay: 0.3
      })

      gsap.utils.toArray('.campaign-card').forEach((card) => {
        const visual = card.querySelector('.campaign-visual')
        if (!visual) return
        gsap.to(visual, {
          scale: 1.055,
          xPercent: 1.5,
          yPercent: -1.5,
          ease: 'none',
          scrollTrigger: {
            trigger: card,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true
          }
        })
      })

      gsap.utils.toArray('.manifesto p').forEach((element) => {
        gsap.fromTo(
          element,
          { xPercent: -5 },
          {
            xPercent: 0,
            ease: 'none',
            scrollTrigger: {
              trigger: element,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true
            }
          }
        )
      })

      ScrollTrigger.refresh()
    })

    return () => {
      lenis.off('scroll', updateScrollChrome)
      gsap.ticker.remove(raf)
      lenis.destroy()
      ctx.revert()
    }
  }, [])

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
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')

  const primaryCategories = Array.isArray(navigation?.items) && navigation.items.length ? navigation.items.slice(0, 8).map((item, index) => ({ id: 'cms-menu-' + index, name: item.label, url: item.url || '/shop' })) : MALE_CATEGORIES.slice(0, 4).map((name, index) => ({ id: 'menu-' + index, name, url: '/shop?category=' + encodeURIComponent(name) }))

  function goToCategory(category) {
    navigate(category.url || '/shop')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function submitSearch(event) {
    event.preventDefault()
    const value = search.trim()
    navigate(value ? '/shop?q=' + encodeURIComponent(value) : '/shop')
    setSearchOpen(false)
  }

  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Galeo Store">
        <span className="brand-logo-wrap">
          <img className="brand-logo" src="/images/galeo-brand.png" alt="GALEO" />
        </span>
        <span className="brand-wordmark">GALEO</span>
      </Link>

      <nav className="desktop-nav" aria-label="Categorias principais">
        {primaryCategories.map((category) => (
          <Link key={category.id} to={category.url}>
            {category.name}
          </Link>
        ))}
        <Link to="/shop">Catálogo</Link>
      </nav>

      <div className="header-actions">
        <button
          className={'search-trigger' + (searchOpen ? ' is-open' : '')}
          type="button"
          onClick={() => setSearchOpen(value => !value)}
          aria-expanded={searchOpen}
          aria-label={searchOpen ? 'Fechar busca' : 'Abrir busca'}
          title={searchOpen ? 'Fechar busca' : 'Buscar produtos'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l5 5" />
          </svg>
        </button>
        <ModeButton theme={theme} onToggle={onToggle} />
        <Link className="bag-link" to="/carrinho">Carrinho <span>{cartItemsCount}</span></Link>
        <Link className="header-link" to="/conta">Conta</Link>
      </div>

      {searchOpen && (
        <form className="header-search" onSubmit={submitSearch}>
          <span className="eyebrow">GALEO / BUSCA</span>
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

function homeSectionContent(sections, key) {
  const section = Array.isArray(sections) ? sections.find((item) => item.key === key) : null
  return { ...(section?.content || {}), __visible: section ? section.visible !== false : true }
}

function splitEditorialText(text) {
  return String(text || '').split(/\n+/).filter(Boolean)
}

function EditorialTitle({ text, type = 'generic' }) {
  const value = String(text || '')
  if (type === 'hero' && value === 'Vista o que representa você') {
    return <>Vista o que<br /><em>representa você</em></>
  }
  if (type === 'featured' && value === 'Seleção multimarcas') {
    return <>Seleção <em>multimarcas</em></>
  }
  if (type === 'campaign' && value === 'Peças que marcam presença') {
    return <>Peças que<br /><em>marcam presença</em></>
  }
  if (type === 'campaign' && value === 'Seu estilo, sem rótulo') {
    return <>Seu estilo,<br /><em>sem rótulo</em></>
  }
  if (type === 'campaign' && value === 'Feito para ser notado') {
    return <>Feito para<br /><em>ser notado</em></>
  }
  if (type === 'manifesto' && value === 'Não seguimos o padrão Criamos o nosso') {
    return <>Não seguimos o padrão<br /><em>Criamos o nosso</em></>
  }
  return value
}

function CampaignVisual({ variant = 0, mediaUrl = '', videoUrl = '', alt = '' }) {
  return (
    <div className={'campaign-visual campaign-visual-' + variant} aria-hidden={alt ? undefined : 'true'}>
      <div className="campaign-orb" />
      <div className="campaign-line campaign-line-a" />
      <div className="campaign-line campaign-line-b" />
      {videoUrl ? <video className="campaign-media campaign-video" src={videoUrl} autoPlay muted loop playsInline /> : mediaUrl ? <img src={mediaUrl} alt={alt} className="campaign-media campaign-brand-image" loading="lazy" /> : <img src="/images/galeo-brand.png" alt="" className="campaign-brand-image" />}
      <div className="campaign-scan" />
    </div>
  )
}

function Home({ products = fallbackProducts, homeSections = [] }) {
  const hero = homeSectionContent(homeSections, 'hero')
  const utility = homeSectionContent(homeSections, 'utility')
  const featured = homeSectionContent(homeSections, 'featured_products')
  const campaigns = homeSectionContent(homeSections, 'campaigns')
  const manifesto = homeSectionContent(homeSections, 'manifesto')
  const newsletter = homeSectionContent(homeSections, 'newsletter')

  const shownProducts = featured?.source === 'manual' && Array.isArray(featured.product_ids) && featured.product_ids.length
    ? featured.product_ids.map((id) => products.find((product) => Number(product.id) === Number(id))).filter(Boolean).slice(0, 8)
    : products.slice(0, 8)

  const campaignItems = Array.isArray(campaigns.items) && campaigns.items.length ? campaigns.items : [
    { eyebrow:'NEW DROPS', title:'Peças que marcam presença', button_label:'Descobrir agora', button_url:'/shop', media_url:'' },
    { eyebrow:'PREMIUM SELECTION', title:'Seu estilo, sem rótulo', button_label:'Ver seleção', button_url:'/shop', media_url:'' },
    { eyebrow:'LIMITED EDITION', title:'Feito para ser notado', button_label:'Explorar', button_url:'/shop', media_url:'' }
  ]

  const heroTitle = hero.title || 'Vista o que representa você'
  const heroDescription = hero.description || 'Curadoria de marcas, peças e estilos para quem não precisa seguir o mesmo caminho'
  return (
    <main>
      {hero.__visible !== false && <section className="hero-full section-shell">
        <div className="hero-full-media"><CampaignVisual mediaUrl={hero.desktop_media_url || ''} videoUrl={hero.video_media_url || ''} /><div className="hero-full-shade" /></div>
        <div className="hero-full-content">
          <span className="eyebrow">{hero.eyebrow || 'GALEO / MULTIBRAND STORE'}</span>
          <h1 className="hero-title">
            <span className="hero-title-line"><span className="hero-title-mask"><EditorialTitle text={heroTitle} type="hero" /></span></span>
          </h1>
          <p>{heroDescription}</p>
          <div className="hero-full-actions"><Link className="button button-primary" to={hero.button_url || '/shop'}>{hero.button_label || 'Explorar coleção'} <span>↗</span></Link><span className="hero-scroll">SCROLL ↓</span></div>
        </div>
        <div className="hero-full-meta"><span>01 / 03</span><span>São Paulo / BR</span></div>
      </section>}

      {utility.__visible !== false && <section className="utility-strip section-shell" aria-label="Diferenciais">
        {(Array.isArray(utility.items) && utility.items.length ? utility.items : ['Curadoria multimarcas','Compra segura','Envio para todo o Brasil','Novas peças toda semana']).map((item,index) => <span key={index}>{item}</span>)}
      </section>}

      {featured.__visible !== false && <section className="section-shell section-block featured-selection" id="destaques">
        <div className="section-heading row-heading" data-reveal><div><span className="eyebrow">{featured.eyebrow || '01 / SELEÇÃO GALEO'}</span><h2><EditorialTitle text={featured.title || 'Seleção multimarcas'} type="featured" /></h2></div><Link className="text-link" to={featured.button_url || '/shop'}>{featured.button_label || 'Ver todos'} ↗</Link></div>
        <div className="product-grid product-grid-editorial">{shownProducts.map((product,index) => <ProductCard key={product.id || index} product={product} index={index} />)}</div>
      </section>}

      {campaigns.__visible !== false && <section className="section-shell campaign-grid" aria-label="Campanhas" data-reveal>
        {campaignItems.slice(0,3).map((item,index) => (
          <Link className={index === 0 ? 'campaign-card campaign-card-wide' : 'campaign-card'} to={item.button_url || '/shop'} key={index}>
            <CampaignVisual variant={index + 1} mediaUrl={item.media_url || ''} />
            <div className="campaign-card-copy">
              <span>{item.eyebrow || 'GALEO / CAMPANHA'}</span>
              <strong><EditorialTitle text={item.title || 'Nova campanha'} type="campaign" /></strong>
              <small>{item.button_label || 'Explorar'} ↗</small>
            </div>
          </Link>
        ))}
      </section>}

      {manifesto.__visible !== false && (
        <section className="manifesto section-shell" id="sobre" data-reveal>
          <span className="eyebrow">{manifesto.eyebrow || '03 / SOBRE A GALEO'}</span>
          <p><EditorialTitle text={manifesto.text || 'Não seguimos o padrão\nCriamos o nosso'} type="manifesto" /></p>
        </section>
      )}

      {newsletter.__visible !== false && (
        <section className="newsletter section-shell" data-reveal>
          <div><span className="eyebrow">{newsletter.eyebrow || 'GALEO / INSIDER'}</span><h2>{newsletter.title || 'Entre para a próxima fase'}</h2></div>
          <form onSubmit={event => event.preventDefault()}><input type="email" placeholder="Seu melhor e-mail" aria-label="Seu melhor e-mail" /><button type="submit">{newsletter.button_label || 'Entrar'} ↗</button></form>
        </section>
      )}

    </main>
  )
}

function ProductCard({ product, index = 0 }) {
  const price = Number(product?.price || 0)
  const image = product?.image || '/images/product-placeholder.svg'
  return (
    <Link className="product-card" to={'/produto/' + product.id}>
      <div className="product-image">
        <img src={image} alt="" loading="lazy" />
        <span className="product-index">0{index + 1}</span>
        <span className="product-arrow">↗</span>
      </div>
      <div className="product-meta">
        <span>{product?.category || 'Sem categoria'}</span>
        <strong>{product?.name || 'Produto'}</strong>
        <b>R$ {price.toFixed(2).replace('.', ',')}</b>
      </div>
    </Link>
  )
}

const normalizeSearchText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

function Shop({ products = fallbackProducts, categories = [] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCategory = searchParams.get('category') || 'Todos'
  const query = searchParams.get('q') || ''
  const [searchInput, setSearchInput] = useState(query)
  const [sort, setSort] = useState('latest')

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
      if (sort === 'price-asc') return Number(a.price || 0) - Number(b.price || 0)
      if (sort === 'price-desc') return Number(b.price || 0) - Number(a.price || 0)
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
      return Number(b.id || 0) - Number(a.id || 0)
    })
  }, [products, selectedCategory, query, sort])

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
        <span className="eyebrow">GALEO / SHOP</span>
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
            <option value="price-asc">Menor preço</option>
            <option value="price-desc">Maior preço</option>
          </select>
        </label>
      </div>

      {filteredProducts.length > 0 ? (
        <div className="product-grid" data-reveal>
          {filteredProducts.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      ) : (
        <div className="empty-catalog" data-reveal>
          <span className="eyebrow">GALEO / SEM RESULTADOS</span>
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

function PlaceholderPage({ title, label }) {
  return (
    <main className="section-shell page-space">
      <span className="eyebrow">{label || 'GALEO'}</span>
      <h1>{title}</h1>
      <p className="page-note">Estrutura preparada para a próxima etapa do projeto.</p>
    </main>
  )
}

export default function App() {
  const previewMode = new URLSearchParams(window.location.search).get('preview') === 'draft'
  const [previewDenied, setPreviewDenied] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('galeo-theme') || 'dark')
  const [catalog, setCatalog] = useState([])
  const [categories, setCategories] = useState([])
  const [catalogError, setCatalogError] = useState('')
  const [homeSections, setHomeSections] = useState([])
  const [siteSettings, setSiteSettings] = useState({})
  const [cartItemsCount, setCartItemsCount] = useState(() => cartCount(readCart()))

  useEffect(() => {
    const syncCart = () => setCartItemsCount(cartCount(readCart()))
    window.addEventListener('galeo-cart-updated', syncCart)
    return () => window.removeEventListener('galeo-cart-updated', syncCart)
  }, [])

  useEffect(() => {
    let active = true

    async function loadCatalog() {
      setCatalogError('')
      const endpoints = [PUBLIC_API_BASE + '/api/store?ts=' + Date.now(), '/api/store?ts=' + Date.now()]
      let catalogLoaded = false

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, { cache:'no-store', headers:{ Accept:'application/json' } })
          if (!response.ok) continue
          const data = await response.json()
          if (!active) return
          setCatalog(Array.isArray(data?.products) ? data.products : [])
          setCategories(Array.isArray(data?.categories) ? data.categories : [])
          catalogLoaded = true
          break
        } catch {}
      }

      if (!catalogLoaded && active) {
        setCatalog([])
        setCategories([])
        setCatalogError('Não foi possível carregar o catálogo agora.')
      }

      try {
        const homeEndpoint = previewMode ? '/api/admin/home' : '/api/store/home'
        const settingsEndpoint = previewMode ? '/api/admin/home/settings' : '/api/store/home/settings'
        const [homeResponse, settingsResponse] = await Promise.all([
          fetch(homeEndpoint + '?ts=' + Date.now(), { cache:'no-store', credentials:'include', headers:{ Accept:'application/json' } }),
          fetch(settingsEndpoint + '?ts=' + Date.now(), { cache:'no-store', credentials:'include', headers:{ Accept:'application/json' } })
        ])

        if (previewMode && (!homeResponse.ok || !settingsResponse.ok)) {
          if (active) setPreviewDenied(true)
          return
        }

        if (homeResponse.ok) {
          const homeData = await homeResponse.json()
          const sections = previewMode
            ? (Array.isArray(homeData?.sections) ? homeData.sections.map((section) => ({ ...section, content: section.draft })) : [])
            : (Array.isArray(homeData?.sections) ? homeData.sections : [])
          if (active) setHomeSections(sections)
        }

        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json()
          if (active) setSiteSettings(Object.fromEntries((settingsData?.settings || []).map((item) => [item.key, item.value])))
        }
      } catch {
        if (previewMode && active) setPreviewDenied(true)
      }
    }

    loadCatalog()
    return () => { active = false }
  }, [previewMode])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('galeo-theme', theme)
  }, [theme])

  useEffect(() => {
    const palette = siteSettings.storefront_visual_defaults?.palette || {}
    const root = document.documentElement
    const vars = { background:'--bg', surface:'--surface', surface_alt:'--surface-2', text:'--text', muted:'--muted', accent:'--accent', accent_soft:'--accent-soft', accent_deep:'--accent-deep', line:'--line' }
    Object.entries(vars).forEach(([key, cssVar]) => { if (palette[key]) root.style.setProperty(cssVar, palette[key]) })
  }, [siteSettings])

  return (
    <div className="app">
      <div className="scroll-progress" aria-hidden="true"><span /></div>
      {catalogError && <div className="catalog-global-error" role="status">{catalogError}</div>}
      {previewDenied && previewMode && (
        <div className="draft-preview-denied" role="alert">
          <strong>Pré-visualização indisponível</strong>
          <span>Abra esta visualização enquanto estiver conectado ao painel administrativo como proprietário</span>
        </div>
      )}
      {previewMode && !previewDenied && (
        <div className="draft-preview-bar" role="status">
          <span><strong>RASCUNHO</strong> esta versão ainda não está publicada</span>
          <a href="/admin?tab=editor">Voltar ao editor</a>
        </div>
      )}

      <StorefrontMotion />
      <Header
        theme={theme}
        categories={categories}
        navigation={siteSettings.navigation}
        cartItemsCount={cartItemsCount}
        onToggle={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
      />
      <Routes>
        <Route path="/admin/*" element={<AdminGate />} />
        <Route path="/" element={<Home products={catalog} homeSections={homeSections} />} />
        <Route path="/shop" element={<Shop products={catalog} categories={categories} />} />
        <Route path="/produto/:id" element={<ProductPage />} />
        <Route path="/conta" element={<AccountPage />} />
        <Route path="/carrinho" element={<CartPage />} />
      </Routes>
      <footer className="site-footer">
        <span>{siteSettings.footer?.brand || 'GALEO STORE'}</span>
        <span>{siteSettings.footer?.location || 'São Paulo / BR'}</span>
        <span>© {siteSettings.footer?.year || '2026'}</span>
      </footer>
    </div>
  )
}
