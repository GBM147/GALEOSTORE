import assert from 'node:assert/strict'
import { test } from 'node:test'
import { packageSuggestion, packageText, sizeSuggestions, withPackageDefaults } from './productDefaults.js'

test('each store category gets its usual size grid', () => {
  assert.deepEqual(sizeSuggestions('Camisetas'), ['PP', 'P', 'M', 'G', 'GG', 'XG'])
  assert.deepEqual(sizeSuggestions('Calças'), ['36', '38', '40', '42', '44', '46', '48'])
  assert.deepEqual(sizeSuggestions('Calçados'), ['37', '38', '39', '40', '41', '42', '43', '44'])
  assert.deepEqual(sizeSuggestions('Acessórios'), ['Único'])
  assert.deepEqual(sizeSuggestions('Bonés'), ['Único'])
  assert.deepEqual(sizeSuggestions(''), ['PP', 'P', 'M', 'G', 'GG', 'XG'])
})

test('camisa and camiseta are not confused and every package fits the carriers', () => {
  assert.equal(packageSuggestion('Camisas').label, 'Camisa padrão')
  assert.equal(packageSuggestion('Camisetas').label, 'Camiseta padrão')
  for (const name of ['Camisetas', 'Calças', 'Camisas', 'Moletons', 'Bermudas', 'Casacos', 'Calçados', 'Acessórios', 'Outra']) {
    const box = packageSuggestion(name)
    assert.ok(box.weight > 0 && box.width >= 11 && box.height >= 2 && box.length >= 16, name)
  }
})

test('package defaults fill only an empty package and read in plain words', () => {
  const filled = withPackageDefaults({ name: 'Peça', shipping_weight: '', shipping_width: '', shipping_height: '', shipping_length: '' }, 'Camisetas')
  assert.deepEqual([filled.shipping_weight, filled.shipping_width, filled.shipping_height, filled.shipping_length], ['0.3', '25', '5', '30'])
  const custom = { shipping_weight: '1', shipping_width: '', shipping_height: '', shipping_length: '' }
  assert.equal(withPackageDefaults(custom, 'Camisetas'), custom)
  assert.equal(packageText(filled), '0,3 kg · 25×5×30 cm')
})
