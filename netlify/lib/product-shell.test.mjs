import assert from 'node:assert/strict'
import { test } from 'node:test'
import { injectProductMeta, ogImage, productIdFromPath, productMeta, productShellResponse } from './product-shell.mjs'

const origin = 'https://galeo.test'
const shellHtml = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Galeo Store — moda com identidade." />
    <meta property="og:title" content="Galeo Store" />
    <meta property="og:image" content="https://galeo-store.netlify.app/images/galeo-og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <title>Galeo Store</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`
const staticShell = async () => new Response(shellHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'", 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex', 'Set-Cookie': 'x=1' } })
const product = { id: 12, name: 'Camisa <Linho> "Verão"', brand: 'Galeo', category: 'Camisas', price: '189.90', stock: 3, description: '<p>Camisa leve de linho.</p>', image: 'https://res.cloudinary.com/galeo/image/upload/v17/produtos/camisa.jpg' }

test('apenas /produto/<número> recebe a página com prévia', () => {
  assert.equal(productIdFromPath('/produto/12'), 12)
  assert.equal(productIdFromPath('/produto/12/'), 12)
  for (const path of ['/produto/0', '/produto/abc', '/produto/12/x', '/produto/', '/shop', '/produto/1234567890123']) assert.equal(productIdFromPath(path), 0)
})

test('imagem da prévia usa recorte 1200x630 do Cloudinary e fallback absoluto', () => {
  assert.equal(ogImage(product.image, origin), 'https://res.cloudinary.com/galeo/image/upload/c_fill,g_auto,w_1200,h_630,q_auto,f_jpg/v17/produtos/camisa.jpg')
  assert.equal(ogImage('/images/peca.webp', origin), 'https://galeo.test/images/peca.webp')
  assert.equal(ogImage('', origin), 'https://galeo.test/images/galeo-og.jpg')
  assert.equal(ogImage('javascript:alert(1)', origin), 'https://galeo.test/images/galeo-og.jpg')
})

test('metadados trazem nome, preço, disponibilidade e texto sem HTML', () => {
  const meta = productMeta(product, origin)
  assert.equal(meta.title, 'Camisa <Linho> "Verão" | Galeo Store')
  assert.equal(meta.description, 'Camisa leve de linho.')
  assert.equal(meta.url, 'https://galeo.test/produto/12')
  assert.deepEqual(meta.structured.offers, { '@type': 'Offer', url: 'https://galeo.test/produto/12', price: '189.90', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' })
  assert.match(productMeta({ id: 3, name: 'Boné', brand: 'Marca', price: 0 }, origin).description, /^Boné — Marca na Galeo Store\.$/)
  assert.equal(productMeta({ id: 3, name: 'Boné', price: 0 }, origin).structured.offers, undefined)
  assert.ok(productMeta({ id: 4, name: 'x', description: 'palavra '.repeat(60) }, origin).description.length <= 160)
})

test('HTML substitui título e descrição, remove OG padrão e escapa tudo', () => {
  const html = injectProductMeta(shellHtml, productMeta(product, origin))
  assert.match(html, /<title>Camisa &lt;Linho&gt; &quot;Verão&quot; \| Galeo Store<\/title>/)
  assert.equal((html.match(/property="og:title"/g) || []).length, 1)
  assert.equal(html.includes('galeo-store.netlify.app/images/galeo-og.jpg'), false)
  assert.equal((html.match(/name="twitter:card"/g) || []).length, 1)
  assert.match(html, /<link rel="canonical" href="https:\/\/galeo\.test\/produto\/12" \/>/)
  assert.match(html, /<meta property="product:price:amount" content="189\.90" \/>/)
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1]
  assert.equal(JSON.parse(jsonLd).name, 'Camisa <Linho> "Verão"')
  assert.equal(jsonLd.includes('<'), false)
  assert.match(html, /<script type="module" crossorigin src="\/assets\/index-abc\.js"><\/script>/)
})

test('resposta mantém os cabeçalhos de segurança e usa cache curto do CDN', async () => {
  const response = await productShellResponse(new Request(origin + '/produto/12'), { productId: 12, origin, fetchShell: staticShell, loadProduct: async id => ({ ...product, id }) })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-security-policy'), "default-src 'self'; script-src 'self'")
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('netlify-cdn-cache-control'), 'public, s-maxage=300, stale-while-revalidate=600')
  assert.match(await response.text(), /og:title" content="Camisa/)
})

test('produto inexistente não é indexado e falha da consulta não fica em cache', async () => {
  const missing = await productShellResponse(new Request(origin + '/produto/99'), { productId: 99, origin, fetchShell: staticShell, loadProduct: async () => null })
  assert.match(await missing.text(), /<meta name="robots" content="noindex" \/>/)
  assert.equal(missing.headers.get('netlify-cdn-cache-control'), null)
  const failing = await productShellResponse(new Request(origin + '/produto/5'), { productId: 5, origin, fetchShell: staticShell, loadProduct: async () => { throw new Error('db') } })
  assert.equal(failing.status, 200)
  assert.equal(failing.headers.get('cache-control'), 'no-store')
  assert.equal((await failing.text()).includes('noindex'), false)
  const noShell = await productShellResponse(new Request(origin + '/produto/5'), { productId: 5, origin, fetchShell: async () => { throw new Error('offline') }, loadProduct: async () => product })
  assert.equal(noShell.status, 503)
  const post = await productShellResponse(new Request(origin + '/produto/5', { method: 'POST' }), { productId: 5, origin, fetchShell: staticShell, loadProduct: async () => product })
  assert.equal(post.status, 405)
})
