// Admin tutorial for the owners, one video with chapters: login, overview,
// products with photos, orders, point of sale, sales, expenses, media, store
// editor and the remaining areas. Usage (Vite on :5173):
//   node tools/video/tutorial-admin.mjs <output folder>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRecorder } from './recorder.mjs'
import { createDemoApi, images } from './demo-store.mjs'

const out = process.argv[2]
if (!out) throw new Error('Informe a pasta de saída.')
const rec = await createRecorder({ name: 'galeo-tutorial-admin', out, api: createDemoApi({ adminLoggedIn: false }), width: 1920, height: 1080, scale: 4 / 3, captionFont: 25, captionBottom: 30 })
const { page, context } = rec

// Two product photos for the upload step (the demo pictures as PNG files).
const photos = []
{
  const helper = await context.newPage()
  for (const key of ['108', '101']) {
    await helper.setContent(`<body style="margin:0">${images[key]}</body>`)
    await helper.setViewportSize({ width: 800, height: 1000 })
    const file = join(out, 'foto-' + key + '.png')
    writeFileSync(file, await helper.screenshot({ clip: { x: 0, y: 0, width: 800, height: 1000 } }))
    photos.push(file)
  }
  await helper.close()
}
const nav = name => page.locator('.admin-nav', { hasText: name }).first()
// Optional steps: a changed button name does not stop the whole recording.
const soft = async (label, fn) => { try { await fn() } catch (error) { console.log('[passo ignorado]', label, error.message.split('\n')[0]) } }
const dialog = name => page.getByRole('dialog', { name, exact: true })

await rec.start('/admin')
await rec.chapter('Tutorial para os donos', 'Como cuidar da loja GALEO', 'Produtos, pedidos, vendas, gastos e o visual da loja.', 3800)

// 1. Entrar
await rec.chapter('Capítulo 1', 'Entrar no painel', '', 2200)
await rec.say('O painel da loja fica no endereço do site, com barra admin no final. Entre com o e-mail e a senha de dono.')
await rec.type('input[placeholder="E-mail"]', 'dono@galeostore.com.br', { delay: 35 })
await rec.type('input[placeholder="Senha"]', 'senha-de-exemplo', { delay: 35 })
await rec.click(page.getByRole('button', { name: /Entrar/ }), { after: 1600 })
await rec.point(page.getByRole('button', { name: 'Alterar senha', exact: true }))
await rec.say('Na primeira vez, troque a senha provisória por uma senha forte, em Alterar senha.')
await rec.unring()

// 2. Visão geral
await rec.chapter('Capítulo 2', 'Visão geral', '', 2200)
await rec.say('A Visão geral mostra, num olhar, os produtos na loja, o estoque e as vendas do mês.')
await rec.point('.admin-content, main', { ms: 600, ring: false })
await rec.pause(1200)

// 3. Cadastrar produto
await rec.chapter('Capítulo 3', 'Cadastrar um produto', 'Quatro passos: o básico, fotos, tamanhos e publicar.', 3000)
await rec.click(nav('Produtos e estoque'), { after: 1200 })
await rec.say('Em Produtos e estoque ficam todas as peças, com busca e filtros. Para cadastrar, toque em Novo produto.')
await rec.click(page.getByRole('button', { name: '+ Novo produto', exact: true }), { after: 1000 })
const wizard = dialog('Cadastrar produto')
await rec.say('Passo um, o básico: o nome da peça, a categoria e o preço de venda.')
await rec.type(wizard.getByLabel('Nome', { exact: true }), 'Camiseta Medalha Dourada', { delay: 40 })
await rec.click(wizard.getByRole('button', { name: 'Camisetas', exact: true }), { after: 500 })
await rec.type(wizard.getByLabel('Preço de venda', { exact: true }), '139.90', { delay: 70 })
await rec.click(wizard.getByRole('button', { name: 'Continuar', exact: true }), { after: 1400 })

await rec.say('Passo dois, as fotos. No celular, dá para tirar a foto na hora. No computador, escolha as fotos ou arraste para cá.')
await rec.point(wizard.getByRole('button', { name: /Escolher fotos/ }).first())
await wizard.getByLabel('Escolher fotos do produto').setInputFiles(photos)
await rec.unring()
await rec.pause(2200)
await rec.say('As fotos sobem na hora. A primeira vira a capa, e você pode trocar a capa e a ordem quando quiser.')
await rec.click(wizard.getByRole('button', { name: 'Continuar', exact: true }), { after: 1200 })

