import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEGAL_PAGES, LEGAL_VERSION, inlineParts, legalDocument } from './documents.js'

const company = { legal_name: 'GALEO Comércio de Roupas LTDA', cnpj: '11222333000181', street: 'Rua Augusta', number: '100', city: 'São Paulo', state: 'SP', postal_code: '01304000', email: 'contato@galeo.com.br', hours: 'seg. a sex., 9h às 18h' }
const footer = { brand: 'GALEO STORE', whatsapp: '11 99999-9999' }
const allText = doc => [doc.title, ...(doc.summary || []), ...doc.sections.flatMap(section => [section.title, ...section.blocks])].join('\n')

test('todas as páginas existem, com título, descrição e seções únicas', () => {
  assert.match(LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}$/)
  for (const page of LEGAL_PAGES) {
    const doc = legalDocument(page.key, { company, footer })
    assert.ok(doc.title && doc.description, page.key)
    const ids = doc.sections.map(section => section.id)
    assert.equal(new Set(ids).size, ids.length, page.key)
    assert.ok(doc.sections.every(section => section.blocks.length), page.key)
  }
  assert.equal(legalDocument('nada', {}), null)
})

test('os dados da empresa entram nos termos e no contato', () => {
  const terms = allText(legalDocument('terms', { company, footer }))
  assert.match(terms, /operada por GALEO Comércio de Roupas LTDA, CNPJ 11\.222\.333\/0001-81, com endereço em Rua Augusta, 100, São Paulo\/SP, CEP 01304-000\./)
  assert.match(terms, /pelo e-mail contato@galeo\.com\.br ou pelo WhatsApp \(11\) 99999-9999/)
  const contact = allText(legalDocument('contact', { company, footer }))
  assert.match(contact, /\*\*CNPJ:\*\* 11\.222\.333\/0001-81/)
  assert.match(contact, /\[\(11\) 99999-9999\]\(https:\/\/wa\.me\/5511999999999\)/)
})

test('sem dados da empresa, os textos continuam corretos e apontam para o Contato', () => {
  const terms = allText(legalDocument('terms', {}))
  assert.match(terms, /operada pela empresa identificada na página \[Contato\]\(\/contato\)/)
  assert.doesNotMatch(terms, /undefined|CNPJ ,|null/)
  assert.match(allText(legalDocument('contact', {})), /serão publicados em breve/)
})

test('trocas seguem a escolha dos donos: 7 dias, 1ª troca paga pela loja, defeito em 90 dias', () => {
  const text = allText(legalDocument('exchanges', { company, footer }))
  assert.match(text, /até 7 dias corridos depois de receber o pedido/)
  assert.match(text, /primeira troca de cada pedido é por conta da loja/)
  assert.match(text, /90 dias do recebimento/)
})

test('texto com negrito e links', () => {
  assert.deepEqual(inlineParts('Veja **isto** e [Trocas](/trocas).'), [
    { type: 'text', text: 'Veja ' }, { type: 'bold', text: 'isto' }, { type: 'text', text: ' e ' }, { type: 'link', text: 'Trocas', href: '/trocas' }, { type: 'text', text: '.' }
  ])
})
