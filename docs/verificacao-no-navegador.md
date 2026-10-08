# GALEO — verificação real no navegador

Verificação de 8 de outubro de 2026, comparada ao histórico fornecido de “Continuar Galeo Store”. Pagamento e frete ficaram fora desta rodada.

Este documento registra a auditoria original. As correções posteriores de conta desativada no reinício e validação de senhas estão em [primeira etapa dos ajustes de segurança](ajustes-seguranca.md).

A decisão posterior de permitir Admin somente aos donos foi implementada e validada em [Admin exclusivo OWNER](acesso-admin-owner.md), substituindo a regra STAFF descrita na auditoria original abaixo.

## Como foi testado

Chromium com React/Vite, Express e MySQL locais reais, sem substituir as APIs por respostas simuladas. Foram usados OWNER, STAFF, visitante e cliente, com dados temporários próprios. O editor foi conferido em desktop e em largura móvel de 390px.

Os testes salvaram rascunhos, abriram a prévia e publicaram somente no banco local de testes. Ao terminar, restauraram o conteúdo/configurações e removeram seus produtos, mídias, pedidos, contas e sessões. Nenhuma alteração foi publicada na loja de produção. Nesta rodada não foram feitas correções no código da aplicação.

Cloudinary e Resend não têm credenciais no ambiente local. As imagens usadas para conferir seleção e alternância eram fixtures; a versão IA pronta foi cadastrada como dado de teste. Isso valida a interface e a persistência, mas não certifica o processamento remoto da fotografia.

## O que passou no navegador

- **Home e editor:** as sete seções carregam do banco; editar e salvar cada uma funciona. Seleção manual de produto, imagem desktop/mobile do Hero, menu, rodapé, tema e configurações de animação persistem.
- **Rascunho/publicação:** conteúdo, ordem, visibilidade e configurações do rascunho não mudam a Home pública. O botão de prévia abre a Home com os dados do rascunho e sua identificação. Publicar aplica essas alterações à Home pública local.
- **Identidade:** a frase original “Vista o que representa você” conserva Inter com peso 850 e Georgia itálica no trecho editorial.
- **Movimento:** Estático, Zoom, Pan horizontal, Pan vertical, Parallax e Ken Burns foram selecionados no editor e conferidos na Home de rascunho. Os movimentos alteram efetivamente a mídia; Estático mantém sua transformação.
- **Biblioteca:** listagem, carregamento de imagens, alternância original/IA pronta, persistência após recarregar e exclusão OWNER funcionam. Alterar título funciona pela API real e aparece após recarregar; falta o controle correspondente na interface.
- **Segurança:** login OWNER/STAFF, cookie httpOnly, manter conectado, troca de senha com renovação de sessão e logout funcionam. Visitante e STAFF não acessam a prévia/CMS. Uma alteração sem CSRF retorna 403 sem mudar dados. Desativar STAFF bloqueia a sessão aberta e o próximo login.
- **Loja/conta:** produto com galeria real, seleção de mídia, quantidade individual, carrinho persistente e remoção funcionam. Cadastro, edição de nome/telefone, logout e login persistem os dados do cliente; o histórico vazio é exibido corretamente.
- **Admin operacional:** cadastro e edição de produto, ocultação após edição, entrada/saída de estoque e histórico funcionam. Saída superior ao saldo é rejeitada sem mudar o banco. PDV pesquisa, adiciona, altera quantidade, calcula total e remove itens, sem registrar cobrança.
- **Pedidos online:** listagem, detalhe, alteração de status e cancelamento de pedido não pago funcionam. A reserva é devolvida uma vez; o backend impede reabrir um pedido cancelado.

## Falhas reproduzidas e ajustes de uso

| Prioridade | Problema | Evidência |
| --- | --- | --- |
| Corrigir segurança | Reiniciar a API reativa a conta desativada indicada em `ADMIN_EMAIL` | Uma API filha local reativou apenas a conta de teste desativada; a API principal e o CMS foram preservados |
| Corrigir carrinho | Adições repetidas podem ultrapassar o estoque | Produto com estoque 3: adicionar 2 unidades duas vezes resulta em 4 no carrinho |
| Corrigir cadastro | Status Oculto é ignorado no cadastro inicial | Formulário enviado como Oculto cria produto com `active=1`; ocultar posteriormente pela edição funciona |
| Corrigir tratamento de erro | Reabrir pedido cancelado gera rejeição JavaScript não tratada | API retorna 400 e preserva o cancelamento; a interface também gera `pageerror` |
| Ajustar operação | Botão Estoque da linha não pré-seleciona seu produto | O formulário exige selecionar novamente o produto |
| Ajustar conta | Nome em duas linhas encosta/sobrepõe o e-mail | Captura do perfil com nome longo mostra o problema de espaçamento |
| Completar formulário | Newsletter não cadastra o e-mail | Clicar em Entrar não envia requisição de inscrição nem mostra confirmação |

