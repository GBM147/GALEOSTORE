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

Tokens e sessões antigas de clientes não confirmados não liberam pedidos. A API
revoga o acesso de cliente e preserva qualquer acesso administrativo separado.
O fluxo não cria acesso ao Admin; ele continua exclusivo para OWNER.

## Testes desta etapa

API e MySQL reais, com dados locais e Resend interceptado: 10 cenários de cadastro,
expiração, uso único, senha incorreta, reenvio, concorrência, bloqueios e falhas
de entrega. Dois fluxos Chromium testaram a interface compilada, confirmação,
login, perfil, logout e erros. Ambos passaram com a proteção dos dados habilitada.
Nenhum e-mail externo foi enviado nesses testes.

Os comandos e as restrições de banco de testes estão no README. A validação de
entrega real depende do remetente configurado e de um endereço de teste autorizado.
