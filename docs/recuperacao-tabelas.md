# Recuperação após exclusão das tabelas — 13/10/2026

O botão **Apagar** do Adminer eliminou as estruturas operacionais. Restaram
11 tabelas com donos, conteúdo, histórico, mídia, categorias, contas e sessões.
A recuperação solicitada recria as estruturas vazias; não recupera os registros
de teste eliminados nem apaga as tabelas preservadas.

## Recuperação na inicialização

- Detecta tabelas operacionais ausentes quando existe uma loja configurada.
- Antes de recriar clientes, remove sessões antigas de clientes. Sessões de
  donos continuam funcionando; nas sessões mistas remove somente `customerId`,
  preservando cookie, expiração e CSRF, inclusive com dados protegidos.
- Remove apenas `product_ids` dos produtos apagados no rascunho, publicado e
  histórico da Home. Textos, fontes, imagens, ordem, visibilidade e datas ficam
  preservados.
- Define IDs novos a partir de uma faixa alta, acima das referências antigas
  identificadas, já no `CREATE TABLE`. Assim uma inicialização interrompida não
  deixa sequências baixas para a próxima tentativa.
- Recria colunas, índices e chaves estrangeiras pelo schema existente, sem
  desativar a verificação dos vínculos e sem inserir produtos/clientes de teste.
- Confere que cada tabela recriada está vazia antes de abrir o serviço.
- Usa uma nova chave de armazenamento de carrinho no navegador, descartando
  carrinhos antigos de teste; os novos carrinhos continuam persistentes.

O fluxo normal de inicialização não invalida sessões nem limpa conteúdo. As
ações de recuperação são condicionadas à ausência real das tabelas. A biblioteca
e os arquivos no Cloudinary permanecem disponíveis. Saldos iniciais das contas
financeiras são preservados; este reparo não os altera.

## Validação

`npm run test:recovery` reproduz o mesmo conjunto de 14 tabelas apagadas num
banco MySQL descartável em loopback, com bloqueio de provedores. Os testes
conferem as 25 tabelas originais, colunas, índices, FKs, dados operacionais vazios,
preservação dos donos/Home/mídia, cookies antigos recusados, sessões de donos
funcionais, IDs altos e segundo reinício idempotente.

Um teste interrompe a inicialização retirando temporariamente `ALTER` apenas
da base descartável. As tabelas já criadas mantêm IDs seguros; após restaurar
a permissão, o reinício termina a recuperação. As fixtures são removidas.

Resultado: 8 verificações de recuperação e 151 testes unitários aprovados,
além da regressão do navegador, verificação de sintaxe e build.

Em produção, a verificação precisa incluir o catálogo e a revisão publicada:
`/health` sozinho consulta `SELECT 1` e pode responder enquanto faltam tabelas.
Recriar a estrutura não constitui restauração de backup e não ativa a camada
adicional de criptografia nem configura o Resend.
