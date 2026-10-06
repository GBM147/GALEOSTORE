import { useEffect, useState } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import AdminGate from './Admin'

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

function Header({ theme, onToggle, categories = [] }) {
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')

  const primaryCategories = categories.slice(0, 4)

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
          <Link key={category.id} to={'/shop?category=' + encodeURIComponent(category.name)}>
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
        <Link className="bag-link" to="/carrinho">Carrinho <span>0</span></Link>
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

function CampaignVisual({ variant = 0 }) {
  return (
    <div className={'campaign-visual campaign-visual-' + variant} aria-hidden="true">
      <div className="campaign-orb" />
      <div className="campaign-line campaign-line-a" />
      <div className="campaign-line campaign-line-b" />
      <img src="/images/galeo-brand.png" alt="" className="campaign-brand-image" />
      <div className="campaign-scan" />
    </div>
  )
}

function Home({ products = fallbackProducts }) {
  const shownProducts = products.length >= 6 ? products.slice(0, 6) : [...products, ...fallbackProducts].slice(0, 6)

  return (
    <main>
      <section className="hero-full section-shell">
        <div className="hero-full-media">
          <CampaignVisual variant={0} />
          <div className="hero-full-shade" />
        </div>
        <div className="hero-full-content">
          <span className="eyebrow">GALEO / MULTIBRAND STORE</span>
          <h1 className="hero-title">
            <span className="hero-title-line"><span className="hero-title-mask">Vista o que</span></span>
            <span className="hero-title-line"><span className="hero-title-mask"><em>representa você.</em></span></span>
          </h1>
          <p>Curadoria de marcas, peças e estilos para quem não precisa seguir o mesmo caminho.</p>
          <div className="hero-full-actions">
            <Link className="button button-primary" to="/shop">Explorar coleção <span>↗</span></Link>
            <span className="hero-scroll">SCROLL ↓</span>
          </div>
        </div>
        <div className="hero-full-meta">
          <span>01 / 03</span>
          <span>São Paulo / BR</span>
        </div>
      </section>

      <section className="utility-strip section-shell" aria-label="Diferenciais">
        <span>Curadoria multimarcas</span>
        <span>Compra segura</span>
        <span>Envio para todo o Brasil</span>
        <span>Novas peças toda semana</span>
      </section>

      <section className="section-shell section-block" id="colecoes">
        <div className="section-heading row-heading" data-reveal>
          <div>
            <span className="eyebrow">01 / CATEGORIAS</span>
            <h2>Escolha seu<br /><em>movimento.</em></h2>
          </div>
          <Link className="text-link" to="/shop">Ver catálogo ↗</Link>
        </div>
        <div className="category-grid">
          {['Camisetas', 'Calças', 'Blusas'].map((item, index) => (
            <Link className={'category-card category-card-' + index} to="/shop" key={item}>
              <span>0{index + 1}</span>
              <strong>{item}</strong>
              <small>Explorar coleção ↗</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="section-shell section-block" id="destaques">
        <div className="section-heading row-heading">
          <div>
            <span className="eyebrow">02 / TRENDING NOW</span>
            <h2>Seleção <em>multimarcas.</em></h2>
          </div>
          <Link className="text-link" to="/shop">Ver todos ↗</Link>
        </div>
        <div className="product-grid product-grid-editorial">
          {shownProducts.map((product, index) => (
            <ProductCard key={product.id || index} product={product} index={index} />
          ))}
        </div>
      </section>

      <section className="section-shell campaign-grid" aria-label="Campanhas" data-reveal>
        <Link className="campaign-card campaign-card-wide" to="/shop">
          <CampaignVisual variant={1} />
          <div className="campaign-card-copy">
            <span>NEW DROPS</span>
            <strong>Peças que<br /><em>marcam presença.</em></strong>
            <small>Descobrir agora ↗</small>
          </div>
        </Link>
        <Link className="campaign-card" to="/shop">
          <CampaignVisual variant={2} />
          <div className="campaign-card-copy">
            <span>PREMIUM SELECTION</span>
            <strong>Seu estilo,<br /><em>sem rótulo.</em></strong>
            <small>Ver seleção ↗</small>
          </div>
        </Link>
        <Link className="campaign-card" to="/shop">
          <CampaignVisual variant={3} />
          <div className="campaign-card-copy">
            <span>LIMITED EDITION</span>
            <strong>Feito para<br /><em>ser notado.</em></strong>
            <small>Explorar ↗</small>
          </div>
        </Link>
      </section>

      <section className="manifesto section-shell" id="sobre" data-reveal>
        <span className="eyebrow">03 / SOBRE A GALEO</span>
        <p>Não seguimos o padrão.<br /><em>Criamos o nosso.</em></p>
      </section>

      <section className="newsletter section-shell" data-reveal>
        <div>
          <span className="eyebrow">GALEO / INSIDER</span>
          <h2>Entre para a próxima fase.</h2>
        </div>
        <form onSubmit={event => event.preventDefault()}>
          <input type="email" placeholder="Seu melhor e-mail" aria-label="Seu melhor e-mail" />
          <button type="submit">Entrar ↗</button>
        </form>
      </section>
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
  .replace(/[\\u0300-\\u036f]/g, '')
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

  const availableCategories = useMemo(() => {
    const byId = new Map()
    categories.forEach((category) => byId.set(String(category.id), category))
    products.forEach((product) => {
      if (product?.category_id && product?.category && !byId.has(String(product.category_id))) {
        byId.set(String(product.category_id), {
          id: product.category_id,
          name: product.category,
          sort_order: 999
        })
      }
    })
    return [...byId.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
  }, [categories, products])

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
        <h1>Descubra<br /><em>seu próximo kit.</em></h1>
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
  const [theme, setTheme] = useState(() => localStorage.getItem('galeo-theme') || 'dark')
  const [catalog, setCatalog] = useState(fallbackProducts)
  const [categories, setCategories] = useState([])

  useEffect(() => {
    fetch('/api/store')
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (data?.products?.length) setCatalog(data.products)
        if (Array.isArray(data?.categories)) setCategories(data.categories)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('galeo-theme', theme)
  }, [theme])

  return (
    <div className="app">
      <div className="scroll-progress" aria-hidden="true"><span /></div>
      <StorefrontMotion />
      <Header
        theme={theme}
        categories={categories}
        onToggle={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
      />
      <Routes>
        <Route path="/admin/*" element={<AdminGate />} />
        <Route path="/" element={<Home products={catalog} />} />
        <Route path="/shop" element={<Shop products={catalog} categories={categories} />} />
        <Route path="/produto/:id" element={<PlaceholderPage title="Produto" label="GALEO / PRODUTO" />} />
        <Route path="/conta" element={<PlaceholderPage title="Minha conta" label="GALEO / CONTA" />} />
        <Route path="/carrinho" element={<PlaceholderPage title="Carrinho" label="GALEO / CARRINHO" />} />
      </Routes>
      <footer className="site-footer">
        <span>GALEO STORE</span>
        <span>São Paulo / BR</span>
        <span>© 2026</span>
      </footer>
    </div>
  )
}
