import { Link } from 'react-router-dom'
import { formatProductPrice } from './productAvailability'
import { ResponsiveImage } from './ResponsiveImage'
import { imageWidths } from './cloudinaryImage'
import { useVisualEditor } from './VisualHomeEditor'

// One product card for the Home, the catalog and "Você também pode gostar".
export default function ProductCard({ product }) {
  const editor = useVisualEditor()
  const image = product?.image || '/images/product-placeholder.svg'
  return (
    <Link className="product-card" to={'/produto/' + product.id} data-editor-spa-link={editor ? 'true' : undefined} onClick={editor?.editing ? event => { event.preventDefault(); editor.select({ sectionKey:'featured_products', kind:'products' }) } : undefined}>
      <div className="product-image">
        <ResponsiveImage src={image} widths={imageWidths.card} sizes="(max-width: 700px) 50vw, (max-width: 1100px) 33vw, 25vw" alt="" loading="lazy" decoding="async" />
        <span className="product-arrow">↗</span>
      </div>
      <div className="product-meta">
        {(product?.category || product?.brand) && <span>{product.category || product.brand}</span>}
        <strong>{product?.name || 'Produto'}</strong>
        <b>{formatProductPrice(product?.price)}</b>
      </div>
    </Link>
  )
}
