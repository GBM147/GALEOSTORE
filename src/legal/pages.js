// The store's policy pages (small module: the footer, the routes and the
// acceptance boxes use it without loading the texts).
export const LEGAL_PAGES = [
  { path: '/termos', key: 'terms', label: 'Termos de Uso' },
  { path: '/privacidade', key: 'privacy', label: 'Privacidade' },
  { path: '/trocas', key: 'exchanges', label: 'Trocas e Devoluções' },
  { path: '/entregas', key: 'shipping', label: 'Entregas' },
  { path: '/contato', key: 'contact', label: 'Contato' }
]

// Version of the terms in force; stored with each acceptance.
export const LEGAL_VERSION = '2026-11-12'
export const LEGAL_VERSION_LABEL = '12 de novembro de 2026'
