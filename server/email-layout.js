// Every store e-mail goes out as a complete, branded document. Mail filters
// distrust bare HTML fragments with no language, title, sender identity or
// footer, which is what the store used to send.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

export const EMAIL_FOOTER_TEXT = 'Mensagem automática da GALEO STORE. Para falar conosco, responda este e-mail.'

export function isCompleteDocument(html) {
  return /^\s*(<!doctype html|<html[\s>])/i.test(String(html || ''))
}

function siteName(appUrl) {
  try { return appUrl ? new URL(appUrl).hostname : '' } catch { return '' }
}

export function emailDocument({ subject, html, appUrl = '', preheader = '' }) {
  if (isCompleteDocument(html)) return html
  const site = siteName(appUrl)
  const font = 'font-family:Arial,Helvetica,sans-serif;'
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f4f1ea;">' +
    (preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + escape(preheader) + '</div>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;">' +
    '<tr><td style="padding:24px 28px 8px;' + font + 'font-size:18px;letter-spacing:4px;font-weight:bold;color:#1a1714;">GALEO STORE</td></tr>' +
    '<tr><td style="padding:8px 28px 24px;' + font + 'font-size:15px;line-height:1.6;color:#2b2723;">' + html + '</td></tr>' +
    '<tr><td style="padding:16px 28px 24px;border-top:1px solid #ece6db;' + font + 'font-size:12px;line-height:1.5;color:#6d655c;">' +
    'Você recebeu esta mensagem automática da GALEO STORE' + (site ? ' (' + escape(site) + ')' : '') +
    ' por causa de um cadastro, pedido ou inscrição feito com este endereço. Para falar conosco, responda este e-mail.' +
    '</td></tr></table></td></tr></table></body></html>'
}

export function emailText(text) {
  return text === undefined ? undefined : String(text).replace(/\s+$/, '') + '\n\n— ' + EMAIL_FOOTER_TEXT
}

// A clear button plus the same address written out, so the link text and its
// destination always match.
export function emailButton(url, label) {
  const href = escape(url)
  return '<p style="margin:24px 0;"><a href="' + href + '" style="display:inline-block;background:#1a1714;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;">' + escape(label) + '</a></p>' +
    '<p style="font-size:13px;color:#6d655c;">Se o botão não abrir, copie e cole este endereço no navegador:<br><a href="' + href + '" style="color:#6d655c;word-break:break-all;">' + href + '</a></p>'
}
