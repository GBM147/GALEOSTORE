# Hospedagem gratuita no Netlify

A GALEO usa o Netlify Free para a interface e a API, Aiven para MySQL,
Cloudinary para fotos/vídeos e Resend para e-mails. O banco e as imagens
existentes continuam nos mesmos serviços. Pagamentos permanecem pendentes;
a integração de cotações do Melhor Envio está publicada e aguarda autorização
da conta e medidas reais das peças, conforme [o guia de frete](melhor-envio.md).

O Vercel Hobby restringe uso comercial; por isso não é o plano gratuito
adequado para esta loja. O Netlify permite projetos comerciais no Free.
Na documentação consultada em 16/10/2026, o Free tem 300 créditos por mês,
limite rígido e sem recarga automática. Ao esgotar a franquia, o projeto pode
ser pausado até a renovação. Cada publicação de código em produção consome
15 créditos; editar/publicar a Home pelo CMS não exige um novo deploy.

## Configuração do projeto

Desde 29/10/2026, o projeto existente pertence à equipe **Galeo Store**,
ID `6ae34373a583add92af1010d`, no plano Free. O ID do projeto permanece
`1987b91f-dacd-4665-bda8-89d899b7b51b` e a URL é
`https://galeo-store.netlify.app`. As 25 variáveis do projeto foram preservadas
na transferência. Para administrar ou publicar, usar um token autorizado pela
nova equipe; o token da equipe anterior deixou de acessar o projeto. No ambiente
de desenvolvimento, reservar `NETLIFY_GALEO_AUTH_TOKEN` para esse acesso, sem
registrar seu valor no repositório.

A produção é pública e as prévias de deploy ficam privadas. A nova equipe
aplicou login da Netlify por padrão à loja transferida, causando HTTP 401 antes
da aplicação. A configuração do próprio projeto foi ajustada com
`sso_login: true` e `sso_login_context: non_production`, sem alterar o padrão da
equipe. O login administrativo da loja continua sendo exigido pela aplicação.

1. Criar/importar `GBM147/GALEOSTORE` em uma equipe no **Free**, sem habilitar
   plano pago ou recarga automática.
2. Usar `netlify.toml`: Node 24, build `npm run build`, saída `dist`, funções
   em `netlify/functions`.
3. Configurar as variáveis abaixo no contexto **Production**, com os escopos
   disponibilizados pelo plano Free. A seleção granular de apenas **Functions**
   é um recurso Pro; não contratar outro plano para habilitá-la. As chaves
   nunca entram em variáveis `VITE_`, no código ou no diretório `dist`.
4. Preparar o schema com `npm run db:migrate`, em um ambiente seguro com as
   mesmas credenciais do MySQL. Esse comando cria a tabela dos limites de
   tentativas e aplica as migrações existentes sem apagar produtos, donos ou
   conteúdo. Não executá-lo a cada acesso nem no build habitual da interface.
5. Publicar e testar a URL canônica do projeto. Usar a mesma origem para
   interface/API; não configurar redirecionamento da API para o Render.

| Variável | Configuração |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | URL HTTPS canônica da loja no Netlify ou domínio próprio |
| `ALLOWED_ORIGINS` | A mesma URL, sem barra final |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Dados do MySQL Aiven existente; respeitar a porta informada pelo serviço |
| `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` | `true` para TLS com certificado validado |
| `DB_SSL_CA` | Certificado CA do serviço Aiven, quando necessário; PEM ou `\n` literal |
| `DB_CONNECTION_LIMIT` | `2` por instância; não usar `1` com os fluxos transacionais existentes |
| `SESSION_SECRET` | Preservar exatamente o segredo existente |
| `DATA_ENCRYPTION_ENABLED`, `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY_ID` | Preservar o estado e as chaves existentes; não gerar outra chave na migração |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap do primeiro dono; não redefinem a senha de uma conta já cadastrada |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Conta Cloudinary existente; chave secreta somente no servidor |
| `RESEND_API_KEY` | Conta Resend existente |
| `EMAIL_FROM` | Preencher após os donos escolherem e verificarem o remetente; não inventar um endereço |
| `STORE_NOTIFICATION_EMAIL` | Endereço opcional de aviso de pedidos |

Segredos opcionais das integrações futuras continuam desabilitados até sua
contratação/configuração. Links de confirmação de e-mail novos usam `APP_URL`;
links antigos apontando ao Render precisarão ser reenviados pelo cliente.

Se a conexão MySQL estiver bloqueada no ambiente de desenvolvimento, executar
a migração em um Netlify Build avulso e confiável, com credenciais de produção
no provedor. Encerrar esse build após a migração, antes da publicação; o build
habitual da loja continua sem migrar o banco. Não expor uma rota HTTP pública
de migração nem usar uma função agendada para esse bootstrap, pois ela tem
limite de 30 segundos.

