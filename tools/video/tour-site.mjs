// Tour of the store for customers: Home, catalog, product, cart, payment,
// account and footer, with narration. Usage (Vite on :5173):
//   node tools/video/tour-site.mjs <output folder>
import { createRecorder } from './recorder.mjs'
import { createDemoApi } from './demo-store.mjs'

const out = process.argv[2]
if (!out) throw new Error('Informe a pasta de saída.')
const rec = await createRecorder({ name: 'galeo-tour-do-site', out, api: createDemoApi(), width: 1920, height: 1080, scale: 4 / 3, captionFont: 26, captionBottom: 34 })
const { page } = rec

await rec.start('/')
await rec.chapter('Tour da loja', 'Como comprar na GALEO', 'Do catálogo ao pagamento, em poucos minutos.', 3600)
await rec.say('Bem-vindo à GALEO! Este é o site da loja: aqui você vê as novidades, escolhe as suas peças e paga com segurança.')
await rec.point('.desktop-nav', { ms: 900 })
await rec.say('No topo ficam o menu com as categorias, a busca, a sua conta e a sacola de compras.')
await rec.point('.bag-link', { ms: 700 })
await rec.unring()

await rec.scrollToElement('[data-home-section="categories"]', 90)
await rec.say('Logo abaixo, as categorias levam direto ao estilo que você procura.')
await rec.scrollToElement('[data-home-section="featured_products"]', 90)
await rec.say('Na Seleção da semana aparecem as peças que acabaram de chegar.')
await rec.scrollToElement('[data-home-section="campaigns"]', 90)
await rec.say('E as campanhas mostram as coleções em destaque.', { hold: 200 })

await rec.goto('/shop')
await rec.say('No catálogo, você vê todas as peças da loja.')
await rec.type('.catalog-search input', 'moletom')
await rec.click('.catalog-search button[type="submit"]', { after: 900 })
await rec.say('Use a busca para encontrar uma peça pelo nome, pela marca ou pela categoria.')
await page.locator('.catalog-search input').fill('')
await rec.click('.catalog-search button[type="submit"]', { after: 600 })
await rec.click(page.getByRole('button', { name: 'Camisetas', exact: true }).first(), { after: 900 })
await rec.say('Ou filtre por categoria, marca e tamanho, e escolha a ordem que preferir.')
await rec.point('select[aria-label="Ordenar produtos"]')
await page.locator('select[aria-label="Ordenar produtos"]').selectOption({ index: 1 }).catch(() => {})
await rec.pause(900)
await rec.unring()

await rec.click(page.locator('.product-card').first(), { after: 1200 })
await rec.say('Ao abrir uma peça, você vê as fotos, a descrição e o preço.')
await rec.click(page.locator('.product-size-option').nth(1))
await rec.say('Escolha o tamanho. Os tamanhos sem estoque ficam indisponíveis.')
await rec.click(page.getByRole('button', { name: /Adicionar ao carrinho/ }).first(), { after: 1000 })
await rec.say('E toque em Adicionar ao carrinho.')

await rec.click('.bag-link', { after: 1300 })
await rec.say('Na sacola, você confere as peças, o tamanho e o total.')
await rec.type('#shipping-postal-code', '01310100', { delay: 90 })
await rec.pause(1200)
await rec.say('Digite o seu CEP: o endereço é preenchido sozinho.')
await rec.click(page.getByRole('button', { name: 'Calcular frete', exact: true }), { after: 1200 })
await rec.say('Toque em Calcular frete e escolha a entrega, com o valor e o prazo de cada opção.')
await rec.click(page.locator('.shipping-option').nth(1), { after: 800 })
await rec.type(page.getByLabel('Número', { exact: true }), '1000')
await rec.say('Complete o número e, se precisar, o complemento.')
await rec.click('label.terms-accept input', { after: 600 })
await rec.say('Marque que leu e concorda com os Termos de Uso e a Política de Trocas e Devoluções.')
await rec.click(page.getByRole('button', { name: /Solicitar pedido/ }), { after: 2200 })

await rec.say('Na tela de pagamento, você paga com Pix ou cartão. O pagamento é processado pelo Mercado Pago, com segurança.')
await rec.type(page.getByLabel('CPF do comprador'), '12345678909', { delay: 70 })
await rec.click(page.getByRole('button', { name: 'Gerar Pix', exact: true }), { after: 1600 })
await rec.say('No Pix, informe o CPF e toque em Gerar Pix. Depois, é só ler o QR Code ou copiar o código no aplicativo do seu banco.')
await rec.scrollTo(260)
await rec.pause(1500)

await rec.goto('/conta')
await rec.pause(800)
await rec.say('Em Minha conta, você acompanha os seus pedidos e o andamento de cada um.')

await rec.goto('/')
await page.locator('.site-footer').scrollIntoViewIfNeeded()
await rec.scrollToElement('.site-footer-review', 80)
await rec.point('.site-footer-review-stars', { ms: 800 })
await rec.say('Comprou com a gente? Toque nas estrelas e conte no Google como foi a sua experiência.')
await rec.point('nav[aria-label="Institucional"]', { ms: 800 })
await rec.say('No rodapé também ficam o contato e as políticas da loja: termos, privacidade, trocas e entregas.')
await rec.unring()
await rec.scrollTo(0, 1600)
await rec.click('.mode-button', { after: 1200 })
await rec.say('Prefere o fundo claro? O botão do tema muda as cores do site.')
await rec.click('.mode-button', { after: 900 })
await rec.say('Pronto! Agora é só escolher a sua próxima peça. GALEO: vista o que representa você.')
await rec.chapter('GALEO STORE', 'Vista o que representa você', '@galeostoreofc', 3200)

const result = await rec.finish()
console.log(JSON.stringify({ mp4: result.mp4, srt: result.srt, segundos: Math.round(result.total) }))
