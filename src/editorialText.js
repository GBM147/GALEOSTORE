const legacyHighlights = {
  hero: {
    'Vista o que representa você': { text: 'representa você', breakBefore: true }
  },
  featured: {
    'Seleção multimarcas': { text: 'multimarcas' }
  },
  campaign: {
    'Peças que marcam presença': { text: 'marcam presença', breakBefore: true },
    'Seu estilo, sem rótulo': { text: 'sem rótulo', breakBefore: true },
    'Feito para ser notado': { text: 'ser notado', breakBefore: true }
  },
  manifesto: {
    'Não seguimos o padrão Criamos o nosso': { text: 'Criamos o nosso', breakBefore: true },
    'Não seguimos o padrão\nCriamos o nosso': { text: 'Criamos o nosso' }
  }
}

export function textHighlightPath(path) {
  const keys = Array.isArray(path) ? [...path] : String(path || '').split('.').filter(Boolean)
  const last = keys.at(-1)
  if (!['title', 'text', 'description'].includes(last)) return null
  return [...keys.slice(0, -1), last + '_highlight']
}

export function editorialType(sectionKey, path) {
  const keys = Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean)
  const last = keys.at(-1)
  if (sectionKey === 'hero' && last === 'title') return 'hero'
  if (sectionKey === 'featured_products' && last === 'title') return 'featured'
  if (sectionKey === 'campaigns' && last === 'title') return 'campaign'
  if (sectionKey === 'manifesto' && last === 'text') return 'manifesto'
  return 'generic'
}

export function defaultTextHighlight(text, type = 'generic') {
  return legacyHighlights[type]?.[String(text ?? '')]?.text || ''
}

// Values stay plain strings throughout editing and persistence. Rendering only
// creates React text nodes, line breaks and emphasis; it never interprets HTML.
export function editorialSegments(text, highlight, type = 'generic') {
  const value = String(text ?? '').replace(/\r\n?/g, '\n')
  const legacy = legacyHighlights[type]?.[value]
  const chosen = highlight === undefined ? legacy?.text || '' : typeof highlight === 'string' ? highlight.replace(/\r\n?/g, '\n') : ''
  const index = chosen.trim() ? value.indexOf(chosen) : -1
  const segments = []
  const append = (part, emphasized = false) => {
    part.split('\n').forEach((line, index) => {
      if (index) segments.push({ type: 'break' })
      if (line) segments.push({ type: emphasized ? 'highlight' : 'text', text: line })
    })
  }
  if (index < 0) {
    append(value)
    return segments
  }
  const breakBefore = highlight === undefined && legacy?.breakBefore
  append(breakBefore ? value.slice(0, index).trimEnd() : value.slice(0, index))
  if (breakBefore) segments.push({ type: 'break' })
  append(chosen, true)
  append(value.slice(index + chosen.length))
  return segments
}
