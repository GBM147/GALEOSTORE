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
- [ ] **Rodapé com links** (Técnico): políticas, contato, Instagram, WhatsApp e
  formas de pagamento. O rodapé atual não tem nenhum link.
- [ ] **Página 404** (Técnico): endereços inexistentes mostram página em branco.
- [ ] **Conteúdo da Home** (Donos): campanhas e categorias no CMS estão sem
  textos e mídias; a logo aparece repetida no lugar das fotos e há cards vazios.
- [ ] **Teste de cadastro real** (Donos): o cadastro de clientes já está aberto na
  produção. Confirmar com um e-mail real que a confirmação chega, e trocar a
  senha provisória do Admin.

## 2. Importante: segurança, estabilidade e custos

- [ ] **Dependências vulneráveis** (Técnico): `npm audit` aponta 3 altas
  (`body-parser`, `multer`, `mysql2`) e 3 moderadas (`qs`, `ip-address`,
  `express-mysql-session`). Atualizar e rodar todas as suítes.
- [ ] **Script de publicação no repositório** (Técnico): build com as variáveis
  `VITE_*` do `netlify.toml`, geração de `_headers`/`_redirects`, pacote das
  funções e envio pela API. Os scripts usados pelo Codex não estão no repositório.
  O deploy manual de 06/11 na homologação saiu sem essas variáveis, o que causa os
  erros de WebSocket (`/ws`) lá; a produção não foi afetada.
- [ ] **Remover legados do Render** (Técnico): keep-alive por WebSocket em
  `src/App.jsx`, `render.yaml` (com `DB_SSL_REJECT_UNAUTHORIZED=false`),
  `render-serve/` e a API Go, se não for mais usada.
- [ ] **Créditos do Netlify** (Donos): cada publicação gasta 15 dos 300 créditos
  mensais e o saldo de novembro acabou em 06/11. Ativar o alerta de créditos,
  juntar mudanças em poucas publicações e decidir o que fazer se acabar de novo,
  porque o plano Free pode pausar os sites.
- [ ] **Barra do Netlify na produção** (Donos, no painel): o script
  `/.netlify/scripts/hud` é injetado em todas as páginas e gera um erro de CSP.
  Desativar a barra de colaboração para a produção.
- [ ] **Testes automáticos no GitHub** (Técnico): CI gratuito com MySQL para
  rodar unitários, integração e navegador a cada envio. Hoje tudo é manual e as
  suítes de integração não rodam sem um MySQL local.
- [ ] **Proteção de dados em produção** (Donos + Técnico): ativar a criptografia
  extra dos dados pessoais e limpar os dados de teste. Dependem de acesso válido
  ao Aiven, backup conferido e janela sem escritas.
- [ ] **Backups do Aiven** (Donos): confirmar que existem e testar uma restauração.
- [ ] **Monitoramento** (Técnico): aviso gratuito de site fora do ar e registro
  de erros da API.

## 3. Melhorias de vendas, desempenho e acessibilidade

- [ ] **SEO e compartilhamento** (Técnico): todas as páginas se chamam
  "Galeo Store", sem descrição por página, sem `canonical` e sem tags OG.
  Gerar no servidor título, descrição e foto de cada produto (como já é feito na
  página de pagamento) para a prévia aparecer no WhatsApp e no Instagram; criar
  `robots.txt`, `sitemap.xml` e dados estruturados de produto. Hoje
  `/robots.txt` e `/sitemap.xml` devolvem a página do site.
- [ ] **Desempenho** (Técnico): a logo `galeo-brand.webp` tem 367 KB
  (736×1600) e aparece em 32×32 no topo de todas as páginas; criar versão
  pequena. Usar redimensionamento do Cloudinary (`f_auto`, `q_auto`, largura)
  nas fotos. Dividir o JavaScript inicial (483 KB) por página. A primeira carga
  depois de um tempo parado pode levar mais de 10 s pelo início a frio da função.
- [ ] **Acessibilidade** (Técnico): 11 links da Home (categorias, produtos e
  campanhas) não têm texto acessível; revisar contraste e foco do teclado.
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
