import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildEnvironment, functionsBundleConfig, headersFile, readNetlifyConfig, redirectsFile } from './netlify-config.mjs'

const config = await readNetlifyConfig(fileURLToPath(new URL('../netlify.toml', import.meta.url)))

test('_redirects mantém a ordem do netlify.toml, com a página de pagamento antes do fallback do SPA', () => {
  const lines = redirectsFile(config).trim().split('\n')
  assert.deepEqual(lines, [
    '/api/* /.netlify/functions/api/api/:splat 200!',
    '/api /.netlify/functions/api/api 200!',
    '/health /.netlify/functions/api/health 200!',
    '/pagamento/* /.netlify/functions/api/pagamento/:splat 200!',
    '/* /index.html 200'
  ])
})

test('_headers inclui a CSP e só a homologação recebe noindex', () => {
  const production = headersFile(config)
  assert.match(production, /^\/\*\n {2}X-Content-Type-Options: nosniff\n/)
  assert.match(production, /\n {2}Content-Security-Policy: default-src 'self';[^\n]+https:\/\/www\.mercadolivre\.com/)
  assert.match(production, /\n\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable\n$/)
  assert.equal(production.includes('X-Robots-Tag'), false)
  assert.match(headersFile(config, { extraForAll: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' } }), /\n {2}X-Robots-Tag: noindex, nofollow, noarchive\n\/index\.html\n/)
  assert.throws(() => headersFile({ headers: [{ for: '/*', values: { 'X-Test': 'a\nb' } }] }), /Cabeçalho inválido/)
})

test('build e funções usam as configurações do netlify.toml', () => {
  assert.equal(buildEnvironment(config).VITE_DIRECT_UPLOADS, 'true')
  assert.equal(buildEnvironment(config).NODE_VERSION, '24')
  assert.equal('VITE_RENDER_KEEPALIVE' in buildEnvironment(config), false)
  assert.deepEqual(functionsBundleConfig(config), {
    '*': { nodeBundler: 'esbuild', externalNodeModules: ['bcrypt'], nodeVersion: '24' },
    maintenance: { schedule: '10 6 * * *' }
  })
})
