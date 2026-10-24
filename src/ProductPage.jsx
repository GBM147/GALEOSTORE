import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addToCart, STORE_API_BASE } from './storeApi'
import ProductGallery from './ProductGallery'
import { formatProductPrice, productCanBePurchased, productHasPrice } from './productAvailability'

const productGallery = (product) => {
  const uploaded = Array.isArray(product?.media) ? product.media : []
  const cover = product?.image ? { id:'cover', media_type:'image', url:product.image } : null
  const video = product?.video ? { id:'video', media_type:'video', url:product.video } : null
  const urls = new Set()
  return [cover, ...uploaded, video].filter((item) => {
    if (!item?.url || urls.has(item.url)) return false
    urls.add(item.url)
    return true
  })
}

export default function ProductPage() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [related, setRelated] = useState([])
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [added, setAdded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetch(STORE_API_BASE + '/api/store/products/' + encodeURIComponent(id) + '?ts=' + Date.now(), { cache:'no-store', headers:{ Accept:'application/json' } })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || 'Produto não encontrado.')
        return data
      })
      .then((data) => {
        if (!alive) return
        setProduct(data.product || null)
        setRelated(Array.isArray(data.related) ? data.related : [])
        setQuantity(1)
      })
      .catch((err) => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  const gallery = useMemo(() => productGallery(product), [product])

  function handleAdd() {
    if (!productCanBePurchased(product)) return
    addToCart(product, quantity)
    setAdded(true)
    window.setTimeout(() => setAdded(false), 2200)
  }

  if (loading) return <main className="section-shell page-space product-page-state"><h1>Carregando produto</h1></main>
  if (error || !product) return <main className="section-shell page-space product-page-state"><h1>Produto não encontrado</h1><p>{error || 'Este produto não está disponível no catálogo'}</p><Link className="button button-primary" to="/shop">Voltar ao catálogo ↗</Link></main>

  const stock = Math.max(0, Number(product.stock || 0))
  const hasPrice = productHasPrice(product)
  const purchasable = productCanBePurchased(product)

  return (
    <main className="section-shell product-page">
      <div className="product-breadcrumb"><Link to="/shop">CATÁLOGO</Link><span>/</span><span>{product.category || 'PRODUTO'}</span></div>
      <div className="product-detail">
        <ProductGallery key={product.id} media={gallery} name={product.name} />

        <section className="product-info">
          {product.brand && <p className="product-detail-brand">{product.brand}</p>}
          <h1>{product.name}</h1>
          <div className="product-detail-price">{formatProductPrice(product.price)}</div>
          <p className="product-detail-description">{product.description || 'Este produto ainda não possui uma descrição cadastrada'}</p>
          <div className="product-stock-line"><span>{!hasPrice ? 'Compra indisponível: preço a definir' : stock > 0 ? 'Disponível em estoque' : 'Indisponível no momento'}</span>{purchasable && <small>{stock} unidade{stock === 1 ? '' : 's'}</small>}</div>
          <div className="product-purchase-box">
            <div className="quantity-control"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Diminuir quantidade">−</button><span>{quantity}</span><button type="button" onClick={() => setQuantity((value) => Math.min(stock || 1, value + 1))} aria-label="Aumentar quantidade">+</button></div>
            <button className="button button-primary product-add-button" type="button" onClick={handleAdd} disabled={!purchasable}>{added ? 'Adicionado ao carrinho' : 'Adicionar ao carrinho'} {added ? '✓' : '↗'}</button>
          </div>
          <div className="product-detail-notes"><div><span>Pedido</span><strong>Registrado com seus dados</strong></div><div><span>Entrega</span><strong>Calculada na finalização do pedido</strong></div><div><span>Atendimento</span><strong>Confirmação por e-mail após o pedido</strong></div></div>
        </section>
      </div>

      {related.length > 0 && <section className="related-products section-block"><div className="section-heading row-heading"><div><h2>Você também pode gostar</h2></div><Link className="text-link" to={'/shop?category=' + encodeURIComponent(product.category || '')}>Ver categoria ↗</Link></div><div className="product-grid product-grid-editorial">{related.slice(0,4).map((item) => <Link className="product-card" key={item.id} to={'/produto/' + item.id}><div className="product-image"><img src={item.image || '/images/product-placeholder.svg'} alt="" loading="lazy" /><span className="product-arrow">↗</span></div><div className="product-meta"><span>{item.category || 'PRODUTO'}</span><strong>{item.name}</strong><b>{formatProductPrice(item.price)}</b></div></Link>)}</div></section>}
    </main>
  )
}
