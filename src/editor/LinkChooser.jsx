import { useId } from 'react'
import { whatsappUrl } from '../siteNavigation.js'
import { categoryLink, describeLink, linkCategory, linkKind, linkProductId } from './links.js'

const kinds = [['catalog', 'Catálogo completo'], ['category', 'Uma categoria'], ['product', 'Um produto'], ['whatsapp', 'WhatsApp da loja'], ['custom', 'Outro endereço']]

// "Para onde leva": the destination of a button or link chosen from the store
// (catalog, a category, a product, WhatsApp) instead of a typed address.
export default function LinkChooser({ label, value, onChange, categories = [], products = [], whatsapp = '' }) {
  const kindId = useId(), detailId = useId()
  const kind = linkKind(value)
  const store = whatsappUrl(whatsapp)
  const names = [...new Set(categories.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean))]
  const productId = linkProductId(value)

  function choose(next) {
    if (next === 'catalog') return onChange('/shop')
    if (next === 'category') return onChange(categoryLink(linkCategory(value) || names[0] || 'Camisetas'))
    if (next === 'product') return onChange(products.length ? '/produto/' + products[0].id : '/shop')
    if (next === 'whatsapp') return onChange(store)
    onChange(kind === 'custom' ? value || '' : '')
  }

  return (
    <div className="visual-link-chooser">
      <span className="visual-field">
        <label htmlFor={kindId}>{label}</label>
        <select id={kindId} aria-label={label} value={kind} onChange={event => choose(event.target.value)}>
          {kinds.filter(([key]) => key !== 'whatsapp' || store || kind === 'whatsapp').filter(([key]) => key !== 'product' || products.length || kind === 'product').map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </span>
      {kind === 'category' && <span className="visual-field">
        <label htmlFor={detailId}>Qual categoria</label>
        <select id={detailId} aria-label={label + ' — categoria'} value={linkCategory(value)} onChange={event => onChange(categoryLink(event.target.value))}>
          {[...new Set([linkCategory(value), ...names].filter(Boolean))].map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </span>}
      {kind === 'product' && <span className="visual-field">
        <label htmlFor={detailId}>Qual produto</label>
        <select id={detailId} aria-label={label + ' — produto'} value={String(productId)} onChange={event => onChange('/produto/' + event.target.value)}>
          {!products.some(product => Number(product.id) === productId) && <option value={String(productId)}>Produto nº {productId}</option>}
          {products.map(product => <option key={product.id} value={String(product.id)}>{product.name}</option>)}
        </select>
      </span>}
      {kind === 'custom' && <span className="visual-field">
        <label htmlFor={detailId}>Endereço</label>
        <input id={detailId} aria-label={label + ' — endereço'} value={value || ''} onChange={event => onChange(event.target.value)} placeholder="Ex.: https://instagram.com/galeo" />
      </span>}
      <p className="visual-link-summary">Leva para: <strong>{describeLink(value, { products, whatsapp })}</strong></p>
    </div>
  )
}
