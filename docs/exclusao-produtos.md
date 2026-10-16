# Exclusão definitiva de produtos

O botão **Excluir** remove o cadastro do produto, sua galeria e todas as suas
movimentações de estoque. Entrada inicial e ajustes manuais não fazem o produto
ser apenas ocultado. A confirmação identifica a operação como definitiva.

Vendas ou pedidos não cancelados impedem a exclusão, assim como um pedido com
pagamento ainda aprovado. Nesse caso a API responde `409` com
`PRODUCT_HAS_TRANSACTIONS`, sem ocultar o produto nem alterar seus vínculos.

Quando só existem operações canceladas, o cadastro pode ser removido. Os itens
dessas operações guardam nome, marca, quantidade e valores; `product_id` passa
a `NULL`. Vendas, pedidos, pagamentos e lançamentos financeiros continuam no
histórico. Excluir o produto não equivale a limpar o financeiro.

A remoção de vínculos, estoque, cadastro e o registro de auditoria usam a mesma
transação. Uma falha provoca rollback. Arquivos compartilhados do Cloudinary
continuam na biblioteca, cuja exclusão exige a verificação de uso existente.

## Migração e validação

Executar a migração explícita `npm run db:migrate` antes de publicar a API nova.
Ela adiciona nome/marca aos itens de vendas, preenche itens antigos a partir do
cadastro e permite `product_id` nulo nos itens de vendas e pedidos. Repetir a
migração preserva os dados já registrados nos itens. Os dois fluxos de criação
de venda passam a registrar essas informações na própria transação.

`npm run test:products` usa somente MySQL local descartável, com as guardas do
helper de integração. O cenário de rollback por trigger exige os privilégios
adequados no banco local. `npm run test:browser` inclui a confirmação, erros e
atualização da lista após excluir, usando APIs simuladas.
