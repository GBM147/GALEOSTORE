import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryLink, describeLink, linkCategory, linkKind, linkProductId } from './links.js'

test('links are recognized by what they open', () => {
  assert.equal(linkKind('/shop'), 'catalog')
  assert.equal(linkKind('/shop?category=Cal%C3%A7as'), 'category')
  assert.equal(linkKind('/produto/31'), 'product')
  assert.equal(linkKind('https://wa.me/5511999999999'), 'whatsapp')
  assert.equal(linkKind('https://instagram.com/galeo'), 'custom')
  assert.equal(linkKind(''), 'custom')
})

test('category and product links round-trip', () => {
  assert.equal(categoryLink('Calças'), '/shop?category=Cal%C3%A7as')
  assert.equal(linkCategory(categoryLink('Calças')), 'Calças')
  assert.equal(linkProductId('/produto/31'), 31)
})

test('links read in plain words', () => {
  const products = [{ id: 31, name: 'Camiseta Essential' }]
  assert.equal(describeLink('/shop'), 'Catálogo completo')
  assert.equal(describeLink('/shop?category=Camisetas'), 'Categoria Camisetas')
  assert.equal(describeLink('/produto/31', { products }), 'Produto Camiseta Essential')
  assert.equal(describeLink('https://wa.me/5511999999999', { whatsapp: '(11) 99999-9999' }), 'WhatsApp da loja')
  assert.equal(describeLink(''), 'Nenhum destino ainda')
})
