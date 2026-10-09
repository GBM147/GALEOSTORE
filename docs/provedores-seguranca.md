# Segurança dos provedores e limites da validação

Esta consulta foi feita em 8 de outubro de 2026. Ela separa a documentação geral
dos provedores das configurações que precisam ser verificadas no serviço real
da GALEO. Nenhum serviço, backup, segredo ou configuração externa foi alterado.

## Fontes oficiais Aiven

O repositório público
[aiven/aiven-docs](https://github.com/aiven/aiven-docs) identifica-se como o
repositório da documentação pública da Aiven. Os quatro textos abaixo foram
lidos pela API do GitHub, com resposta HTTP 200. As consultas diretas ao domínio
`aiven.io` retornaram HTTP 403 neste ambiente; não houve desativação de TLS nem
contorno do proxy.

- [Cloud security](https://github.com/aiven/aiven-docs/blob/main/docs/platform/concepts/cloud-security.md)
  — `docs/platform/concepts/cloud-security.md`.
- [Service backups](https://github.com/aiven/aiven-docs/blob/main/docs/platform/concepts/service_backups.md)
  — `docs/platform/concepts/service_backups.md`.
- [TLS/SSL certificates](https://github.com/aiven/aiven-docs/blob/main/docs/platform/concepts/tls-ssl-certificates.md)
  — `docs/platform/concepts/tls-ssl-certificates.md`.
- [Understand MySQL backups in Aiven](https://github.com/aiven/aiven-docs/blob/main/docs/products/mysql/concepts/mysql-backups.md)
  — `docs/products/mysql/concepts/mysql-backups.md`.

## Criptografia em repouso e dos backups

Segundo **Cloud security**, a proteção em repouso da Aiven cobre as instâncias
ativas e os backups no armazenamento de objetos. Os volumes usam LUKS2, modo
`aes-xts-plain64:sha256`, com uma chave de 512 bits gerada para cada instância e
volume. A documentação descreve descarte da chave ao destruir a instância.

O mesmo texto descreve os backups com AES-256 em modo CTR e HMAC-SHA256 para
integridade. Cada arquivo recebe sua própria chave; essas chaves são protegidas
por um par RSA de 3072 bits gerado para cada serviço.

**Service backups** informa que os serviços Aiven, com exceção do Apache Kafka,
têm backups automáticos criptografados. A documentação específica de MySQL
informa backups completos diários, registros binários contínuos e uso de
`myhoard` para criptografia. A retenção e a quantidade de backups dependem do
plano contratado; backups completos e binlogs permitem recuperação para um
ponto no tempo.

Essas são características documentadas da plataforma. Não foram conferidos o
plano, a retenção, a região, a última execução bem-sucedida ou a restauração do
serviço Aiven da GALEO. A região de armazenamento dos backups também precisa
ser consultada no serviço real: a documentação prevê diferenças conforme o
provedor de nuvem.

Os backups gerenciados da Aiven são criptografados e não estão disponíveis para
download direto. Uma exportação própria com `mysqldump` exige sua própria
proteção e armazenamento seguro; não se deve presumir que o arquivo exportado
herda automaticamente a criptografia do backup gerenciado. A camada adicional
da aplicação é descrita em [protecao-dados.md](protecao-dados.md).

## TLS e autoridade certificadora MySQL

O texto **Cloud security** ressalva que Aiven for MySQL aceita conexões sem TLS
por padrão. Exigir TLS para um usuário de banco depende de configuração do
usuário, como `ALTER USER ... REQUIRE SSL`. Nenhum comando desse tipo foi
executado durante esta consulta.

**TLS/SSL certificates** informa que MySQL com `VERIFY_CA` ou
`VERIFY_IDENTITY` precisa da CA do projeto Aiven. O primeiro modo confere a
cadeia de certificados; o segundo também confere o nome do servidor. O
certificado pode ser baixado no painel do serviço, em **Overview → Connection
information → CA Certificate**.

A Aiven realiza rotação da CA. Durante a transição, o certificado disponível
para download pode ser um conjunto com a CA atual e a nova; os clientes devem
ser atualizados antes da segunda manutenção descrita na documentação.

No driver `mysql2` instalado nesta validação, `rejectUnauthorized: true`
confere a confiança no certificado. A opção `ssl.verifyIdentity: true` também
é necessária para ativar a conferência de hostname: sem ela,
`lib/base/connection.js` substitui `checkServerIdentity` por uma função que
aceita o nome. Para o serviço Aiven, use seu hostname DNS e a CA correta.

Não foram obtidos o certificado do projeto ou as configurações reais do usuário
MySQL. Portanto, esta consulta não comprova que a conexão de produção verifica
a CA e a identidade do servidor, nem que o usuário do banco recusa conexões
sem TLS.

## Publicação e configuração da GALEO

O GitHub confirmou por consultas somente de leitura:

- Repositório público `GBM147/GALEOSTORE`, branch padrão `main`.
- Commit remoto
  [`8ac2ba87abde7a83cc38eed8275807718a179afa`](https://github.com/GBM147/GALEOSTORE/commit/8ac2ba87abde7a83cc38eed8275807718a179afa)
  na consulta, com a correção de gestão e acesso administrativo OWNER.
- Nenhum deployment, workflow do GitHub Actions, check-run ou status de commit
  foi registrado pelas APIs consultadas. A ausência desses registros não
  significa falha de deploy no Render.

Na validação anterior da publicação, o `/health` público e os arquivos de
frontend em `https://galeo-store.onrender.com` foram conferidos, e os assets
corresponderam ao build publicado dessa revisão. Essa evidência verifica a
publicação e a disponibilidade observadas; não verifica a política de backups,
os segredos do servidor ou a criptografia da conexão ao Aiven. Uma publicação
posterior exige nova conferência.

Não havia acesso administrativo Render/Aiven disponível nesta consulta. A
presença de autenticação GitHub não concede acesso aos painéis desses
provedores. Não foram lidos valores de segredos, testados tokens de contas ou
solicitados valores de chaves em conversa.

Antes de declarar a proteção adicional ativa em produção, é preciso conferir
no serviço real a configuração da chave da aplicação, a CA e a verificação
TLS, a migração dos dados existentes e a possibilidade de restaurar um backup
com a chave correspondente. Esses requisitos não foram satisfeitos apenas por
consultar a documentação dos provedores.

## Diagnóstico atual da conexão

O diagnóstico OWNER em `GET /api/admin/security-status` foi ampliado para
consultar `Ssl_cipher` e `Ssl_version` na mesma conexão MySQL da aplicação,
além da opção global `require_secure_transport`. Os campos de certificado e
hostname só indicam verificação quando a conexão negociou TLS e as opções
correspondentes do driver estão ativas. O resultado não expõe credenciais.

A exigência global de TLS não substitui a conferência da regra do usuário
individual. Restrições de leitura ou uma variável indisponível deixam a
exigência global como desconhecida; uma falha de transporte retorna 503.
Essas consultas não verificam criptografia em repouso nem backups da Aiven.

O procedimento solicitado de remoção dos testes está em
[limpeza dos dados de teste](limpeza-dados-de-teste.md). A remoção na produção
permanece pendente de acesso seguro e de backup recuperável. O proprietário
confirmou a remoção de todos os dados operacionais de teste, preservando donos
e Home, em 9 de outubro de 2026.
