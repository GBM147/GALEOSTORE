# Plano de melhorias da GALEO Store

Verificação de 06/11/2026: documentação do projeto, código, dependências e
navegação real em https://galeo-store.netlify.app (computador e celular, sem
login e sem pedidos). Marque `[x]` ao concluir. **Donos** = depende de dados,
contas ou decisões da loja; **Técnico** = pode ser feito no código.

## 1. Antes de vender online

- [ ] **Mercado Pago — concluir a homologação** (Técnico, após 29/11, quando os
  créditos do Netlify renovam): publicar a branch `fix/mercado-pago-device-nonce`
  na homologação, fechar o item Notificações (95/100 hoje), testar pelo site
  cartão aprovado, recusado, Pix e estorno, e passar a branch para a `main`.
- [ ] **Mercado Pago — ativar em produção** (Donos + Técnico): credenciais de
  produção, webhook de produção (URL, assinatura secreta e evento Order),
  `MERCADO_PAGO_MODE=production`, compra real de valor baixo e estorno.
- [ ] **Catálogo real** (Donos): só 2 produtos estão no ar e os dois aparecem com
  a imagem provisória. Faltam fotos, descrições, preços, tamanhos e estoque
  conferidos, além de peso e medidas da embalagem para o frete.
- [ ] **Páginas obrigatórias** (Donos enviam os dados; Técnico cria): Contato
  com razão social, CNPJ, endereço, WhatsApp, e-mail e horários; Política de
  Privacidade (LGPD); Termos de Uso; Trocas e Devoluções, com o arrependimento em
  7 dias; e Entregas. O Decreto 7.962/2013 exige identificação e contato visíveis.
  Hoje `/contato`, `/privacidade`, `/termos` e `/trocas` mostram página vazia.
- [ ] **Rodapé com links** (Técnico, junto com as páginas acima): políticas, contato, Instagram, WhatsApp e
  formas de pagamento. O rodapé atual não tem nenhum link.
- [x] **Página 404** (Técnico): página "Página não encontrada" com `noindex` e links para o catálogo e o início. Feito em 06/11, publica junto com o próximo deploy.
- [ ] **Produtos e categorias de teste na vitrine** (Donos): a produção mostra os produtos "teste" e "teste2" (R$ 50, sem categoria e sem foto) e a categoria "Nova categoria". Remover ou substituir antes de divulgar.
- [ ] **Conteúdo da Home** (Donos): campanhas e categorias no CMS estão sem
  textos e mídias; a logo aparece repetida no lugar das fotos e há cards vazios.
- [ ] **Teste de cadastro real** (Donos): o cadastro de clientes já está aberto na
  produção. Confirmar com um e-mail real que a confirmação chega, e trocar a
  senha provisória do Admin.

## 2. Importante: segurança, estabilidade e custos

- [x] **Dependências vulneráveis** (Técnico, 06/11: produção sem vulnerabilidades; `mysql2` interno do `express-mysql-session` forçado para a versão corrigida; restam 10 moderadas só no empacotador de funções do Netlify, ferramenta de desenvolvimento): `npm audit` aponta 3 altas
  (`body-parser`, `multer`, `mysql2`) e 3 moderadas (`qs`, `ip-address`,
  `express-mysql-session`). Atualizar e rodar todas as suítes.
- [x] **Script de publicação no repositório** (Técnico, 06/11: `npm run deploy:netlify`, ver hospedagem-netlify.md): build com as variáveis
  `VITE_*` do `netlify.toml`, geração de `_headers`/`_redirects`, pacote das
  funções e envio pela API. Os scripts usados pelo Codex não estão no repositório.
  O deploy manual de 06/11 na homologação saiu sem essas variáveis, o que causa os
  erros de WebSocket (`/ws`) lá; a produção não foi afetada.
- [x] **Remover legados do Render** (Técnico, 06/11): keep-alive por WebSocket no site e na API, `render.yaml` (com `DB_SSL_REJECT_UNAUTHORIZED=false`) e `render-serve/`.
- [ ] **API Go** (Donos decidem): o catálogo opcional em `go-api/` não é usado pela loja publicada; remover se não houver planos para ele.
- [ ] **Créditos do Netlify** (Donos): cada publicação gasta 15 dos 300 créditos
  mensais e o saldo de novembro acabou em 06/11. Ativar o alerta de créditos,
  juntar mudanças em poucas publicações e decidir o que fazer se acabar de novo,
  porque o plano Free pode pausar os sites.
- [ ] **Barra do Netlify na produção** (Donos, no painel): o script
  `/.netlify/scripts/hud` é injetado em todas as páginas e gera um erro de CSP.
  Desativar a barra de colaboração para a produção.
