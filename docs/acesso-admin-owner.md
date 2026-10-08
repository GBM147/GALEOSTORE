# GALEO — Admin exclusivo dos proprietários

Etapa aplicada no checkout local em 8 de outubro de 2026. O usuário definiu que somente os donos da loja terão acesso ao Admin, substituindo o acesso operacional STAFF previsto no plano anterior. Não houve deploy nesta etapa.

## Regra aplicada

- Apenas contas administrativas ativas com papel `owner` podem entrar pelo login do Admin.
- Uma conta STAFF com senha correta recebe 403 e não ganha sessão administrativa. Credenciais inválidas continuam recebendo 401.
- Toda requisição administrativa consulta o estado e o papel atual da conta no banco. Sessões STAFF antigas, inclusive com papel OWNER obsoleto no JSON da sessão, são invalidadas e têm o cookie removido.
- A restrição cobre produtos, estoque, vendas, pedidos online, financeiro, CMS, biblioteca de mídia, consulta da sessão e alteração da senha administrativa.
- Se uma conta OWNER perder esse papel com o painel aberto, a próxima requisição é recusada e a interface volta ao login. Isso também é tratado durante envio de mídia de produto.
- Cadastro e login dos clientes continuam separados. Tentar acessar o Admin com uma sessão exclusiva de cliente não encerra sua sessão da loja nem concede permissões administrativas.
- Contas STAFF existentes foram preservadas no banco para manter referências e histórico. Nenhuma conta foi promovida automaticamente e não foi criado gerenciamento de usuários.

## Validação

Os **12 testes de segurança com API e MySQL locais reais** passaram, incluindo as regressões de contas desativadas e senhas da etapa anterior. A suíte está em [auth-security.integration.test.js](../tests/auth-security.integration.test.js) e pode ser executada com `npm run test:security`, conforme o README.

Também passaram **10 verificações no Chromium com a aplicação compilada, API e MySQL reais**:

1. OWNER entra e acessa produtos, pedidos, financeiro, CMS e biblioteca.
2. STAFF ativo é bloqueado no formulário e não recebe sessão.
3. Sessão STAFF antiga com papel OWNER no JSON é revogada usando o papel real do banco.
4. Cliente cria conta e abre seu perfil.
5. Cliente não acessa o Admin e mantém sua sessão de cliente após a tentativa.
6. Logout e login do cliente continuam funcionando.
7. Perder o papel OWNER com uma aba aberta bloqueia a alteração e devolve a interface ao login.
8. Uma conta OWNER autorizada mantém acesso normal.
9. Perder OWNER entre salvar os dados do produto e enviar a mídia bloqueia o upload e devolve a interface ao login.
10. O navegador não registra erros JavaScript.

No teste de envio de mídia, a requisição foi apenas atrasada para reproduzir a mudança de papel nesse intervalo; a resposta veio da API real. Não houve upload ao Cloudinary nem cobrança externa. Todas as contas, produtos, sessões e logs de teste foram removidos e a API isolada foi encerrada.

Também passaram quatro testes adicionais da interface/CMS com APIs simuladas: retry de upload, ordem/visibilidade/mídia/tipografia da Home, tema e salvamento de categorias. Essa validação complementar não substitui os testes reais acima.

`npm run check` e `npm run build` passaram. O build mantém o aviso já existente de bundle JavaScript acima de 500 kB.

[Relatório e capturas do navegador](/workspace/.galeo-setup/browser-audit/owner-only/report.json), [bloqueio STAFF](/workspace/.galeo-setup/browser-audit/owner-only/staff-login-denied.png) e [cliente com sessão preservada](/workspace/.galeo-setup/browser-audit/owner-only/customer-profile-preserved.png).

## Conferência pelo proprietário

Quando este código for disponibilizado no ambiente de validação, entrar com a conta OWNER deve abrir o painel normalmente. Contas de clientes devem continuar entrando somente na área da loja. Uma conta administrativa STAFF deve receber “Acesso administrativo exclusivo dos proprietários”.

As demais pendências da auditoria permanecem em etapas próprias. Pagamento e frete continuam fora do escopo.
