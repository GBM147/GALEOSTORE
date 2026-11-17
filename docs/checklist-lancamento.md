# Preparação da GALEO para atender clientes

Situação atualizada em 17/11/2026. O site está publicado em
https://galeo-store.netlify.app, na conta Netlify do galeostore01@gmail.com desde
16/11. Já estão no ar:
- o visual novo;
- o frete calculado pelo Melhor Envio;
- o cadastro de clientes;
- as páginas legais com aceite.

O pagamento online continua desligado. A operação comercial ainda depende das
providências abaixo.

## Providências dos donos

- [x] **Remetente dos e-mails.** No lançamento, o Resend envia de um endereço do
  domínio `gbm-finance.com`, com o nome GALEO STORE. As respostas dos clientes e os
  avisos de pedido vão para galeostore01@gmail.com. Quando a loja tiver domínio
  próprio, verificar o domínio no Resend e trocar `EMAIL_FROM`. Não enviar a chave
  em conversa nem colocá-la no Git.
- [ ] **Fornecer o catálogo real.** Fotos, nome, marca, categoria, descrição,
  composição/cuidados, preços, custos e estoque conferido. Foram importados
  [19 cadastros de peças e mídias do Instagram](catalogo-instagram.md), para
  revisão dos donos. As peças ainda sem valor mostram **Preço a definir**; a
  compra exige preço positivo e estoque suficiente conferidos pelos donos.
  A última conferência encontrou 18 produtos; cadastros removidos pelos donos
  não serão recriados.
- [ ] **Cadastrar os tamanhos e conferir as cores.** A atualização da reunião
  inclui grade por tamanho, seleção no produto/carrinho e controle na Frente
  de caixa. Em **Produtos e estoque → Editar**, ativar **Controlar estoque por
  tamanho** e informar as quantidades reais de cada numeração. Nenhum tamanho
  ou saldo é inventado pela atualização. Para cores diferentes, manter
  cadastros separados; não há uma segunda grade de variação por cor.
- [ ] **Aprovar a apresentação da loja.** Conferir Home, categorias,
  campanhas, imagens e produtos em destaque; substituir ou aprovar o conteúdo
  inicial que ainda estiver publicado.
- [ ] **Fornecer os dados comerciais e de atendimento.** Nome/razão social,
  identificação do responsável/CPF ou CNPJ aplicável, endereço físico,
  WhatsApp, e-mail de atendimento e horários.
- [ ] **Definir e aprovar as regras comerciais.** Retirada, áreas de entrega,
  prazos, custos, trocas, devoluções, cancelamento, reembolso e atendimento.
  Fornecer/aprovar as informações para Contato, Privacidade e Termos.
- [ ] **Definir a cobrança e entrega da primeira fase.** O carrinho calcula o frete
  pelo Melhor Envio, e cada peça precisa de peso e medidas reais. O pagamento
  online pelo Mercado Pago está em preparação para produção. Até lá, definir o
  procedimento manual de cobrança ou a retirada.
- [ ] **Organizar a operação.** Definir responsáveis por atendimento,
  separação/entrega, atualização dos pedidos e emissão de nota fiscal pelo
  processo da loja. Conferir o estoque inicial e registrar vendas físicas no
  módulo **Frente de caixa** para manter o saldo correto enquanto a maquininha
  não for integrada. Em **Gastos da loja**, lançar descrição, valor e data
  depois de gastar. Em **Gastos recorrentes**, cadastrar modelos e usar
  **Registrar gasto** quando o pagamento ocorrer; os modelos não geram
  despesas pendentes automaticamente.
- [ ] **Organizar os acessos e o acompanhamento dos serviços.** Feito em 16/11:
  - o site passou para a conta Netlify do galeostore01@gmail.com;
  - o Admin ganhou o login galeostore01, com a senha nova; o login antigo fica
    como reserva.

  Falta:
  - apagar o projeto `galeo-store-antigo` na conta Netlify antiga;
  - passar para o galeostore01 as contas do Aiven, Cloudinary, Melhor Envio, Google
    (Perfil da Empresa) e Render;
  - guardar os acessos e a recuperação das contas;
  - acompanhar os limites dos planos gratuitos;
  - definir quem controla o domínio, quando houver um.
- [ ] **Participar do teste final.** Conferir no celular e computador: cadastro
  com e-mail real, chegada da confirmação, login, produto, pedido controlado,
  cobrança/entrega combinadas, cancelamento e atualização do estoque.

Um domínio personalizado para o endereço do site é opcional: a URL Netlify já
funciona. Para o remetente Resend precisamos de um domínio verificado sob
controle da loja; pode ser um domínio que os donos já possuam.

## Trabalho técnico que fica conosco

- Comprovar com os donos que o e-mail de confirmação chega no site novo (16/11).
- O banco passou do Aiven grátis (desligado em 21/12/2026) para o TiDB Cloud
  Starter em 17/11, sem perda de dados, conforme [a hospedagem](hospedagem-netlify.md).
  Depois de uns dias estável, apagar o projeto `galeo-tarefas` e o serviço no Aiven.
- O monitor de queda (GitHub Actions, a cada 30 minutos) roda a partir da `main`
  desde 17/11. Antes disso, o agendamento não rodava, porque o arquivo só existia
  na branch de trabalho.
- Páginas de Contato, Privacidade, Termos, Trocas e Entregas criadas em 12/11, com
  aceite registrado no cadastro e na compra. Falta os donos preencherem os Dados da
  empresa no editor e a revisão dos textos por contador ou advogado.
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
