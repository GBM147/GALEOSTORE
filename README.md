# GALEO STORE

Loja de moda multimarcas com vitrine pública e painel administrativo integrado.

## Stack
- React 19
- Vite 7
- React Router 7
- Node.js + Express 5
- MySQL 8 (Aiven)
- Sessão administrativa no servidor
- Cloudinary para fotos e vídeos de produtos

## Gestão
O painel administrativo contempla produtos, marcas, categorias, estoque, histórico de movimentações, vendas, financeiro, contas recorrentes e auditoria.

Uma venda aprovada baixa o estoque e cria automaticamente a receita correspondente no financeiro. O cancelamento estorna estoque e lançamento financeiro.

## Mídia de produtos
Os administradores podem cadastrar URLs de mídia ou selecionar fotos e vídeos diretamente no computador. Os arquivos enviados são armazenados externamente e apenas os metadados/URLs ficam no MySQL.

Para ativar upload de arquivos, configure no Render:
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET

## Desenvolvimento
`npm install`
`npm run dev`

## Produção
`npm run build`
`npm start`

O Render publica o frontend e a API pelo mesmo serviço.
