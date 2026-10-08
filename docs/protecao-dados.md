# Proteção dos dados da GALEO

A proteção combinada tem duas partes: criptografia do armazenamento e dos backups
no provedor do MySQL, e criptografia adicional dos dados pessoais pela aplicação.
Criptografar os campos pessoais não comprova, por si só, a proteção de todo o banco
ou dos backups. A configuração e a política de backup do serviço Aiven utilizado
devem ser conferidas no serviço real antes de declarar essa parte validada.

## Dados que precisam de proteção adicional

O inventário do código inclui:

- `customers`: nome, e-mail e telefone.
- `admin_users`: e-mail do proprietário.
- `store_orders`: nome, e-mail, telefone, endereço completo e observações.
- `sales`: nome do cliente e observações da venda física.
- `payments.raw_payload` e `integration_events.payload`: respostas externas podem
  repetir os dados do pagador e do endereço.
- `financial_entries.description`, `recurring_expenses.description`,
  `stock_movements.reason` e `audit_logs.details`: texto livre pode conter dados
  pessoais; o mapa de proteção da aplicação cobre esses destinos.
- Qualquer tabela de cadastro pendente, verificação ou envio de e-mail deve usar
  o mesmo cuidado. Tokens de confirmação não devem ser gravados em texto puro.

As sessões guardam identificadores, permissões, token CSRF e informações do cookie.
Quando a proteção está habilitada, o conteúdo também é criptografado e vinculado
ao ID da sessão. Apenas ID e expiração ficam disponíveis para as consultas do
armazenamento. A migração protege sessões antigas antes de iniciar a API;
sessões em texto puro inseridas posteriormente são recusadas. O armazenamento
reutiliza o pool MySQL com TLS: o pacote `express-mysql-session@3.0.3` não repassa
a opção `ssl` quando cria seu próprio pool.

IDs, estados, estoque, preços, totais e vínculos entre tabelas continuam sendo
utilizados pelo SQL. A criptografia do armazenamento protege também esses dados
sem impedir as somas, filtros e relacionamentos da loja. As senhas continuam como
hash bcrypt; a aplicação não precisa conseguir recuperar a senha original.

## Módulo de criptografia

`server/data-protection.js` oferece `createDataProtection`, `encryptField`,
`decryptField`, `encryptJSON`, `decryptJSON`, `emailLookup` e `normalizeEmail`.
O módulo só atua nos dados que a aplicação efetivamente enviar para ele.

O método usa AES-256-GCM com nonce aleatório de 12 bytes e tag de autenticação de
16 bytes. A chave de criptografia e a chave do índice de e-mail são derivadas por
HKDF-SHA256 com domínios separados. Um envelope tem o formato:

```json
{"v":1,"alg":"A256GCM","kid":"primary","iv":"...","tag":"...","data":"..."}
```

Os métodos de criptografia retornam o objeto do envelope. É possível armazenar
esse objeto em uma coluna JSON ou serializá-lo em TEXT. Os métodos de leitura
aceitam ambas as representações. Não existe fallback para texto puro quando a
chave estiver ausente, inválida, incorreta ou quando o conteúdo estiver adulterado.

O contexto é obrigatório e autenticado junto com o conteúdo. Para dados de uma
linha, use a tabela, o campo e o identificador da linha:

```js
const context = { table: 'customers', field: 'private_data', rowId: customerId }
const protectedData = protection.encryptJSON({ name, email, phone }, context)
const originalData = protection.decryptJSON(protectedData, context)
```

Trocar o conteúdo protegido para outra linha, tabela ou campo com contexto
diferente faz a autenticação falhar. Quando o ID for atribuído pelo banco, a
aplicação deve inserir a linha e completar o payload protegido na mesma transação.

`emailLookup(email, 'customers.email')` calcula um índice HMAC-SHA256, representado
por 64 caracteres hexadecimais. Ele permite consultar e impor unicidade sem
guardar o endereço no índice. Para o proprietário, use `admin_users.email` como
destino. A normalização mantém o comportamento de entrada da aplicação:
remover espaços nas pontas e converter para minúsculas. O índice revela igualdade
entre valores dentro do mesmo destino; ele não permite recuperar o e-mail sem a
chave. Não substitua o HMAC por um SHA-256 simples de um endereço previsível.

## Chaves e implantação

`DATA_ENCRYPTION_KEY` deve ser uma chave aleatória de 32 bytes codificada em Base64.
`DATA_ENCRYPTION_KEY_ID` identifica a chave e usa `primary` quando não informado.
A chave deve ficar nos segredos do servidor, separada de `SESSION_SECRET`, do
MySQL, do repositório, dos logs e das variáveis `VITE_*` enviadas ao navegador.
Ela não deve ser gerada automaticamente a cada inicialização.

O código mantém a camada extra desativada enquanto `DATA_ENCRYPTION_ENABLED`
não for `true`. Isso permite publicar o fluxo de e-mail e preparar o schema sem
inventar uma chave de produção. Depois de haver dados protegidos, desativar a
camada ou usar uma chave incorreta bloqueia a inicialização e evita sobrescrever
os registros. Isso não prova que a camada esteja ativa na loja publicada.

Para ativar no serviço Render existente:

