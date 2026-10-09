# GALEO Store — revisão do plano

Revisão do código comparada aos dois trechos do histórico fornecido da conversa “Continuar Galeo Store”, em 8 de outubro de 2026. As etapas implementadas foram publicadas no serviço Render existente, incluindo a integração transacional com Resend. As pendências abaixo distinguem a validação dos donos, a configuração dos provedores e as funcionalidades ainda não implementadas.

A rodada posterior de [verificação real no navegador](verificacao-no-navegador.md) usa a API e o MySQL locais sem mocks e registra funções aprovadas, falhas reproduzidas e pendências das nove fases. Pagamento e frete foram excluídos dessa rodada conforme solicitado.

A [primeira etapa dos ajustes de segurança](ajustes-seguranca.md) corrige a reativação de contas no reinício e a validação de senhas, mantendo as demais pendências para as próximas etapas.

A decisão posterior de permitir Admin somente aos donos foi aplicada em [Admin exclusivo OWNER](acesso-admin-owner.md). O plano atual substitui o acesso STAFF operacional pelo acesso exclusivo de contas OWNER ativas.

A etapa seguinte acrescenta [confirmação de e-mail dos clientes](verificacao-email.md)
e [proteção adicional dos dados pessoais](protecao-dados.md). Novos cadastros e
contas existentes exigem confirmação antes de entrar e comprar. A camada extra
de criptografia foi testada com migração e fluxos reais em MySQL local; ativá-la
na produção depende da chave segura, TLS validado, backup conferido e uma janela
sem escritas de versões anteriores. A documentação do Aiven sobre criptografia
do armazenamento e dos backups está em [segurança dos provedores](provedores-seguranca.md).

A [limpeza dos dados de teste](limpeza-dados-de-teste.md) teve seu escopo
confirmado: remover todos os dados operacionais, preservando donos e Home.
A ferramenta de manutenção inspeciona por padrão, executa com backup e
escritores interrompidos e compara os registros preservados antes do commit.
O bootstrap deixou de substituir automaticamente frases da Home em cada
reinício. A remoção na produção continua pendente do acesso seguro e do backup;
o token Aiven vinculado respondeu HTTP 401 na última conferência.

## Escopo e forma de trabalho confirmados

