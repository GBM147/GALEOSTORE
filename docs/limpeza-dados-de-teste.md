# Limpeza dos dados de teste

A limpeza foi solicitada pelo proprietário. Em 9 de outubro de 2026, ele
confirmou o escopo: remover todos os dados operacionais de teste e preservar
as contas dos donos e o conteúdo da Home. Nenhum reset foi executado na produção.
A auditoria abaixo vem do código; o schema e as contagens do banco real precisam
ser conferidos quando houver acesso seguro e um backup recuperável.

## Preservação

Preservar contas e hashes dos donos (`admin_users`), Home e configurações
(`home_sections`, `home_settings`), biblioteca de mídia (`media_assets`) e
categorias de configuração. As tabelas e os índices continuam existindo.
Os arquivos do Cloudinary não serão excluídos por uma limpeza do MySQL.

Auditoria de segurança e conteúdo permanece. Registros referentes às entidades
operacionais removidas podem ser eliminados, com um evento compacto da limpeza
que contenha somente responsável, escopo e contagens, sem dados pessoais.

## Remoção dos dados operacionais

Para o escopo confirmado, conferir primeiro o banco e serviço corretos,
um backup recuperável, as contagens e todas as dependências em
`information_schema`. Uma tabela ou FK desconhecida exige adaptar o plano ao
schema real antes de executar a operação.

Interromper as escritas durante backup e limpeza, incluindo API, Admin,
webhooks e tarefas agendadas. Recorrências também geram lançamentos no
bootstrap e na consulta do dashboard; mantê-las ativas recria dados financeiros.

Ordem de remoção compatível com o schema atual, em uma única transação InnoDB:

1. `recurring_expenses`
2. `payments`
3. `store_order_items`
4. `sale_items`
5. `stock_movements`
6. `financial_entries`
7. `store_orders`
8. `sales`
9. `customer_email_verifications`
10. `customers`
11. `product_media`
12. `products`
13. `integration_events`

Zerar os saldos iniciais de teste em `financial_accounts`, preservando as contas
e suas configurações. Os eventos removidos em `integration_events` fazem a
deduplicação de notificações: essa remoção pertence ao reset de todos os dados
operacionais de teste autorizado, e não deve ser usada com transações reais.

Usar `DELETE` transacional, sem desativar FKs e sem resetar `AUTO_INCREMENT`.
Carrinhos antigos guardam IDs de produtos; reutilizar esses IDs pode fazer um
carrinho antigo apontar para um produto novo. As rotas comuns de exclusão de
produto não executam esse reset: podem apenas ocultar o produto com histórico
ou excluir arquivos do Cloudinary.

Retirar os IDs dos produtos excluídos de `featured_products.product_ids` nos
conteúdos publicado e rascunho, preservando textos, mídia e outras configurações.
No código atual, uma lista manual vazia volta à seleção dos produtos mais
recentes. Conferir que sessões de clientes removidos perderam acesso, preservando
o acesso dos donos; a aplicação já recusa clientes que não existem no banco.

Antes do commit, exigir contagem zero nas tabelas escolhidas e comparar os
registros preservados. Depois, conferir catálogo vazio, dashboard sem valores
de teste, login OWNER, Home e preview. Os seeds não cadastram produtos nem estoque.

## Ferramenta local

`scripts/cleanup-test-data.mjs` executa a inspeção e a limpeza sem importar o
servidor HTTP, sem criar schema e sem criar uma rota destrutiva na aplicação.
O padrão é somente leitura. As credenciais são lidas das variáveis do ambiente,
e os logs contêm contagens e códigos fixos, nunca conteúdo pessoal ou segredos.

Inspecionar o banco alvo previamente conferido:

```sh
npm run cleanup:test-data -- --host "$DB_HOST" --database "$DB_NAME"
```

Depois de conferir o backup recuperável, interromper todos os escritores e
identificar o ID de um proprietário ativo no banco correto:

```sh
npm run cleanup:test-data -- --host "$DB_HOST" --database "$DB_NAME" \
  --execute --backup-confirmed --writers-stopped --reset-test-balances \
  --owner-id "$CLEANUP_OWNER_ID"
```

As flags de backup e manutenção são declarações do operador. A ferramenta não
confirma uma restauração nem para a API, os webhooks e os agendamentos. Elas só
devem ser fornecidas após essas condições terem sido verificadas. Não execute
este comando enquanto o acesso e o backup de produção continuarem pendentes.

Conexões remotas exigem hostname DNS e TLS com certificado e identidade
validados; `DB_SSL_CA` permite informar a CA confiável. `--local-no-tls` é uma
exceção exclusivamente para testes em loopback. Banco, host e proprietário são
conferidos antes da execução. Engines, dependências, triggers ou eventos
desconhecidos impedem a operação; metadados ocultos por falta de privilégios não
podem ser tratados como inexistentes. A conta de manutenção precisa comprovar
visibilidade completa; a ferramenta não concede privilégios.

A execução compara os registros preservados antes do commit, limpa sessões de
clientes e mantém o acesso administrativo de sessões mistas. Quando a proteção
adicional já está ativa, usa a chave atual para as sessões e para o evento
compacto de auditoria. Erros anteriores ao commit revertem a transação. Uma
resposta de commit perdida deixa o resultado incerto: conferir o estado do banco
antes de qualquer repetição, em vez de presumir que nada foi alterado.

`npm run test:cleanup` verifica esses comportamentos em bancos MySQL locais
exclusivos, com guardas que recusam produção. O reinício da API também precisa
preservar os textos personalizados de rascunho e publicação: as substituições
globais de frases antigas foram retiradas do bootstrap.

Verificação desta etapa: 14 testes da limpeza passaram no MySQL loopback,
incluindo falha após exclusões com rollback, commit confirmado sem resposta,
conta de banco com metadados incompletos, sessões protegidas e reinício real da
API mantendo textos e datas da Home. Os 36 testes unitários existentes, a
verificação de sintaxe e o build também passaram. Esses testes não removem
dados de produção nem comprovam os backups do Aiven.

## Situação do acesso

O acesso ao Render foi validado no serviço `GALEO-STORE`, com a revisão
`d89b99e4c35fc79361ed82781396037923591580` publicada. A configuração consultada
usa TLS, mas não valida o certificado MySQL; não há CA ou chave da camada
adicional configurada. A tentativa direta ao MySQL com validação obrigatória
foi recusada antes da negociação TLS. Isso não demonstra que o certificado
seja inválido.

O token Aiven vinculado foi rejeitado com HTTP 401. Os backups do serviço real
ainda não foram conferidos. A definição do escopo não está mais pendente;
permanecem necessários o acesso seguro, o backup e a interrupção das escritas.

## Verificação da proteção

`GET /api/admin/security-status`, restrito ao OWNER, consulta o cipher e o
protocolo da sessão MySQL usada pela aplicação. Também informa a verificação
de certificado/hostname e a exigência global de TLS. Uma exigência global
desativada não prova que o usuário individual permite conexões sem TLS.

A criptografia do armazenamento e dos backups depende da conferência do
serviço Aiven real. A proteção adicional na aplicação precisa da chave e das
condições descritas em [proteção dos dados](protecao-dados.md). Backups próprios
precisam ser protegidos, e a chave de aplicação precisa ficar guardada
separadamente. Não há credencial, exportação ou chave neste documento.
