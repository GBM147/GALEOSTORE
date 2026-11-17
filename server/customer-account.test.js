import assert from 'node:assert/strict'
import test from 'node:test'
import { createResetToken, parseResetToken, passwordMark, removedCustomerEmail, resetLink, resetWindow, verifyResetToken, RESET_RESEND_MS, RESET_TTL_MS } from './customer-account.js'

const secret = 'local-session-secret-0123456789abcdef'
const base = { customerId: 42, passwordHash: '$2b$12$hash-a', email: 'Cliente@Example.Invalid', secret }

test('o link de senha confere com a senha e o e-mail atuais e vale uma vez', () => {
  const now = Date.now()
  const token = createResetToken({ ...base, now })
  assert.match(token, /^42\.\d{10}\.[A-Za-z0-9_-]{43}$/)
  assert.equal(verifyResetToken(token, { ...base, now }), true)
  assert.equal(verifyResetToken(token, { ...base, email: 'cliente@example.invalid', now }), true, 'e-mail sem diferença de maiúsculas')
  assert.equal(verifyResetToken(token, { ...base, passwordHash: '$2b$12$hash-b', now }), false, 'depois da troca de senha o link morre')
  assert.equal(verifyResetToken(token, { ...base, email: 'outro@example.invalid', now }), false)
  assert.equal(verifyResetToken(token, { ...base, secret: secret + 'x', now }), false)
})

test('o link expira em 1 hora e recusa formatos alterados', () => {
  const now = Date.now()
  const token = createResetToken({ ...base, now })
  assert.equal(verifyResetToken(token, { ...base, now: now + RESET_TTL_MS - 2000 }), true)
  assert.equal(verifyResetToken(token, { ...base, now: now + RESET_TTL_MS + 2000 }), false)
  const [id, expires, sig] = token.split('.')
  assert.equal(verifyResetToken(['43', expires, sig].join('.'), { ...base, now }), false, 'outro cliente')
  assert.equal(verifyResetToken([id, String(Number(expires) + 3600), sig].join('.'), { ...base, now }), false, 'validade esticada')
  for (const bad of ['', 'x', token + 'a', token.replace('.', '..'), '42.1.abc']) assert.equal(verifyResetToken(bad, { ...base, now }), false, bad)
  assert.deepEqual(parseResetToken(token), { customerId: 42, expires: Number(expires), signature: sig })
})

test('a marca da sessão muda quando a senha muda', () => {
  assert.equal(passwordMark('$2b$12$hash-a', secret), passwordMark('$2b$12$hash-a', secret))
  assert.notEqual(passwordMark('$2b$12$hash-a', secret), passwordMark('$2b$12$hash-b', secret))
  assert.equal(passwordMark('$2b$12$hash-a', secret).length, 32)
  assert.throws(() => passwordMark('x', 'curto'), /SESSION_SECRET/)
})

test('o link usa o fragmento #redefinir em HTTPS e o e-mail removido é único', () => {
  assert.equal(resetLink('https://galeo-store.netlify.app', '42.1.abc'), 'https://galeo-store.netlify.app/conta#redefinir=42.1.abc')
  assert.throws(() => resetLink('http://galeo.example', 'x'), /HTTPS/)
  assert.equal(removedCustomerEmail(7), 'removido-7@excluido.invalid')
})

test('pedidos na mesma janela de 10 minutos geram o mesmo link, válido por pelo menos 1 hora', () => {
  const start = Math.floor(Date.now() / RESET_RESEND_MS) * RESET_RESEND_MS
  const first = createResetToken({ ...base, ...resetWindow(start + 1000) })
  assert.equal(createResetToken({ ...base, ...resetWindow(start + RESET_RESEND_MS - 1000) }), first)
  assert.notEqual(createResetToken({ ...base, ...resetWindow(start + RESET_RESEND_MS + 1000) }), first)
  const late = start + RESET_RESEND_MS - 1000
  assert.equal(verifyResetToken(first, { ...base, now: late + RESET_TTL_MS - 2000 }), true)
  assert.equal(verifyResetToken(first, { ...base, now: start + RESET_TTL_MS + RESET_RESEND_MS + 2000 }), false)
})
