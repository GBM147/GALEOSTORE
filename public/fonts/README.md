# Fontes da loja

Todas com a licença SIL Open Font License 1.1 (textos em `OFL-*.txt`), hospedadas
aqui para a loja não depender de outro site. Origem: pacotes `@fontsource-variable`
5.3.0 (os mesmos arquivos do Google Fonts), subconjunto Latin, baixados em 10/11/2026.

| Arquivo | Uso | Origem e ajuste |
| --- | --- | --- |
| `inter-latin-normal.woff2` | textos, menus, botões, preços, formulários | Inter variável (peso 100–900), sem alteração |
| `inter-latin-italic.woff2` | itálico dos textos (pouco usado) | Inter Italic variável, sem alteração |
| `bodoni-moda-latin-normal.woff2` | títulos editoriais (capa, seções, manifesto, campanhas, páginas) | Bodoni Moda com o tamanho óptico fixo em 40 e peso 400–700 |
| `bodoni-moda-latin-italic.woff2` | trechos dourados em itálico dos títulos | Bodoni Moda Italic, tamanho óptico 40, peso 400–700 |
| `cinzel-caps.woff2` | nome GALEO no topo, rodapé e campanha sem foto | Cinzel só com maiúsculas, números e pontuação (Latin-1), peso 400–700 |

O tamanho óptico fixo e os subconjuntos deixam os arquivos menores (Bodoni Moda de
46 KB para 24 KB; Cinzel de 26 KB para 16 KB). Para refazer: `fontTools`
(`varLib.instancer` com `opsz=40, wght=400:700`; `subset` com os códigos de
`unicode-range` da Cinzel em `src/styles.css`). A cena 3D do logo usa a Cinzel em
`src/brand3d/cinzel-galeo.typeface.json`, com a licença em `src/brand3d/CINZEL-LICENSE.txt`.
