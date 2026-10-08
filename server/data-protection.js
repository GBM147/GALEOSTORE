import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'

const ALGORITHM = 'A256GCM'
const VERSION = 1
const ENCRYPTION_DOMAIN = 'GALEO/data-encryption/v1'
const LOOKUP_DOMAIN = 'GALEO/email-lookup/v1'

export class DataProtectionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DataProtectionError'
    this.code = code
  }
}

function fail(code, message) {
  throw new DataProtectionError(code, message)
}

function readKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('DATA_KEY_MISSING', 'DATA_ENCRYPTION_KEY não configurada.')
  }
  const encoded = value.trim()
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    fail('DATA_KEY_INVALID', 'DATA_ENCRYPTION_KEY deve conter 32 bytes aleatórios em Base64.')
  }
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    fail('DATA_KEY_INVALID', 'DATA_ENCRYPTION_KEY deve conter 32 bytes aleatórios em Base64.')
  }
  return key
}

function normalizeKeyId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    fail('DATA_KEY_ID_INVALID', 'Identificador da chave de proteção inválido.')
  }
  return value
}

function normalizeContext(value) {
  if (typeof value === 'string' && value.trim() && value.length <= 1024) {
    return value
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { table, field, rowId } = value
    if (typeof table !== 'string' || !table.trim() || table.length > 128 ||
        typeof field !== 'string' || !field.trim() || field.length > 128) {
      fail('DATA_CONTEXT_INVALID', 'Informe a tabela e o campo protegidos.')
    }
    if (rowId !== undefined && rowId !== null &&
        !(typeof rowId === 'string' && rowId.length > 0 && rowId.length <= 128) &&
        !(typeof rowId === 'number' && Number.isSafeInteger(rowId) && rowId >= 0)) {
      fail('DATA_CONTEXT_INVALID', 'Identificador da linha protegida inválido.')
    }
    return { table, field, rowId: rowId == null ? null : String(rowId) }
  }
  fail('DATA_CONTEXT_INVALID', 'Informe um contexto estável para os dados protegidos.')
}

function associatedData(keyId, context) {
  return Buffer.from(JSON.stringify({ domain: ENCRYPTION_DOMAIN, v: VERSION, alg: ALGORITHM, kid: keyId, context }), 'utf8')
}

function decodePart(value, expectedSize = null) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
    fail('DATA_ENVELOPE_INVALID', 'Formato dos dados protegidos inválido.')
  }
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value || (expectedSize !== null && decoded.length !== expectedSize)) {
    fail('DATA_ENVELOPE_INVALID', 'Formato dos dados protegidos inválido.')
  }
  return decoded
}

function readEnvelope(value) {
  let envelope = value
  if (typeof envelope === 'string') {
    try { envelope = JSON.parse(envelope) }
    catch { fail('DATA_ENVELOPE_INVALID', 'Formato dos dados protegidos inválido.') }
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      envelope.v !== VERSION || envelope.alg !== ALGORITHM || typeof envelope.kid !== 'string') {
    fail('DATA_ENVELOPE_INVALID', 'Formato ou versão dos dados protegidos inválido.')
  }
  return envelope
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') fail('DATA_EMAIL_INVALID', 'E-mail inválido para consulta protegida.')
  const email = value.trim().toLowerCase()
  if (!email || email.length > 255 || !/^\S+@\S+\.\S+$/.test(email)) {
    fail('DATA_EMAIL_INVALID', 'E-mail inválido para consulta protegida.')
  }
  return email
}

/**
 * A chave fica somente no servidor. Os envelopes podem ser armazenados em JSON
 * ou serializados em TEXT; nenhum método aceita texto puro como fallback.
 */
export function createDataProtection({
  key = process.env.DATA_ENCRYPTION_KEY,
  keyId = process.env.DATA_ENCRYPTION_KEY_ID || 'primary'
} = {}) {
  const masterKey = readKey(key)
  const id = normalizeKeyId(keyId)
  const encryptionKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), ENCRYPTION_DOMAIN, 32))
  const lookupKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), LOOKUP_DOMAIN, 32))

  function encryptField(value, context) {
    if (typeof value !== 'string') fail('DATA_VALUE_INVALID', 'O campo protegido deve ser texto.')
    const normalizedContext = normalizeContext(context)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv, { authTagLength: 16 })
    cipher.setAAD(associatedData(id, normalizedContext))
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return {
      v: VERSION,
      alg: ALGORITHM,
      kid: id,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      data: data.toString('base64url')
    }
  }

  function decryptField(value, context) {
    const normalizedContext = normalizeContext(context)
    const envelope = readEnvelope(value)
    if (envelope.kid !== id) fail('DATA_KEY_UNKNOWN', 'A chave necessária para ler estes dados não está configurada.')
    const iv = decodePart(envelope.iv, 12)
    const tag = decodePart(envelope.tag, 16)
    const data = decodePart(envelope.data)
    try {
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv, { authTagLength: 16 })
      decipher.setAAD(associatedData(id, normalizedContext))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    } catch {
      fail('DATA_DECRYPTION_FAILED', 'Não foi possível validar os dados protegidos.')
    }
  }

  function encryptJSON(value, context) {
    let serialized
    try { serialized = JSON.stringify(value) }
    catch { fail('DATA_VALUE_INVALID', 'Os dados protegidos devem ser JSON válido.') }
    if (serialized === undefined) fail('DATA_VALUE_INVALID', 'Os dados protegidos devem ser JSON válido.')
    return encryptField(serialized, context)
  }

  function decryptJSON(value, context) {
    const plaintext = decryptField(value, context)
    try { return JSON.parse(plaintext) }
    catch { fail('DATA_VALUE_INVALID', 'Os dados protegidos não contêm JSON válido.') }
  }

  function emailLookup(email, purpose = 'customers.email') {
    if (typeof purpose !== 'string' || !purpose.trim() || purpose.length > 128) {
      fail('DATA_CONTEXT_INVALID', 'Informe o destino do índice protegido de e-mail.')
    }
    return createHmac('sha256', lookupKey)
      .update(JSON.stringify({ domain: LOOKUP_DOMAIN, purpose, email: normalizeEmail(email) }), 'utf8')
      .digest('hex')
  }

  return Object.freeze({ keyId: id, encryptField, decryptField, encryptJSON, decryptJSON, emailLookup })
}

let defaultProtection
function configuredProtection() {
  defaultProtection ||= createDataProtection()
  return defaultProtection
}

export const encryptField = (value, context) => configuredProtection().encryptField(value, context)
export const decryptField = (value, context) => configuredProtection().decryptField(value, context)
export const encryptJSON = (value, context) => configuredProtection().encryptJSON(value, context)
export const decryptJSON = (value, context) => configuredProtection().decryptJSON(value, context)
export const emailLookup = (value, purpose) => configuredProtection().emailLookup(value, purpose)
