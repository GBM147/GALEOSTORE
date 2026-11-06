# Monitoramento da loja

## Aviso de loja fora do ar

O workflow `.github/workflows/uptime.yml` roda a cada 30 minutos no GitHub e
confere duas coisas na produção (https://galeo-store.netlify.app):

- **Loja:** a página inicial responde com o site.
- **API e banco de dados:** `/health` responde `status: ok` e `database: ok`.

Cada conferência faz até 3 tentativas, com 20 segundos de intervalo, para um
início lento da função não gerar alarme falso. Se algo continuar fora, o
script `scripts/uptime-check.mjs` abre **uma** issue "Loja fora do ar", com a
etiqueta `site-fora-do-ar`, o horário de Brasília e o que falhou. O GitHub avisa
por e-mail e no app quem acompanha o repositório. Enquanto a queda continuar,
não há novos avisos; quando a loja voltar, a issue recebe um comentário com o
horário e é fechada sozinha. O histórico fica nas issues fechadas.

- As execuções agendadas usam a versão do workflow na `main`; envios para outras
  branches só conferem, sem abrir ou fechar avisos. Para conferir na hora, use
  **Actions → Monitoramento → Run workflow**.
- O GitHub pausa workflows agendados depois de 60 dias sem atividade no
  repositório e avisa por e-mail; reativar é um clique em **Actions**.
- Custo: cerca de 2.900 requisições por mês à produção, aproximadamente 2
  créditos do Netlify.

## Erros do servidor

Respostas 5xx da API ficam na tabela `error_events` do MySQL da loja e aparecem
em **Admin → Erros recentes**, somente para donos (`GET /api/admin/error-events`).

- Guardados: horário, método, rota com números e tokens trocados por `:id` e
  `:token`, status, código técnico (do erro ou da própria resposta, como
  `PAYMENT_RESULT_PENDING`), a frase fixa do log com e-mails e números longos
  mascarados e o identificador da requisição do Netlify.
- Nunca guardados: corpo das requisições, query strings, nomes, e-mails ou
  outros dados de clientes.
- Retenção: 30 dias e no máximo 2.000 registros, limpos pela manutenção diária.
  Cada instância grava no máximo 30 erros por minuto, para uma queda não inundar o
  banco.
- A migração (`npm run db:migrate`) cria a tabela. Se uma publicação chegar antes
  da migração, a API cria a tabela na primeira falha; sem permissão para isso, o
  registro apenas fica desligado, sem afetar as requisições.
- A ferramenta de limpeza de dados de teste preserva `error_events` e
  `shipping_integrations` (conexão do Melhor Envio).
