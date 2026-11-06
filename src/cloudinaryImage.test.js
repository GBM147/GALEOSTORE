import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cloudinaryImageUrl, cloudinarySrcSet } from './cloudinaryImage.js'

const upload = 'https://res.cloudinary.com/galeo/image/upload/v1730000000/produtos/camisa-azul.jpg'

test('upload simples recebe formato, qualidade e largura automáticos', () => {
  assert.equal(cloudinaryImageUrl(upload, 480), 'https://res.cloudinary.com/galeo/image/upload/f_auto,q_auto,c_limit,w_480/v1730000000/produtos/camisa-azul.jpg')
  assert.equal(cloudinaryImageUrl('https://res.cloudinary.com/galeo/image/upload/camisa.png', 320), 'https://res.cloudinary.com/galeo/image/upload/f_auto,q_auto,c_limit,w_320/camisa.png')
  assert.equal(cloudinaryImageUrl(upload, 99999), 'https://res.cloudinary.com/galeo/image/upload/f_auto,q_auto,c_limit,w_4000/v1730000000/produtos/camisa-azul.jpg')
})

test('URLs com transformações, vídeos e outros hosts ficam inalterados', () => {
  for (const url of [
    'https://res.cloudinary.com/galeo/image/upload/e_background_removal,f_png/v1730000000/produtos/camisa.png',
    'https://res.cloudinary.com/galeo/image/upload/c_fill,w_200/v1/produtos/camisa.jpg',
    'https://res.cloudinary.com/galeo/video/upload/v1/campanha.mp4',
    'http://res.cloudinary.com/galeo/image/upload/v1/camisa.jpg',
    'https://cdn.exemplo.test/image/upload/v1/camisa.jpg',
    '/images/product-placeholder.svg',
    'nao e uma url', '', null
  ]) assert.equal(cloudinaryImageUrl(url, 480), url)
})

test('srcset só existe quando a foto pode ser redimensionada', () => {
  assert.equal(cloudinarySrcSet(upload, [320, 640]), 'https://res.cloudinary.com/galeo/image/upload/f_auto,q_auto,c_limit,w_320/v1730000000/produtos/camisa-azul.jpg 320w, https://res.cloudinary.com/galeo/image/upload/f_auto,q_auto,c_limit,w_640/v1730000000/produtos/camisa-azul.jpg 640w')
  assert.equal(cloudinarySrcSet('/images/galeo-brand.webp', [320, 640]), undefined)
  assert.equal(cloudinarySrcSet('https://res.cloudinary.com/galeo/image/upload/e_background_removal/v1/a.png', [320]), undefined)
})
