export const CAMPAIGN_DEFAULTS = Object.freeze({ effect:'zoom', transition:'crossfade', speed:'slow', duration_seconds:6 })
export const CAMPAIGN_EFFECTS = ['static','zoom','pan-horizontal','pan-vertical','parallax','ken-burns']
export const CAMPAIGN_TRANSITIONS = ['fade','slide','crossfade']
export const CAMPAIGN_SPEEDS = ['slow','normal','fast']
export const MAX_CAMPAIGN_SLIDES = 12

const bounded = (value, fallback, min, max) => {
  const number = Number(value)
  return value !== '' && value != null && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}
const member = (value, choices, fallback) => choices.includes(value) ? value : fallback
export const isCampaignVideo = (url) => /\.(mp4|webm|mov)(?:[?#]|$)|\/video\/upload\//i.test(String(url || ''))

export function resolveCampaignAnimation(item = {}, defaults = {}, sectionDefaults = {}) {
  item = item && typeof item === 'object' ? item : {}
  const shared = { ...CAMPAIGN_DEFAULTS, ...sectionDefaults, ...defaults }
  const individual = item.animation?.use_default === false ? item.animation : {}
  const value = { ...shared, ...individual }
  return {
    use_default:item.animation?.use_default !== false,
    effect:member(value.effect, CAMPAIGN_EFFECTS, CAMPAIGN_DEFAULTS.effect),
    transition:member(value.transition, CAMPAIGN_TRANSITIONS, CAMPAIGN_DEFAULTS.transition),
    speed:member(value.speed, CAMPAIGN_SPEEDS, CAMPAIGN_DEFAULTS.speed),
    duration_seconds:bounded(value.duration_seconds, CAMPAIGN_DEFAULTS.duration_seconds, 2, 30)
  }
}

export function campaignSlides(item = {}) {
  item = item && typeof item === 'object' ? item : {}
  const mediaUrl = (value) => typeof value === 'string' ? value.trim() : ''
  const slides = Array.isArray(item.slides)
    ? item.slides.filter((slide) => slide && typeof slide === 'object' && !Array.isArray(slide)
      && (mediaUrl(slide.media_url) || mediaUrl(slide.video_media_url) || mediaUrl(slide.mobile_media_url) || mediaUrl(slide.mobile_video_media_url))).slice(0, MAX_CAMPAIGN_SLIDES)
    : []
  return (slides.length ? slides : [item]).map((slide) => {
    const desktop = mediaUrl(slide.video_media_url) || mediaUrl(slide.media_url)
    const mobile = mediaUrl(slide.mobile_video_media_url) || mediaUrl(slide.mobile_media_url)
    return {
      ...slide,
      desktop_url:desktop || mobile,
      desktop_type:slide.video_media_url || (!desktop && slide.mobile_media_type === 'video') || slide.media_type === 'video' || isCampaignVideo(desktop || mobile) ? 'video' : 'image',
      mobile_url:mobile,
      mobile_type:slide.mobile_video_media_url || slide.mobile_media_type === 'video' || isCampaignVideo(mobile) ? 'video' : 'image'
    }
  })
}

export function campaignTransitionSeconds(speed) {
  return { slow:0.9, normal:0.65, fast:0.4 }[speed] || 0.9
}
