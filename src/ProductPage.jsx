import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addToCart, STORE_API_BASE } from './storeApi'

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })

const productGallery = (product) => {
  const uploaded = Array.isArray(product?.media) ? product.media : []
  const cover = product?.image ? { id:'cover', media_type:'image', url:product.image } : null
  const urls = new Set()
  return [cover, ...uploaded].filter((item) => {
    if (!item?.url || urls.has(item.url)) return false
    urls.add(item.url)
    return true
  })
}

export default function ProductPage() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [related, setRelated] = useState([])
  const [selectedMedia, setSelectedMedia] = useState(null)
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
        const media = productGallery(data.product)
        setSelectedMedia(media.find((item) => item.media_type === 'image') || media[0] || null)
        setQuantity(1)
      })
      .catch((err) => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  const gallery = useMemo(() => productGallery(product), [product])

  function handleAdd() {
    if (!product || Number(product.stock || 0) <= 0) return
    addToCart(product, quantity)
    setAdded(true)
    window.setTimeout(() => setAdded(false), 2200)
  }

  if (loading) return <main className="section-shell page-space product-page-state"><span className="eyebrow">GALEO / PRODUTO</span><h1>Carregando produto</h1></main>
  if (error || !product) return <main className="section-shell page-space product-page-state"><span className="eyebrow">GALEO / PRODUTO</span><h1>Produto não encontrado</h1><p>{error || 'Este produto não está disponível no catálogo'}</p><Link className="button button-primary" to="/shop">Voltar ao catálogo ↗</Link></main>

  const stock = Math.max(0, Number(product.stock || 0))
  const currentMedia = selectedMedia || gallery[0]
  const image = currentMedia?.media_type === 'image' ? currentMedia.url : (product.image || '/images/product-placeholder.svg')

  return (
    <main className="section-shell product-page">
      <div className="product-breadcrumb"><Link to="/shop">CATÁLOGO</Link><span>/</span><span>{product.category || 'PRODUTO'}</span></div>
      <div className="product-detail">
        <section className="product-gallery" aria-label="Galeria do produto">
          <div className="product-main-media">
            {currentMedia?.media_type === 'video'
              ? <video src={currentMedia.url} controls playsInline className="product-detail-media" />
              : <img src={image} alt={product.name} className="product-detail-media" />}
          </div>
          {gallery.length > 1 && <div className="product-thumb-grid">{gallery.map((media, index) => <button className={currentMedia?.url === media.url ? 'product-thumb active' : 'product-thumb'} type="button" key={media.url} aria-label={(media.media_type === 'video' ? 'Ver vídeo ' : 'Ver foto ') + (index + 1)} aria-pressed={currentMedia?.url === media.url} onClick={() => setSelectedMedia(media)}>{media.media_type === 'video' ? <span className="product-thumb-video">▶</span> : <img src={media.url} alt="" loading="lazy" />}</button>)}</div>}
        </section>

        <section className="product-info">
          <span className="eyebrow">{product.brand || 'GALEO'} / {product.category || 'PRODUTO'}</span>
          <h1>{product.name}</h1>
          <div className="product-detail-price">{money(product.price)}</div>
          <p className="product-detail-description">{product.description || 'Este produto ainda não possui uma descrição cadastrada'}</p>
          <div className="product-stock-line"><span>{stock > 0 ? 'Disponível em estoque' : 'Indisponível no momento'}</span>{stock > 0 && <small>{stock} unidade{stock === 1 ? '' : 's'}</small>}</div>
          <div className="product-purchase-box">
            <div className="quantity-control"><button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Diminuir quantidade">−</button><span>{quantity}</span><button type="button" onClick={() => setQuantity((value) => Math.min(stock || 1, value + 1))} aria-label="Aumentar quantidade">+</button></div>
            <button className="button button-primary product-add-button" type="button" onClick={handleAdd} disabled={stock <= 0}>{added ? 'Adicionado ao carrinho' : 'Adicionar ao carrinho'} {added ? '✓' : '↗'}</button>
          </div>
          <div className="product-detail-notes"><div><span>Pedido</span><strong>Registrado com seus dados</strong></div><div><span>Entrega</span><strong>Calculada na finalização do pedido</strong></div><div><span>Atendimento</span><strong>Confirmação por e-mail após o pedido</strong></div></div>
        </section>
      </div>

      {related.length > 0 && <section className="related-products section-block"><div className="section-heading row-heading"><div><span className="eyebrow">MAIS DA CATEGORIA</span><h2>Você também pode gostar</h2></div><Link className="text-link" to={'/shop?category=' + encodeURIComponent(product.category || '')}>Ver categoria ↗</Link></div><div className="product-grid product-grid-editorial">{related.slice(0,4).map((item,index) => <Link className="product-card" key={item.id} to={'/produto/' + item.id}><div className="product-image"><img src={item.image || '/images/product-placeholder.svg'} alt="" loading="lazy" /><span className="product-index">0{index + 1}</span><span className="product-arrow">↗</span></div><div className="product-meta"><span>{item.category || 'PRODUTO'}</span><strong>{item.name}</strong><b>{money(item.price)}</b></div></Link>)}</div></section>}
    </main>
  )
}
