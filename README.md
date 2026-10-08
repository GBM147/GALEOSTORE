# GALEO STORE

Loja de moda multimarcas com vitrine pública e painel administrativo integrado.

## Stack
- React 19
- Vite 7
- React Router 7
- Node.js + Express 5
- MySQL 8 (Aiven)
- Sessão administrativa no servidor
- Cloudinary para fotos e vídeos de produtos

## Gestão
O painel administrativo contempla produtos, marcas, categorias, estoque, histórico de movimentações, vendas, financeiro, contas recorrentes e auditoria.

Somente contas OWNER ativas podem acessar o Admin e suas APIs. Contas STAFF
existentes não entram no painel; contas de clientes usam acesso separado à loja.

Clientes precisam confirmar o e-mail por link de uso único antes do login e
de fazer pedidos, incluindo contas existentes. Configure Resend e remetente
verificado conforme [verificação de e-mail](docs/verificacao-email.md).

A proteção adicional dos dados pessoais e sua ativação segura estão em
[proteção dos dados](docs/protecao-dados.md). Não habilite a migração sem chave
guardada separadamente, TLS validado e janela de manutenção.

Uma venda aprovada baixa o estoque e cria automaticamente a receita correspondente no financeiro. O cancelamento estorna estoque e lançamento financeiro.

## Mídia de produtos
Os administradores podem cadastrar URLs de mídia ou selecionar fotos e vídeos diretamente no computador. Os arquivos enviados são armazenados externamente e apenas os metadados/URLs ficam no MySQL.

Para ativar upload de arquivos, configure no Render:
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET

## Desenvolvimento
`npm install`

Configure um `.env` a partir de `.env.example`, com `NODE_ENV=development`,
`APP_URL=http://localhost:5173` e `ALLOWED_ORIGINS=http://localhost:5173`.
Preencha as credenciais do MySQL e `SESSION_SECRET` nas configurações locais.

Execute `npm start` para iniciar a API Node na porta 10000 e, em outro terminal,
`npm run dev` para iniciar a interface. O Vite encaminha `/api` e `/ws` para
`http://127.0.0.1:10000`, mantendo o login e o checkout na mesma origem.

O catálogo também usa a API local por padrão. Para usar o catálogo público Go,
configure `VITE_STORE_API_URL=https://galeo-api-go.onrender.com` antes do build.
Essa variável afeta somente o catálogo e os detalhes de produtos; conta,
pagamentos, editor e painel continuam usando a API Node da aplicação.
Após alterar uma variável `VITE_`, reinicie o Vite no desenvolvimento ou execute
`npm run build` novamente na produção.

## Produção
`npm run build`
`npm start`

O Render publica o frontend e a API pelo mesmo serviço.

## Validação da interface
Com `npm run dev` ativo, execute `node --test tests/frontend.browser.mjs`.
Esses testes usam APIs simuladas para verificar checkout, reenvio de mídia e o
editor da Home, incluindo ordem, visibilidade, mídia móvel, tema e tipografia.
O ambiente precisa ter Playwright e Chromium disponíveis; o navegador do sistema
em `/usr/bin/chromium` é reutilizado quando presente. Use `FRONTEND_TEST_URL`
para outra URL e `PLAYWRIGHT_CHROMIUM_EXECUTABLE` para outro executável.

## Validação de segurança

Com Node 24 e MySQL local de testes, execute `npm run test:security`.
Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` e
`SESSION_SECRET` no ambiente; o teste exige `DB_NAME=galeo_store_test` e
endereço de banco loopback, recusando bancos externos ou de produção.
Para MySQL local sem TLS, defina `DB_SSL=false`. A porta 10002 deve estar livre.
A suíte inicia sua própria API local, usa contas temporárias e remove os dados
ao terminar. Ela confere reinício com contas desativadas, política de novas
senhas e compatibilidade com senhas antigas, sem cobranças ou testes de frete.

`npm run test:email` verifica confirmação, reenvio, expiração, uso único e falhas
de entrega com Resend simulado e API/MySQL locais. `npm run build` seguido de
`node --test --test-isolation=none tests/email-verification.browser.mjs` testa
o mesmo fluxo no Chromium contra a API real. Execute as duas suítes em sequência;
elas usam a porta 10006. Configure `APP_URL` loopback, os parâmetros do MySQL
e `SESSION_SECRET`; ambos recusam bancos externos e dados de produção.

`npm run test:privacy` e
`node --test --test-isolation=none tests/business-privacy.integration.test.js`
usam um segundo MySQL isolado em `DB_PORT=3308`, `DB_NAME=galeo_store_test`,
com `DATA_ENCRYPTION_ENABLED=true` e chave aleatória exclusiva de testes.
O schema deve ter sido inicializado pela API e a porta 10010 deve estar livre.

As correções e os testes no navegador desta etapa estão documentados em
[ajustes-seguranca.md](docs/ajustes-seguranca.md).
