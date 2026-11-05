# Mercado Pago — Checkout Transparente via Orders

O código da GALEO implementa Checkout Transparente via Orders, usando a aplicação existente da loja. O pagamento possui uma tela própria em `/pagamento/:orderId`, acessível após registrar o pedido no carrinho e pela área do cliente. A captura atual do painel mostra a aplicação como **Loja Integrada / CheckoutPro**; esses metadados e a compatibilidade da modalidade precisam ser conferidos na homologação antes de ativar os pagamentos. O código não altera esse cadastro nem cria outra aplicação automaticamente.

O adaptador anterior misturava Orders com redirecionamento do Checkout Pro. O contrato atual utiliza `POST /v1/orders`, processamento automático e uma transação de Pix ou cartão tokenizado. Não espera `checkout_url` nem envia `config.online.success_url`.

O pedido enviado ao Mercado Pago segue o exemplo mínimo documentado: tipo online, processamento automático, total, referência, e-mail do comprador e transação. Produtos, nomes, endereço e demais metadados completos permanecem na GALEO. O total enviado continua sendo conferido contra os itens e o frete do pedido; os padrões do provedor regem captura e segurança da transação.

## Estado da validação

O código tem testes automatizados locais com MySQL isolado e APIs/SDK simulados. Isso verifica a lógica da GALEO, mas **não comprova uma compra no Mercado Pago**, a entrega real do webhook, a tokenização com as chaves da loja ou a qualidade oficial da integração. Essas etapas dependem das credenciais e da conta de teste. Não houve cobrança real durante o desenvolvimento.

As ferramentas MCP do Mercado Pago não estão conectadas a esta sessão. Foram consultados os guias e o OpenAPI públicos do fornecedor; nenhuma aplicação ou conta foi criada por essas ferramentas.

## Configuração

Tudo começa desativado: `MERCADO_PAGO_MODE=disabled`. Apenas salvar um Access Token não habilita pagamentos.

Para homologação, use banco separado cujo nome termine em `_test`, origem própria de teste em `APP_URL` e credenciais de teste correspondentes ao vendedor configurado. Nunca copie os dados operacionais de produção para esse ambiente. Configure somente no servidor:

```dotenv
MERCADO_PAGO_MODE=test
GALEO_MERCADO_PAGO_TEST_ACCESS_TOKEN=
GALEO_MERCADO_PAGO_TEST_PUBLIC_KEY=
GALEO_MERCADO_PAGO_TEST_WEBHOOK_SECRET=
MERCADO_PAGO_TEST_SELLER_ID=
MERCADO_PAGO_TEST_CREDENTIALS_CONFIRMED=true
```

Para testar **Orders API**, obtenha o Access Token e a Public Key **`APP_USR-` de homologação no painel da aplicação**. O ambiente de teste da GALEO exige consulta autenticada a `/users/me`, com o ID do vendedor configurado, `site_id=MLB` e a marca `test_user`. Credenciais `APP_USR-` de um perfil normal não passam por esse fluxo.

As credenciais estáticas **`TEST-`** são válidas para outros produtos, como Payments API/Bricks; não são aceitas por este adaptador de Orders. Na homologação, esse par permitiu consultar o perfil e tokenizar o cartão de teste, mas `POST /v1/orders` respondeu **401 `invalid_credentials`**. Esses dois primeiros resultados não comprovam compatibilidade com Orders. Não altere o prefixo de uma chave: obtenha as credenciais da conta de teste pelo painel do fornecedor.

Pares estáticos `TEST-`, misturados ou desconhecidos ficam indisponíveis antes de qualquer chamada ao provedor. O prefixo `APP_USR-`, isoladamente, não libera cobranças: continuam obrigatórios a confirmação explícita das credenciais, o banco e a origem de homologação, as demais chaves e a verificação autenticada do vendedor. Uma consulta negada ou um ID/país divergente não permite criar o pagamento. A verificação em cache é vinculada ao modo, tipo de credencial, Access Token, Public Key e vendedor.

Em homologação, uma recusa definitiva na criação do pagamento pode registrar o status HTTP, códigos limitados e nomes de campos reconhecidos do pedido no payload cifrado da tentativa. Os nomes são derivados somente das chaves realmente enviadas; mensagens do provedor servem para reconhecer essas referências e não são armazenadas. Esse diagnóstico não inclui valores dos campos, dados do cartão ou credenciais, não aparece nas respostas ao cliente e não modifica o tratamento de respostas ambíguas. O registro permanece desativado em produção.

Para testar cartões na Web, a documentação atual permite um **e-mail válido do comprador**. Na GALEO, esse e-mail vem da conta autenticada no ambiente de homologação, não de um valor arbitrário enviado pelo navegador. A exigência de uma conta virtual vendedora para Orders permanece independente desse e-mail.

O backend disponibiliza somente a Public Key e as opções permitidas em `GET /api/store/payments/config`, com `Cache-Control: no-store`. Access Token e segredo de webhook permanecem no servidor ou nas rotinas privadas de configuração; nunca devem entrar no HTML, nos assets ou no código do frontend. Não use prefixo `VITE_` para essas credenciais.

