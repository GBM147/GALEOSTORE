import assert from 'node:assert/strict'
import test from 'node:test'
import { EMAIL_FOOTER_TEXT, emailButton, emailDocument, emailText, isCompleteDocument } from './email-layout.js'

test('o e-mail sai como documento completo, com marca, pré-visualização e rodapé', () => {
  const html = emailDocument({ subject: 'Pedido <1>', html: '<p>Corpo</p>', appUrl: 'https://galeo-store.netlify.app/conta', preheader: 'Prévia & mais' })
  assert.match(html, /^<!doctype html><html lang="pt-BR">/)
  assert.match(html, /<title>Pedido &lt;1&gt;<\/title>/)
  assert.match(html, />GALEO STORE</)
  assert.match(html, /Prévia &amp; mais/)
  assert.match(html, /<p>Corpo<\/p>/)
  assert.match(html, /\(galeo-store\.netlify\.app\)/)
  assert.match(html, /responda este e-mail/)
  assert.doesNotMatch(html, /<img/)
  assert.equal(isCompleteDocument(html), true)
  assert.equal(emailDocument({ subject: 'x', html }), html, 'não embrulha duas vezes')
  assert.doesNotMatch(emailDocument({ subject: 'x', html: '<p>a</p>' }), /\(\)/)
})

test('o texto ganha o rodapé, e sem texto nada é inventado', () => {
  assert.equal(emailText('Linha\n\n'), 'Linha\n\n— ' + EMAIL_FOOTER_TEXT)
  assert.equal(emailText(undefined), undefined)
})

test('o botão e o endereço escrito apontam para o mesmo link, escapado', () => {
  const html = emailButton('https://galeo.test/conta#verify=a&b="c"', 'Confirmar <já>')
  const escaped = 'https://galeo.test/conta#verify=a&amp;b=&quot;c&quot;'
  assert.equal(html.split('href="' + escaped + '"').length - 1, 2)
  assert.match(html, />Confirmar &lt;já&gt;</)
  assert.match(html, new RegExp('>' + escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</a>'))
})
