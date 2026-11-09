// Typical sizes and packages per category, so the owners tap instead of type.
// Matching uses the category name without accents, so new categories with
// familiar words ("Tênis", "Shorts", "Bonés") get sensible suggestions too.

const plain = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const groups = [
  { match: /calcad|tenis|sapato|chinelo|sandalia|bota/, sizes: ['37', '38', '39', '40', '41', '42', '43', '44'], package: { label: 'Caixa de calçado padrão', weight: 1.2, width: 20, height: 13, length: 33 } },
  { match: /calca|jeans/, sizes: ['36', '38', '40', '42', '44', '46', '48'], package: { label: 'Calça padrão', weight: 0.6, width: 30, height: 8, length: 35 } },
  { match: /bermuda|short/, sizes: ['36', '38', '40', '42', '44', '46', '48'], package: { label: 'Bermuda padrão', weight: 0.4, width: 25, height: 6, length: 30 } },
  { match: /acessori|bone|meia|cinto|oculos|carteira|bolsa|mochila|chapeu|gorro/, sizes: ['Único'], package: { label: 'Acessório padrão', weight: 0.2, width: 16, height: 8, length: 20 } },
  { match: /moletom|blusa/, sizes: ['PP', 'P', 'M', 'G', 'GG', 'XG'], package: { label: 'Moletom padrão', weight: 0.8, width: 30, height: 10, length: 35 } },
  { match: /casaco|jaqueta|corta.?vento/, sizes: ['PP', 'P', 'M', 'G', 'GG', 'XG'], package: { label: 'Casaco padrão', weight: 1, width: 30, height: 12, length: 40 } },
  { match: /camisa\b|camisas|polo/, sizes: ['PP', 'P', 'M', 'G', 'GG', 'XG'], package: { label: 'Camisa padrão', weight: 0.35, width: 25, height: 6, length: 30 } },
  { match: /camiseta|regata|t.?shirt/, sizes: ['PP', 'P', 'M', 'G', 'GG', 'XG'], package: { label: 'Camiseta padrão', weight: 0.3, width: 25, height: 5, length: 30 } }
]
const fallback = { sizes: ['PP', 'P', 'M', 'G', 'GG', 'XG'], package: { label: 'Embalagem padrão', weight: 0.4, width: 25, height: 6, length: 30 } }

const groupFor = categoryName => groups.find(group => group.match.test(plain(categoryName))) || fallback

export const sizeSuggestions = categoryName => [...groupFor(categoryName).sizes]

export const packageSuggestion = categoryName => ({ ...groupFor(categoryName).package })

// Fills only the package fields that are still empty.
export function withPackageDefaults(form, categoryName) {
  const suggestion = packageSuggestion(categoryName)
  const fields = { shipping_weight: suggestion.weight, shipping_width: suggestion.width, shipping_height: suggestion.height, shipping_length: suggestion.length }
  const empty = key => String(form[key] ?? '').trim() === ''
  if (!Object.keys(fields).every(empty)) return form
  return { ...form, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)])) }
}

export const packageText = form => {
  const number = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  return `${number(form.shipping_weight)} kg · ${number(form.shipping_width)}×${number(form.shipping_height)}×${number(form.shipping_length)} cm`
}
