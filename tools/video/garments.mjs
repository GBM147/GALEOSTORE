import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Demo product pictures for the videos: flat garment illustrations with the
// GALEO medallion, on a soft studio background. They exist only in the videos
// (the store's real photos come from the Admin).
const logoPath = fileURLToPath(new URL('../../public/images/galeo-logo-128.webp', import.meta.url))
const logo = 'data:image/webp;base64,' + readFileSync(logoPath).toString('base64')

const W = 800, H = 1000

function frame(body, { bg = ['#efe9df', '#d9d0c2'], shadow = 0.18 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
    <linearGradient id="light" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
    <linearGradient id="fall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="400" cy="905" rx="270" ry="34" fill="#000" opacity="${shadow}" filter="url(#soft)"/>
  ${body}
</svg>`
}

const shade = path => `<path d="${path}" fill="url(#light)"/><path d="${path}" fill="url(#fall)"/>`
const print = (x, y, size) => `<image href="${logo}" xlink:href="${logo}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}"/>`

const TEE = 'M318 190 C350 238 450 238 482 190 L585 214 L712 338 L650 446 L586 400 L590 868 Q400 892 210 868 L214 400 L150 446 L88 338 L215 214 Z'
const TANK = 'M300 170 C330 300 470 300 500 170 L548 180 C540 290 560 360 600 410 L604 868 Q400 892 196 868 L200 410 C240 360 260 290 252 180 Z'
const HOODIE_BODY = 'M300 205 L232 222 L124 330 L80 780 L160 800 L214 440 L212 870 Q400 896 588 870 L586 440 L640 800 L720 780 L676 330 L568 222 L500 205 Z'
const HOOD = 'M290 214 C280 120 340 82 400 82 C460 82 520 120 510 214 C480 262 320 262 290 214 Z'

export function tee(color, { printSize = 210, chest = false, collar } = {}) {
  const collarColor = collar || 'rgba(0,0,0,.25)'
  return frame(`<path d="${TEE}" fill="${color}"/>${shade(TEE)}
    <path d="M318 190 C350 238 450 238 482 190" fill="none" stroke="${collarColor}" stroke-width="16" stroke-linecap="round"/>
    <path d="M215 214 L214 400 M585 214 L586 400" stroke="#000" stroke-opacity=".12" stroke-width="3"/>
    ${chest ? print(500, 330, 86) : print(400, 470, printSize)}`)
}

export function tank(color) {
  return frame(`<path d="${TANK}" fill="${color}"/>${shade(TANK)}
    <path d="M300 170 C330 300 470 300 500 170" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="12"/>
    ${print(400, 500, 190)}`)
}

export function hoodie(color) {
  return frame(`<path d="${HOOD}" fill="${color}"/><path d="${HOOD}" fill="#000" opacity=".22"/>
    <path d="${HOODIE_BODY}" fill="${color}"/>${shade(HOODIE_BODY)}
    <path d="M320 230 C360 270 440 270 480 230" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="10"/>
    <path d="M372 262 L366 420 M428 262 L434 420" stroke="#e9e1d2" stroke-width="6" stroke-linecap="round"/>
    <path d="M290 640 L510 640 L540 780 L260 780 Z" fill="#000" opacity=".16"/>
    <path d="M80 780 L160 800 M720 780 L640 800" stroke="#000" stroke-opacity=".3" stroke-width="22"/>
    ${print(400, 470, 170)}`)
}

export function cap(color, brim) {
  // Side view: the dome and the bill pointing right, as a baseball cap reads best.
  const crown = 'M190 610 C186 390 320 300 440 300 C556 300 612 400 612 610 Z'
  const bill = 'M590 578 C668 552 748 566 790 612 C730 640 650 642 588 626 Z'
  return frame(`<path d="${crown}" fill="${color}"/><path d="${crown}" fill="url(#light)"/>
    <path d="M440 300 C400 380 380 500 384 610 M440 300 C520 360 560 480 566 610 M440 300 C330 360 260 480 250 610" stroke="#000" stroke-opacity=".2" stroke-width="4" fill="none"/>
    <path d="M190 610 C300 628 500 628 612 610" stroke="#000" stroke-opacity=".3" stroke-width="10" fill="none"/>
    <circle cx="440" cy="302" r="15" fill="${color}" stroke="#000" stroke-opacity=".3" stroke-width="4"/>
    <path d="${bill}" fill="${brim || color}"/><path d="${bill}" fill="#000" opacity=".22"/>
    <path d="M206 560 C230 590 262 600 300 598" stroke="#c9a462" stroke-opacity=".6" stroke-width="5" fill="none"/>
    ${print(496, 470, 150)}`, { shadow: 0.14 })
}

function trousers(color, { length = 870, cargo = false } = {}) {
  const legs = `M250 190 L550 190 L566 240 L600 ${length} L432 ${length} L404 420 L396 420 L368 ${length} L200 ${length} L234 240 Z`
  return frame(`<path d="${legs}" fill="${color}"/>${shade(legs)}
    <path d="M250 190 L550 190 L556 240 L244 240 Z" fill="#000" opacity=".16"/>
    <path d="M260 250 C300 300 330 300 352 262 M540 250 C500 300 470 300 448 262" fill="none" stroke="#c9a462" stroke-opacity=".7" stroke-width="4" stroke-dasharray="10 7"/>
    <path d="M400 240 L400 420" stroke="#000" stroke-opacity=".22" stroke-width="4"/>
    <circle cx="400" cy="215" r="9" fill="#c9a462"/>
    ${cargo ? `<rect x="214" y="${length - 330}" width="96" height="120" rx="8" fill="#000" opacity=".14"/><rect x="490" y="${length - 330}" width="96" height="120" rx="8" fill="#000" opacity=".14"/>` : ''}
    ${print(510, 300, 64)}`)
}

export const jeans = color => trousers(color)
export const shorts = color => trousers(color, { length: 610, cargo: true })

// Wide campaign picture (1600×900): the products together on the studio floor.
export function campaign() {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1600 900" width="1600" height="900">
  <defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b140c"/><stop offset="1" stop-color="#050505"/></linearGradient>
  <radialGradient id="glow" cx="70%" cy="40%" r="50%"><stop offset="0" stop-color="#e2c27f" stop-opacity=".35"/><stop offset="1" stop-color="#e2c27f" stop-opacity="0"/></radialGradient></defs>
  <rect width="1600" height="900" fill="url(#c)"/><rect width="1600" height="900" fill="url(#glow)"/>
  ${print(1120, 420, 520)}
</svg>`
}
