# Biblioteca — proteção das mídias em uso

Este incremento da Fase 3 impede excluir um arquivo da biblioteca enquanto
existirem referências nos produtos ou no conteúdo da Home.

## Uso no painel

Em **Biblioteca de mídia**, cada foto e vídeo tem a ação **Onde esta mídia é
usada**. A consulta mostra os nomes dos produtos e das seções, distinguindo
**Publicado** e **Rascunho**. Não há consultas individuais automáticas ao abrir
toda a biblioteca.

**Excluir** consulta o uso antes de abrir a confirmação. Mídias em uso ficam
bloqueadas. Se a consulta falhar ou outra edição criar um vínculo entre a
consulta e a exclusão, o arquivo permanece na biblioteca; a API também verifica
as referências antes de remover o arquivo.

Para liberar uma imagem publicada da Home, troque-a no editor, salve o rascunho
e publique a alteração. Para uma imagem usada somente no rascunho, altere e
salve o rascunho. Nos produtos, troque a capa/vídeo ou remova a referência da
galeria e salve. Consulte novamente o uso antes de excluir.

## Referências verificadas

- Capa e vídeo dos produtos, incluindo produtos desativados.
- Fotos e vídeos da galeria dos produtos, por URL ou identificação do arquivo.
- Seções da Home publicadas e rascunhos, inclusive seções ocultas.
- Campos de mídia nas configurações da Home, publicados e rascunhos.
- Referências das cinco versões retidas da Home.
- Imagem original, versão sem fundo e variantes do mesmo arquivo no Cloudinary.

Texto comum, títulos, descrições e IDs de produtos não são tratados como
referências de mídia. Um rascunho continua protegido enquanto seu vínculo
permanecer salvo, mesmo quando a seção estiver oculta.

## Comportamento da API

`GET /api/admin/media-library/:id/usage` retorna `in_use` e `references`, somente
para OWNER. `DELETE /api/admin/media-library/:id` exige sessão OWNER e CSRF,
consulta novamente as referências com bloqueios no MySQL e devolve
`409 MEDIA_IN_USE` com a lista quando o arquivo estiver vinculado.

Falha ao verificar as referências impede a exclusão. Falha ou ausência da
configuração do Cloudinary conserva o registro da biblioteca. A exclusão também
aguarda a conclusão de um processamento de IA já iniciado.

A seleção de capa por ID bloqueia o registro da biblioteca durante a gravação
do produto, evitando salvar uma escolha que foi excluída simultaneamente.
URLs digitadas manualmente depois de uma exclusão concluída continuam sendo
URLs manuais; esta etapa não cria um histórico de arquivos já excluídos.

Não há alteração dos dados operacionais de produção, nova coluna ou serviço.
Substituição, nomes e ordenação foram concluídos no incremento descrito em [conclusão das etapas](conclusao-etapas-cms.md).
