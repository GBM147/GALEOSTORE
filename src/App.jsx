import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import AdminGate from './Admin'

const fallbackProducts = [
  { id: 1, name: 'Camiseta Essential', category: 'Camisetas', price: 129.9, image: '/images/product-placeholder.svg' },
  { id: 2, name: 'Moletom Galeo Core', category: 'Moletons', price: 219.9, image: '/images/product-placeholder.svg' },
  { id: 3, name: 'Camiseta Oversized', category: 'Camisetas', price: 149.9, image: '/images/product-placeholder.svg' },
  { id: 4, name: 'Shoulder Bag', category: 'Acessórios', price: 99.9, image: '/images/product-placeholder.svg' },
  { id: 5, name: 'Calça Essential', category: 'Calças', price: 189.9, image: '/images/product-placeholder.svg' },
  { id: 6, name: 'Tênis Urban', category: 'Tênis', price: 299.9, image: '/images/product-placeholder.svg' }
]

function ModeButton({ theme, onToggle }) {
  return (
    <button className="mode-button" type="button" onClick={onToggle} aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}>
      <span>Escolha do modo</span>
      <i>{theme === 'dark' ? '☼' : '☾'}</i>
    </button>
  )
}

function Header({ theme, onToggle }) {
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Galeo Store">
        <span className="brand-logo-wrap">
          <img className="brand-logo" src="/images/galeo-brand.png" alt="GALEO" />
        </span>
        <span className="brand-wordmark">GALEO</span>
      </Link>
      <nav className="desktop-nav" aria-label="Navegação principal">
        <a href="#colecoes">Coleções</a>
        <a href="#sobre">Sobre</a>
      </nav>
      <div className="header-actions">
        <ModeButton theme={theme} onToggle={onToggle} />
        <Link className="bag-link" to="/carrinho">Carrinho <span>0</span></Link>
        <Link className="header-link" to="/conta">Conta</Link>
      </div>
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
          <h1>Vista o que<br /><em>representa você.</em></h1>
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
        <div className="section-heading row-heading">
          <div>
            <span className="eyebrow">01 / CATEGORIAS</span>
            <h2>Escolha seu<br /><em>movimento.</em></h2>
          </div>
          <Link className="text-link" to="/shop">Ver catálogo ↗</Link>
        </div>
        <div className="category-grid">
          {['Camisetas', 'Calças', 'Moletons'].map((item, index) => (
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

      <section className="section-shell campaign-grid" aria-label="Campanhas">
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

      <section className="manifesto section-shell" id="sobre">
        <span className="eyebrow">03 / SOBRE A GALEO</span>
        <p>Não seguimos o padrão.<br /><em>Criamos o nosso.</em></p>
      </section>

      <section className="newsletter section-shell">
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

function Shop({ products = fallbackProducts }) {
  return (
    <main className="section-shell page-space">
      <div className="page-heading">
        <span className="eyebrow">GALEO / SHOP</span>
        <h1>Descubra<br /><em>seu próximo kit.</em></h1>
      </div>
      <div className="filters">
        {['Todos', 'Camisetas', 'Calças', 'Moletons', 'Tênis', 'Acessórios'].map((item, index) => (
          <button key={item} className={index === 0 ? 'filter-active' : ''}>{item}</button>
        ))}
        <span />
        <button>Ordenar ↕</button>
      </div>
      <div className="product-grid">{products.map(product => <ProductCard key={product.id} product={product} />)}</div>
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

  useEffect(() => {
    fetch('/api/store')
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (data?.products?.length) setCatalog(data.products)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('galeo-theme', theme)
  }, [theme])

  return (
    <div className="app">
      <Header theme={theme} onToggle={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} />
      <Routes>
        <Route path="/admin/*" element={<AdminGate />} />
        <Route path="/" element={<Home products={catalog} />} />
        <Route path="/shop" element={<Shop products={catalog} />} />
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