- [x] **Testes automáticos no GitHub** (Técnico, 06/11): `.github/workflows/ci.yml`
  roda verificação de sintaxe, unitários, build, integração com MySQL descartável e
  navegador a cada envio para `main`, `fix/**`, `feature/**` e em pull requests.
  Quatro testes que já falhavam antes de 06/11 rodam como pendentes (`todo`): o
  teste 37 de produtos (reescrever para o fluxo Orders), os 2 de contraste do
  título da Home no tema claro e o de usuário restrito da limpeza (permissões do
  MySQL). A suíte de privacidade, que exige um segundo MySQL com criptografia,
  ainda não roda no CI.
- [ ] **Proteção de dados em produção** (Donos + Técnico): ativar a criptografia
  extra dos dados pessoais e limpar os dados de teste. Dependem de acesso válido
  ao Aiven, backup conferido e janela sem escritas.
- [ ] **Backups do Aiven** (Donos): confirmar que existem e testar uma restauração.
- [ ] **Monitoramento** (Técnico): aviso gratuito de site fora do ar e registro
  de erros da API.

## 3. Melhorias de vendas, desempenho e acessibilidade

- [x] **SEO e compartilhamento** (Técnico, 06/11): título próprio em cada página;
  a página de produto sai da função com título, descrição, foto 1200×630, preço,
  `canonical` e dados estruturados de produto, para a prévia aparecer no WhatsApp,
  Instagram e Facebook (cache de 5 minutos no CDN); `robots.txt` e `sitemap.xml`
  gerados pela API, com a homologação sempre bloqueada; prévia padrão com a logo.
- [ ] **Google Search Console** (Donos): cadastrar o site e enviar
  `https://galeo-store.netlify.app/sitemap.xml` depois da publicação. Se a loja
  ganhar domínio próprio, atualizar a URL absoluta da prévia padrão no
  `index.html` e o `APP_URL`.
- [x] **Desempenho — imagens** (Técnico, 06/11): a logo do topo passou de 367 KB
  para 4,5 KB; cards, categorias, campanhas, banner, galeria, ampliação e carrinho
  pedem ao Cloudinary a foto no tamanho exibido (`srcset`) com formato e qualidade
  automáticos (`f_auto,q_auto`). Se a versão redimensionada falhar, a imagem volta
  sozinha para a original. URLs que já têm efeito (como a versão sem fundo) não
  são alteradas, para o Cloudinary não recalcular um efeito pago a cada tamanho.
- [ ] **Confirmar o redimensionamento no Cloudinary** (Técnico, quando houver a
  primeira foto real publicada): conferir que a conta não usa transformações
  restritas; se usar, liberar `f_auto,q_auto,c_limit,w_*` no painel do Cloudinary.
- [ ] **Fotos sem fundo mais leves** (Técnico): a versão tratada é um PNG no
  tamanho original; gerar também tamanhos menores no momento do tratamento.
- [ ] **Desempenho — JavaScript** (Técnico): o pacote inicial tem 472 KB
  (React DOM 205 KB, GSAP 112 KB, React Router 38 KB, editor visual 31 KB, App
  28 KB, Lenis 18 KB). Carregar GSAP/Lenis depois da página exige revisar as
  animações, porque elas definem o estado inicial antes da primeira pintura e
  poderiam piscar; separar o editor visual dos donos rende só cerca de 6 KB
  comprimidos. A primeira carga depois de um tempo parado pode levar mais de 10 s
  pelo início a frio da função.
- [ ] **Acessibilidade** (Técnico): os 11 links "sem texto" eram falso positivo da animação de revelação (todos têm texto depois de aparecer). Falta corrigir o contraste do título da Home no tema claro do editor (2 testes falham desde antes) e revisar o foco do teclado.
- [ ] **Frete** (Técnico, quando os donos decidirem): compra de etiqueta e
  rastreamento no Melhor Envio, que já cota fretes na produção; opção de
  retirada na loja.
- [ ] **Boas práticas do Mercado Pago** (Técnico): logotipo do Mercado Pago no
  pagamento e cancelamento de pedido pela API no Admin.
- [ ] **Pequenos ajustes** (Técnico): `/api/customer/me` responder sem erro 401
  para visitantes (aparece no console do carrinho e da conta) e revisar o
  pré-carregamento da fonte.
- [ ] **Organização do código** (Técnico): dividir `server/index.js`
  (2.905 linhas) e `src/Admin.jsx` (1.558 linhas) em módulos; atualizar docs
  antigas (a newsletter já está implementada, por exemplo).
- [ ] **Opcionais** (Donos): domínio próprio (.com.br) e e-mail no domínio da
  loja; análise de visitas, com aviso de cookies; maquininha (Stone ou Point)
  quando contratada.
