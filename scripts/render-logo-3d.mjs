// Renders the 3D GALEO logo files from tools/brand3d/render.html (run the Vite
// dev server first). Usage: node scripts/render-logo-3d.mjs [base URL] [folder for the full-size files]
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright')
const base = process.argv[2] || 'http://127.0.0.1:5173'
const exportDir = process.argv[3] || 'brand-3d-export'
const site = 'public'
mkdirSync(exportDir, { recursive: true })

const outputs = [
  // Full-size files for social media, print and documents.
  { file: join(exportDir, 'galeo-logo-3d.png'), width: 2048, height: 2048 },
  { file: join(exportDir, 'galeo-logo-3d-fundo-preto.png'), width: 2048, height: 2048, background: '#050505' },
  { file: join(exportDir, 'galeo-medalha-3d.png'), width: 1024, height: 1024, includeName: false },
  // Site images.
  { file: join(site, 'images/galeo-logo-3d.webp'), width: 1100, height: 1100, type: 'image/webp', quality: 0.88 },
  { file: join(site, 'images/galeo-logo-128.webp'), width: 128, height: 128, includeName: false, pose: { x: 0.04, y: -0.22 }, zoom: 1.08, type: 'image/webp', quality: 0.9 },
  { file: join(site, 'images/galeo-og.jpg'), width: 1200, height: 630, background: '#050505', zoom: 1.15, type: 'image/jpeg', quality: 0.9 },
  { file: join(site, 'favicon.png'), width: 64, height: 64, includeName: false, pose: { x: 0, y: -0.18 }, zoom: 1.12 }
]

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
page.on('pageerror', error => console.error('Página:', error.message))
await page.goto(base + '/tools/brand3d/render.html')
await page.waitForFunction(() => window.galeoReady === true)
for (const { file, ...options } of outputs) {
  const url = await page.evaluate(options => window.renderGaleo(options), options)
  writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
  console.log('ok', file)
}
await browser.close()
