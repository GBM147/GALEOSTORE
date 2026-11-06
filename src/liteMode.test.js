import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectLiteMode, LITE_STORAGE_KEY } from './liteMode.js'

function memoryStore(initial) {
  const values = new Map(initial ? [[LITE_STORAGE_KEY, initial]] : [])
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }
}
const detect = (nav = {}, { search = '', saved, reducedData = false } = {}) => {
  const store = memoryStore(saved)
  return { ...detectLiteMode({ navigator: nav, search, store, matchMedia: query => ({ matches: reducedData && query.includes('reduced-data') }) }), saved: store.values.get(LITE_STORAGE_KEY) }
}

test('aparelho comum fica com a versão completa', () => {
  assert.deepEqual(detect({ deviceMemory: 8, hardwareConcurrency: 2, connection: { effectiveType: '4g', saveData: false } }), { lite: false, reason: '', saved: undefined })
  assert.deepEqual(detect({}), { lite: false, reason: '', saved: undefined })
})

test('economia de dados, conexão lenta e pouca memória ligam o modo leve', () => {
  assert.equal(detect({ connection: { saveData: true } }).reason, 'save-data')
  for (const effectiveType of ['slow-2g', '2g', '3g']) assert.equal(detect({ connection: { effectiveType } }).reason, 'slow-connection')
  assert.equal(detect({ deviceMemory: 2 }).reason, 'low-memory')
  assert.equal(detect({ deviceMemory: 4 }).lite, false)
  assert.equal(detect({}, { reducedData: true }).reason, 'save-data')
})

test('a escolha do visitante vence a detecção e fica guardada', () => {
  assert.deepEqual(detect({ deviceMemory: 1 }, { saved: '0' }), { lite: false, reason: 'manual', saved: '0' })
  assert.deepEqual(detect({ deviceMemory: 8 }, { saved: '1' }), { lite: true, reason: 'manual', saved: '1' })
  assert.deepEqual(detect({ deviceMemory: 8 }, { search: '?lite=1' }), { lite: true, reason: 'manual', saved: '1' })
  assert.deepEqual(detect({ connection: { saveData: true } }, { search: '?lite=0', saved: '1' }), { lite: false, reason: 'manual', saved: '0' })
  // A broken or blocked storage never stops the page.
  assert.equal(detectLiteMode({ navigator: { deviceMemory: 1 }, search: '', store: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } } }).lite, true)
})
