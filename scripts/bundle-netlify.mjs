import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { zipFunctions } from '@netlify/zip-it-and-ship-it'

const basePath = fileURLToPath(new URL('..', import.meta.url))
const destination = fileURLToPath(new URL('../.netlify/functions-dist', import.meta.url))
await mkdir(destination, { recursive: true })
const bundles = await zipFunctions(fileURLToPath(new URL('../netlify/functions', import.meta.url)), destination, {
  basePath,
  config: {
    '*': { nodeBundler: 'esbuild', externalNodeModules: ['bcrypt'], nodeVersion: '24' },
    maintenance: { schedule: '10 6 * * *' }
  }
})
if (bundles.length !== 2 || !bundles.some(bundle => bundle.name === 'api') || !bundles.some(bundle => bundle.name === 'maintenance')) {
  throw new Error('Os pacotes da API e da manutenção não foram gerados.')
}
for (const bundle of bundles) console.log(`${bundle.name}: ${bundle.size} bytes (${bundle.runtime})`)