1. Conferir no Aiven o serviço real, criptografia de armazenamento e política de
   backup aplicável ao plano. Consulte [fontes dos provedores](provedores-seguranca.md).
2. Guardar um backup recuperável e uma cópia separada da chave. Usar uma chave
   aleatória de 32 bytes em Base64 no segredo `DATA_ENCRYPTION_KEY`; não enviar
   seu valor em mensagens nem reutilizar `SESSION_SECRET`.
3. Configurar `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=true` e `DB_SSL_CA`
   com a CA confiável do projeto. O driver também verifica o hostname. A aplicação
   não aceita ativação da camada extra em produção com TLS sem validação.
4. Confirmar que esta versão do código foi publicada, interromper todas as
   instâncias que ainda possam gravar dados e ativar `DATA_ENCRYPTION_ENABLED=true`
   em uma janela de manutenção. Não executar a migração em um deploy com código
   anterior ainda atendendo e escrevendo no mesmo banco.
5. Iniciar apenas a versão compatível. Ela valida envelopes anteriores, migra
   cada linha em transação, confirma a leitura e esvazia as cópias legíveis.
   Validar login, perfil, pedidos e Admin antes de reabrir as escritas.

`GET /api/admin/security-status`, restrito a OWNER, mostra a configuração de
e-mail, da camada adicional e do TLS, sem revelar chaves. A proteção do
armazenamento e dos backups continua exigindo conferência no provedor.

Guarde uma cópia recuperável da chave em um local seguro separado do backup do
banco. Perder a chave impede recuperar os dados pessoais protegidos, mesmo que
o backup do MySQL esteja íntegro. Um invasor com acesso simultâneo ao processo da
aplicação e à chave pode ler os dados: essa camada protege principalmente contra
acesso isolado ao banco e às suas cópias.

A presença do `kid` prepara a identificação de versões. Esta versão do módulo
aceita uma única chave configurada e recusa envelopes de outro `kid`; ela ainda
não é um mecanismo completo de rotação com várias chaves de leitura. Trocar a
chave exige recriptografar os dados e recalcular os índices HMAC. Alterar somente
o identificador da chave não altera o índice HMAC, mas muda o contexto autenticado
dos novos envelopes.

`server/database-privacy.js` adiciona `private_data JSON NULL` às tabelas do mapa
`PRIVATE_FIELD_MAP`. Com `DATA_ENCRYPTION_ENABLED=true`, a aplicação exige a chave
antes de iniciar a proteção. O payload contém os valores privados originais;
as colunas anteriores ficam vazias ou nulas, conforme o tipo. As colunas de e-mail
usadas em login recebem `private-<índice HMAC>@galeo.invalid`, preservando a
unicidade do SQL sem expor o endereço real. A URL de checkout também é protegida
nas tabelas `store_orders` e `payments`.

`pendingFields` fornece somente os campos privados da entrada, preparados para
o INSERT. `completeInsert` completa o payload após conhecer o ID; `updateFields`
preserva os outros campos privados ao editar apenas parte deles. Esses métodos
de escrita devem usar a conexão da mesma transação que criou ou alterou a linha.
`decodeRow` repõe somente os campos presentes no SELECT e retira `private_data`
do resultado, evitando enviar todo o registro pessoal por acidente.

O modo desabilitado permite preparar o código e o esquema antes de configurar
os segredos; ele não deve ser apresentado como proteção adicional já ativa.
Ao detectar qualquer payload existente, iniciar com a proteção desabilitada é
recusado. Iniciar com chave incorreta também é recusado, sem apagar ou substituir
o conteúdo. A chave não é inventada nem substituída por `SESSION_SECRET`.

## Migração e verificação

Antes de ativar a escrita protegida em produção, é necessário configurar a chave,
verificar os backups e testar a migração sobre uma cópia controlada. A migração
deve impedir escritas concorrentes por código antigo, proteger cada linha com o
seu contexto, validar os índices de consulta e remover as cópias antigas em texto
puro somente após confirmar a leitura protegida. É preciso tratar também índices
`UNIQUE` das antigas colunas de e-mail, sem introduzir conflitos ou perder contas.

Não misture erro de criptografia com ausência de dados. Uma chave incorreta ou um
envelope adulterado deve bloquear a operação e não sobrescrever os dados com
valores vazios. Depois que as colunas antigas forem removidas ou esvaziadas, uma
versão antiga da aplicação não pode ser usada como rollback sem um procedimento
de recuperação compatível.

As verificações incluem leitura do banco para confirmar a ausência de dados
pessoais nas colunas antigas, login e perfil dos clientes, login dos proprietários,
pedidos com seus endereços, vendas físicas e falha com chave ou contexto incorretos.
Os testes unitários do módulo podem ser executados com:

```sh
node --test --test-isolation=none server/data-protection.test.js server/database-privacy.test.js
```

Uma migração não muda retroativamente dumps antigos já produzidos em texto puro.
Também é preciso aplicar a política de retenção e proteção às cópias anteriores.
Para a conexão do MySQL, habilitar TLS sem verificar o certificado deixa pendente
a validação de identidade do servidor. A CA confiável e as opções reais da
conexão Aiven devem ser verificadas na implantação.
