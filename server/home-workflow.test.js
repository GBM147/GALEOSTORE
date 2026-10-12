import assert from 'node:assert/strict'
import test from 'node:test'
import { HOME_SECTION_KEYS, HOME_SETTING_KEYS, buildHomeSnapshot, validateHomeOrder, validateHomeSnapshot, registerHomeWorkflow } from './home-workflow.js'

function rows() {
  return {
    sections: HOME_SECTION_KEYS.map((key, index) => ({ section_key: key, section_type: key, sort_order: index * 10, visible: 0, published_sort_order: (index + 1) * 10, published_visible: 1, draft_content: { title: 'Rascunho ' + key }, published_content: JSON.stringify({ title: 'Publicado ' + key }) })),
    settings: HOME_SETTING_KEYS.map(key => ({ setting_key: key, setting_value: { theme: 'published' }, draft_value: JSON.stringify({ theme: 'draft' }) }))
  }
}
test('orders must contain each of the seven real Home sections exactly once', () => {
  assert.deepEqual(validateHomeOrder([...HOME_SECTION_KEYS].reverse()), [...HOME_SECTION_KEYS].reverse().map((key, index) => ({ key, order: (index + 1) * 10 })))
  for (const input of [null, [], HOME_SECTION_KEYS.slice(1), [...HOME_SECTION_KEYS, 'hero'], [...HOME_SECTION_KEYS.slice(1), 'unexpected']]) assert.throws(() => validateHomeOrder(input), { code: 'HOME_ORDER_INVALID' })
})
test('snapshot chooses draft or published content, visibility, order and settings consistently', () => {
  const { sections, settings } = rows()
  const draft = buildHomeSnapshot(sections, settings, 'draft')
  const published = buildHomeSnapshot(sections, settings)
  assert.equal(draft.sections[0].content.title, 'Rascunho hero')
  assert.equal(published.sections[0].content.title, 'Publicado hero')
  assert.equal(draft.sections[0].visible, false)
  assert.equal(published.sections[0].visible, true)
  assert.equal(published.sections[0].order, 10)
  assert.equal(draft.settings[0].value.theme, 'draft')
  assert.equal(published.settings[0].value.theme, 'published')
})
test('invalid historical snapshots are refused before partial restoration', () => {
  const valid = buildHomeSnapshot(rows().sections, rows().settings)
  for (const mutate of [snapshot => snapshot.sections.pop(), snapshot => { snapshot.schema = 2 }, snapshot => { snapshot.settings[0].value = [] }, snapshot => { snapshot.sections[0].order = -1 }, snapshot => { snapshot.sections[0].visible = 1 }]) {
    const snapshot = structuredClone(valid)
    mutate(snapshot)
    assert.throws(() => validateHomeSnapshot(snapshot), { code: 'HOME_VERSION_INVALID' })
  }
  const oversized = structuredClone(valid)
  oversized.sections[0].content.description = 'x'.repeat(2 * 1024 * 1024)
  assert.throws(() => validateHomeSnapshot(oversized), { code: 'HOME_VERSION_TOO_LARGE' })
})
test('new order, versions, restore and publish routes all require login and OWNER middleware', () => {
  const routes = []
  const app = Object.fromEntries(['get', 'put', 'post'].map(method => [method, (path, ...handlers) => routes.push({ method, path, handlers })]))
  const exigirLogin = () => {}, exigirOwner = () => {}
  registerHomeWorkflow(app, { workflow: {}, exigirLogin, exigirOwner })
  assert.equal(routes.length, 4)
  for (const route of routes) assert.deepEqual(route.handlers.slice(0, 2), [exigirLogin, exigirOwner])
  assert.equal(routes[0].path, '/api/admin/home/order')
})
