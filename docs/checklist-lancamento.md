# Preparação da GALEO para atender clientes

Situação conferida em 23/10/2026. O site já está publicado em
https://galeo-store.netlify.app. Publicação não significa que cadastro, catálogo
e operação comercial estejam liberados para uso com clientes.

## Providências dos donos

- [ ] **Definir o remetente dos e-mails.** Informar um endereço em domínio sob
  controle da loja, verificar o domínio no Resend e disponibilizar a chave de
  envio com segurança nas variáveis do Netlify. Faltam `RESEND_API_KEY` e
  `EMAIL_FROM`; a confirmação de cadastro depende desses dois itens. Não enviar
  a chave em conversa nem colocá-la no Git. O endereço de atendimento deve ser
  acompanhado pela equipe. Enviar pelo Resend não exige contratar uma caixa
  postal no mesmo provedor.
- [ ] **Fornecer o catálogo real.** Fotos, nome, marca, categoria, descrição,
  composição/cuidados, preços, custos e estoque conferido. Foram importados
  [19 rascunhos de peças e mídias do Instagram](catalogo-instagram.md), para
  revisão dos donos; o catálogo público continua sem produtos ativos.
- [ ] **Definir tamanhos e cores.** A grade de variações ainda não existe no
  sistema. Decidir entre um cadastro separado para cada combinação de
  tamanho/cor ou a implementação de um módulo de variações antes de vender.
- [ ] **Aprovar a apresentação da loja.** Conferir Home, categorias,
  campanhas, imagens e produtos em destaque; substituir ou aprovar o conteúdo
  inicial que ainda estiver publicado.
- [ ] **Fornecer os dados comerciais e de atendimento.** Nome/razão social,
  identificação do responsável/CPF ou CNPJ aplicável, endereço físico,
  WhatsApp, e-mail de atendimento e horários.
- [ ] **Definir e aprovar as regras comerciais.** Retirada, áreas de entrega,
  prazos, custos, trocas, devoluções, cancelamento, reembolso e atendimento.
  Fornecer/aprovar as informações para Contato, Privacidade e Termos.
- [ ] **Definir a cobrança e entrega da primeira fase.** Pagamento online,
  integração com maquininha e cotação de frete continuam adiados. Definir o
  procedimento manual ou a retirada. Hoje o checkout mostra frete “A calcular”
  e o pedido registra frete zero; isso não deve ser apresentado como frete
  grátis ou custo final confirmado.
- [ ] **Organizar a operação.** Definir responsáveis por atendimento,
  separação/entrega, atualização dos pedidos e emissão de nota fiscal pelo
  processo da loja. Conferir o estoque inicial e registrar vendas físicas no
  PDV para manter o saldo correto enquanto a maquininha não for integrada.
  Informar saldos, custos e despesas recorrentes reais se usarem o financeiro.
- [ ] **Organizar os acessos e o acompanhamento dos serviços.** Substituir a
  senha provisória do Admin por uma senha forte, definir os donos autorizados,
  guardar acessos e recuperação das contas e acompanhar os limites dos planos
  gratuitos. Definir quem controla o domínio e suas configurações DNS.
- [ ] **Participar do teste final.** Conferir no celular e computador: cadastro
  com e-mail real, chegada da confirmação, login, produto, pedido controlado,
  cobrança/entrega combinadas, cancelamento e atualização do estoque.

Um domínio personalizado para o endereço do site é opcional: a URL Netlify já
funciona. Para o remetente Resend precisamos de um domínio verificado sob
controle da loja; pode ser um domínio que os donos já possuam.

## Trabalho técnico que fica conosco

- Configurar a integração de envio quando a chave e o remetente estiverem
  disponíveis, validar o domínio e comprovar o fluxo de entrega/confirmação.
- Criar as páginas aprovadas de Contato, Privacidade, Termos e
  Entregas/Trocas. Essas rotas ainda não existem na loja pública.
- Implementar o fluxo inicial de cobrança/entrega definido pelos donos, sem
  apresentar pagamento ou frete automáticos como concluídos.
- Ativar a proteção adicional dos dados pessoais e verificar backups e
  recuperação. A conexão MySQL já usa TLS com certificado validado; a camada
  extra de criptografia dos campos permanece desativada em produção.
- Conferir dados de teste remanescentes e realizar a validação final de
  segurança, estoque e pedidos. Testes de desenvolvimento usam somente bancos
  locais isolados; não criar clientes ou pedidos fictícios em produção.

As integrações de pagamento, maquininha e frete automáticos só serão retomadas
quando os serviços e o escopo forem definidos, conforme combinado.
