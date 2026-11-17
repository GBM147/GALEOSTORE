// Store colors: each theme keeps its own custom colors in
// storefront_visual_defaults (`palette` for dark, `palette_light` for light).
// A color left empty falls back to the stylesheet. THEME_DEFAULTS mirrors the
// :root and :root[data-theme="light"] variables in styles.css; the unit test
// keeps the two in sync.
export const PALETTE_VARIABLES = Object.freeze({
  background: '--bg', surface: '--surface', surface_alt: '--surface-2', text: '--text', muted: '--muted',
  accent: '--accent', accent_soft: '--accent-soft', accent_deep: '--accent-deep', line: '--line'
})

export const THEME_DEFAULTS = Object.freeze({
  dark: Object.freeze({
    background: '#050505', surface: '#0d0c0b', surface_alt: '#15120f', text: '#f2eadb', muted: '#978b78',
    accent: '#c4934c', accent_soft: '#e2c27f', accent_deep: '#72501f', line: 'rgba(224, 189, 125, .19)'
  }),
  light: Object.freeze({
    background: '#eee9df', surface: '#f7f2e8', surface_alt: '#e9decb', text: '#1a1510', muted: '#766a5a',
    accent: '#95692d', accent_soft: '#b98948', accent_deep: '#60441e', line: 'rgba(74, 54, 29, .18)'
  })
})

export const themeName = theme => theme === 'light' ? 'light' : 'dark'
export const paletteKey = theme => themeName(theme) === 'light' ? 'palette_light' : 'palette'

export function themePalette(visual, theme) {
  const value = visual?.[paletteKey(theme)]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// Sets the theme's custom colors on the root element and clears the rest, so a
// color removed in the editor goes back to the stylesheet default.
export function applyThemePalette(root, visual, theme) {
  const palette = themePalette(visual, theme)
  for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
    const color = typeof palette[key] === 'string' ? palette[key].trim() : ''
    if (color) root.style.setProperty(variable, color)
    else root.style.removeProperty(variable)
  }
}
