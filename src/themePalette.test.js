import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PALETTE_VARIABLES, THEME_DEFAULTS, applyThemePalette, paletteKey, themePalette } from './themePalette.js'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const block = selector => {
  const start = css.indexOf(selector + ' {')
  assert.ok(start >= 0, selector)
  return css.slice(start, css.indexOf('}', start))
}
const variable = (text, name) => text.match(new RegExp(name + ':\\s*([^;]+);'))?.[1].trim()

test('as cores padrão de cada modo são as mesmas do styles.css', () => {
  for (const [theme, selector] of [['dark', ':root'], ['light', ':root[data-theme="light"]']]) {
    const text = block(selector)
    for (const [key, name] of Object.entries(PALETTE_VARIABLES)) assert.equal(THEME_DEFAULTS[theme][key], variable(text, name), theme + ' ' + key)
  }
})

test('cada modo usa a sua paleta e cor apagada volta ao padrão', () => {
  const values = new Map()
  const root = { style: { setProperty: (name, value) => values.set(name, value), removeProperty: name => values.delete(name) } }
  const visual = { palette: { background: '#111111', text: '#eeeeee' }, palette_light: { background: ' #fafafa ' } }
  assert.equal(paletteKey('dark'), 'palette')
  assert.equal(paletteKey('light'), 'palette_light')
  assert.equal(paletteKey(undefined), 'palette')
  applyThemePalette(root, visual, 'dark')
  assert.deepEqual(Object.fromEntries(values), { '--bg': '#111111', '--text': '#eeeeee' })
  applyThemePalette(root, visual, 'light')
  assert.deepEqual(Object.fromEntries(values), { '--bg': '#fafafa' }, 'o claro não herda as cores do escuro')
  applyThemePalette(root, { palette_light: {} }, 'light')
  assert.deepEqual(Object.fromEntries(values), {})
  assert.deepEqual(themePalette({ palette_light: ['x'] }, 'light'), {})
  assert.deepEqual(themePalette(null, 'dark'), {})
})
