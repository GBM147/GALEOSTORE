// Company data shown on the Contact page, in the policies and in the footer
// (Decreto 7.962/2013: name, CNPJ, address and contact must be visible).
// Shared by the storefront and the server, which stores only these fields.

const text = (input, max) => typeof input === 'string' ? input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const digits = input => typeof input === 'string' || typeof input === 'number' ? String(input).replace(/\D/g, '') : ''

// A CNPJ with valid check digits (14 digits, not all equal).
export function cnpjDigits(value) {
  const number = digits(value)
  if (!/^\d{14}$/.test(number) || /^(\d)\1{13}$/.test(number)) return ''
  const check = length => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((total, weight, index) => total + Number(number[index]) * weight, 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  return check(12) === Number(number[12]) && check(13) === Number(number[13]) ? number : ''
}

export function formatCnpj(value) {
  const number = cnpjDigits(value)
  return number ? number.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : ''
}

export function companyEmail(value) {
  const email = text(value, 160).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : ''
}

function postalCode(value) {
  const number = digits(value)
  return number.length === 8 ? number.replace(/^(\d{5})(\d{3})$/, '$1-$2') : ''
}

// Stored company settings keep only known, bounded fields. Invalid CNPJ or
// e-mail become empty (the server refuses them before saving).
export function normalizeCompanySettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const state = text(source.state, 2).toUpperCase()
  return {
    legal_name: text(source.legal_name, 160),
    trade_name: text(source.trade_name, 80),
    cnpj: formatCnpj(source.cnpj),
    street: text(source.street, 160),
    number: text(source.number, 20),
    complement: text(source.complement, 80),
    neighborhood: text(source.neighborhood, 80),
    city: text(source.city, 80),
    state: /^[A-Z]{2}$/.test(state) ? state : '',
    postal_code: postalCode(source.postal_code),
    email: companyEmail(source.email),
    hours: text(source.hours, 120)
  }
}

// Full address in one line, without the empty parts.
export function companyAddress(company) {
  const c = normalizeCompanySettings(company)
  const street = [c.street, c.number].filter(Boolean).join(', ')
  const first = [street, c.complement].filter(Boolean).join(' – ')
  const cityState = [c.city, c.state].filter(Boolean).join('/')
  return [first, c.neighborhood, cityState, c.postal_code && 'CEP ' + c.postal_code].filter(Boolean).join(', ')
}

// What is still missing before the store is advertised.
export function missingCompanyFields(company) {
  const c = normalizeCompanySettings(company)
  return [
    ['legal_name', 'razão social'],
    ['cnpj', 'CNPJ'],
    ['street', 'endereço'],
    ['city', 'cidade'],
    ['email', 'e-mail de atendimento']
  ].filter(([key]) => !c[key]).map(([, label]) => label)
}