- Integração com maquininha e frete automático estão adiados por decisão do usuário até a contratação dos serviços. O PDV atual registra pagamentos confirmados manualmente.
- Executar uma ação por vez, explicar antes e apresentar o resultado para o usuário testar e validar antes da próxima etapa.
- A autorização para aplicar uma etapa inclui fazer o deploy no serviço existente e verificar o resultado publicado antes da validação do usuário. Pagamento e frete continuam fora do escopo até nova autorização.
- Preservar a identidade editorial da GALEO, incluindo Inter pesada e Georgia em itálico; manter senhas com bcrypt e arquivos grandes no Cloudinary.
- Para alterações visuais, seguir a skill [img-to-html](https://github.com/rtadewald/skills/blob/main/img-to-html/SKILL.md): referência, wireframe e plano, fundo, componentes/fontes, assets e revisão, com aprovação entre etapas. Aplicar o fluxo ao projeto React existente conforme o escopo pedido.

## Etapas combinadas

| Etapa | Estado nesta revisão |
| --- | --- |
| Editor da Home | Conteúdo, categorias, ordem, visibilidade, mídia móvel, tema e efeitos ligados à vitrine; tipografia editorial original preservada |
| Salvar → visualizar rascunho → publicar | Conteúdo, ordem, visibilidade e configurações agora ficam separados da versão pública; prévia e publicação restritas ao proprietário |
| Produto | Detalhe, mídias, estoque, carrinho e relacionados implementados; catálogo usa a mesma API da loja por padrão |
| Conta | Cadastro, login, sessão persistente, perfil, pedidos e logout implementados; identificador da sessão renovado ao autenticar |
| Carrinho e pedido | Pedido reserva estoque; falha ao abrir pagamento permite retomar o mesmo pedido, inclusive após recarregar a página |
| Pedidos online no Admin | Listagem e operação existentes; cancelamento e notificações protegem estoque e estados finais |
| PDV físico | Tela de caixa adicionada ao Admin: produtos, quantidades, total, confirmação manual, venda, estoque, financeiro e comprovante |
| Cobrança automática na maquininha | Adiada até contratação dos serviços; o adaptador Point existente ainda não compõe um fluxo de caixa automático |
| Pagamento online | Lógica local de checkout, aprovação, venda, receita e estorno validada com Mercado Pago simulado; contrato e operação reais precisam de teste com a conta do provedor |
| E-mails transacionais | Resend ligado a confirmação de cadastro, boas-vindas após confirmação, pedido e mudanças de status no Admin; diagnóstico restrito ao OWNER; remetente pendente e envio real ainda não validado |
| Frete automático | Adiado até contratação dos serviços; o pedido atualmente grava frete zero, sem cotação automática |

## Conferência das nove fases do plano completo

| Fase | O que existe | O que ainda precisa ser concluído |
| --- | --- | --- |
| 1 — Segurança e permissões | Admin exclusivo OWNER conforme decisão atual; STAFF não inicia sessão e sessões antigas são revogadas; clientes separados; CSRF, bcrypt, renovação de sessão, bloqueio de contas desativadas e limites de login; reinício não reativa contas e novas senhas respeitam o limite do bcrypt; sem gestão de usuários | Validação final dos donos no ambiente publicado |
| 2 — CMS da Home | Sete blocos no MySQL, conteúdo editável, dados de mídia, ordem e visibilidade | Conferir todos os campos e o uso no editor com o proprietário; alterações de texto não podem perder a formatação editorial |
| 3 — Biblioteca de mídia | Upload e visualização no Cloudinary, metadados no MySQL, exclusão, seleção original/IA e ordenação de mídia de produtos | Substituição e ordenação da biblioteca geral; seleção da versão tratada diretamente no cadastro de produto |
| 3A — Tratamento de imagens | Original preservado, remoção de fundo e resultado salvo/reutilizado | Prévia lado a lado e aprovação antes de usar: hoje concluir a IA já marca `use_ai=1`; configurar o padrão para novas fotos de produtos; opção visual Fundo GALEO |
| 4 — Campanhas com movimento | Presets de efeito, velocidade/duração, GSAP e configurações de movimento | Carrossel real com Fade/Slide/Crossfade, opção explícita Usar padrão da GALEO e escolha de mídia móvel na edição da campanha |
| 5 — Ordenação | Ordem numérica editável, respeitada pela Home, visível/oculto | Arrastar e soltar seções no editor |
| 6 — Rascunho e publicação | Conteúdo, metadados e configurações separados; publicação transacional | Comparação visual clara entre rascunho e última publicação, além das datas e prévia atuais |
| 7 — Preview | Home de rascunho protegida para OWNER | Validação visual do usuário em cada alteração de interface |
| 8 — Auditoria econômica | Registro de ações administrativas relevantes | Edição/salvamento do conteúdo ainda não é auditado; limitar tamanho dos detalhes e implementar retenção automática por prazo/quantidade. Hoje não há limpeza de `audit_logs` |
| 9 — Versionamento | Publicação atual e rascunho | Snapshot compacto da publicação anterior, histórico limitado e restauração. Hoje não há versão anterior recuperável |

Os limites numéricos citados para planos gratuitos vieram do histórico fornecido e não foram revalidados com os provedores nesta revisão. A política de retenção e versionamento deve continuar conservadora independentemente desses valores.

## Correções relevantes

- Inicialização agora cria `payments` e `integration_events` e migra colunas necessárias sem apagar dados.
- Um rascunho não publica configurações nem muda a ordem/visibilidade pública; reiniciar o servidor preserva as edições do CMS.
- Categorias de produtos ficam separadas das categorias financeiras.
- Repetir upload usa o produto já cadastrado; repetir pagamento usa o pedido já registrado.
- Vendas do PDV usam uma referência por operador/venda para evitar duplicação em requisições repetidas ou respostas perdidas.
- O PDV verifica o total esperado antes de registrar; mudanças de preço exigem nova confirmação.
- Auditoria e consulta da resposta de vendas, pedidos e produtos ocorrem antes da confirmação da transação.
- Cancelamento devolve a reserva uma vez; pedidos cancelados não são reabertos por notificações de entrega. Estornos confirmados não repetem a restituição.
- Pagamento aprovado gera uma única venda/receita. Eventos atrasados e a criação do checkout não rebaixam uma aprovação já processada.
- Aprovação após cancelamento fica registrada para conciliação, sem reabrir o pedido nem lançar venda sobre estoque já devolvido.
- A API pública omite custo de compra e estoque mínimo. Alterar a senha preserva a duração escolhida da sessão administrativa.
- Produtos rejeitam valores negativos e estoque fracionário; ajuste de estoque para zero é permitido; recorrências usam datas válidas para o mês.
- Biblioteca de mídia reaproveita o resultado de IA salvo, evitando uma segunda transformação ao verificar o resultado.
- O comando de build do Render agora gera o frontend.

## Validação e reprodução

Use Node compatível com Vite 7 (20.19+, 22.12+ ou 24). As suites automatizadas desta revisão usam Node 24. Execute `npm install`, `npm run check`, `npm test` e `npm run build`.

Resultado desta revisão: build e verificação de sintaxe aprovados; 42 testes passaram (19 backend, 10 Mercado Pago simulado, 3 biblioteca de mídia e 10 navegador), sem testes ignorados. Health com MySQL, rotas da versão compilada e keepalive WebSocket também responderam corretamente. O build ainda emite aviso de bundle JavaScript acima de 500 kB; a otimização por carregamento de módulos pode ser feita separadamente.

Os testes de integração exigem MySQL local, `DB_NAME=galeo_store_test`, `DB_HOST` loopback, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `GALEO_TEST_BASE_URL` e `DISTRIBUTOR_WEBHOOK_SECRET`. Inicie a API com essas variáveis e execute `npm run test:integration`. Os testes recusam bancos externos/de produção, usam dados próprios e removem as fixtures. A suíte Mercado Pago inicia e encerra seu próprio servidor na porta 10001; essa porta deve estar livre. O provedor é simulado, sem cobranças nem chamadas externas.

Para o navegador, inicie `npm run dev`, disponibilize Playwright e Chromium e execute `npm run test:browser`. `FRONTEND_TEST_URL` e `PLAYWRIGHT_CHROMIUM_EXECUTABLE` permitem indicar servidor e navegador locais. O ambiente desta revisão já fornece Playwright; fora dele, pode ser instalado com `npm install --no-save --package-lock=false playwright`. Esses testes usam APIs simuladas para verificar interface, retries, CMS e caixa.

## Pendências externas e limites

- Retomar maquininha e frete automático somente após a contratação dos serviços e a autorização do usuário para essa etapa.
- Validar Mercado Pago com credenciais de teste e sua documentação atual antes de habilitar cobranças reais. Os testes simulados verificam a lógica da aplicação, não certificam o contrato do provedor.
- Configurar/validar `RESEND_API_KEY`, `EMAIL_FROM` e `STORE_NOTIFICATION_EMAIL` nas configurações seguras do serviço. Não colocar chaves no código nem em mensagens.
- Configurar/validar Cloudinary para uploads e tratamento de imagens reais.
- O frete atual permanece manual/pendente; a interface “A calcular” não representa uma cotação nem um valor já cobrado.
- O formulário de newsletter ainda não registra inscrições; isso não foi incluído no plano transacional fornecido e precisa de definição própria.
- Os efeitos de campanha são aplicados à mídia de cada card. O seletor de transições não constitui um carrossel entre múltiplas mídias; esse carrossel faz parte da Fase 4 do plano completo e permanece pendente.
- O `render.yaml` existente desativa a validação do certificado MySQL com `DB_SSL_REJECT_UNAUTHORIZED=false`. É necessário obter a CA confiável do banco e habilitar validação TLS antes de tratar esse ponto como resolvido. Os testes usam somente MySQL loopback sem TLS e não validam a conexão Aiven.
- A API Go foi inspecionada e mantida como catálogo opcional, sem alterações. Não foi executada nesta revisão.
