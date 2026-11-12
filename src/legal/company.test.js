import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cnpjDigits, companyAddress, companyEmail, formatCnpj, missingCompanyFields, normalizeCompanySettings } from './company.js'

test('CNPJ só vale com os dígitos verificadores certos', () => {
  assert.equal(cnpjDigits('11.222.333/0001-81'), '11222333000181')
  assert.equal(formatCnpj('11222333000181'), '11.222.333/0001-81')
  for (const value of ['11.222.333/0001-80', '00.000.000/0000-00', '1122233300018', 'abc', '', null]) assert.equal(cnpjDigits(value), '', String(value))
})

test('dados da empresa guardam só campos conhecidos, limpos e limitados', () => {
  const company = normalizeCompanySettings({ legal_name: '  GALEO Comércio\nde Roupas LTDA ', cnpj: '11222333000181', street: 'Rua Augusta', number: '100', neighborhood: 'Consolação', city: 'São Paulo', state: 'sp', postal_code: '01304000', email: ' Contato@Galeo.com.br ', hours: 'Seg. a sex., 9h às 18h', script: '<x>' })
  assert.deepEqual(company, { legal_name: 'GALEO Comércio de Roupas LTDA', trade_name: '', cnpj: '11.222.333/0001-81', street: 'Rua Augusta', number: '100', complement: '', neighborhood: 'Consolação', city: 'São Paulo', state: 'SP', postal_code: '01304-000', email: 'contato@galeo.com.br', hours: 'Seg. a sex., 9h às 18h' })
  assert.equal(normalizeCompanySettings({ state: 'São Paulo', postal_code: '123', email: 'sem-arroba' }).state, '')
  assert.equal(normalizeCompanySettings({ legal_name: 'x'.repeat(300) }).legal_name.length, 160)
  assert.equal(companyEmail('atendimento@galeo'), '')
  assert.equal(companyAddress(company), 'Rua Augusta, 100, Consolação, São Paulo/SP, CEP 01304-000')
})

test('o editor sabe o que falta antes de divulgar a loja', () => {
  assert.deepEqual(missingCompanyFields({}), ['razão social', 'CNPJ', 'endereço', 'cidade', 'e-mail de atendimento'])
  assert.deepEqual(missingCompanyFields({ legal_name: 'GALEO LTDA', cnpj: '11222333000181', street: 'Rua A', city: 'São Paulo', email: 'a@b.com' }), [])
})
