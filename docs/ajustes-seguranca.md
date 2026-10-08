# GALEO — primeira etapa dos ajustes de segurança

Correções aplicadas no checkout local em 8 de outubro de 2026, após a verificação no navegador. Não houve deploy nesta etapa.

A definição posterior de Admin somente para os donos foi aplicada em [acesso exclusivo OWNER](acesso-admin-owner.md), com a suíte de segurança ampliada para 12 testes. As contas de clientes continuam separadas.

## Correções

- A configuração `ADMIN_EMAIL`/`ADMIN_PASSWORD` cria o OWNER inicial somente se a conta ainda não existir. Reiniciar a API preserva o estado ativo/desativado, o papel e a senha de contas OWNER/STAFF existentes. Uma senha de configuração inválida não interfere em uma conta já cadastrada.
- Novas senhas precisam ter pelo menos 10 caracteres Unicode e caber em 72 bytes UTF-8, limite considerado pelo bcrypt. A regra vale para cadastro de cliente, alteração de senha administrativa e criação inicial do OWNER. Não há corte silencioso, remoção de espaços ou normalização da senha.
- A alteração de senha rejeita uma proposta equivalente ao hash atual. Isso também cobre contas antigas cuja senha informada ultrapassava o limite do bcrypt.
- Login continua compatível com senhas antigas. Senhas válidas continuam armazenadas como hash bcrypt; a alteração mantém a renovação de sessão.

## Validação no navegador

Oito verificações passaram no Chromium com API e MySQL locais reais, sem respostas simuladas:

1. Reiniciar com `ADMIN_EMAIL` apontando para uma conta desativada preserva seu estado, papel e hash, mesmo com `ADMIN_PASSWORD` diferente e inválida.
2. A conta continua impedida de entrar após esse reinício.
3. Cinco emojis não cumprem o mínimo de 10 caracteres e são recusados sem alterar senha ou sessão.
4. Trinta e sete letras `é` excedem o limite de bytes e são recusadas sem alterar senha ou sessão.
5. Setenta e três caracteres ASCII são recusados sem alterar senha ou sessão.
6. Trinta e seis letras `é`, exatamente 72 bytes, são aceitas, geram o hash correto e renovam a sessão.
7. Logout e login com a nova senha funcionam.
8. O navegador não registra erros JavaScript.

A verificação sintática `npm run check` também passou. As contas, logs e sessões temporárias foram removidos; a API isolada do teste foi encerrada.

## Testes permanentes de regressão

A suíte [auth-security.integration.test.js](../tests/auth-security.integration.test.js) passou nos seis grupos de testes, usando API e MySQL locais reais:

- Estado, papel e hash de OWNER/STAFF existentes permanecem iguais após o reinício, inclusive com senha de configuração inválida.
- Criação inicial de OWNER aceita uma senha Unicode válida no limite de 72 bytes.
- Criação inicial com senha excessivamente longa falha sem criar a conta nem revelar o valor da senha nos logs.
- Alteração de senha inválida mantém hash e sessão; uma alteração válida renova a sessão e permite autenticar com a nova senha.
- Login de conta antiga com senha longa continua funcionando; trocar por um prefixo equivalente é recusado e trocar por uma senha diferente funciona.
- Cadastro de cliente rejeita senhas inválidas sem criar linhas e aceita os limites válidos, com hash bcrypt e login funcionando.

Execute `npm run test:security` com Node 24 e as variáveis do MySQL local configuradas, conforme o README. A suíte recusa bancos externos/de produção, usa a porta 10002 e encerra sua API e remove suas contas/sessões ao finalizar.

[Relatório do navegador](/workspace/.galeo-setup/browser-audit/security-fixes/report.json), [conta bloqueada após reinício](/workspace/.galeo-setup/browser-audit/security-fixes/disabled-account-after-restart.png) e [mensagem de senha longa](/workspace/.galeo-setup/browser-audit/security-fixes/password-limit-error.png).

## Validação pelo proprietário

Após disponibilizar este código no ambiente usado para validação, confira Alterar senha no Admin com uma senha válida de pelo menos 10 caracteres, saia e entre com a nova senha. Uma senha excessivamente longa deve exibir uma mensagem clara e manter a senha anterior.

As demais pendências registradas na auditoria continuam em etapas próprias, incluindo limite acumulado de estoque no carrinho e ajustes operacionais. Pagamento e frete permanecem fora deste trabalho.
