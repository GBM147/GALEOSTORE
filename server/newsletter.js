import { createHash, randomBytes } from 'node:crypto'
import { rateLimit } from 'express-rate-limit'
import { normalizeEmail } from './data-protection.js'

export const NEWSLETTER_DDL = `CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  email_lookup CHAR(64) NOT NULL UNIQUE,
  private_data JSON NULL,
  status ENUM('pending','confirmed','unsubscribed') NOT NULL DEFAULT 'pending',
  token_hash CHAR(64) NULL UNIQUE,
  token_expires_at DATETIME NULL,
  unsubscribe_hash CHAR(64) NULL UNIQUE,
  sent_at DATETIME NULL,
  confirmed_at DATETIME NULL,
  unsubscribed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_newsletter_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`

export class NewsletterError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'NewsletterError'
    this.code = code
    this.status = status
  }
}

const unavailable = () => new NewsletterError('NEWSLETTER_EMAIL_UNAVAILABLE', 503, 'As inscrições estão temporariamente indisponíveis. Tente novamente mais tarde.')
const invalidLink = () => new NewsletterError('NEWSLETTER_LINK_INVALID', 400, 'Este link é inválido ou expirou. Solicite uma nova inscrição na Home.')
const digest = value => createHash('sha256').update(value).digest('hex')
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const context = id => ({ table: 'newsletter_subscriptions', field: 'private_data', rowId: String(id) })
const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function validEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\x00-\x20\x7f]/.test(value)) return false
  const parts = value.split('@')
  return parts.length === 2 && parts[0].length <= 64 && !parts[0].startsWith('.') && !parts[0].endsWith('.') && !parts[0].includes('..') &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(parts[1])
}

function link(appUrl, action, token) {
  let url
  try { url = new URL('/newsletter', appUrl) } catch { throw unavailable() }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && process.env.NODE_ENV !== 'production' && url.protocol === 'http:'))) throw unavailable()
  // Fragments stay out of HTTP access logs and referrers. The page requires an
  // explicit button; opening a link never changes a subscription.
  url.hash = action + '=' + token
  return url.toString()
}

