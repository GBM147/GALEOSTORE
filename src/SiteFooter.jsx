import { useState } from 'react'
import { Link } from 'react-router-dom'
import { setLiteMode, useLiteMode } from './liteMode'
import { footerReviewUrl, instagramUrl, navigationLinks, whatsappUrl } from './siteNavigation'
import { useVisualEditor } from './VisualHomeEditor'

const STAR = 'M12 2.8l2.84 5.75 6.35.92-4.6 4.48 1.09 6.32L12 17.29l-5.68 2.98 1.09-6.32-4.6-4.48 6.35-.92z'

// Invitation to review the store: any star opens the store on Google, where the
// review is written. Google does not allow filtering ratings, so every star
// goes to the same page and the site keeps no rating of its own.
function GoogleReview({ url }) {
  const [lit, setLit] = useState(0)
  const [thanks, setThanks] = useState(false)
  const open = { href: url, target: '_blank', rel: 'noopener noreferrer', onClick: () => setThanks(true) }
  return <section className="site-footer-review" aria-labelledby="site-footer-review-title">
    <div className="site-footer-review-copy">
      <h2 id="site-footer-review-title">Comprou com a gente? <em>Conte como foi</em></h2>
      <p>Toque numa estrela para avaliar a GaleoStore no Google.</p>
    </div>
    <div className="site-footer-review-stars" role="group" aria-label="Avaliar no Google" onMouseLeave={() => setLit(0)}>
      {[1, 2, 3, 4, 5].map(stars => <a key={stars} {...open} className={stars <= lit ? 'is-lit' : undefined}
        aria-label={'Dar ' + stars + (stars === 1 ? ' estrela' : ' estrelas') + ' no Google'}
        onMouseEnter={() => setLit(stars)} onFocus={() => setLit(stars)} onBlur={() => setLit(0)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={STAR} /></svg>
      </a>)}
    </div>
    <a className="button button-ghost site-footer-review-button" {...open}>Avaliar no Google <span aria-hidden="true">↗</span></a>
    <p className="site-footer-review-thanks" role="status">{thanks ? 'Obrigado! Termine sua avaliação no Google.' : ''}</p>
  </section>
}

export default function SiteFooter({ footer, navigation }) {
  const editor = useVisualEditor()
  const lite = useLiteMode()
  const brand = footer?.brand || 'GALEO STORE'
  const year = footer?.year || '2026'
  const instagram = instagramUrl(footer?.instagram)
  const whatsapp = whatsappUrl(footer?.whatsapp)
  const review = footerReviewUrl(footer)
  const categories = navigationLinks(navigation, 5)

  return <footer className="site-footer">
    <div className="site-footer-band" aria-hidden="true"><span>GALEO</span></div>
    {review && <GoogleReview url={review} />}
    <div className="site-footer-grid">
      <div className="site-footer-about">
        <img src="/images/galeo-logo-128.webp" width="56" height="56" alt="" loading="lazy" decoding="async" />
        <p><strong>{brand}</strong>Moda com identidade.</p>
      </div>
      <nav aria-label="Loja">
        <h2>Loja</h2>
        <ul>
          <li><Link to="/shop">Catálogo</Link></li>
          {categories.map(link => <li key={link.id}><Link to={link.url}>{link.name}</Link></li>)}
        </ul>
      </nav>
      <nav aria-label="Ajuda">
        <h2>Ajuda</h2>
        <ul>
          <li><Link to="/conta">Minha conta</Link></li>
          <li><Link to="/carrinho">Carrinho</Link></li>
        </ul>
      </nav>
      <div className="site-footer-payment">
        <h2>Pagamento</h2>
        <ul className="payment-badges">
          <li>Pix</li><li>Crédito</li><li>Débito</li>
        </ul>
        <p>Pagamento processado pelo Mercado Pago.</p>
      </div>
      {(instagram || whatsapp) && <nav aria-label="Redes sociais">
        <h2>Redes</h2>
        <ul>
          {instagram && <li><a href={instagram} target="_blank" rel="noopener noreferrer">Instagram</a></li>}
          {whatsapp && <li><a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a></li>}
        </ul>
      </nav>}
    </div>
    <div className="site-footer-bottom">
      <span>© {year} · {brand}</span>
      <button type="button" className="lite-mode-toggle" onClick={() => setLiteMode(!lite)}
        title="Sem animações, vídeos automáticos e efeitos de desfoque">Modo leve: {lite ? 'ligado' : 'desligado'}</button>
    </div>
    {editor?.editing && <button type="button" className="visual-editor-footer-button" onClick={() => editor.select({ kind:'settings', tab:'footer' })}>Editar rodapé</button>}
  </footer>
}
