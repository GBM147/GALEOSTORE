// Turns netlify.toml into what an API deploy needs: Netlify does not read
// netlify.toml for deploys of prebuilt files, so _redirects/_headers, the build
// environment and the function bundle settings come from here.
import { readFile } from 'node:fs/promises'
import { parse } from 'smol-toml'

export async function readNetlifyConfig(file) {
  return parse(await readFile(file, 'utf8'))
}

export function redirectsFile(config) {
  return (config.redirects || []).map(rule => {
    if (!rule.from || !rule.to) throw new Error('Regra de redirecionamento incompleta no netlify.toml.')
    return `${rule.from} ${rule.to} ${rule.status ?? 301}${rule.force ? '!' : ''}`
  }).join('\n') + '\n'
}

export function headersFile(config, { extraForAll = {} } = {}) {
  const blocks = (config.headers || []).map(rule => ({ path: rule.for, values: { ...(rule.values || {}) } }))
  if (Object.keys(extraForAll).length) {
    const all = blocks.find(block => block.path === '/*')
    if (all) Object.assign(all.values, extraForAll)
    else blocks.unshift({ path: '/*', values: { ...extraForAll } })
  }
  for (const block of blocks) {
    for (const [name, value] of Object.entries(block.values)) {
      if (/[\r\n]/.test(String(value)) || /[\r\n:]/.test(name)) throw new Error('Cabeçalho inválido no netlify.toml: ' + name)
    }
  }
  return blocks.map(block => block.path + '\n' + Object.entries(block.values).map(([name, value]) => `  ${name}: ${value}\n`).join('')).join('')
}

export function buildEnvironment(config) {
  return Object.fromEntries(Object.entries(config.build?.environment || {}).map(([name, value]) => [name, String(value)]))
}

export function functionsBundleConfig(config) {
  const settings = config.functions || {}
  const config_ = { '*': {
    nodeBundler: settings.node_bundler || 'esbuild',
    externalNodeModules: settings.external_node_modules || [],
    nodeVersion: String(config.build?.environment?.NODE_VERSION || '24')
  } }
  for (const [name, value] of Object.entries(settings)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.schedule) config_[name] = { schedule: value.schedule }
  }
  return config_
}
