# Vídeos da GALEO (só desenvolvimento)

Scripts que gravam os vídeos de divulgação e de explicação usando o site local
(`npm run dev` na porta 5173). A API é simulada pelo Playwright com uma loja de
demonstração (`demo-store.mjs`): peças desenhadas (`garments.mjs`), pedidos e números
de exemplo. Nada é gravado no banco nem na loja real.

| Script | Vídeo |
| --- | --- |
| `node tools/video/promo.mjs <pasta>` | Divulgação (modelo), 26 s, vertical 1080×1920 e horizontal 1920×1080, sem som |
| `node tools/video/tour-site.mjs <pasta>` | Tour do site para clientes, voz + legendas (`.srt`) |
| `node tools/video/tutorial-admin.mjs <pasta>` | Tutorial do Admin para os donos, com capítulos |

Requisitos na máquina: Playwright com Chromium, `ffmpeg` (libx264/aac), Python 3 e a
voz brasileira `espeak-ng` + MBROLA `br4`:

```bash
apt-get install -y espeak-ng mbrola mbrola-br4
```

- `recorder.mjs` grava a tela (capturas do Chromium), mostra legenda, cursor e
  destaque (`overlay.mjs`), gera a fala de cada legenda e monta o MP4, o `.srt` e os
  capítulos.
- `promo.html` e `medallion.html` são páginas de composição usadas quadro a quadro
  pelo `promo.mjs`.
- Quando o site mudar, rode de novo o script do vídeo afetado. Se um botão mudar de
  nome, ajuste o roteiro.
