// bcrypt uses at most 72 UTF-8 bytes. Validate before hashing so distinct
// passwords cannot silently become equivalent after that boundary.
export function newPasswordError(password) {
  if (Array.from(password).length < 10) {
    return 'A senha deve ter pelo menos 10 caracteres.'
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'A senha é muito longa. Use no máximo 72 caracteres; acentos e emojis podem reduzir esse limite.'
  }
  return null
}