await rec.say('Passo três, tamanhos e estoque. Toque em Sim, tem tamanhos, escolha a grade e a quantidade de cada um.')
await rec.click(wizard.getByRole('button', { name: 'Sim, tem tamanhos', exact: true }), { after: 600 })
for (const size of ['P', 'M', 'G']) await rec.click(wizard.getByRole('group', { name: 'Tamanhos mais comuns' }).getByRole('button', { name: size, exact: true }), { after: 300, ms: 450 })
for (const [size, times] of [['p', 2], ['m', 3], ['g', 2]]) for (let i = 0; i < times; i++) await rec.click(wizard.getByRole('button', { name: 'Aumentar quantidade do tamanho ' + size, exact: true }), { after: 150, ms: 350 })
await rec.say('A embalagem do frete já vem sugerida pela categoria.')
await rec.click(wizard.getByRole('button', { name: 'Continuar', exact: true }), { after: 1400 })

await rec.say('Passo quatro: confira a prévia, igual na loja, e a lista de conferência. Está tudo certo? Toque em Publicar na loja.')
await rec.click(wizard.getByRole('button', { name: 'Publicar na loja', exact: true }), { after: 1600 })
await rec.say('Pronto: a peça já aparece no site. Se preferir, deixe como rascunho e publique depois.')
await soft('fechar cadastro', () => rec.click(page.getByRole('button', { name: 'Voltar para a lista', exact: true }), { after: 900 }))

// 4. Editar
await rec.chapter('Capítulo 4', 'Editar produto e estoque', '', 2200)
await rec.type('input[placeholder="Buscar por nome, marca ou categoria"]', 'moletom', { delay: 60 })
await rec.pause(700)
await rec.say('Para mudar preço, fotos ou estoque, busque a peça e toque em Editar. Os passos viram abas, e Salvar produto grava tudo.')
await soft('editar', () => rec.click(page.getByRole('button', { name: 'Editar', exact: true }).first(), { after: 1400 }))
await rec.pause(1800)
await soft('fechar edição', () => rec.click(page.getByRole('button', { name: 'Fechar', exact: true }).first(), { after: 600 }))
await page.keyboard.press('Escape')
await rec.pause(600)
await page.locator('input[placeholder="Buscar por nome, marca ou categoria"]').fill('')

// 5. Pedidos do site
await rec.chapter('Capítulo 5', 'Pedidos do site', '', 2200)
await rec.click(nav('Pedidos do site'), { after: 1200 })
await rec.say('Em Pedidos do site chegam as compras feitas pela loja online, com o status e o total.')
await soft('abrir pedido', () => rec.click(page.getByRole('button', { name: 'Abrir', exact: true }).first(), { after: 1200 }))
await rec.say('Abra o pedido para ver o cliente, o pagamento, o endereço, o frete escolhido e as peças. O aceite dos Termos também fica registrado.')
await soft('status', async () => { await rec.point('.online-order-status select'); await page.locator('.online-order-status select').selectOption('PREPARING') })
await rec.say('Quando for separar ou enviar, atualize o status. O cliente acompanha tudo em Minha conta.')
await soft('salvar status', () => rec.click(page.getByRole('button', { name: 'Salvar status', exact: true }), { after: 1200 }))
await page.getByRole('button', { name: 'Voltar', exact: true }).click().catch(() => {})

// 6. Frente de caixa
await rec.chapter('Capítulo 6', 'Frente de caixa', 'Vendas da loja física, com baixa no estoque.', 2600)
await rec.click(nav('Frente de caixa'), { after: 1400 })
await rec.say('Vendeu na loja física? Use a Frente de caixa: toque no tamanho da peça para colocar na venda.')
await soft('pdv camiseta', () => rec.click(page.getByRole('button', { name: /Adicionar Camiseta Oversized Medalha tamanho M/ }), { after: 600 }))
await soft('pdv boné', () => rec.click(page.getByRole('button', { name: /Adicionar Boné GALEO Aba Curva/ }).first(), { after: 600 }))
await soft('pdv pagamento', async () => { await rec.point(page.getByLabel(/Forma de pagamento/)); await page.getByLabel(/Forma de pagamento/).selectOption('PIX') })
await rec.say('Escolha como o cliente pagou, confira o pagamento e confirme. O estoque baixa sozinho.')
await soft('registrar venda', () => rec.click(page.getByRole('button', { name: 'Confirmar pagamento e registrar venda', exact: true }), { after: 1600 }))

// 7. Histórico
await rec.click(nav('Histórico de vendas'), { after: 1200 })
await rec.say('No Histórico de vendas ficam todas as vendas registradas, da loja e do site.')

