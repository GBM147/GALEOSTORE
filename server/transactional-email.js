const endpoint = 'https://api.resend.com/emails'
const controls = /[\x00-\x1f\x7f]/
const mailboxPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/

class TransactionalEmailError extends Error {
  constructor(code, status) {
    // Messages and metadata deliberately contain no provider body or inputs.
    super(code)
    this.name = 'TransactionalEmailError'
    this.code = code
    this.status = status
  }
}

function mailboxValid(value) {
  if (typeof value !== 'string' || controls.test(value) || value.length > 254 || !mailboxPattern.test(value)) return false
  const local = value.slice(0, value.lastIndexOf('@'))
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
}

function addressValid(value) {
  if (typeof value !== 'string' || value.length > 512 || controls.test(value)) return false
  if (mailboxValid(value)) return true
  const display = /^([^<>]+?)\s*<([^<>]+)>$/.exec(value)
  return Boolean(display && display[1].trim() && mailboxValid(display[2]))
}

function appUrlValid(value, production) {
  if (!value || controls.test(value)) return false
  try {
    const url = new URL(value)
    if (url.username || url.password || !url.hostname) return false
    return url.protocol === 'https:' || (!production && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch { return false }
}

export function createTransactionalEmail({ env = process.env, fetchImpl = globalThis.fetch, logger = console, timeoutMs = 15000 } = {}) {
  // A deployment uses one configuration snapshot. Never expose these values in
  // status, error messages, logs, or provider response objects returned upstream.
  const rawApiKey = String(env.RESEND_API_KEY || '')
  const apiKey = rawApiKey.trim()
  const rawSender = String(env.EMAIL_FROM || '')
  const sender = rawSender.trim()
  const rawAppUrl = String(env.APP_URL || '')
  const appUrl = rawAppUrl.trim()
  const rawStoreNotification = String(env.STORE_NOTIFICATION_EMAIL || '')
  const rawStoreAddress = rawStoreNotification.trim() ? rawStoreNotification : String(env.ADMIN_EMAIL || '')
  const storeAddress = rawStoreAddress.trim()
  const keyConfigured = Boolean(apiKey && !controls.test(rawApiKey) && !/\s/.test(apiKey))
  const senderConfigured = !controls.test(rawSender) && addressValid(sender)
  const urlConfigured = !controls.test(rawAppUrl) && appUrlValid(appUrl, (env.NODE_ENV || 'production') === 'production')
  const storeConfigured = !controls.test(rawStoreAddress) && addressValid(storeAddress)
  const sendingConfigured = keyConfigured && senderConfigured
  const confirmationReady = sendingConfigured && urlConfigured
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000

  function status() {
    return {
      provider: 'RESEND',
      api_key_configured: keyConfigured,
      sender_configured: senderConfigured,
      app_url_configured: urlConfigured,
      store_notification_configured: storeConfigured,
      sending_configured: sendingConfigured,
      confirmation_configured: confirmationReady,
      pending_configuration: [
        ...(!keyConfigured ? ['RESEND_API_KEY'] : []),
        ...(!senderConfigured ? ['EMAIL_FROM'] : []),
        ...(!urlConfigured ? ['APP_URL'] : [])
      ]
    }
  }

  async function send(payload) {
    if (!sendingConfigured) throw new TransactionalEmailError('EMAIL_NOT_CONFIGURED', 503)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TransactionalEmailError('EMAIL_PAYLOAD_INVALID', 400)
    const { to, subject, html, text, idempotencyKey } = payload
    const rawRecipients = Array.isArray(to) ? to : [to]
    if (!rawRecipients.length || rawRecipients.length > 50 || rawRecipients.some((value) => typeof value !== 'string' || controls.test(value) || !addressValid(value.trim()))) {
      throw new TransactionalEmailError('EMAIL_PAYLOAD_INVALID', 400)
    }
    if (typeof subject !== 'string' || !subject.trim() || controls.test(subject) || subject.length > 998 || typeof html !== 'string' || !html.trim() || (text !== undefined && typeof text !== 'string')) {
      throw new TransactionalEmailError('EMAIL_PAYLOAD_INVALID', 400)
    }
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || (idempotencyKey && !/^[\x21-\x7e]{1,256}$/.test(idempotencyKey)))) {
      throw new TransactionalEmailError('EMAIL_PAYLOAD_INVALID', 400)
    }
    const controller = new AbortController()
    let timer
    let expired = false
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true
        controller.abort()
        reject(new TransactionalEmailError('EMAIL_DELIVERY_TIMEOUT', 504))
      }, duration)
    })
    async function deliver() {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: JSON.stringify({
          from: sender,
          to: rawRecipients.map((value) => value.trim()),
          subject,
          html,
          ...(text !== undefined ? { text } : {})
        })
      })
      if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
        throw new TransactionalEmailError('EMAIL_PROVIDER_RESPONSE_INVALID', 502)
      }
      if (!response.ok || response.status < 200 || response.status >= 300) throw new TransactionalEmailError('EMAIL_PROVIDER_REJECTED', response.status)
      let data
      try { data = JSON.parse(await response.text()) } catch { throw new TransactionalEmailError('EMAIL_PROVIDER_RESPONSE_INVALID', 502) }
      if (typeof data?.id !== 'string' || !data.id.trim() || controls.test(data.id)) throw new TransactionalEmailError('EMAIL_PROVIDER_RESPONSE_INVALID', 502)
      return { id: data.id }
    }
    try {
      return await Promise.race([deliver(), deadline])
    } catch (error) {
      if (expired) throw new TransactionalEmailError('EMAIL_DELIVERY_TIMEOUT', 504)
      if (error instanceof TransactionalEmailError) throw error
      throw new TransactionalEmailError('EMAIL_DELIVERY_FAILED', 502)
    } finally {
      clearTimeout(timer)
    }
  }

  async function sendSafely(payload) {
    try { return await send(payload) }
    catch (error) {
      if (error.code === 'EMAIL_NOT_CONFIGURED') return { skipped: true, reason: 'EMAIL_NOT_CONFIGURED' }
      try { logger.error('EMAIL_DELIVERY', { code: error.code, status: error.status }) } catch {}
      return { error: error.code }
    }
  }

  return { send, sendSafely, status, confirmationConfigured: () => confirmationReady }
}
