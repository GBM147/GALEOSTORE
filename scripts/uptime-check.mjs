#!/usr/bin/env node
// Checks the public store and its API. While something is down, one GitHub issue
// stays open (GitHub notifies by e-mail and app); it closes when the store is back.
// Run every 30 minutes by .github/workflows/uptime.yml.
import { pathToFileURL } from 'node:url'

export const LABEL = 'site-fora-do-ar'
export const TITLE = 'Loja fora do ar'

export function defaultTargets(base = 'https://galeo-store.netlify.app') {
  return [
    { name: 'Loja (página inicial)', url: base + '/', check: (status, body, type) => status === 200 && type.includes('text/html') && body.includes('id="root"') },
    { name: 'API e banco de dados', url: base + '/health', check: (status, body) => {
      if (status !== 200) return false
      try { const data = JSON.parse(body); return data.status === 'ok' && data.database === 'ok' } catch { return false }
    } }
  ]
}

// Three attempts, 20 s apart, so a single slow cold start never opens an alert.
export async function checkTargets(targets, { fetchImpl = fetch, attempts = 3, delayMs = 20000, timeoutMs = 20000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const results = []
  for (const target of targets) {
    let last = { ok: false, status: 0, detail: '' }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetchImpl(target.url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual', headers: { 'User-Agent': 'galeo-uptime-check' } })
        const body = await response.text()
        const ok = Boolean(target.check(response.status, body, response.headers.get('content-type') || ''))
        last = { ok, status: response.status, detail: ok ? '' : 'resposta inesperada (HTTP ' + response.status + ')' }
      } catch (error) {
        last = { ok: false, status: 0, detail: error?.name === 'TimeoutError' ? 'sem resposta em ' + timeoutMs / 1000 + ' s' : 'falha de conexão' }
      }
      if (last.ok) break
      if (attempt < attempts) await sleep(delayMs)
    }
    results.push({ name: target.name, url: target.url, ...last })
  }
  return results
}

export async function syncIssue(results, { repository, token, fetchImpl = fetch, now = new Date() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repository || '')) || !token) throw new Error('Informe GITHUB_REPOSITORY e GITHUB_TOKEN.')
  async function github(method, path, body) {
    const response = await fetchImpl('https://api.github.com/repos/' + repository + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }
    })
    // 422 on label creation means the label already exists.
    if (!response.ok && !(method === 'POST' && path === '/labels' && response.status === 422)) throw new Error(`GitHub ${method} ${path} respondeu ${response.status}`)
    return response.status === 204 ? null : response.json().catch(() => null)
  }
  const open = (await github('GET', '/issues?state=open&labels=' + LABEL + '&per_page=10')) || []
  const issue = open.find(item => !item.pull_request)
  const failing = results.filter(result => !result.ok)
  const when = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
  if (failing.length) {
    // One open alert at a time: no comment every 30 minutes while it stays down.
    if (issue) return { action: 'still-open', number: issue.number }
    await github('POST', '/labels', { name: LABEL, color: 'B60205', description: 'Aviso automático do monitoramento da loja' })
    const body = ['O monitoramento automático não conseguiu acessar a loja em ' + when + ' (horário de Brasília), depois de 3 tentativas.', '',
      ...failing.map(result => '- **' + result.name + '**: ' + result.detail + ' — ' + result.url), '', 'Este aviso fecha sozinho quando a loja voltar a responder.'].join('\n')
    const created = await github('POST', '/issues', { title: TITLE, body, labels: [LABEL] })
    return { action: 'opened', number: created?.number }
  }
  if (!issue) return { action: 'ok' }
  await github('POST', '/issues/' + issue.number + '/comments', { body: 'A loja voltou a responder em ' + when + ' (horário de Brasília).' })
  await github('PATCH', '/issues/' + issue.number, { state: 'closed', state_reason: 'completed' })
  return { action: 'closed', number: issue.number }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await checkTargets(defaultTargets(process.env.UPTIME_BASE_URL || undefined))
  for (const result of results) console.log((result.ok ? 'OK    ' : 'FALHA ') + result.name + (result.ok ? '' : ' — ' + result.detail))
  if (process.env.UPTIME_REPORT === 'true') {
    const outcome = await syncIssue(results, { repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN })
    console.log('Aviso no GitHub: ' + outcome.action + (outcome.number ? ' #' + outcome.number : ''))
  } else console.log('Aviso no GitHub não atualizado nesta execução.')
}
