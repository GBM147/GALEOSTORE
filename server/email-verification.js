import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'

export const verificationRequired = {
  success: false,
  authenticated: false,
  verification_required: true,
  code: 'EMAIL_VERIFICATION_REQUIRED',
  error: 'Confirme seu e-mail para acessar a conta. Você pode solicitar um novo link.'
}

export class EmailVerificationError extends Error {
  constructor(code, status, message, retryAfter = 0) {
    super(message)
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}

function deliveryUnavailable() {
  return new EmailVerificationError('EMAIL_DELIVERY_UNAVAILABLE', 503, 'Não foi possível enviar o e-mail de confirmação. Tente novamente mais tarde.')
}

export function verificationLink(appUrl, token) {
  let url
  try { url = new URL('/conta', appUrl) } catch { throw deliveryUnavailable() }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && url.protocol === 'http:')) throw deliveryUnavailable()
  // A fragment is not sent in HTTP requests or included in normal access logs.
  url.hash = 'verify=' + token
  return url.toString()
}

export function verificationDigest(token) {
  return createHash('sha256').update(token).digest('hex')
}

// The caller locks the customer and owns the transaction. Only successful
// delivery is committed, so a provider failure never authenticates a customer
// or consumes the resend cooldown. A successful resend replaces the old token.
export async function issueEmailVerification(conn, customer, { appUrl, sendTransactionalEmail }) {
  const [previous] = await conn.execute(
    'SELECT GREATEST(0,60-TIMESTAMPDIFF(SECOND,sent_at,UTC_TIMESTAMP())) AS retry_after FROM customer_email_verifications WHERE customer_id=? FOR UPDATE',
    [customer.id]
  )
  const retryAfter = Number(previous[0]?.retry_after || 0)
  if (retryAfter > 0) {
    throw new EmailVerificationError('EMAIL_VERIFICATION_COOLDOWN', 429, 'Aguarde um minuto antes de solicitar outro e-mail de confirmação.', retryAfter)
  }
  const token = randomBytes(32).toString('hex')
  const digest = verificationDigest(token)
  const link = verificationLink(appUrl, token)
  await conn.execute(
    `INSERT INTO customer_email_verifications(customer_id,token_hash,expires_at,sent_at)
     VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR),UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),expires_at=VALUES(expires_at),sent_at=VALUES(sent_at)`,
    [customer.id, digest]
  )
  try {
    const delivery = await sendTransactionalEmail({
      to: customer.email,
      subject: 'Confirme seu e-mail — GALEO',
      idempotencyKey: 'verify-customer-' + customer.id + '-' + digest,
      text: 'Confirme seu e-mail na GALEO abrindo este link e informando a senha que você escolheu: ' + link + '\nO link vale por 24 horas. Se você não criou esta conta, ignore este e-mail.',
      html: '<div style="font-family:Arial,sans-serif"><h1>Confirme seu e-mail</h1><p>Para acessar sua conta na GALEO, abra o link abaixo e informe a senha que você escolheu no cadastro.</p><p><a href="' + link.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">Confirmar meu e-mail</a></p><p>Este link vale por 24 horas. Se você não criou esta conta, ignore este e-mail.</p></div>'
    })
    if (!delivery || delivery.skipped || delivery.error) throw deliveryUnavailable()
  } catch {
    // Provider error bodies can contain recipient information. Never log or
    // expose those bodies, credentials, or the plaintext verification token.
    throw deliveryUnavailable()
  }
}

export async function consumeEmailVerification(conn, token, password) {
  if (!/^[a-f0-9]{64}$/.test(token) || !password) return false
  const digest = verificationDigest(token)
  const [lookup] = await conn.execute('SELECT customer_id FROM customer_email_verifications WHERE token_hash=? LIMIT 1', [digest])
  if (!lookup.length) return false
  // All writers lock customer first, then token, so concurrent resend and
  // confirmation cannot produce mismatched accounts or reusable links.
  const [customers] = await conn.execute('SELECT id,password_hash,active,email_verified_at FROM customers WHERE id=? FOR UPDATE', [lookup[0].customer_id])
  const customer = customers[0]
  if (!customer?.active || customer.email_verified_at) return false
  const [tokens] = await conn.execute(
    'SELECT customer_id FROM customer_email_verifications WHERE token_hash=? AND customer_id=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE',
    [digest, customer.id]
  )
  if (!tokens.length || !(await bcrypt.compare(password, customer.password_hash))) return false
  await conn.execute('UPDATE customers SET email_verified_at=UTC_TIMESTAMP() WHERE id=? AND email_verified_at IS NULL', [customer.id])
  await conn.execute('DELETE FROM customer_email_verifications WHERE customer_id=?', [customer.id])
  return true
}