// 8. Gastos
await rec.chapter('Capítulo 7', 'Gastos da loja', '', 2200)
await rec.click(nav('Gastos da loja'), { after: 1200 })
await rec.say('Em Gastos da loja, registre cada despesa: só a descrição, o valor e a data.')
await rec.click(page.getByRole('button', { name: '+ Registrar gasto', exact: true }), { after: 900 })
await rec.type(page.getByLabel('Descrição do gasto'), 'Sacolas personalizadas', { delay: 45 })
await rec.type(page.getByLabel('Valor gasto'), '180', { delay: 80 })
await soft('salvar gasto', () => rec.click(page.getByRole('button', { name: 'Salvar gasto', exact: true }), { after: 1200 }))
await rec.click(nav('Gastos recorrentes'), { after: 1200 })
await rec.say('Contas de todo mês, como aluguel e internet, ficam em Gastos recorrentes. Quando pagar, toque em Registrar gasto.')

// 9. Biblioteca
await rec.click(nav('Biblioteca de mídia'), { after: 1400 })
await rec.say('A Biblioteca de mídia guarda todas as fotos e vídeos da loja, para usar nos produtos e na página inicial.')

// 10. Editor da loja
await rec.chapter('Capítulo 8', 'Editor da loja', 'O visual da página inicial, sem mexer em código.', 3000)
await rec.click(nav('Editor da loja'), { after: 2600 })
await page.getByRole('toolbar', { name: 'Editor visual da loja' }).waitFor().catch(() => {})
await rec.say('No Editor da loja, à esquerda ficam as partes da página, na ordem. Dá para mostrar, ocultar e mudar a ordem.')
const panel = page.getByRole('complementary', { name: 'Painel do editor', exact: true })
await soft('capa', () => rec.click(panel.getByRole('button', { name: /Capa/ }).first(), { after: 1400 }))
await rec.say('Ao abrir a Capa, você troca a foto ou o vídeo, escolhe as palavras em dourado e para onde o botão leva.')
const words = page.getByRole('group', { name: /Palavras em dourado/ }).first()
await rec.click(words.getByRole('button', { name: 'Vista', exact: true }), { after: 700 }).catch(() => {})
await rec.click(words.getByRole('button', { name: 'Vista', exact: true }), { after: 500 }).catch(() => {})
const destination = page.getByRole('combobox', { name: 'Para onde o botão leva', exact: true })
await soft('destino', async () => { await rec.point(destination); await destination.selectOption('category') })
await rec.pause(900)
await rec.say('O destino do botão é escolhido na lista: o catálogo, uma categoria, um produto ou o WhatsApp.')
await rec.unring()
await page.keyboard.press('Escape').catch(() => {})
await rec.pause(500)
await soft('dados da empresa', () => rec.click(panel.getByRole('button', { name: /Dados da empresa/ }), { after: 1200 }))
await rec.say('Em Dados da empresa, preencha a razão social, o CNPJ, o endereço e o atendimento. Eles aparecem no contato, nos termos e no rodapé.')
await rec.pause(800)
await soft('salvar rascunho', () => rec.point(page.getByRole('button', { name: 'Salvar rascunho', exact: true }).first()))
await rec.say('Tudo fica num rascunho: a loja só muda quando você salva o rascunho e toca em Publicar alterações.')
await rec.unring()

// 11. Entregas e erros
await rec.chapter('Capítulo 9', 'Entregas e avisos', '', 2200)
await rec.goto('/admin?tab=shipping')
await rec.pause(1200)
await rec.say('Em Entregas fica a conexão com o Melhor Envio, que calcula o frete do site.')
await rec.goto('/admin?tab=errors')
await rec.pause(1000)
await rec.say('E em Erros recentes, o sistema avisa se algo deu errado no site, para a gente corrigir.')
await rec.say('Pronto! Sempre que precisar, volte a este vídeo e pule direto para o capítulo que quiser.')
await rec.chapter('GALEO STORE', 'Bom trabalho!', 'Dúvidas? Fale com o suporte técnico da loja.', 3200)

const result = await rec.finish({ crf: 26 })
const stamp = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
writeFileSync(join(out, 'galeo-tutorial-capitulos.txt'), 'Tutorial do Admin — capítulos\n\n' + result.chapters.filter(chapter => chapter.title !== 'Bom trabalho!').map(chapter => `${stamp(chapter.start)}  ${chapter.title}`).join('\n') + '\n')
console.log(JSON.stringify({ mp4: result.mp4, segundos: Math.round(result.total) }))
