import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultTextHighlight, editorialSegments, editorialType, textHighlightPath } from './editorialText.js'

test('highlight metadata follows the exact field path without affecting links or utility strings', () => {
  assert.deepEqual(textHighlightPath('title'), ['title_highlight'])
  assert.deepEqual(textHighlightPath(['items', 2, 'title']), ['items', 2, 'title_highlight'])
  assert.deepEqual(textHighlightPath('description'), ['description_highlight'])
  assert.equal(textHighlightPath(['items', 2]), null)
  assert.equal(textHighlightPath('button_label'), null)
  assert.equal(textHighlightPath('button_url'), null)
  assert.equal(editorialType('hero', 'title'), 'hero')
  assert.equal(editorialType('hero', 'description'), 'generic')
  assert.equal(editorialType('campaigns', ['items', 2, 'title']), 'campaign')
  assert.equal(editorialType('featured_products', 'title'), 'featured')
  assert.equal(editorialType('manifesto', 'text'), 'manifesto')
})

test('previous editorial titles keep their emphasis and line breaks without new metadata', () => {
  assert.equal(defaultTextHighlight('Vista o que representa você', 'hero'), 'representa você')
  assert.deepEqual(editorialSegments('Vista o que representa você', undefined, 'hero'), [
    { type: 'text', text: 'Vista o que' }, { type: 'break' }, { type: 'highlight', text: 'representa você' }
  ])
  assert.deepEqual(editorialSegments('Seleção multimarcas', undefined, 'featured'), [
    { type: 'text', text: 'Seleção ' }, { type: 'highlight', text: 'multimarcas' }
  ])
  assert.deepEqual(editorialSegments('Não seguimos o padrão\nCriamos o nosso', undefined, 'manifesto'), [
    { type: 'text', text: 'Não seguimos o padrão' }, { type: 'break' }, { type: 'highlight', text: 'Criamos o nosso' }
  ])
  assert.equal(defaultTextHighlight('Uma frase nova', 'hero'), '')
})

test('an explicit empty highlight disables the legacy formatting instead of silently restoring it', () => {
  assert.deepEqual(editorialSegments('Vista o que representa você', '', 'hero'), [
    { type: 'text', text: 'Vista o que representa você' }
  ])
  assert.deepEqual(editorialSegments('', 'antigo destaque', 'hero'), [])
})

test('custom emphasis matches one exact occurrence, preserving the rest of the sentence', () => {
  assert.deepEqual(editorialSegments('Seu estilo, sua história, seu estilo', 'seu estilo'), [
    { type: 'text', text: 'Seu estilo, sua história, ' }, { type: 'highlight', text: 'seu estilo' }
  ])
  assert.deepEqual(editorialSegments('Novo kit, novo kit', 'kit'), [
    { type: 'text', text: 'Novo ' }, { type: 'highlight', text: 'kit' }, { type: 'text', text: ', novo kit' }
  ])
  assert.deepEqual(editorialSegments('Nova coleção', 'Destaque antigo'), [{ type: 'text', text: 'Nova coleção' }])
})

test('line breaks and markup characters remain inert text around custom emphasis', () => {
  assert.deepEqual(editorialSegments('<img src=x>\r\nNova\n\ncoleção', 'Nova'), [
    { type: 'text', text: '<img src=x>' }, { type: 'break' }, { type: 'highlight', text: 'Nova' },
    { type: 'break' }, { type: 'break' }, { type: 'text', text: 'coleção' }
  ])
  assert.deepEqual(editorialSegments('Texto <script>alert(1)</script>', '<script>alert(1)</script>'), [
    { type: 'text', text: 'Texto ' }, { type: 'highlight', text: '<script>alert(1)</script>' }
  ])
  assert.deepEqual(editorialSegments('texto normal', '   '), [{ type: 'text', text: 'texto normal' }])
})
