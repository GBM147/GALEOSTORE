# Confirmação de e-mail dos clientes

Novos cadastros ficam pendentes, sem sessão autenticada. O cliente recebe um
link na rota `/conta`, informa a senha escolhida e confirma o e-mail. Só depois
entra na conta e pode fazer pedidos. Contas existentes não são apagadas nem
recriadas: também precisam confirmar o endereço no próximo acesso.

O link vale por 24 horas e só pode ser usado uma vez. O banco guarda apenas o
SHA-256 de um token aleatório de 32 bytes. O token permanece no fragmento do link,
é removido imediatamente da URL no navegador e não é enviado por um GET nem
consumido automaticamente por um scanner de e-mail. A confirmação exige token e
senha, e exige novo login. Não guardamos token ou senha no armazenamento do navegador.

O reenvio exige e-mail e senha, tem intervalo mínimo de 60 segundos por conta e
limite por IP. Um novo envio invalida o link anterior. Endereço inexistente,
senha incorreta ou conta já confirmada recebem uma resposta genérica; erros de
entrega e excesso de tentativas são tratados sem autenticar o cliente.

Configure nos segredos do Render existente `RESEND_API_KEY`, `EMAIL_FROM` com
domínio remetente verificado no Resend, e `APP_URL` HTTPS da loja. Nunca publique
a chave no GitHub. `GET /api/customer/registration-status` informa somente se o
cadastro tem os requisitos de envio configurados; isso não testa entrega na caixa
de entrada. Sem provedor configurado ou com erro de envio, a operação retorna 503
e desfaz o cadastro novo. Não há modo que marque um cliente como confirmado sem
validação. Link expirado ou inválido exige nova solicitação.

## Integração Resend e remetente pendente

O Resend é o serviço de envio; o Render executa a API e guarda a configuração,
e o Aiven guarda o banco de dados. `EMAIL_FROM` permanece vazio enquanto os donos
não definirem o endereço da loja e verificarem o domínio no Resend. Não há um
remetente de teste ou domínio da loja presumido como alternativa.

`GET /api/admin/email-status`, restrito ao OWNER, informa presença da chave,
validade do formato do remetente, validade da URL da loja e nomes das configurações
pendentes. Não revela valores, destinatários nem credenciais. Esses indicadores
são verificações locais; domínio e entrega real continuam marcados como pendentes
até a validação na conta do provedor e na caixa postal autorizada.

Eventos ligados ao Resend:

- Cadastro ou reenvio: confirmação por link; falha desfaz a emissão do token e
  o cadastro novo. A operação não entrega sessão autenticada.
- Confirmação bem-sucedida: boas-vindas enviadas depois de confirmar no banco,
  uma vez por conta. Falha do aviso não desfaz a confirmação nem concede login.
- Pedido recebido: confirmação ao cliente e aviso à loja. `STORE_NOTIFICATION_EMAIL`
  é opcional; sem valor, o destinatário da loja é `ADMIN_EMAIL`.
- Mudança de status no Admin: confirmação, preparação, envio, entrega e
  cancelamento, depois de concluir a transação. Repetir o mesmo status ou tentar
  uma alteração rejeitada não envia outro aviso.

O provider aplica timeout de 15 segundos e chave de idempotência, exige ID de
aceitação e registra falhas somente por código e status HTTP. Não registra corpos
de erro do provedor, links privados nem credenciais. Ausência de remetente deixa
o envio operacional desativado; pedidos e estoque continuam funcionando. Esses
avisos não ficam em uma fila para envio retroativo, e uma aceitação da API não
comprova chegada à caixa postal. Não houve ativação de pagamento ou frete.

`GET /health` inclui a revisão pública informada pelo Render para conferir o
deploy efetivamente ativo. O campo é `null` fora do Render ou sem um SHA válido;
nenhuma outra variável do ambiente é incluída.

Tokens e sessões antigas de clientes não confirmados não liberam pedidos. A API
revoga o acesso de cliente e preserva qualquer acesso administrativo separado.
O fluxo não cria acesso ao Admin; ele continua exclusivo para OWNER.

## Testes desta etapa

Doze testes de contrato do provider cobrem configuração, payload, idempotência,
resposta inválida, rejeição, timeout e ausência de dados privados nos erros.
API e MySQL reais, com dados locais e Resend interceptado: dez cenários de cadastro,
expiração, uso único, senha incorreta, reenvio, concorrência, bloqueios e falhas
de entrega, mais sete cenários de boas-vindas, pedidos, mudanças de status,
acesso OWNER e remetente pendente. Os eventos passaram com a proteção dos dados
habilitada e desabilitada. Dois fluxos Chromium testaram a interface compilada,
confirmação, login, perfil, logout e erros com a proteção dos dados habilitada.
Nenhum e-mail externo foi enviado nesses testes.

Os comandos e as restrições de banco de testes estão no README. A validação de
entrega real depende do remetente configurado e de um endereço de teste autorizado.
