import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAMPAIGN_DEFAULTS, campaignSlides, campaignTransitionSeconds, resolveCampaignAnimation } from './campaign-model.js'

test('campaigns use the GALEO defaults unless the owner explicitly chooses individual settings', () => {
  const shared = { effect:'pan-horizontal', transition:'slide', speed:'normal', duration_seconds:9 }
  assert.deepEqual(resolveCampaignAnimation({ animation:{ effect:'static', transition:'fade', use_default:true } }, shared), { ...shared, use_default:true })
  assert.deepEqual(resolveCampaignAnimation({ animation:{ effect:'static', transition:'fade', use_default:false } }, shared), { ...shared, effect:'static', transition:'fade', use_default:false })
  assert.deepEqual(resolveCampaignAnimation({}, {}, { effect:'parallax' }), { ...CAMPAIGN_DEFAULTS, effect:'parallax', use_default:true })
})

test('invalid motion settings fall back safely and duration remains bounded', () => {
  assert.deepEqual(resolveCampaignAnimation({}, { effect:'invalid', transition:'bounce', speed:'invalid', duration_seconds:'bad' }), { ...CAMPAIGN_DEFAULTS, use_default:true })
  assert.equal(resolveCampaignAnimation({ animation:{ use_default:false, duration_seconds:99 } }).duration_seconds, 30)
  assert.equal(resolveCampaignAnimation({ animation:{ use_default:false, duration_seconds:-1 } }).duration_seconds, 2)
  assert.equal(resolveCampaignAnimation({}, { duration_seconds:'' }).duration_seconds, 6)
  assert.equal(campaignTransitionSeconds('fast'), 0.4)
})

test('existing single-media campaigns retain their desktop and mobile media', () => {
  const item = { title:'Campanha antiga', media_url:'https://example.test/photo.jpg', mobile_media_url:'https://example.test/mobile.webp' }
  assert.equal(campaignSlides(item).length, 1)
  assert.deepEqual(campaignSlides(item)[0], { ...item, desktop_url:item.media_url, desktop_type:'image', mobile_url:item.mobile_media_url, mobile_type:'image' })
  assert.equal(campaignSlides({})[0].desktop_url, '')
  assert.equal(campaignSlides(null)[0].desktop_url, '')
  assert.equal(campaignSlides({ media_url:{} })[0].desktop_url, '')
})

test('slide lists filter empty entries, cap total media, and preserve explicit image/video selection', () => {
  const slides = [{}, null, false, [], ...Array.from({ length:20 }, (_, index) => ({ media_url:'https://example.test/asset/' + index, media_type:index === 0 ? 'video' : 'image' }))]
  const result = campaignSlides({ slides })
  assert.equal(result.length, 12)
  assert.equal(result[0].desktop_type, 'video')
  assert.equal(result[1].desktop_type, 'image')
  assert.equal(campaignSlides({ slides:[{}], media_url:'https://example.test/fallback.jpg' })[0].desktop_url, 'https://example.test/fallback.jpg')
})

test('mobile videos and legacy video URL fields select the correct responsive media', () => {
  assert.equal(campaignSlides({ video_media_url:'https://example.test/film', mobile_media_url:'https://example.test/mobile.jpg' })[0].desktop_type, 'video')
  assert.equal(campaignSlides({ media_url:'https://res.cloudinary.com/test/video/upload/v1/campaign', mobile_media_url:'https://example.test/mobile.webm?x=1' })[0].mobile_type, 'video')
  const mobileOnly = campaignSlides({ mobile_media_url:'https://example.test/video', mobile_media_type:'video' })[0]
  assert.equal(mobileOnly.desktop_type, 'video')
  assert.equal(mobileOnly.desktop_url, mobileOnly.mobile_url)
})
