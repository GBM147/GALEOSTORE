import { readFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import { parse } from 'smol-toml'
import { addScriptNonce, createNonce, injectScriptNonce, isPaymentShellPath } from '../netlify/lib/payment-shell.mjs'
import { storeIndexable } from './seo.js'

// The classic server (npm start, used by the Render test copy) serves the built
// site with the same security headers Netlify applies from netlify.toml, the
// per-request nonce on the payment page and noindex outside production.
export function siteHeaders(configText, env = process.env) {
  const rules = parse(String(configText)).headers || []
  const valuesFor = pattern => ({ ...(rules.find(rule => rule.for === pattern)?.values || {}) })
  const all = valuesFor('/*')
  if (!storeIndexable(env)) all['X-Robots-Tag'] = 'noindex, nofollow, noarchive'
  return { all, assets: valuesFor('/assets/*') }
}

export function paymentShell(html, policy, nonce = createNonce()) {
  return { html: injectScriptNonce(html, nonce), policy: policy ? addScriptNonce(policy, nonce) : '' }
}

export function registerStaticSite(app, { dist, configFile, env = process.env }) {
  const headers = siteHeaders(readFileSync(configFile, 'utf8'), env)
  const apply = (res, values) => { for (const [name, value] of Object.entries(values)) res.setHeader(name, value) }
  let shell = null
  const index = () => (shell ??= readFileSync(path.join(dist, 'index.html'), 'utf8'))

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/') && req.path !== '/health') apply(res, headers.all)
    next()
  })
  app.get(/^\/pagamento\/[^/]+\/?$/, (req, res, next) => {
    if (!isPaymentShellPath(req.path)) return next()
    const page = paymentShell(index(), headers.all['Content-Security-Policy'])
    if (page.policy) res.setHeader('Content-Security-Policy', page.policy)
    res.setHeader('Cache-Control', 'no-store')
    res.type('html').send(page.html)
  })
  app.use(express.static(dist, {
    setHeaders(res, filePath) {
      if (String(filePath).endsWith(path.sep + 'index.html')) res.setHeader('Cache-Control', 'no-store')
      else if (String(filePath).includes(path.sep + 'assets' + path.sep)) apply(res, headers.assets)
    }
  }))
  app.get(/^(?!\/api\/|\/health$).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.type('html').send(index())
  })
}