export function createNewsletter({ db, emailService, appUrl, protection = null } = {}) {
  const protectedEmail = email => protection ? protection.emailLookup(email, 'newsletter_subscriptions.email') : digest(email)
  const ready = () => Boolean(emailService?.confirmationConfigured?.())

  function readEmail(row) {
    if (row.private_data != null) {
      if (!protection) throw new NewsletterError('NEWSLETTER_PRIVACY_DOWNGRADE', 500, 'Há inscrições protegidas. Mantenha a chave de proteção configurada.')
      const payload = protection.decryptJSON(row.private_data, context(row.id))
      if (!validEmail(payload?.email)) throw new NewsletterError('NEWSLETTER_PRIVATE_DATA_INVALID', 500, 'Não foi possível validar a inscrição protegida.')
      return payload.email
    }
    if (!validEmail(row.email)) throw new NewsletterError('NEWSLETTER_PRIVATE_DATA_INVALID', 500, 'Não foi possível validar a inscrição.')
    return row.email
  }

  async function initialize() {
    await db.execute(NEWSLETTER_DDL)
    // Only the owning application version may migrate in the established
    // maintenance window. Validation precedes writes and rejects key loss.
    let lastId = 0
    while (true) {
      const [rows] = await db.execute('SELECT id,email,email_lookup,private_data FROM newsletter_subscriptions WHERE id>? ORDER BY id LIMIT 100', [lastId])
      if (!rows.length) break
      for (const row of rows) {
        if (row.private_data != null) {
          const email = readEmail(row)
          if (row.email !== '' || row.email_lookup !== protectedEmail(email)) throw new NewsletterError('NEWSLETTER_PRIVATE_DATA_INVALID', 500, 'A inscrição protegida contém dados inconsistentes.')
        }
      }
      lastId = rows.at(-1).id
    }
    if (!protection) return
    lastId = 0
    while (true) {
      const [rows] = await db.execute('SELECT id FROM newsletter_subscriptions WHERE private_data IS NULL AND id>? ORDER BY id LIMIT 100', [lastId])
      if (!rows.length) break
      for (const candidate of rows) {
        const conn = await db.getConnection()
        try {
          await conn.beginTransaction()
          const [locked] = await conn.execute('SELECT id,email,private_data FROM newsletter_subscriptions WHERE id=? FOR UPDATE', [candidate.id])
          const row = locked[0]
          if (row && row.private_data == null) {
            const email = readEmail(row)
            const payload = protection.encryptJSON({ email }, context(row.id))
            if (protection.decryptJSON(payload, context(row.id)).email !== email) throw new NewsletterError('NEWSLETTER_PRIVATE_DATA_INVALID', 500, 'Não foi possível validar a migração da inscrição.')
            await conn.execute("UPDATE newsletter_subscriptions SET email='',email_lookup=?,private_data=? WHERE id=?", [protectedEmail(email), JSON.stringify(payload), row.id])
          }
          await conn.commit()
        } catch (error) {
          await conn.rollback().catch(() => {})
          throw error
        } finally { conn.release() }
      }
      lastId = rows.at(-1).id
    }
  }

  async function subscribe(input) {
    let email
    try { email = normalizeEmail(input) } catch { throw new NewsletterError('NEWSLETTER_EMAIL_INVALID', 400, 'Informe um e-mail válido.') }
    if (!validEmail(email)) throw new NewsletterError('NEWSLETTER_EMAIL_INVALID', 400, 'Informe um e-mail válido.')
    if (!ready()) throw unavailable()
    const token = randomBytes(32).toString('hex')
    const unsubscribeToken = randomBytes(32).toString('hex')
    const confirmationLink = link(appUrl, 'confirm', token)
    const unsubscribeLink = link(appUrl, 'unsubscribe', unsubscribeToken)
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      // A unique lookup serializes concurrent first subscriptions; both new
      // and existing subscribers use the same row lock before changing tokens.
      await conn.execute('INSERT INTO newsletter_subscriptions(email,email_lookup) VALUES(?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [protection ? '' : email, protectedEmail(email)])
      const [rows] = await conn.execute('SELECT *,TIMESTAMPDIFF(SECOND,sent_at,UTC_TIMESTAMP()) AS since_sent FROM newsletter_subscriptions WHERE email_lookup=? FOR UPDATE', [protectedEmail(email)])
      const row = rows[0]
      if (!row) throw new Error('newsletter row missing')
      if (row.private_data != null) readEmail(row)
      if (row.status === 'confirmed' || (row.sent_at && row.status === 'pending' && Number(row.since_sent) < 60)) {
        await conn.commit()
        return { accepted: true }
      }
      const payload = protection ? JSON.stringify(protection.encryptJSON({ email }, context(row.id))) : null
      await conn.execute(
        "UPDATE newsletter_subscriptions SET email=?,private_data=?,status='pending',token_hash=?,token_expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR),unsubscribe_hash=?,sent_at=UTC_TIMESTAMP(),confirmed_at=NULL,unsubscribed_at=NULL WHERE id=?",
        [protection ? '' : email, payload, digest(token), digest(unsubscribeToken), row.id])
      try {
        const sent = await emailService.send({
          to: email,
          subject: 'Confirme sua inscrição — GALEO',
          idempotencyKey: 'newsletter-' + row.id + '-' + digest(token),
          text: 'Confirme que deseja receber novidades da GALEO: ' + confirmationLink + '\nO link vale por 24 horas. Se você não solicitou esta inscrição, ignore este e-mail. Para cancelar: ' + unsubscribeLink,
          html: '<div style="font-family:Arial,sans-serif"><h1>Novidades da GALEO</h1><p>Confirme que deseja receber novidades da loja.</p><p><a href="' + escapeHtml(confirmationLink) + '">Confirmar inscrição</a></p><p>O link vale por 24 horas. Se você não solicitou esta inscrição, ignore este e-mail.</p><p><a href="' + escapeHtml(unsubscribeLink) + '">Cancelar inscrição</a></p></div>'
        })
        if (!sent?.id || sent.skipped || sent.error) throw unavailable()
      } catch { throw unavailable() }
      await conn.commit()
      return { accepted: true }
    } catch (error) {
      await conn.rollback().catch(() => {})
      if (error instanceof NewsletterError) throw error
      throw new NewsletterError('NEWSLETTER_FAILED', 503, 'Não foi possível concluir a inscrição. Tente novamente mais tarde.')
    } finally { conn.release() }
  }

  async function consume(token, unsubscribe = false) {
    if (!validToken(token)) throw invalidLink()
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [rows] = await conn.execute(unsubscribe
        ? 'SELECT id,private_data FROM newsletter_subscriptions WHERE unsubscribe_hash=? FOR UPDATE'
        : "SELECT id,private_data FROM newsletter_subscriptions WHERE token_hash=? AND status='pending' AND token_expires_at>UTC_TIMESTAMP() FOR UPDATE", [digest(token)])
      if (!rows.length) throw invalidLink()
      if (rows[0].private_data != null) readEmail(rows[0])
      await conn.execute(unsubscribe
        ? "UPDATE newsletter_subscriptions SET status='unsubscribed',unsubscribed_at=UTC_TIMESTAMP(),token_hash=NULL,token_expires_at=NULL WHERE id=?"
        : "UPDATE newsletter_subscriptions SET status='confirmed',confirmed_at=UTC_TIMESTAMP(),token_hash=NULL,token_expires_at=NULL WHERE id=?", [rows[0].id])
      await conn.commit()
      return { status: unsubscribe ? 'unsubscribed' : 'confirmed' }
    } catch (error) {
      await conn.rollback().catch(() => {})
      if (error instanceof NewsletterError) throw error
      throw new NewsletterError('NEWSLETTER_FAILED', 503, 'Não foi possível concluir esta ação. Tente novamente mais tarde.')
    } finally { conn.release() }
  }

  return { initialize, subscribe, confirm: token => consume(token), unsubscribe: token => consume(token, true), status: () => ({ available: ready() }) }
}

export function registerNewsletter(app, { newsletter }) {
  const subscriptionLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde antes de tentar novamente.', code: 'NEWSLETTER_RATE_LIMIT' } })
  const actionLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde antes de tentar novamente.', code: 'NEWSLETTER_RATE_LIMIT' } })
  const handle = (action, successStatus) => async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie a solicitação em JSON.', code: 'NEWSLETTER_CONTENT_TYPE' })
    try {
      const result = await action(req.body || {})
      return res.status(successStatus).json(result)
    } catch (error) {
      if (error instanceof NewsletterError) return res.status(error.status).json({ code: error.code, error: error.message })
      return res.status(503).json({ code: 'NEWSLETTER_FAILED', error: 'Não foi possível concluir esta ação. Tente novamente mais tarde.' })
    }
  }
  app.post('/api/store/newsletter/subscribe', subscriptionLimit, handle(body => newsletter.subscribe(body.email), 202))
  app.post('/api/store/newsletter/confirm', actionLimit, handle(body => newsletter.confirm(body.token), 200))
  app.post('/api/store/newsletter/unsubscribe', actionLimit, handle(body => newsletter.unsubscribe(body.token), 200))
}
