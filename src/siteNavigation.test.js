import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_GOOGLE_REVIEW_URL, footerReviewUrl, googleReviewUrl, instagramUrl, navigationLinks, normalizeFooterSettings, whatsappUrl } from './siteNavigation.js'

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

test('avaliação no Google: só links do Google para a loja, sem parâmetros de rastreio', () => {
  const pasted = 'https://www.google.com/maps/place/GaleoStore/@-23.5561312,-46.4726521,17z/data=!4m8!3m7!1s0x94ce675e943b374f:0xfcc1a871fee53d0e!8m2!3d-23.5561312!4d-46.4700772!9m1!1b1!16s%2Fg%2F11zwp02xns?entry=ttu&g_ep=EgoyMDI2MTEwOC4wIKXMDSoASAFQAw%3D%3D'
  assert.equal(googleReviewUrl(pasted), DEFAULT_GOOGLE_REVIEW_URL)
  assert.equal(googleReviewUrl('https://maps.app.goo.gl/AbC123xyz'), 'https://maps.app.goo.gl/AbC123xyz')
  assert.equal(googleReviewUrl('https://g.page/r/CQ5d5f5xqMH8EAE/review'), 'https://g.page/r/CQ5d5f5xqMH8EAE/review')
  assert.equal(googleReviewUrl('https://search.google.com/local/writereview?placeid=ChIJTzc7lF5nzpQRDj3l_nGowfw'), 'https://search.google.com/local/writereview?placeid=ChIJTzc7lF5nzpQRDj3l_nGowfw')
  for (const value of ['javascript:alert(1)', 'http://www.google.com/maps/place/x', 'https://www.google.com/search?q=galeo', 'https://google.com.evil.test/maps/x', 'https://user:pw@www.google.com/maps/x', 'https://maps.app.goo.gl/', 'GaleoStore', '', null]) assert.equal(googleReviewUrl(value), '', String(value))
})

test('rodapé: sem link salvo usa a GaleoStore no Google; link vazio esconde as estrelas', () => {
  assert.equal(footerReviewUrl({ brand:'GALEO STORE' }), DEFAULT_GOOGLE_REVIEW_URL)
  assert.equal(footerReviewUrl(null), DEFAULT_GOOGLE_REVIEW_URL)
  assert.equal(footerReviewUrl({ google_review:'' }), '')
  assert.equal(footerReviewUrl({ google_review:'https://maps.app.goo.gl/AbC123xyz' }), 'https://maps.app.goo.gl/AbC123xyz')
  assert.equal(normalizeFooterSettings({ google_review:'https://maps.app.goo.gl/AbC123xyz?g_st=ic' }).google_review, 'https://maps.app.goo.gl/AbC123xyz')
  assert.equal(normalizeFooterSettings({ google_review:'' }).google_review, '')
  assert.equal('google_review' in normalizeFooterSettings({ brand:'GALEO' }), false)
})
