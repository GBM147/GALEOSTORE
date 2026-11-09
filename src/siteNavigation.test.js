import assert from 'node:assert/strict'
import { test } from 'node:test'
import { instagramUrl, navigationLinks, normalizeFooterSettings, whatsappUrl } from './siteNavigation.js'

test('menu usa os itens do CMS e, sem eles, as categorias principais', () => {
  assert.deepEqual(navigationLinks({ items:[{ label:'Novidades', url:'/shop?q=novo' }, { label:' ' }, null, { label:'Sale' }] }).map(link => [link.name, link.url]), [['Novidades', '/shop?q=novo'], ['Sale', '/shop']])
  assert.deepEqual(navigationLinks(null).map(link => link.url), ['/shop?category=Camisetas', '/shop?category=Cal%C3%A7as', '/shop?category=Camisas', '/shop?category=Moletons'])
  assert.equal(navigationLinks({ items:Array.from({ length:12 }, (_, i) => ({ label:'C' + i })) }, 5).length, 5)
})

test('Instagram só vira link para um perfil real do instagram.com', () => {
  assert.equal(instagramUrl('@galeo.store'), 'https://www.instagram.com/galeo.store/')
  assert.equal(instagramUrl('https://instagram.com/galeo_store?igsh=x'), 'https://www.instagram.com/galeo_store/')
  for (const value of ['javascript:alert(1)', 'http://instagram.com/galeo', 'https://instagram.com.evil.test/galeo', 'https://user:pw@instagram.com/galeo', 'galeo store', '', null]) assert.equal(instagramUrl(value), '', String(value))
})

test('WhatsApp aceita número brasileiro com DDD e gera o link wa.me', () => {
  assert.equal(whatsappUrl('(11) 99999-9999'), 'https://wa.me/5511999999999')
  assert.equal(whatsappUrl('+55 11 3333-4444'), 'https://wa.me/551133334444')
  for (const value of ['9999-9999', '+1 415 555 0100', 'abc', '']) assert.equal(whatsappUrl(value), '', value)
})

test('configuração do rodapé guarda só campos conhecidos e limitados', () => {
  assert.deepEqual(normalizeFooterSettings({ brand:'  GALEO STORE\n', year:'2026', location:'São Paulo / BR', instagram:'@galeo', whatsapp:'11 99999-9999', script:'<x>' }),
    { brand:'GALEO STORE', year:'2026', location:'São Paulo / BR', instagram:'https://www.instagram.com/galeo/', whatsapp:'5511999999999' })
  assert.deepEqual(normalizeFooterSettings([]), { brand:'', year:'', instagram:'', whatsapp:'' })
  assert.equal(normalizeFooterSettings({ brand:'x'.repeat(200) }).brand.length, 60)
})