Depois da homologação, a ativação real exige todas as chaves de produção, origem HTTPS e os dois controles explícitos:

```dotenv
MERCADO_PAGO_MODE=production
MERCADO_PAGO_LIVE_PAYMENTS_ENABLED=true
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_PUBLIC_KEY=
MERCADO_PAGO_WEBHOOK_SECRET=
MERCADO_PAGO_SELLER_ID=
```

Ativar pagamentos reais e fazer uma compra real são etapas distintas do teste automatizado e devem ser combinadas com os donos. A configuração de maquininha Point permanece separada.

## Fluxo e proteção

- O servidor calcula os itens, o frete e o total, e obtém o comprador da sessão autenticada. Valores e e-mail enviados pelo navegador não substituem esses dados.
- Cartão utiliza o CardForm oficial com `iframe: true`. Número, validade e CVV são coletados pelo Mercado Pago; a API da GALEO rejeita campos brutos de cartão. Crédito e débito estão preparados para pagamento em uma parcela.
- Pix exibe QR Code e copia e cola retornados pelo provedor, com expiração de 30 minutos. A imagem é validada e mostrada localmente; não é enviada a geradores de QR externos.
- Cada tentativa possui UUID persistida antes da chamada externa. Uma resposta incerta preserva a mesma tentativa; não permite abrir uma segunda cobrança até esclarecer a primeira. A sessão do navegador guarda apenas UUID e forma de pagamento, nunca token do cartão ou CPF.
- A confirmação é consultada no servidor. A página de retorno e os parâmetros da URL não aprovam pagamentos. Status de autorização, revisão e desafio permanecem pendentes.
- Webhooks exigem HMAC válido, correspondência dos identificadores e consulta autenticada à Orders API. O tópico é `orders`. Configure a URL do **ambiente correspondente** com o caminho `/api/integrations/mercado-pago/webhook`.
- Se a resposta de criação se perder, o webhook pode recuperar atomicamente a única tentativa pendente sem referência, depois de verificar pedido, vendedor, valor, método e coerência temporal. Não cria outra cobrança.
- Eventos repetidos não criam outra venda ou receita. Estorno da tentativa vencedora restitui estoque e cancela a receita uma vez. Aprovação depois de cancelamento exige conciliação, sem recriar venda ou retirar estoque já restituído.
- Todos os locks e conexões são liberados antes da resposta HTTP, inclusive em erros, para compatibilidade com Functions da Netlify. A confirmação durável é concluída antes de responder; não depende de trabalho solto após `res.json()`.

## Reservas e financeiro

A criação do pedido reserva estoque por tamanho. A aprovação gera uma venda e receita bruta incluindo frete; taxas, recebimento líquido e prazo de liquidação precisam ser conciliados com a operação da loja.

A manutenção diária pode encerrar pedidos de Mercado Pago com mais de 24 horas quando não há pagamento em andamento nem aprovação. Tentativas ambíguas e cobranças ainda pendentes são preservadas. O lote não deixa 50 tentativas ambíguas bloquearem a liberação de outras reservas. A rotina não altera pedidos manuais antigos e permanece inativa enquanto o pagamento online estiver desabilitado.

O Melhor Envio calcula o frete. Compra e emissão de etiquetas continuam pendentes; não são realizadas ao aprovar pagamento.

## Testes

```sh
npm test
npm run check
node --test --test-isolation=none tests/frontend.browser.mjs tests/mercado-pago-checkout.browser.mjs
```

Os testes de integração recusam banco externo: exigem `DB_HOST` loopback e `DB_NAME=galeo_store_test`. O helper simula o Mercado Pago e bloqueia chamadas externas. Eles cobrem criação, concorrência, recuperação de resposta perdida, Pix, cartão tokenizado, aprovação, recusa, estorno, reservas, assinatura e vendedor/valor incorretos.

Depois disso, ainda é necessário testar com o fornecedor: tokenização, cartões de teste, Pix e estados disponíveis na conta; entrega real das notificações; e-mails; retomada do pedido; estoque e venda; cancelamento/estorno. O Order ID de uma compra de teste pode ser usado na medição do painel. Não preencher a medição com um identificador inventado.

## Fontes oficiais

- [Recursos de IA](https://www.mercadopago.com.br/developers/pt/docs/ai-resources.md)
- [Skill de integração para Codex](https://github.com/mercadopago/mercadopago-plugins-marketplace/blob/main/plugins/mercadopago/codex/skills/mp-integrate/SKILL.md)
- [Checkout Transparente/Orders](https://github.com/mercadopago/mercadopago-plugins-marketplace/blob/main/plugins/mercadopago/codex/skills/mp-integrate/references/guides/checkout-api.md)
- [Preparação de testes](https://github.com/mercadopago/mercadopago-plugins-marketplace/blob/main/plugins/mercadopago/codex/skills/mp-test-setup/SKILL.md)
- [OpenAPI de Orders](https://github.com/mercadopago/openapi/blob/master/by-product/orders/spec3.reference.json)
- [CardForm](https://github.com/mercadopago/sdk-js/blob/main/docs/card-form.md)
