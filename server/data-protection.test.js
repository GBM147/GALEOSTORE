import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createDataProtection, DataProtectionError, normalizeEmail } from './data-protection.js'

const key = randomBytes(32).toString('base64')
const protection = createDataProtection({ key, keyId: 'test-key' })
const context = { table: 'customers', rowId: 42, field: 'personal_data' }

function hasCode(code) {
  return (error) => error instanceof DataProtectionError && error.code === code
}

test('AES-GCM preserva UTF-8, campos vazios e envelopes serializados sem expor o texto', () => {
  for (const value of ['Camila São Paulo 👕', '', '  valor com espaços  ']) {
    const envelope = protection.encryptField(value, context)
    assert.equal(envelope.v, 1)
    assert.equal(envelope.alg, 'A256GCM')
    assert.equal(envelope.kid, 'test-key')
    assert.equal(protection.decryptField(envelope, context), value)
    assert.equal(protection.decryptField(JSON.stringify(envelope), context), value)
    if (value) assert.equal(JSON.stringify(envelope).includes(value), false)
  }
})

test('cada gravação usa nonce aleatório inclusive para dados idênticos', () => {
  const first = protection.encryptField('cliente@galeo.test', context)
  const second = protection.encryptField('cliente@galeo.test', context)
  assert.notEqual(first.iv, second.iv)
  assert.notEqual(first.data, second.data)
  assert.notEqual(first.tag, second.tag)
})

test('o contexto autenticado impede trocar tabela, campo ou linha', () => {
  const envelope = protection.encryptField('cliente@galeo.test', context)
  for (const changed of [
    { ...context, table: 'admin_users' },
    { ...context, field: 'email' },
    { ...context, rowId: 43 }
  ]) assert.throws(() => protection.decryptField(envelope, changed), hasCode('DATA_DECRYPTION_FAILED'))
  assert.equal(protection.decryptField(envelope, { field: 'personal_data', rowId: '42', table: 'customers' }), 'cliente@galeo.test')
})

test('ciphertext, tag ou nonce adulterados falham na autenticação', () => {
  const envelope = protection.encryptField('segredo', context)
  for (const part of ['data', 'tag', 'iv']) {
    const bytes = Buffer.from(envelope[part], 'base64url')
    bytes[0] ^= 1
    assert.throws(() => protection.decryptField({ ...envelope, [part]: bytes.toString('base64url') }, context), hasCode('DATA_DECRYPTION_FAILED'))
  }
})

test('chave incorreta e key id desconhecido nunca devolvem texto puro', () => {
  const envelope = protection.encryptField('segredo', context)
  const otherKey = createDataProtection({ key: randomBytes(32).toString('base64'), keyId: 'test-key' })
  assert.throws(() => otherKey.decryptField(envelope, context), hasCode('DATA_DECRYPTION_FAILED'))
  const otherId = createDataProtection({ key, keyId: 'different-key' })
  assert.throws(() => otherId.decryptField(envelope, context), hasCode('DATA_KEY_UNKNOWN'))
  assert.throws(() => protection.decryptField('texto legado', context), hasCode('DATA_ENVELOPE_INVALID'))
})

test('chave ausente, malformada ou de tamanho incorreto bloqueia a proteção', () => {
  for (const invalid of ['', null, undefined]) {
    if (invalid === undefined && process.env.DATA_ENCRYPTION_KEY) continue
    assert.throws(() => createDataProtection({ key: invalid }), hasCode('DATA_KEY_MISSING'))
  }
  for (const invalid of ['not-a-key', randomBytes(16).toString('base64'), randomBytes(33).toString('base64'), '_'.repeat(43) + '=']) {
    assert.throws(() => createDataProtection({ key: invalid }), hasCode('DATA_KEY_INVALID'))
  }
  assert.throws(() => createDataProtection({ key, keyId: '../key' }), hasCode('DATA_KEY_ID_INVALID'))
})

test('envelopes truncados, versões desconhecidas e Base64 não canônico são recusados', () => {
  const envelope = protection.encryptField('segredo', context)
  for (const invalid of [null, [], {}, { ...envelope, v: 2 }, { ...envelope, alg: 'plain' }, { ...envelope, iv: 'AA' }, { ...envelope, tag: 'AA' }, { ...envelope, data: envelope.data + '=' }]) {
    assert.throws(() => protection.decryptField(invalid, context), hasCode('DATA_ENVELOPE_INVALID'))
  }
})

test('JSON protege dados estruturados e recusa valores não serializáveis', () => {
  const personalData = { name: 'Camila', email: 'camila@galeo.test', phone: '', addresses: [{ city: 'São Paulo', number: '21' }], nullable: null }
  const envelope = protection.encryptJSON(personalData, context)
  assert.deepEqual(protection.decryptJSON(envelope, context), personalData)
  assert.equal(JSON.stringify(envelope).includes(personalData.email), false)
  const circular = {}
  circular.self = circular
  for (const invalid of [undefined, 1n, circular]) assert.throws(() => protection.encryptJSON(invalid, context), hasCode('DATA_VALUE_INVALID'))
  assert.throws(() => protection.decryptJSON(protection.encryptField('not-json', context), context), hasCode('DATA_VALUE_INVALID'))
})

test('índice HMAC permite igualdade de e-mail sem guardar o endereço', () => {
  const index = protection.emailLookup(' Cliente@GALEO.TEST ')
  assert.match(index, /^[a-f0-9]{64}$/)
  assert.equal(index, protection.emailLookup('cliente@galeo.test'))
  assert.notEqual(index, protection.emailLookup('outro@galeo.test'))
  assert.notEqual(index, protection.emailLookup('cliente@galeo.test', 'admin_users.email'))
  const otherId = createDataProtection({ key, keyId: 'next-key-id' })
  assert.equal(index, otherId.emailLookup('cliente@galeo.test'))
  const otherKey = createDataProtection({ key: randomBytes(32).toString('base64'), keyId: 'test-key' })
  assert.notEqual(index, otherKey.emailLookup('cliente@galeo.test'))
})

test('contexto e e-mail ausentes são recusados sem adivinhar destinos', () => {
  for (const invalid of [undefined, null, '', {}, { table: 'customers' }, { ...context, rowId: NaN }]) {
    assert.throws(() => protection.encryptField('segredo', invalid), hasCode('DATA_CONTEXT_INVALID'))
  }
  for (const invalid of [undefined, null, '', 'cliente', 'cliente @galeo.test']) assert.throws(() => normalizeEmail(invalid), hasCode('DATA_EMAIL_INVALID'))
  assert.equal(normalizeEmail(' A@GALEO.TEST '), 'a@galeo.test')
  assert.throws(() => protection.emailLookup('cliente@galeo.test', ''), hasCode('DATA_CONTEXT_INVALID'))
})
