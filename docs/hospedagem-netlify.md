# Hospedagem gratuita no Netlify

A GALEO usa:
- o Netlify Free para a interface e a API;
- o TiDB Cloud Starter, compatível com MySQL, para o banco, desde 17/11/2026
  (veja [Banco de dados](#banco-de-dados-tidb-cloud));
- o Cloudinary para fotos e vídeos. Desde 17/11/2026 a loja usa a conta da própria
  loja, com o cloud name `lqux8ugm`. Ali foram testados o envio de foto pelo Admin
  e a versão sem fundo. A conta antiga, `q2xpaz4o`, não recebe mais envios;
- o Resend para e-mails.

Os pagamentos online continuam pendentes. As cotações do Melhor Envio já estão
publicadas, conforme [o guia de frete](melhor-envio.md).

O Vercel Hobby restringe uso comercial; por isso não é o plano gratuito
adequado para esta loja. O Netlify permite projetos comerciais no Free.
Na documentação consultada em 16/10/2026, o Free tem 300 créditos por mês,
limite rígido e sem recarga automática. Ao esgotar a franquia, o projeto pode
ser pausado até a renovação. Cada publicação de código em produção consome
15 créditos; editar/publicar a Home pelo CMS não exige um novo deploy.

## Configuração do projeto

Desde 16/11/2026, a loja roda na conta Netlify **galeostore01@gmail.com**, na
equipe **Galeos** (ID `6afaffde148474e775ffbe02`, plano Free). O projeto tem o ID
`b68ab513-906f-4f57-8cd5-b45c64a3c54f` e a URL continua
`https://galeo-store.netlify.app`.

**Como foi a mudança de conta:**
- No Free, uma equipe aceita uma só pessoa, então a transferência oficial não era
  possível. Por isso o projeto foi recriado:
  - as 24 variáveis legíveis foram copiadas pela API;
  - o dono cadastrou os 5 valores secretos (Cloudinary, Resend, Melhor Envio e a
    senha do Admin);
  - `ADMIN_EMAIL`, `EMAIL_REPLY_TO` e `STORE_NOTIFICATION_EMAIL` passaram para
    galeostore01@gmail.com.
- O banco foi atualizado num build avulso, que terminou com o marcador
  `MIGRACAO_OK`. Depois, a revisão `4558536` foi publicada no deploy
  `6afb4667aeae034d9d1c82b8`.
- Na troca de nomes, o projeto anterior (`1987b91f-dacd-4665-bda8-89d899b7b51b`, da
  equipe Galeo Store da conta antiga) virou `galeo-store-antigo`. As 7 respostas
  públicas da API ficaram idênticas às de antes da troca.

Para administrar ou publicar, use um token da equipe Galeos. No ambiente de
desenvolvimento, a chave é injetada pelo proxy e nunca fica no repositório.

A produção é pública e as prévias de deploy ficam privadas. A equipe nova aplica
login da Netlify por padrão aos projetos, o que causava HTTP 401 antes de a loja
abrir. A configuração do próprio projeto foi ajustada com
`sso_login: true` e `sso_login_context: non_production`, sem alterar o padrão da
equipe. O login administrativo da loja continua sendo exigido pela aplicação.

## Banco de dados (TiDB Cloud)

O Aiven encerrou o MySQL grátis: em 21/12/2026 o serviço é desligado e os dados
são apagados. Desde 17/11/2026, às 13:13 UTC, a loja usa o **TiDB Cloud Starter**,
na conta galeostore01@gmail.com. Ele é grátis e compatível com MySQL 8.

**Onde está o banco:**
- cluster `galeo-store`, na AWS **N. Virginia (us-east-1)**, com endpoint público;
- `DB_NAME=galeo_store`, `DB_PORT=4000`;
- o usuário tem o formato `<prefixo>.root` e aparece no botão **Connect** do
  painel, junto do host;
- a senha só vive no Netlify, como valor secreto.

**Conexão:**
- O TiDB Cloud usa certificado público, então a produção não tem `DB_SSL_CA`.
- `DB_SSL` e `DB_SSL_REJECT_UNAUTHORIZED` continuam `true`, com verificação do
  nome do host.
- O limite grátis por mês é de 5 GiB e 50 milhões de RUs. Se passar, o banco fica
  lento ou recusa conexões novas até o mês virar. O uso aparece no painel do TiDB.

**Como foi a mudança:**
- `npm run db:copy` (`scripts/copy-database.mjs`) copiou as 29 tabelas, mantendo os
  IDs e o próximo ID de cada uma. A cópia leu um retrato consistente da origem e
  conferiu linha por linha com hash.
- No TiDB, as tabelas copiadas usam `AUTO_ID_CACHE=1`, para os IDs seguirem em
  sequência como no MySQL.
- O Aiven roda em modo ANSI, então a cópia lê a estrutura sem `ANSI_QUOTES`.
- A cópia rodou em build avulso no projeto interno `galeo-tarefas`, com a origem
  em `SOURCE_DB_*` e o destino em `DB_*`. Primeiro um ensaio, depois a cópia
  final, e por fim a publicação da loja com as variáveis do TiDB.

**Para voltar ao Aiven (até 21/12):**
1. Recolocar na produção os valores de `SOURCE_DB_*` guardados no `galeo-tarefas`,
   incluindo `DB_SSL_CA`.
2. Publicar de novo.

Depois de uns dias estável, apagar o `galeo-tarefas` e o serviço no Aiven.

**Diferenças conhecidas do TiDB, já cobertas no código e nos testes:**
- Não há trava compartilhada, então a escolha da capa usa `FOR UPDATE`.
- `GET_LOCK` espera no mínimo 1 s.
- `information_schema.TABLES.AUTO_INCREMENT` mostra 0 até o primeiro ID.
- Não há triggers nem eventos. Por isso `test:cleanup` e a ferramenta de limpeza
  de dados de teste são só para MySQL.

O job **TiDB** do GitHub Actions roda as suítes de banco no TiDB 8.5 e testa a
cópia MySQL → TiDB a cada envio.

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
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Dados do TiDB Cloud (botão **Connect** no painel), porta `4000`; a senha fica como secreta |
| `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` | `true` para TLS com certificado validado |
| `DB_SSL_CA` | Não usar com o TiDB Cloud, que tem certificado público. Só para provedor com CA própria, como era o Aiven; PEM ou `\n` literal |
| `DB_CONNECTION_LIMIT` | `2` por instância; não usar `1` com os fluxos transacionais existentes |
| `SESSION_SECRET` | Preservar exatamente o segredo existente |
| `DATA_ENCRYPTION_ENABLED`, `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY_ID` | Preservar o estado e as chaves existentes; não gerar outra chave na migração |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap do primeiro dono; não redefinem a senha de uma conta já cadastrada |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Conta Cloudinary da loja (`lqux8ugm`, desde 17/11); a chave secreta fica só no servidor. A remoção de fundo usa o add-on de IA da conta |
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

Para publicar pela API, use o script do repositório. Ele compila com as
variáveis de `[build.environment]`, gera `dist/_redirects` e `dist/_headers` a
partir do `netlify.toml`, empacota as funções com o agendamento da manutenção e
envia tudo pela API. `--noindex` acrescenta `X-Robots-Tag` para a homologação, e
`--dry-run` prepara sem enviar. Cada publicação em produção gasta 15 créditos.

```sh
NETLIFY_AUTH_TOKEN=... npm run deploy:netlify -- --site 832678f0-b9a7-4b99-b8f7-fad63cb55245 --noindex --message "homologação"
NETLIFY_AUTH_TOKEN=... npm run deploy:netlify -- --site 1987b91f-dacd-4665-bda8-89d899b7b51b --message "produção"
```

Publicações enviadas pela API com arquivos já compilados precisam também
incluir `dist/_redirects` e `dist/_headers` equivalentes ao TOML e o agendamento
da função `maintenance` no manifesto. Nesse fluxo o Netlify não executa o
processamento habitual de `netlify.toml` de um build por Git.
As páginas de produto (`/produto/*`), `robots.txt` e `sitemap.xml` também passam pela função `api`, antes da regra `/*`. O produto sai com título, descrição, foto, preço e dados estruturados para as prévias de links, e o CDN guarda essa página por até 5 minutos (`Netlify-CDN-Cache-Control`); a navegação dentro do site continua no SPA, sem chamar a função. Na homologação, `robots.txt` bloqueia tudo e não há sitemap.

O `_redirects` precisa manter a regra `/pagamento/*` para a função `api` antes da regra `/*`: ela entrega a página de pagamento com o nonce de CSP exigido pelo coletor de dispositivo do Mercado Pago.

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
- APIs retornam JSON e `Cache-Control: no-store`, exceto os dados públicos da
  vitrine (`/api/store`, `/api/store/home`, `/api/store/home/settings` e
  `/api/store/products/:id`): o CDN do Netlify guarda essas respostas por 60 s e
  continua entregando a cópia anterior enquanto renova
  (`Netlify-CDN-Cache-Control: public, durable, s-maxage=60, stale-while-revalidate=300`),
  então a maioria das visitas não espera a função nem o banco. Só respostas 200
  sem cookie são guardadas. Qualquer gravação bem-sucedida no Admin limpa esse
  cache na hora (etiqueta `galeo-storefront`, API de purge do Netlify com o
  token que a própria função recebe); se a limpeza falhar, as cópias expiram em
  até um minuto. O carrinho confere preço e estoque sem cache antes do pedido, e
  o servidor valida o estoque de novo ao criar o pedido. Rotas da interface usam
  a mesma SPA; arquivos estáticos com hash têm cache longo.

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
