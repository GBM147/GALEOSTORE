# Ajustes da reunião da GALEO

Revisão preparada em 26–27/10/2026. Implementação e testes locais concluídos;
publicação e conferência em produção devem ser registradas após o deploy.

## Mudanças para os donos

| Solicitação | Comportamento da atualização |
| --- | --- |
| Centralizar as vendas | **Frente de caixa** concentra o registro da venda física. **Histórico de vendas** permite consultar e cancelar vendas, sem outro formulário para registrar. |
| Simplificar o financeiro | **Gastos da loja** pede apenas descrição, valor e data. Cada registro representa um gasto realizado; categoria, conta, tipo receita/despesa e estado pendente/pago saem desse formulário. |
| Evitar saltos de rolagem | Atualizações na mesma aba mantêm o conteúdo e a posição. Comparação, edição e vínculos de mídia abrem em janelas com rolagem própria. Navegar para outra página ou aba continua levando ao início. |
| Remover gasto recorrente | **Gastos recorrentes → Remover** exclui o modelo após confirmação e preserva os gastos já registrados. |
| Pesquisar no histórico de estoque | **Movimentações de estoque** permite buscar o produto pelo nome, marca ou código. |
| Evitar a frase antiga ao abrir | A Home aguarda o conteúdo publicado do CMS, sem mostrar antes o título antigo do código. Textos deixados vazios no CMS permanecem vazios. |
| Melhorar o carregamento | Home, catálogo e configurações começam a carregar independentemente. Páginas e dados administrativos são carregados conforme a área aberta. |
| Ampliar filtros e ordenação | Catálogo oferece marca, tamanho disponível e disponibilidade, além de ordenação por nome, marca, preço, estoque e tamanho. A grade controla estoque por tamanho também no carrinho, pedidos e caixa. |
| Ajustar as letras | Roboto hospedada no próprio site, com pesos menores em títulos e controles. |
| Reescrever texto apagado | No editor visual, textos vazios mantêm uma área clicável para escrever novamente; os campos de título também permanecem acessíveis no painel da seção. |

## Rotina de gastos

Em **Gastos da loja → Registrar gasto**, informar descrição, valor e data do
pagamento. O sistema registra uma despesa paga. Receitas das vendas continuam
sendo calculadas automaticamente; não precisam ser lançadas novamente aqui.
Remover um gasto retira-o da lista e dos totais, preservando internamente o
registro do cancelamento.

**Gastos recorrentes** guarda modelos com descrição, valor mensal e dia
habitual. Cadastrar um modelo não gera uma dívida nem confirma um pagamento.
Quando o gasto ocorrer, usar **Registrar gasto**. O mesmo modelo só pode gerar
um lançamento por mês; repetir o comando não duplica o valor. Remover o modelo
não apaga lançamentos feitos em meses anteriores.

## Configuração de tamanhos

1. Abrir **Produtos e estoque → Editar** no produto correspondente.
2. Ativar **Controlar estoque por tamanho**.
3. Adicionar cada tamanho ou numeração e sua quantidade real.
4. Conferir o total calculado pela soma da grade e salvar.

O cliente deve escolher um tamanho disponível antes de adicionar o produto ao
carrinho. No caixa, tamanhos diferentes da mesma peça ficam em itens separados.
Vendas, reservas, cancelamentos e devoluções movimentam o tamanho selecionado;
o histórico conserva o nome do tamanho usado na operação.

Produtos antigos sem grade continuam com saldo único. A conversão é bloqueada
quando há uma venda ou pedido anterior sem tamanho que ainda possa ser
cancelado, pois não existe informação suficiente para atribuir uma devolução a
um tamanho. Não alterar artificialmente essas operações para contornar o
bloqueio; conferir os registros ou cadastrar as novas peças em outro produto.

Se o estoque mudar enquanto o cadastro está aberto, o formulário avisa o
conflito. **Atualizar quantidades** recarrega o saldo sem apagar as alterações
de nome e descrição. Salvar apenas os textos não sobrescreve o saldo atual.
Não foram criados tamanhos, preços ou estoques para os produtos existentes.

## Preservação dos dados

A migração acrescenta a tabela da grade e referências de tamanho nos itens de
vendas, pedidos e movimentações. Não remove os produtos, registros comerciais,
contas dos donos, Home ou mídias originais. Produtos já excluídos pelos donos
não são recriados. Lançamentos financeiros anteriores permanecem no banco;
a tela simplificada exibe os gastos realizados.

A conferência anterior à publicação registrou somente contagens e resumos
criptográficos para comparar os dados depois do deploy. Os testes de escrita
usaram bancos locais isolados. A revisão do site publicado deve se limitar a
leituras e autenticação, sem compras ou clientes fictícios.

## Verificação técnica

- 173 testes unitários passaram, incluindo inicialização e validação de
  proteção dos dados e sessões.
- 37 testes de produtos passaram, incluindo 17 de grade, reserva, venda,
  cancelamento e concorrência de estoque.
- 12 testes de gastos, 29 de integração principal/pagamentos simulados,
  8 de recuperação de esquema e 7 do runtime Netlify passaram.
- A revisão de navegador cobriu painel, tamanhos, estoque concorrente,
  biblioteca, rolagem, editor, tipografia e carregamento. A execução conjunta
  passou 117 de 118 casos; o único caso dependia de uma atualização do DOM e
  foi corrigido no teste. Os 6 casos desse arquivo passaram na repetição.
- A compilação de produção e a verificação de sintaxe passaram.

O JavaScript inicial passou de 613.693 para 476.183 bytes descomprimidos,
redução de **22,4%**, com o Admin separado em outro arquivo carregado quando
necessário. A imagem local da marca foi convertida para WebP sem alterar os
pixels, de 670.651 para 367.138 bytes; o PNG original foi preservado. A consulta
da visão geral passou de sete para quatro consultas ao banco. Esses números
medem os arquivos e consultas; o tempo percebido ainda depende da conexão e
da inicialização dos serviços gratuitos.

## Pendências fora desta entrega

Integração Stone, cobrança online e cotação automática de frete continuam
adiadas. A confirmação de cadastro de clientes ainda depende da configuração
do remetente e credenciais do Resend. Tamanhos, preços e saldos reais devem ser
conferidos pelos donos. As demais providências comerciais estão no
[checklist de lançamento](checklist-lancamento.md).
