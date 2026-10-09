# Biblioteca — comparação e escolha da imagem

Este incremento das fases 3 e 3A mantém o visual do Admin existente e separa
preparar a foto sem fundo de escolher qual versão será usada.

## Biblioteca de mídia

1. Abra **Biblioteca de mídia** e escolha uma foto para comparar.
2. Confira **Original** e **Sem fundo** lado a lado (empilhadas no celular).
3. Se necessário, use **Remover fundo (IA)** e depois **Verificar resultado**.
4. Use **Usar esta versão** na foto desejada. A versão selecionada indica **Em uso**.

Concluir o processamento não ativa a versão sem fundo. O original permanece
guardado, e conferir um resultado já gerado reutiliza a URL existente.
Uma foto em processamento ou com erro não pode ser escolhida como versão sem
fundo; a versão original continua disponível.

## Capa do produto

Em **Produtos e estoque**, cadastre ou edite um produto, abra **Escolher da
biblioteca**, selecione a foto e use **Usar esta versão** em Original ou Sem
fundo. A escolha fica no formulário até clicar em **Salvar produto**.

Essa escolha não muda a preferência geral da biblioteca. O produto guarda a
URL da versão aprovada; mudar posteriormente a preferência da biblioteca não
troca sua capa. Alterar manualmente a URL da foto principal substitui a escolha
da biblioteca. Cancelar a seleção preserva a capa anterior.

A página pública do produto mostra a capa salva primeiro e conserva as demais
fotos e vídeos da galeria, sem repetir a mesma mídia.

## Contratos e limites

- `PATCH /api/admin/media-library/:id` exige `use_ai` booleano quando informado.
  `true` exige uma foto com `ai_status=done` e uma URL tratada disponível.
- Criar/editar produto aceita `image_asset_id` e `image_variant` (`original` ou
  `ai`). O backend resolve a URL confiável da biblioteca e rejeita mídias
  inexistentes, vídeos e versões ainda indisponíveis.
- Não há nova coluna nem migração dos produtos existentes. Uploads e URLs
  manuais continuam disponíveis.
- A remoção real de fundo depende da configuração e dos créditos do Cloudinary.
  Os testes automatizados usam resultados controlados, sem transformações pagas.
- Substituição e ordenação da biblioteca geral, tratamento automático de novas
  fotos, Fundo GALEO e carrossel de campanhas pertencem aos próximos incrementos.
- Excluir um arquivo da biblioteca remove o arquivo remoto; fotos já usadas em
  produtos ou conteúdo precisam ser preservadas.

## Verificação

`npm run check`, `npm test` e `npm run build` verificam o código e os contratos
de processamento, aprovação explícita, reuso e escolha de capa. Os testes de
integração `npm run test:media` exigem MySQL local `galeo_store_test` na porta
3307 e as variáveis locais `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD` e `SESSION_SECRET`. O helper recusa produção, inicia sua API na
porta 10128, bloqueia provedores externos e remove somente suas próprias
fixtures no encerramento.

Com Vite e Playwright/Chromium disponíveis, `npm run test:browser` verifica
comparação, seleção, cancelamento, falha/retry da prévia e galeria em desktop e
celular, além dos fluxos anteriores. Essas interações usam APIs controladas
para testar estados sem depender de créditos do Cloudinary.

Na verificação de 9 de outubro de 2026 passaram 71 testes unitários, 10 testes
HTTP/MySQL desta etapa e 16 testes no navegador. A revisão visual corrigiu a
sobreposição do cabeçalho sobre o formulário do produto no celular. Build e
verificação de sintaxe também passaram.

Um fluxo adicional no navegador, sem mocks das APIs, verificou login OWNER,
comparação em desktop/celular, salvar a capa sem fundo, conferir no MySQL e na
página pública e restaurar a capa original, mantendo a galeria. Usou fotos
sintéticas e resultados já preparados, sem chamadas ao Cloudinary ou e-mails.
