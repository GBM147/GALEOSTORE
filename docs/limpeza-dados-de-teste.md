# Limpeza dos dados de teste

A limpeza foi solicitada pelo proprietário. A escolha entre remover os dados
operacionais e manter os produtos com estoque zero ainda está pendente. Nenhum
reset foi executado na produção. A auditoria abaixo vem do código; o schema e
as contagens do banco real precisam ser conferidos quando houver acesso seguro.

## Preservação

Preservar contas e hashes dos donos (`admin_users`), Home e configurações
(`home_sections`, `home_settings`), biblioteca de mídia (`media_assets`) e
categorias de configuração. As tabelas e os índices continuam existindo.
Os arquivos do Cloudinary não serão excluídos por uma limpeza do MySQL.

Auditoria de segurança e conteúdo permanece. Registros referentes às entidades
operacionais removidas podem ser eliminados, com um evento compacto da limpeza
que contenha somente responsável, escopo e contagens, sem dados pessoais.

## Remoção dos dados operacionais

Se esse for o escopo escolhido, conferir primeiro o banco e serviço corretos,
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

Conferir separadamente saldos iniciais de teste em `financial_accounts` e
eventos de teste em `integration_events`. Os eventos fazem a deduplicação de
notificações; limpar eventos reais poderia permitir seu processamento repetido.

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

## Somente estoque zero

Se esse for o escopo escolhido, manter produtos, clientes, pedidos, vendas e
configurações. Conferir pedidos com reserva ativa antes de alterar quantidades:
uma reserva não deve ser tratada como estoque de teste. Definir como ficam as
movimentações de estoque antes da operação para conservar a coerência do histórico.

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
