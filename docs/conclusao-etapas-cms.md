# Conclusão das etapas técnicas do editor — 12/10/2026

O trabalho continua no repositório e no serviço Render existentes. O Admin
permanece exclusivo para OWNER ativo; a loja e as contas dos clientes seguem
separadas. Pagamento, maquininha e frete automático permanecem adiados.

## Biblioteca e fotos

- Renomear pela interface, ordenar arrastando ou pelos botões e persistir a ordem.
- Substituir cria um arquivo independente. O original e as referências atuais
  permanecem disponíveis; selecionar a nova foto no produto ou no rascunho é uma
  ação explícita.
- Preferência para preparar automaticamente novas fotos da biblioteca e dos
  produtos, desativada inicialmente. Preparação não significa aprovação.
- Original, Sem fundo e Fundo GALEO podem ser comparados antes de escolher.
  Fundo GALEO usa CSS e o mesmo PNG transparente já preparado; o fragmento da URL
  não vai ao Cloudinary e não cria outra transformação de IA.
- Remover uma foto da galeria ou excluir um produto remove suas associações.
  Os arquivos permanecem na biblioteca; sua exclusão passa pela consulta de uso.
- A proteção inclui capas, galerias, rascunho, publicado, configurações e as
  cinco versões retidas da Home. Falha na verificação bloqueia a exclusão.

## Editor, campanhas e versões

- Seções podem ser arrastadas ou movidas com botões acessíveis no celular e pelo
  teclado. A ordem é salva no rascunho e só chega à vitrine após publicar.
- Comparação mostra conteúdo e mídia de rascunho e publicado lado a lado.
  Edições ainda não salvas são indicadas; publicar exige salvar primeiro.
- Cada campanha aceita até 12 fotos/vídeos, mídia própria para celular e
  Fade, Slide ou Crossfade. “Usar padrão da GALEO” aplica a configuração geral.
- Rotação pausa fora da área visível, quando a página fica oculta, no foco e no
  hover. Há controle de pausa; movimento reduzido permite navegação manual.
- As cinco últimas publicações guardam somente dados e referências de mídia.
  Publicação e snapshot são transacionais. Restaurar recupera o rascunho inteiro,
  sem trocar automaticamente a versão pública.
- Edição, ordenação, publicação e restauração geram auditoria compacta. Detalhes
  ficam limitados a 4 KB, com retenção de 90 dias e no máximo 5.000 eventos.
- O menu da vitrine não sobrepõe mais o Admin. Inter pesada e Georgia em itálico
  permanecem na Home pública.

## Newsletter

Inscrição real com confirmação explícita por e-mail, token aleatório de uso
único, validade de 24 horas, limite de tentativas e link para cancelamento.
O banco guarda hashes dos tokens. Quando a proteção adicional está habilitada,
o endereço usa AES-GCM e índice HMAC. Sem Resend/remetente configurados, a API
informa indisponibilidade e não simula confirmação nem envio.

## Validação

Node 24, MySQL descartável em loopback e Chromium. Foram aprovados:

- 145 testes unitários.
- 10 testes HTTP/MySQL do fluxo da Home.
- 32 testes HTTP/MySQL de seleção, gestão e proteção de mídia.
- 7 testes MySQL/HTTP da newsletter, incluindo criptografia e falha de envio.
- 14 testes da ferramenta de limpeza, incluindo rollback e preservação do CMS.
- 30 testes de navegador, desktop e mobile.
- Fluxos adicionais no navegador com API/MySQL reais: campanhas, biblioteca,
  capa pública, comparação, publicação e restauração. Fotos/vídeos sintéticos,
  sem transformação paga ou envio real de e-mail.

`npm run check` e `npm run build` aprovados. O build ainda informa o tamanho
do bundle; isso não é erro de compilação. Os testes usam dados próprios locais,
removem suas fixtures e bloqueiam chamadas a provedores.

## Pendências externas reais

Em 12/10/2026, o Render respondeu autenticado. O token Aiven respondeu HTTP 401;
a tentativa direta de MySQL com TLS estrito retornou ECONNREFUSED. A produção
ainda está sem CA/validação de certificado MySQL, chave da proteção adicional,
`RESEND_API_KEY` e remetente da loja. A criptografia extra dos dados pessoais e
a remoção dos dados operacionais de teste **não foram ativadas/executadas**.

Antes dessas duas operações faltam acesso válido ao Aiven, TLS validado,
backup recuperável conferido e janela sem escritas. Banco e backups criptografados
no armazenamento precisam ser confirmados na conta do provedor; documentação
geral não constitui comprovação desta instância.

O código de manutenção agora reconhece e preserva versões da Home e preferências
da biblioteca, e inclui inscrições de teste no conjunto operacional removível.
Publicar este código não dispara limpeza nem habilita migração criptográfica.
