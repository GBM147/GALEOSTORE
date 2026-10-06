import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import AdminGate from './Admin'

const fallbackProducts = [
  { id: 1, name: 'Camiseta Essential', category: 'Camisetas', price: 129.9, image: '/images/product-placeholder.svg' },
  { id: 2, name: 'Moletom Galeo Core', category: 'Moletons', price: 219.9, image: '/images/product-placeholder.svg' },
  { id: 3, name: 'Camiseta Oversized', category: 'Camisetas', price: 149.9, image: '/images/product-placeholder.svg' },
  { id: 4, name: 'Shoulder Bag Galeo', category: 'Acessórios', price: 99.9, image: '/images/product-placeholder.svg' }
]

function ThemeToggle({ theme, onToggle }) {
  return (
    <button className="icon-button" type="button" onClick={onToggle} aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}>
      {theme === 'dark' ? '☼' : '☾'}
    </button>
  )
}

function Header({ theme, onToggle }) {
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Galeo Store">
        <span className="brand-logo-wrap">
          <img className="brand-logo" src="https://res.cloudinary.com/ovbsocaw/image/upload/v1791245015/galeo-store/branding/galeo-logo-photo.webp" alt="GALEO" />
        </span>
        <span className="brand-wordmark">GALEO</span>
      </Link>
      <nav className="desktop-nav" aria-label="Navegação principal">
        <Link to="/shop">Shop</Link>
        <a href="#colecoes">Coleções</a>
        <a href="#sobre">Sobre</a>
      </nav>
      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onToggle} />
        <Link className="header-link" to="/conta">Conta</Link>
        <Link className="bag-link" to="/carrinho">Bag <span>0</span></Link>
      </div>
    </header>
  )
}

function Home({ products = fallbackProducts }) {
  return (
    <>
      <main>
        <section className="hero section-shell">
          <div className="hero-copy">
            <span className="eyebrow">GALEO / 001 — NEW STORE</span>
            <h1>Vista sua<br /><em>identidade.</em></h1>
            <p>Uma experiência de moda construída para destacar a marca, o produto e quem usa.</p>
            <Link className="button button-primary" to="/shop">Explorar coleção <span>↗</span></Link>
          </div>
          <div className="hero-art" aria-label="Campanha GALEO com movimento automático">
            <div className="hero-campaign-glow" />
            <div className="hero-grid" />
            <div className="hero-campaign-stage">
              <img className="hero-campaign-logo hero-campaign-logo-a" src="https://res.cloudinary.com/ovbsocaw/image/upload/v1791245015/galeo-store/branding/galeo-logo-photo.webp" alt="Logo GALEO" />
              <img className="hero-campaign-logo hero-campaign-logo-b" src="https://res.cloudinary.com/ovbsocaw/image/upload/v1791245015/galeo-store/branding/galeo-logo-photo.webp" alt="" aria-hidden="true" />
            </div>
            <div className="hero-campaign-vignette" />
            <div className="hero-campaign-meta">
              <span>GALEO / CAMPAIGN 001</span>
              <span>AUTOPLAY VISUAL</span>
            </div>
            <div className="hero-campaign-copy">
              <span>MULTIMARCA / SÃO PAULO</span>
              <strong>Presença<br /><em>em movimento.</em></strong>
              <p>Uma vitrine viva, com imagens que respiram, mudam de enquadramento e conduzem a coleção.</p>
            </div>
            <div className="hero-campaign-scroll">SCROLL / 001 ↘</div>
          </div>
        </section>

        <section className="section-shell section-block" id="colecoes">
          <div className="section-heading">
            <span className="eyebrow">01 / CATEGORIAS</span>
            <h2>Encontre seu<br /><em>movimento.</em></h2>
          </div>
          <div className="category-grid">
            {['Camisetas', 'Calças', 'Vestidos', 'Casacos', 'Calçados', 'Acessórios'].slice(0, 3).map((item, index) => (
              <Link className="category-card" to="/shop" key={item}>
                <span>0{index + 1}</span>
                <strong>{item}</strong>
                <i>↗</i>
              </Link>
            ))}
          </div>
        </section>

        <section className="section-shell section-block" id="destaques">
          <div className="section-heading row-heading">
            <div><span className="eyebrow">02 / DESTAQUES</span><h2>Seleção <em>multimarcas.</em></h2></div>
            <Link className="text-link" to="/shop">Ver todos ↗</Link>
          </div>
          <div className="product-grid">
            {products.map(product => <ProductCard key={product.id} product={product} />)}
          </div>
        </section>

        <section className="manifesto section-shell" id="sobre">
          <span className="eyebrow">03 / MANIFESTO</span>
          <p>Não seguimos o padrão.<br /><em>Criamos o nosso.</em></p>
        </section>

        <section className="newsletter section-shell">
          <div><span className="eyebrow">04 / NEWSLETTER</span><h2>Entre para a próxima fase.</h2></div>
          <form onSubmit={event => event.preventDefault()}><input type="email" placeholder="Seu melhor e-mail" aria-label="Seu e-mail" /><button type="submit">Entrar ↗</button></form>
        </section>
      </main>
    </>
  )
}

function ProductCard({ product }) {
  const price = Number(product?.price || 0)
  const image = product?.image || '/images/product-placeholder.svg'

  return (
    <Link className="product-card" to={`/produto/${product.id}`}>
      <div className="product-image"><img src={image} alt="" loading="lazy" /><span>↗</span></div>
      <div className="product-meta"><span>{product?.category || 'Sem categoria'}</span><strong>{product?.name || 'Produto'}</strong><b>R$ {price.toFixed(2).replace('.', ',')}</b></div>
    </Link>
  )
}

function Shop({ products = fallbackProducts }) {
  return (
    <main className="section-shell page-space">
      <div className="page-heading"><span className="eyebrow">SHOP / 001</span><h1>Produtos.</h1></div>
      <div className="filters"><button className="filter-active">Todos</button><button>Camisetas</button><button>Calças</button><button>Vestidos</button><button>Calçados</button><button>Acessórios</button><span /><button>Ordenar ↕</button></div>
      <div className="product-grid">{products.map(product => <ProductCard key={product.id} product={product} />)}</div>
    </main>
  )
}

function PlaceholderPage({ title, label }) {
  return <main className="section-shell page-space"><span className="eyebrow">{label}</span><h1>{title}</h1><p className="page-note">Estrutura preparada para a próxima etapa do projeto.</p></main>
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('galeo-theme') || 'dark')
  const [catalog, setCatalog] = useState(fallbackProducts)
  useEffect(() => { fetch('/api/store').then(r => r.ok ? r.json() : null).then(d => { if (d?.products?.length) setCatalog(d.products) }).catch(() => {}) }, [])

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
        <Route path="/produto/:id" element={<PlaceholderPage title="Produto" label="PRODUCT / 001" />} />
        <Route path="/conta" element={<PlaceholderPage title="Minha conta" label="ACCOUNT / 001" />} />
        <Route path="/carrinho" element={<PlaceholderPage title="Sua bag" label="BAG / 001" />} />
      </Routes>
      <footer className="site-footer"><span>GALEO STORE</span><span>São Paulo / BR</span><span>© 2026</span></footer>
    </div>
  )
}