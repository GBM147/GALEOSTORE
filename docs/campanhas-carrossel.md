# Campanhas com várias mídias

A composição editorial da Home continua com seus cards de campanha. Cada
campanha pode ter até 12 imagens ou vídeos, com uma mídia opcional para celular
em cada posição. Campanhas antigas, com uma única mídia, continuam funcionando
sem controles de carrossel.

O editor oferece **Usar padrão da GALEO**, selecionado automaticamente. Essa
opção aplica o efeito, a transição, a velocidade e a duração salvos em
**Configurações → Animações**. Desmarcar a opção permite definir essas escolhas
apenas para a campanha atual. As configurações individuais não substituem o
padrão das outras campanhas.

As transições **Fade**, **Slide** e **Crossfade** trocam as mídias de fato.
Fade apaga a anterior antes de mostrar a próxima; Crossfade faz as duas mudanças
ao mesmo tempo; Slide acrescenta um deslocamento curto. O intervalo entre
trocas usa a duração configurada, entre 2 e 30 segundos. A velocidade controla
a transição e o movimento da imagem.

Quando há pelo menos duas mídias, o cliente pode voltar, avançar e pausar a
rotação. A rotação também pausa quando a campanha sai da tela, o navegador fica
em segundo plano, o ponteiro está sobre o card ou um controle recebe foco.
Vídeos ocultos ou de slides inativos não reproduzem. Com a preferência de
movimento reduzido, a rotação automática, as animações e a reprodução automática
de vídeos ficam desativadas; os botões continuam trocando as mídias.

As imagens para celular usam a seleção responsiva do navegador. Os vídeos
podem ter versão móvel própria; quando ela não existe, a versão desktop é
reutilizada. As fotos originais permanecem no Cloudinary e os novos campos
guardam somente suas referências no conteúdo da Home.

Os dados continuam seguindo **Salvar rascunho → Visualizar rascunho → Publicar
Home**. Escolher uma mídia ou uma animação no editor não altera a Home pública
até a publicação. A combinação de Inter pesada e Georgia em itálico dos
títulos existentes foi preservada.

## Dados e verificação

`items[].slides` aceita `media_id`, `media_url`, `media_type`, `mobile_media_id`,
`mobile_media_url` e `mobile_media_type`. As URLs de vídeo antigas
`video_media_url` e `mobile_video_media_url` também são reconhecidas.
`items[].animation.use_default` ausente equivale a `true`.

O resolver é verificado por
`node --test --test-isolation=none src/campaign-model.test.js`, cobrindo padrão,
configuração individual, limites, compatibilidade com mídia única e versões
móveis de vídeo. A revisão no navegador usa mídia local e não executa
transformações pagas nem acessa os provedores.
