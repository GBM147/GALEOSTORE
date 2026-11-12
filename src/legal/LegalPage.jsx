import { Link } from 'react-router-dom'
import { usePageMeta } from '../pageMeta'
import { LEGAL_PAGES, LEGAL_VERSION_LABEL, inlineParts, legalDocument } from './documents'
import './legal.css'

// Text with **bold** and [links](url): store links stay in the app; others open
// in a new tab (e-mail and WhatsApp open their own apps).
export function LegalText({ text }) {
  return inlineParts(text).map((part, index) => {
    if (part.type === 'bold') return <strong key={index}>{part.text}</strong>
    if (part.type !== 'link') return part.text
    if (part.href.startsWith('/')) return <Link key={index} to={part.href}>{part.text}</Link>
    const external = /^https:\/\//.test(part.href)
    return <a key={index} href={part.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{part.text}</a>
  })
}

// Paragraphs, with consecutive "- " lines grouped into a list.
function Blocks({ blocks }) {
  const groups = []
  for (const block of blocks) {
    if (block.startsWith('- ')) {
      const last = groups.at(-1)
      if (Array.isArray(last)) last.push(block.slice(2))
      else groups.push([block.slice(2)])
    } else groups.push(block)
  }
  return groups.map((group, index) => Array.isArray(group)
    ? <ul key={index}>{group.map((text, item) => <li key={item}><LegalText text={text} /></li>)}</ul>
    : <p key={index}><LegalText text={group} /></p>)
}

// Terms, privacy, exchanges, shipping and contact: one page per document,
// filled with the company data from the store settings.
export default function LegalPage({ docKey, company, footer }) {
  const doc = legalDocument(docKey, { company, footer })
  usePageMeta(doc.title, doc.description)
  return <main className="section-shell page-space legal-page">
    <nav className="legal-tabs" aria-label="Políticas da loja">
      {LEGAL_PAGES.map(page => <Link key={page.key} to={page.path} aria-current={page.key === docKey ? 'page' : undefined}>{page.label}</Link>)}
    </nav>
    <header className="page-heading legal-heading">
      <span className="section-eyebrow">{docKey === 'contact' ? 'Atendimento' : 'Políticas da loja'}</span>
      <h1>{doc.title}</h1>
      {docKey !== 'contact' && <p className="legal-version">Versão de {LEGAL_VERSION_LABEL}</p>}
    </header>
    {doc.summary && <aside className="legal-summary" aria-labelledby="legal-summary-title">
      <h2 id="legal-summary-title">Resumo</h2>
      <ul>{doc.summary.map((text, index) => <li key={index}><LegalText text={text} /></li>)}</ul>
    </aside>}
    {doc.sections.length > 3 && <nav className="legal-index" aria-labelledby="legal-index-title">
      <h2 id="legal-index-title">Nesta página</h2>
      <ol>{doc.sections.map(section => <li key={section.id}><a href={'#' + section.id}>{section.title}</a></li>)}</ol>
    </nav>}
    <div className="legal-body">
      {doc.sections.map(section => <section key={section.id} id={section.id} aria-labelledby={section.id + '-title'}>
        <h2 id={section.id + '-title'}>{section.title}</h2>
        <Blocks blocks={section.blocks} />
      </section>)}
    </div>
  </main>
}
