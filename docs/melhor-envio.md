# Frete com Melhor Envio

## O que esta etapa entrega

- **Admin → Entregas:** conexão da conta por OAuth, exclusiva dos proprietários.
- **Produtos e estoque → editar peça → Dados para entrega:** peso em kg e dimensões em cm da peça embalada. Os quatro campos podem ficar vazios enquanto os donos fazem as medições; não há valores fictícios ou preenchimento automático.
- **Carrinho:** consulta por CEP mesmo antes do login, escolha de transportadora, preço e prazo e inclusão do frete no total.
- **Pedidos do site:** registro do serviço escolhido junto ao pedido.

Esta etapa não compra etiquetas, não debita a carteira do Melhor Envio e não ativa pagamentos. O payload de pagamento existente inclui o frete quando ele estiver presente no pedido. Emissão de etiquetas e rastreamento ainda precisam ser implementados.

## Configuração na Netlify

Variáveis de produção, disponíveis para Functions, sem prefixo `VITE_`:

| Variável | Valor ou origem |
| --- | --- |
| `MELHOR_ENVIO_CLIENT_ID` | ID do aplicativo criado no Melhor Envio |
| `MELHOR_ENVIO_CLIENT_SECRET` | Segredo do aplicativo; marcar como secreto |
| `MELHOR_ENVIO_REDIRECT_URI` | `https://galeo-store.netlify.app/api/integrations/melhor-envio/callback` |
| `MELHOR_ENVIO_ORIGIN_POSTAL_CODE` | `08285130` |
| `MELHOR_ENVIO_ENVIRONMENT` | Opcional; padrão `production` |
| `MELHOR_ENVIO_CONTACT_EMAIL` | Opcional; padrão `storegaleo@gmail.com`, informado no cadastro do aplicativo |

O aplicativo e suas credenciais devem corresponder ao ambiente escolhido. Sandbox usa conta e aplicativo próprios; não reutilizar credenciais de produção em sandbox. O callback deve ser exatamente igual no aplicativo e na hospedagem.

As três credenciais foram encontradas na Netlify em 27/10/2026; os valores marcados como secretos não foram lidos nem validados. O CEP de origem foi adicionado e conferido nessa data. O callback foi publicado em 29/10/2026; a autorização real pelo dono permanece pendente.

## Publicação e ativação

1. Executar `npm run db:migrate` no banco de produção, com as credenciais existentes e TLS validado, **antes** de publicar a nova API. A migração é aditiva: cria `shipping_integrations`, adiciona quatro medidas opcionais aos produtos e o resumo do frete aos pedidos. Não apaga nem altera os valores dos cadastros existentes.
2. Gerar o site (`npm run build`) e as Functions (`npm run bundle:netlify`) e publicar os dois juntos.
3. Entrar como proprietário em **Admin → Entregas → Conectar Melhor Envio** e autorizar o aplicativo com a conta da loja.
4. Informar peso e medidas reais nas peças antes de oferecer entrega pelo site.
5. Conferir uma cotação real com um CEP de destino. Essa consulta não compra etiqueta. Nenhuma cotação real, autorização OAuth real ou compra de frete foi realizada nos testes locais.

Em 27/10/2026 a conta Netlify estava em `in_operational_mode`, impedindo novas publicações. A API indicou a próxima renovação para **30/10/2026 às 04h, horário de São Paulo**. O deploy e a migração de produção ficaram pendentes desse bloqueio; não houve alteração de plano ou contratação de créditos.

Em **29/10/2026**, o projeto existente foi transferido para a equipe **Galeo Store**, no Free, mantendo o mesmo ID e endereço. A migração foi executada e seu marcador de sucesso confirmado nos logs do build; depois foram publicadas a interface e as Functions da revisão `330eaea752065d684e9118634c0dd8a8843d241e`, no deploy `6ae34da0fab2e4e71b41f0af`. As verificações no navegador passaram em desktop e celular, com os 11 hashes dos dados consultados iguais aos capturados antes do deploy. O banco continua no Aiven e as mídias no Cloudinary. Falta o proprietário autorizar a conta em **Admin → Entregas** e cadastrar peso e medidas reais para consultar fretes.

O envio de pedidos exige uma cotação válida quando há credenciais do Melhor Envio configuradas. Uma configuração incompleta, erro de conexão ou peça sem medidas não transforma o frete em gratuito. Instalações sem credenciais mantêm o fluxo manual, identificado no carrinho como frete a combinar e subtotal sem frete.

## Identificação das entregas

O carrinho e os detalhes do pedido mostram nomes legíveis: **Jadlog — Entrega econômica** para `.Package` e **Jadlog — Entrega expressa** para `.Com`. A apresentação não muda a modalidade selecionada, os identificadores, os tokens assinados, os preços ou os prazos retornados. Não presume que a opção expressa sempre terá o menor prazo ou o maior preço em uma cotação específica. Serviços desconhecidos conservam o nome retornado pela transportadora.

As marcas são arquivos locais originais, sem depender de imagens externas durante o checkout. Se uma imagem não carregar, o nome e a seleção da entrega continuam disponíveis. A legenda identifica a cotação pelo Melhor Envio; os logos não representam um selo de certificação da loja.

Fontes dos arquivos oficiais, obtidos em 30/10/2026:

- [Jadlog, servido pelo Melhor Envio](https://melhorenvio.com.br/images/shipping-companies/jadlog.png)
- [Correios](https://www.correios.com.br/++theme++tema-do-portal-correios/static/imagens/correios.svg)
- [Melhor Envio](https://melhorenvio.com.br/nuxt-assets/images/logo/melhor-envio.svg)
- [Descrição das modalidades Jadlog](https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220727372564)

## Proteções e verificação

O OAuth usa estado aleatório de uso único, vinculado à sessão do proprietário e consumido atomicamente no banco. Os tokens ficam criptografados com AES-GCM; o navegador nunca recebe o token de acesso ou de renovação. Quando a proteção geral de dados está ativa, usa a mesma infraestrutura de chave; caso contrário, usa uma chave derivada de `SESSION_SECRET`, específica da integração. Trocar essas chaves exige reconectar a conta.

O token de acesso é renovado sob demanda, com bloqueio no banco para evitar renovações concorrentes em diferentes Functions. Se a autorização de renovação expirar ou for revogada, o painel permite conectar novamente.

Cada cotação assinada dura 15 minutos e fica vinculada ao CEP de origem e destino, aos produtos, tamanhos, quantidades, preços, peso e medidas. O pedido verifica esses dados enquanto mantém o bloqueio do estoque; o cliente não escolhe o valor do frete pelo corpo da requisição. Mudanças no carrinho ou no CEP invalidam a escolha também na interface.

Verificações locais:

```sh
npm run check
npm test
npm run test:shipping
node --test --test-concurrency=1 tests/shipping.browser.mjs tests/shipping-admin.browser.mjs
npm run build
npm run bundle:netlify
```

Os testes de integração recusam banco de produção e criam somente uma base descartável no MySQL local. As respostas do Melhor Envio são simuladas nesses testes.

Documentação oficial consultada: [autorização](https://docs.melhorenvio.com.br/reference/fluxo-de-autorização), [token](https://docs.melhorenvio.com.br/reference/solicitacao-do-token) e [cálculo por produtos](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos).
