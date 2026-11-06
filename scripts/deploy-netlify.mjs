#!/usr/bin/env node
// Publishes GALEO to an existing Netlify project through the API (no Git build).
//
//   NETLIFY_AUTH_TOKEN=... npm run deploy:netlify -- --site <project id> [--noindex] [--message "..."]
//   npm run deploy:netlify -- --dry-run [--noindex]      (prepares everything, sends nothing)
//
// Every production deploy costs Netlify credits (15 on the Free plan).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipFunctions } from '@netlify/zip-it-and-ship-it'
import { buildEnvironment, functionsBundleConfig, headersFile, readNetlifyConfig, redirectsFile } from './netlify-config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const api = 'https://api.netlify.com/api/v1'

function options(argv) {
  const result = { site: '', message: '', noindex: false, dryRun: false, skipBuild: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--site') result.site = argv[++index] || ''
    else if (arg === '--message') result.message = argv[++index] || ''
    else if (arg === '--noindex') result.noindex = true
    else if (arg === '--dry-run') result.dryRun = true
    else if (arg === '--skip-build') result.skipBuild = true
    else throw new Error('Opção desconhecida: ' + arg)
  }
  if (!result.dryRun && !/^[0-9a-f-]{36}$/.test(result.site)) throw new Error('Informe --site com o ID do projeto Netlify.')
  return result
}

async function files(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await files(full))
    else if (entry.isFile()) found.push(full)
  }
  return found
}

const digest = (algorithm, data) => createHash(algorithm).update(data).digest('hex')

async function call(method, url, body, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(api + url, { method, body, headers: { Authorization: 'Bearer ' + process.env.NETLIFY_AUTH_TOKEN, ...headers } })
    if (response.ok) return response.status === 204 ? null : response.json()
    const text = (await response.text()).slice(0, 300)
    if (attempt >= 4 || response.status < 500) throw new Error(`${method} ${url} respondeu ${response.status}: ${text}`)
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
  }
}

const opts = options(process.argv.slice(2))
if (!opts.dryRun && !process.env.NETLIFY_AUTH_TOKEN) throw new Error('Defina NETLIFY_AUTH_TOKEN. Nunca grave o token no repositório.')
const config = await readNetlifyConfig(path.join(root, 'netlify.toml'))
const publish = path.join(root, config.build?.publish || 'dist')

if (!opts.skipBuild) {
  // Git builds read [build.environment]; an API deploy must apply it itself.
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, ...buildEnvironment(config) } })
  if (build.status !== 0) throw new Error('O build falhou.')
}
await writeFile(path.join(publish, '_redirects'), redirectsFile(config))
await writeFile(path.join(publish, '_headers'), headersFile(config, opts.noindex ? { extraForAll: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' } } : {}))

const functionsOut = path.join(root, '.netlify/functions-dist')
await rm(functionsOut, { recursive: true, force: true })
await mkdir(functionsOut, { recursive: true })
const bundles = await zipFunctions(path.join(root, config.build?.functions || 'netlify/functions'), functionsOut, { basePath: root, config: functionsBundleConfig(config) })

const fileDigests = {}, filesBySha = new Map()
for (const full of await files(publish)) {
  const urlPath = '/' + path.relative(publish, full).split(path.sep).join('/')
  const sha = digest('sha1', await readFile(full))
  fileDigests[urlPath] = sha
  filesBySha.set(sha, [...(filesBySha.get(sha) || []), urlPath])
}
const functionDigests = {}, bundlesBySha = new Map()
for (const bundle of bundles) {
  const sha = digest('sha256', await readFile(bundle.path))
  functionDigests[bundle.name] = sha
  bundlesBySha.set(sha, bundle)
}
const schedules = bundles.filter(bundle => bundle.schedule).map(bundle => ({ name: bundle.name, cron: bundle.schedule }))
console.log(`Preparado: ${Object.keys(fileDigests).length} arquivos, funções ${bundles.map(bundle => bundle.name).join(', ')}, agendamentos ${schedules.map(item => item.name + ' ' + item.cron).join(', ') || 'nenhum'}.`)
if (opts.dryRun) process.exit(0)

let deploy = await call('POST', `/sites/${opts.site}/deploys`, JSON.stringify({
  title: opts.message || undefined, draft: false, async: false, framework: 'vite',
  files: fileDigests, functions: functionDigests, function_schedules: schedules,
  functions_config: Object.fromEntries(bundles.map(bundle => [bundle.name, {
    build_data: { bootstrapVersion: bundle.bootstrapVersion, runtimeAPIVersion: bundle.runtimeAPIVersion },
    priority: bundle.priority, routes: bundle.routes, excluded_routes: bundle.excludedRoutes
  }]))
}), { 'Content-Type': 'application/json' })
for (const sha of deploy.required || []) {
  for (const urlPath of filesBySha.get(sha) || []) {
    await call('PUT', `/deploys/${deploy.id}/files${urlPath.split('/').map(encodeURIComponent).join('/')}`, await readFile(path.join(publish, urlPath.slice(1))), { 'Content-Type': 'application/octet-stream' })
  }
}
for (const sha of deploy.required_functions || []) {
  const bundle = bundlesBySha.get(sha)
  const query = new URLSearchParams({ runtime: bundle.runtimeVersion || bundle.runtime, ...(bundle.invocationMode ? { invocation_mode: bundle.invocationMode } : {}) })
  await call('PUT', `/deploys/${deploy.id}/functions/${encodeURIComponent(bundle.name)}?${query}`, await readFile(bundle.path), { 'Content-Type': 'application/octet-stream' })
}
for (let check = 0; check < 100 && !['ready', 'error'].includes(deploy.state); check++) {
  await new Promise(resolve => setTimeout(resolve, 3000))
  deploy = await call('GET', `/deploys/${deploy.id}`)
}
console.log(`Deploy ${deploy.id}: ${deploy.state}${deploy.error_message ? ' — ' + deploy.error_message : ''}`)
if (deploy.state !== 'ready') process.exitCode = 1