`netlify.toml` fornece somente variáveis públicas de build:
`VITE_DIRECT_UPLOADS=true`, `VITE_RENDER_KEEPALIVE=false` e
`VITE_STORE_API_URL` vazia. O catálogo passa a usar a mesma API Node, sem
depender do serviço Go no Render. Novas variáveis de Functions devem ser
cadastradas pela interface/API do Netlify, pois os valores de
`[build.environment]` não são a configuração dos segredos em execução.

Publicações enviadas pela API com arquivos já compilados precisam também
incluir `dist/_redirects` e `dist/_headers` equivalentes ao TOML e o agendamento
da função `maintenance` no manifesto. Nesse fluxo o Netlify não executa o
processamento habitual de `netlify.toml` de um build por Git.

Não expor as credenciais de produção a deploy previews de branches não
confiáveis. Previews com API precisam de banco e segredos próprios de testes;
uma cópia da Home pública pode usar fixtures locais no desenvolvimento.

## Comportamento da API

- A função `api` usa a API moderna Request/Response do Netlify com Express.
  Preserva cookies separados, sessão MySQL, CSRF, OWNER e clientes separados.
  Usa o IP informado pela plataforma, ignorando X-Forwarded-For do cliente.
- A inicialização de cada instância só verifica o schema. Migrações e seeds
  ficam no comando explícito `db:migrate`. Não há servidor escutando portas,
  WebSocket de keepalive nem cron residente no modo serverless.
- Os limites de login/reenvio são compartilhados no MySQL, sem armazenar IPs
  em texto. Sessões não dependem de memória ou disco temporário.
- Uploads de até 25 MB por arquivo seguem do navegador para Cloudinary com
  autorização assinada e temporária. A API verifica o arquivo no provedor
  antes de registrá-lo. Repetir a confirmação não duplica nem apaga a mídia.
- O envio de e-mails termina antes de devolver a resposta. Tarefas locais
  pendentes são aguardadas; a remoção de fundo é iniciada de forma assíncrona
  no Cloudinary e pode ser conferida com **Verificar resultado** sem nova
  solicitação de transformação. A fotografia original é preservada.
- A função `maintenance` roda diariamente às 06:10 UTC / 03:10 de São Paulo:
  gera recorrências de forma idempotente e remove sessões/limites expirados e
  auditoria antiga. É invocada pelo agendamento privado do Netlify.
- APIs retornam JSON e `Cache-Control: no-store`. Rotas da interface usam a
  mesma SPA; arquivos estáticos com hash têm cache longo.

## Validação antes de publicar

```sh
npm ci
npm run check
npm test
VITE_DIRECT_UPLOADS=true VITE_RENDER_KEEPALIVE=false npm run build
npm run bundle:netlify
```

Com MySQL descartável local em `127.0.0.1:3307`, `DB_NAME=galeo_store_test`,
credenciais da aplicação, `MYSQL_ROOT_PASSWORD` e `SESSION_SECRET` de testes:

```sh
npm run test:netlify
npm run test:security
npm run test:media
npm run test:home
```

`test:netlify` cria um schema aleatório e o remove ao terminar; recusa banco
externo. Verifica inicialização sem DDL, cookies/CSRF, rate limit entre
instâncias, compra com reserva de estoque, repetição de uploads, agendamento
e o pacote real do Netlify em um processo novo, incluindo bcrypt nativo.

Para os testes de upload no Chromium, iniciar Vite com
`VITE_DIRECT_UPLOADS=true VITE_RENDER_KEEPALIVE=false npm run dev -- --port 5174`
e executar `node --test tests/direct-upload.browser.mjs`. O teste usa arquivos
de 8 MB e intercepta todos os provedores; não envia fotos reais.

Depois da publicação: conferir `/health`, loja, produto/galeria, conta,
carrinho, login dos donos, editor visual e biblioteca. Fazer escrita de
validação em fixtures locais; não criar pedidos ou estoque falso em produção.
O pacote deve conter `bcrypt.glibc.node` e nenhum arquivo `.env`.

## Referências oficiais

- [Uso do Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Uso comercial gratuito no Netlify](https://answers.netlify.com/t/will-netlify-free-plan-allow-my-business-online-e-commerce-website-to-host/43368)
- [Planos e créditos](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Express no Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/)
- [Limites das funções](https://docs.netlify.com/build/functions/optional-configuration/)
- [Funções agendadas](https://docs.netlify.com/build/functions/scheduled-functions/)
