# Catálogo da GALEO a partir do Instagram

Importação pontual concluída em 23/10/2026, a pedido dos donos. Origem:
https://www.instagram.com/galeostoreofc/.

## Resultado atual

- 19 cadastros de peças, publicados como vitrine em 24/10/2026 por solicitação
  dos donos, com **Preço a definir** e compra indisponível.
- Biblioteca com oito fotos extraídas literalmente dos vídeos e seis vídeos
  completos com áudio. Os arquivos ficam no Cloudinary; o banco guarda referências.
- Fotos e vídeos compartilhados foram enviados uma única vez e reutilizados.
- Na importação inicial, os 19 cadastros ficaram privados. A publicação
  posterior confirmou os 19 endereços públicos e preservou fotos, vídeos,
  descrições, preços, saldos e histórico de estoque.

Vitrine: https://galeo-store.netlify.app/shop.

Acesso: https://galeo-store.netlify.app/admin → **Produtos e estoque** → **Editar**.
A biblioteca de mídia também está disponível pelo Admin.

## Dados pendentes antes de vender

A [planilha de revisão](catalogo-instagram-revisao.csv) contém os 19 cadastros e
campos vazios para preço, custo, tamanhos/numerações e quantidades por tamanho.

Os preços, custos e saldos foram gravados como zero por estarem pendentes de
preenchimento; não representam preços comerciais nem uma contagem do estoque
real. A vitrine exibe **Preço a definir**, e a interface e a API bloqueiam
pedidos de peças sem preço positivo. Também é necessário saldo suficiente
para comprar. Nenhum tamanho foi inventado.

Conferir nomes, marcas e quais peças são vendidas separadamente ou como kit.
As fotos mostram composições com várias peças; a separação em cadastros é
preliminar. A marca da bermuda branca e a do chinelo de dedo ficaram em aberto
porque a inscrição não estava suficientemente legível. As demais marcas foram
transcritas das estampas ou etiquetas visíveis; os modelos exatos e demais
características ainda precisam de confirmação.

O sistema **ainda não oferece seleção de tamanho nem estoque por tamanho**.
Uma grade precisa ser implementada em conjunto no produto, carrinho, reservas,
PDV e histórico antes de vender várias numerações no mesmo cadastro. Preencher
uma descrição com tamanhos não implementa esse controle.

## Origem e limites da coleta

O Instagram liberou 12 publicações no acesso público sem login. Destas, seis
vídeos comerciais foram importados; apresentações de integrantes, meme e
consulta sobre possíveis relógios não foram transformados em produtos. Isso
não é uma importação das 154 publicações do perfil nem uma sincronização
automática de novas postagens.

Peças identificadas em:

- https://www.instagram.com/galeostoreofc/reel/Dewo-BLRIlv/ — seis composições;
  fotos usadas nos cadastros e vídeo completo mantido somente na biblioteca,
  pois mostra produtos diferentes.
- https://www.instagram.com/galeostoreofc/reel/Deei2UWN40l/ — composição com
  regata preta e bermuda branca; foto e vídeo associados às respectivas peças.
- https://www.instagram.com/galeostoreofc/reel/DeeilEotfXr/ — composição com
  regata vermelha e bermuda preta; foto e vídeo associados às respectivas peças.

Vídeos comerciais adicionais, disponíveis na biblioteca para revisão:

- https://www.instagram.com/galeostoreofc/reel/DeuR1fnxQ-g/
- https://www.instagram.com/galeostoreofc/reel/DezOZg0RkeX/
- https://www.instagram.com/galeostoreofc/reel/DeU6wYDiuzz/

Valores promocionais antigos e menções de tamanhos desses vídeos não foram
usados para cadastrar preços ou estoque. As fotos foram extraídas sem alterar
a aparência das roupas; não foi aplicada remoção de fundo por IA.

## Cadastros criados

| ID no Admin | Produto | Marca visível | Categoria |
| --- | --- | --- | --- |
| 1000000001 | Camiseta Balenciaga preta com logo vermelho | Balenciaga | Camisetas |
| 1000000002 | Calça jeans cinza com detalhes vermelhos | John John | Calças |
| 1000000003 | Camiseta Fred Perry branca com gola listrada | Fred Perry | Camisetas |
| 1000000004 | Calça jeans escura com respingos amarelos | John John | Calças |
| 1000000005 | Camiseta EA7 preta com estampa de águia | EA7 | Camisetas |
| 1000000006 | Calça jeans azul clara com rasgos | John John | Calças |
| 1000000007 | Camiseta Fred Perry preta com acabamento verde | Fred Perry | Camisetas |
| 1000000008 | Calça jeans escura com detalhes vermelhos | John John | Calças |
| 1000000009 | Camiseta EA7 branca estampada | EA7 | Camisetas |
| 1000000010 | Calça preta com detalhes vermelhos | John John | Calças |
| 1000000011 | Camiseta EA7 preta com faixa amarela | EA7 | Camisetas |
| 1000000012 | Calça jeans cinza clara com detalhes verde-limão | John John | Calças |
| 1000000013 | Regata Nike preta com estampa branca e vermelha | Nike | Camisetas |
| 1000000014 | Bermuda branca com cordão | A confirmar | Bermudas |
| 1000000015 | Chinelo Nike slide preto e branco | Nike | Calçados |
| 1000000016 | Regata Nike vermelha com estampa branca e preta | Nike | Camisetas |
| 1000000017 | Bermuda Nike preta com cordão | Nike | Bermudas |
| 1000000018 | Boné Nike vermelho com logo preto | Nike | Acessórios |
| 1000000019 | Chinelo de dedo preto com detalhes claros | A confirmar | Calçados |
