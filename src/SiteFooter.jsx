import { Link } from 'react-router-dom'
import { setLiteMode, useLiteMode } from './liteMode'
import { instagramUrl, navigationLinks, whatsappUrl } from './siteNavigation'
import { useVisualEditor } from './VisualHomeEditor'

export default function SiteFooter({ footer, navigation }) {
  const editor = useVisualEditor()
  const lite = useLiteMode()
  const brand = footer?.brand || 'GALEO STORE'
  const year = footer?.year || '2026'
  const instagram = instagramUrl(footer?.instagram)
  const whatsapp = whatsappUrl(footer?.whatsapp)
  const categories = navigationLinks(navigation, 5)

  return <footer className="site-footer">
    <div className="site-footer-band" aria-hidden="true"><span>GALEO</span></div>
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
