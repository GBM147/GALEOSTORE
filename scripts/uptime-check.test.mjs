import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkTargets, defaultTargets, LABEL, syncIssue } from './uptime-check.mjs'

const page = (status, body, type = 'text/html; charset=utf-8') => new Response(body, { status, headers: { 'Content-Type': type } })
const html = '<!doctype html><div id="root"></div>'
const health = JSON.stringify({ status: 'ok', service: 'galeo-api', database: 'ok' })

test('loja e API respondendo passam na primeira tentativa', async () => {
  const urls = []
  const results = await checkTargets(defaultTargets('https://loja.test'), { sleep: async () => {}, fetchImpl: async url => { urls.push(url); return url.endsWith('/health') ? page(200, health, 'application/json') : page(200, html) } })
  assert.deepEqual(urls, ['https://loja.test/', 'https://loja.test/health'])
  assert.deepEqual(results.map(result => result.ok), [true, true])
})

test('uma falha passageira não vira alerta e banco fora do ar vira', async () => {
  let calls = 0
  const flaky = await checkTargets(defaultTargets('https://loja.test').slice(0, 1), { sleep: async () => {}, fetchImpl: async () => ++calls < 2 ? page(503, 'x') : page(200, html) })
  assert.equal(flaky[0].ok, true)
  assert.equal(calls, 2)
  const sleeps = []
  const down = await checkTargets(defaultTargets('https://loja.test').slice(1), { sleep: async ms => { sleeps.push(ms) }, fetchImpl: async () => page(200, JSON.stringify({ status: 'ok', database: 'error' }), 'application/json') })
  assert.equal(down[0].ok, false)
  assert.equal(down[0].detail, 'resposta inesperada (HTTP 200)')
  assert.deepEqual(sleeps, [20000, 20000])
  const offline = await checkTargets(defaultTargets('https://loja.test').slice(0, 1), { sleep: async () => {}, fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.equal(offline[0].detail, 'falha de conexão')
})

function github(openIssues = []) {
  const calls = []
  const fetchImpl = async (url, options) => {
    const { pathname, search } = new URL(url)
    calls.push([options.method, pathname.replace('/repos/GBM147/GALEOSTORE', '') + search, options.body ? JSON.parse(options.body) : null])
    if (options.method === 'GET') return Response.json(openIssues)
    if (pathname.endsWith('/labels')) return new Response('{}', { status: 422 })
    if (pathname.endsWith('/issues') && options.method === 'POST') return Response.json({ number: 7 }, { status: 201 })
    return Response.json({})
  }
  return { calls, fetchImpl }
}
const options = fetchImpl => ({ repository: 'GBM147/GALEOSTORE', token: 'token-local', fetchImpl, now: new Date('2026-11-06T22:30:00Z') })
const down = [{ name: 'API e banco de dados', url: 'https://loja.test/health', ok: false, detail: 'sem resposta em 20 s' }, { name: 'Loja (página inicial)', url: 'https://loja.test/', ok: true }]

test('queda abre um único aviso com etiqueta e detalhes', async () => {
  const { calls, fetchImpl } = github()
  assert.deepEqual(await syncIssue(down, options(fetchImpl)), { action: 'opened', number: 7 })
  assert.deepEqual(calls.map(call => call[0] + ' ' + call[1]), ['GET /issues?state=open&labels=' + LABEL + '&per_page=10', 'POST /labels', 'POST /issues'])
  const issue = calls.at(-1)[2]
  assert.equal(issue.title, 'Loja fora do ar')
  assert.deepEqual(issue.labels, [LABEL])
  assert.match(issue.body, /06\/11\/2026, 19:30 \(horário de Brasília\)/)
  assert.match(issue.body, /\*\*API e banco de dados\*\*: sem resposta em 20 s/)
  assert.equal(issue.body.includes('Loja (página inicial)'), false)
})

test('enquanto continua fora não repete o aviso; quando volta, comenta e fecha', async () => {
  const still = github([{ number: 7 }])
  assert.deepEqual(await syncIssue(down, options(still.fetchImpl)), { action: 'still-open', number: 7 })
  assert.equal(still.calls.length, 1)
  const back = github([{ number: 9, pull_request: {} }, { number: 7 }])
  assert.deepEqual(await syncIssue([{ ok: true }, { ok: true }], options(back.fetchImpl)), { action: 'closed', number: 7 })
  assert.deepEqual(back.calls.slice(1).map(call => call[0] + ' ' + call[1]), ['POST /issues/7/comments', 'PATCH /issues/7'])
  assert.equal(back.calls.at(-1)[2].state, 'closed')
  const quiet = github()
  assert.deepEqual(await syncIssue([{ ok: true }], options(quiet.fetchImpl)), { action: 'ok' })
  await assert.rejects(syncIssue([{ ok: true }], { repository: 'x', token: '' }), /GITHUB_REPOSITORY/)
})
