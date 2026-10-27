# Pagamento presencial pelo PDV da GALEO

Pesquisa de documentação oficial em 24/10/2026. A operadora da loja ainda foi
informada como provável Stone; o modelo e a habilitação não foram confirmados.
Nenhuma integração Stone está implementada ou habilitada na GALEO neste momento.

## Fluxo desejado

Funcionário seleciona as peças na **Frente de caixa** → escolhe débito, crédito ou Pix → GALEO
cria a cobrança → terminal recebe o pagamento → Stone confirma a aprovação →
GALEO conclui a venda e atualiza estoque e financeiro uma única vez.

O funcionário inicia a venda no PDV para que o sistema saiba quais produtos e
quantidades pertencem ao pagamento. Transações feitas diretamente na máquina
sem esse vínculo não identificam automaticamente as peças vendidas.

## O que confirmar na visita

1. Operadora, modelo exato e número de série de cada terminal.
2. Acesso do responsável ao painel da conta da loja na operadora.
3. Compatibilidade e habilitação de **Stone Connect 2.0 / Pagamento Direto**,
   incluindo o modo em que o terminal aguarda cobranças do PDV.
4. Conta Stone com Pix habilitado, se quiserem receber Pix nesse fluxo.
5. Processo de credenciamento do desenvolvedor, homologação, liberação para
   produção e condições comerciais. Não há custo confirmado nesta pesquisa.

Mensagem para o atendimento Stone:

> Queremos integrar um PDV web próprio pelo Stone Connect 2.0, em Pagamento
> Direto, para débito, crédito e Pix, com confirmação por webhook. Este modelo
> é compatível? Como habilitar o terminal e obter credenciais e homologação
> para nossa integração? Há custos adicionais?

## Implementação após a confirmação

O Connect 2.0 oferece envio de pedidos pela API, identificação dos terminais
pelo número de série e confirmação por webhook. A documentação exige entrada
no programa de parcerias, desenvolvimento, homologação e aprovação para uso
em produção. As credenciais devem permanecer somente no backend.

A implementação precisará tratar cobrança pendente, aprovação, recusa,
cancelamento, expiração e estorno, sem duplicar venda, estoque ou lançamento
financeiro quando a operadora repetir uma notificação.

A atualização dos ajustes da reunião inclui a grade por tamanho no produto,
carrinho, reservas, Frente de caixa e histórico. Os donos ainda precisam
cadastrar os tamanhos e conferir o estoque real de cada peça antes da
operação. Essa grade não habilita a comunicação com a maquininha: a integração
Stone continua pendente da confirmação acima.

## Fontes oficiais

- [Visão geral do Connect](https://connect-stone.stone.com.br/reference/vis%C3%A3o-geral)
- [Operações e Pagamento Direto](https://connect-stone.stone.com.br/docs/opera%C3%A7%C3%B5es)
- [Configurações do pagamento e terminal](https://connect-stone.stone.com.br/reference/poi-payment-settings)
- [Perguntas frequentes, incluindo Pix](https://connect-stone.stone.com.br/page/faq)
- [Processo de integração e homologação](https://connect-stone.stone.com.br/docs/processo-de-integra%C3%A7%C3%A3o)
- [Dispositivos suportados](https://connect-stone.stone.com.br/docs/dispositivos-suportados)

A lista de dispositivos e suas restrições pode mudar; conferir o modelo real
com a Stone antes de escolher a arquitetura ou contratar um equipamento.