Na conferência complementar do código, a senha nova admite até 128 caracteres, mas bcrypt considera apenas os primeiros 72 bytes. Duas senhas diferentes com o mesmo prefixo de 72 bytes foram comparadas e aceitas pelo mesmo hash. Isso deve ser corrigido na validação sem abandonar bcrypt; esse achado não foi obtido pela interface do navegador.

## Pendências por fase do plano

| Fase | Situação comprovada | O que ainda falta |
| --- | --- | --- |
| 1 — Segurança e acesso | Autenticação, sessões, CSRF, bloqueio de STAFF e CMS exclusivo OWNER funcionam | Corrigir reativação no bootstrap e limite de senha; separar o escopo da biblioteca de conteúdo OWNER das mídias operacionais STAFF. STAFF atualmente pode consultar/enviar e alternar versões da biblioteca geral, embora não possa gerar IA/excluir |
| 2 — CMS da Home | Sete blocos editáveis e alimentando a Home | Expor os campos já existentes do cabeçalho de Categorias — título, eyebrow e botão/link — no editor |
| 3 — Biblioteca | Lista, alternância de versão, persistência e exclusão local funcionam | Substituir/ordenar mídias da biblioteca geral; controle de título na interface e seleção da mídia tratada diretamente no produto. Upload real precisa de validação com Cloudinary configurado |
| 3A — IA | Original preservado e seleção de resultado já salvo funcionam | Aprovação antes de aplicar o resultado — hoje concluir IA marca `use_ai=1`; configuração de tratamento de novas fotos de produto e opção Fundo GALEO. Geração/verificação remota não foi validada sem credenciais |
| 4 — Campanhas e transições | Os seis efeitos de movimento funcionam | Carrossel real com Fade/Slide/Crossfade; hoje a configuração é salva, mas há cards individuais. Também faltam a opção explícita Usar padrão da GALEO e mídia mobile no editor da campanha |
| 5 — Ordenação | Ordem numérica e visível/oculto funcionam na Home | Arrastar e soltar as seções |
| 6 — Rascunho/publicação | Fluxo funcional e separado da versão pública | Comparação lado a lado entre rascunho/publicado é um complemento da experiência; datas e prévia já existem |
| 7 — Preview | Funciona com dados de rascunho e proteção OWNER | Nenhuma falha funcional reproduzida nesta rodada; validação visual do proprietário continua fazendo parte de futuras mudanças |
| 8 — Auditoria econômica | Login, logout, senha e publicação geram eventos; outras operações relevantes têm registros no código | Auditar salvamento de conteúdo/configurações, limitar detalhes e apagar eventos antigos por prazo ou quantidade |
| 9 — Versionamento | Existem rascunho e publicação atual | Guardar publicação anterior, limitar histórico e restaurar uma versão. Publicar atualmente sobrescreve os dados anteriores |

Também falta validar o envio real dos e-mails transacionais com Resend. Não foi incluído como etapa aprovada de newsletter o envio de campanhas por e-mail; o problema confirmado aqui é que o formulário atual não registra a inscrição.

## Evidências locais

| Área | Resultado do roteiro | Relatório |
| --- | --- | --- |
| CMS/editor/preview | 23 verificações aprovadas | [/workspace/.galeo-setup/browser-audit/cms/report.json](/workspace/.galeo-setup/browser-audit/cms/report.json) |
| Biblioteca | 10 verificações do comportamento local aprovadas; chamadas externas indisponíveis retornaram 503 informativo | [/workspace/.galeo-setup/browser-audit/library/report.json](/workspace/.galeo-setup/browser-audit/library/report.json) |
| Produto/carrinho/conta/STAFF | Fluxos conferidos; limite acumulado do carrinho falhou | [/workspace/.galeo-setup/browser-audit/store/results.json](/workspace/.galeo-setup/browser-audit/store/results.json) |
| Segurança | 3 verificações aprovadas e reativação no bootstrap reproduzida | [/workspace/.galeo-setup/browser-audit/security/report.json](/workspace/.galeo-setup/browser-audit/security/report.json) |
| Operações/Admin | 11 verificações aprovadas e 2 falhas de aplicação | [/workspace/.galeo-setup/browser-audit/operations/report.json](/workspace/.galeo-setup/browser-audit/operations/report.json) |
| Movimento/newsletter | 6 efeitos aprovados; ausência de envio da newsletter reproduzida | [/workspace/.galeo-setup/browser-audit/motion/report.json](/workspace/.galeo-setup/browser-audit/motion/report.json) |

Esses números contam verificações dos roteiros, inclusive confirmação de erros esperados. Não significam que todos os recursos de cada módulo estejam completos. Os diretórios dos relatórios também contêm capturas de tela e scripts desta execução; ficam fora do repositório.
