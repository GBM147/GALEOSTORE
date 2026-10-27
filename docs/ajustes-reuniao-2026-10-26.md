# Ajustes da reunião da GALEO

Atualização publicada e conferida em 27/10/2026 em
https://galeo-store.netlify.app. Código: `ad4197d`; deploy Netlify:
`6ae0ab8e5e7651d531f9d753`. A hospedagem permanece no plano Free, sem
recarga automática nem período de teste pago.

Revisão solicitada pelos donos em 27/10/2026: o estoque fica concentrado em
**Produtos e estoque**. A aba separada **Movimentações de estoque** foi retirada;
os registros históricos no banco são preservados. Links antigos dessa aba
passam a abrir Produtos e estoque.

## Mudanças para os donos

| Solicitação | Comportamento da atualização |
| --- | --- |
| Centralizar as vendas | **Frente de caixa** concentra o registro da venda física. **Histórico de vendas** permite consultar e cancelar vendas, sem outro formulário para registrar. |
| Simplificar o financeiro | **Gastos da loja** pede apenas descrição, valor e data. Cada registro representa um gasto realizado; categoria, conta, tipo receita/despesa e estado pendente/pago saem desse formulário. |
| Evitar saltos de rolagem | Atualizações na mesma aba mantêm o conteúdo e a posição. Comparação, edição e vínculos de mídia abrem em janelas com rolagem própria. Navegar para outra página ou aba continua levando ao início. |
| Remover gasto recorrente | **Gastos recorrentes → Remover** exclui o modelo após confirmação e preserva os gastos já registrados. |
| Concentrar o estoque | Em **Produtos e estoque → Estoque**, a seleção de produto permite pesquisar pelo nome, marca ou código, sem uma aba separada de movimentações. |
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
  8 de recuperação de esquema, 14 de limpeza operacional em banco isolado
  e 7 do runtime Netlify passaram. Nenhuma limpeza foi executada na produção.
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

## Conferência da publicação

A revisão com HTTPS validado passou em larguras de 1.440 e 390 pixels, cobrindo
Home, catálogo, produto, painel e editor. Não houve erros JavaScript nem
alterações comerciais durante os testes; login e logout responderam normalmente.
Comparar, editar e consultar vínculos de mídia mantiveram a rolagem com
deslocamento de **0 pixels**, restaurando o foco ao fechar os diálogos.
O título dos destaques pôde ser apagado e reescrito em memória; as alterações
locais foram desfeitas, sem salvar ou publicar conteúdo de teste.

As consultas de catálogo, Home e configurações começaram em paralelo. As
respostas de API observadas ficaram entre 307 e 959 ms; a primeira navegação
HTML levou aproximadamente 5,2 segundos neste ambiente. São medições pontuais,
não uma garantia de tempo de resposta em toda visita.

Os resumos criptográficos anteriores e posteriores confirmaram que produtos,
movimentações, financeiro, recorrências, vendas, pedidos, Home publicada e
configurações foram preservados. Os 18 produtos existentes continuam sem
grade cadastrada, aguardando os tamanhos e quantidades reais dos donos.

## Pendências fora desta entrega

Integração Stone, cobrança online e cotação automática de frete continuam
adiadas. A confirmação de cadastro de clientes ainda depende da configuração
do remetente e credenciais do Resend. Tamanhos, preços e saldos reais devem ser
conferidos pelos donos. As demais providências comerciais estão no
[checklist de lançamento](checklist-lancamento.md).
