import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { overlaySource } from './overlay.mjs'
import { images } from './demo-store.mjs'

// Records a scripted visit to the local store with captions, cursor and a
// Brazilian synthetic voice (espeak-ng + MBROLA br4), then assembles the MP4,
// the .srt subtitles and the chapter marks with ffmpeg.
const { chromium } = createRequire(import.meta.url)('playwright')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function wavDuration(file) {
  const data = readFileSync(file)
  const rate = data.readUInt32LE(24), byteRate = data.readUInt32LE(28)
  let offset = 12
  while (offset < data.length - 8) {
    const id = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4)
    if (id === 'data') return Math.min(size, data.length - offset - 8) / byteRate
    offset += 8 + size
  }
  return (data.length - 44) / (byteRate || rate * 2)
}

// Words the synthetic voice reads better when spelled out.
function spoken(text) {
  return text
    .replace(/R\$\s?(\d+),(\d{2})/g, (_, reais, cents) => `${reais} reais${cents === '00' ? '' : ' e ' + Number(cents) + ' centavos'}`)
    .replace(/\bPix\b/g, 'Píx').replace(/\bCEP\b/g, 'cép').replace(/\bWhatsApp\b/g, 'uótsápi').replace(/\bAdmin\b/g, 'Ádmin')
    .replace(/\bGALEO\b/g, 'Galêo').replace(/\bCNPJ\b/g, 'cê ene pê jota').replace(/\bPDV\b/g, 'pê dê vê').replace(/\bLGPD\b/g, 'éle gê pê dê')
    .replace(/\bOK\b/g, 'ô quêi').replace(/\be-mail\b/gi, 'imêil').replace(/\bsite\b/g, 'sáite').replace(/\bmouse\b/g, 'máuse')
    .replace(/[“”"]/g, '').replace(/\s+—\s+/g, ', ')
}

// width × height is the video size; scale zooms the page (a 1440×810 page at
// scale 4/3 fills 1920×1080 with sharp, larger text).
export async function createRecorder({ name, out, baseUrl = 'http://127.0.0.1:5173', width = 1920, height = 1080, scale = 1, mobile = false, api, voice = true, captionFont = 28, captionBottom = 42, webgl = false }) {
  const view = { width: Math.round(width / scale), height: Math.round(height / scale) }
  const dir = join(out, name)
  rmSync(join(dir, 'frames'), { recursive: true, force: true })
  mkdirSync(join(dir, 'frames'), { recursive: true })
  mkdirSync(join(out, 'tts'), { recursive: true })
  // Default software compositing; the SwiftShader WebGL flags make every frame slow.
  const browser = await chromium.launch({ args: ['--no-sandbox', '--hide-scrollbars'] })
  const context = await browser.newContext({ viewport: view, deviceScaleFactor: scale, reducedMotion: 'no-preference', ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  await context.addInitScript(overlaySource)
  // This machine draws WebGL in software, which would slow every frame of the
  // recording: the Home keeps the 3D image (the promo renders the 3D itself).
  if (!webgl) await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : getContext.call(this, type, ...rest) }
  })
  await context.addInitScript(() => { try { localStorage.setItem('galeo-lite', '0') } catch {} })
  await context.route('**/video-demo/*.svg', route => {
    const key = new URL(route.request().url()).pathname.split('/').pop().replace('.svg', '')
    return route.fulfill({ contentType: 'image/svg+xml', body: images[key] || images['101'] })
  })
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    let body = null
    try { body = request.postDataJSON() } catch {}
    const result = await api.handle({ path: url.pathname, method: request.method(), body, query: url.searchParams })
    return route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result.data ?? {}) })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => console.log('[erro na página]', error.message))
  page.on('dialog', dialog => dialog.accept())

  const frames = [], events = [], chapters = []
  let cursor = { x: view.width * 0.6, y: view.height * 0.55 }, frameIndex = 0
  const cdp = await context.newCDPSession(page)
  // Frames come from a screenshot loop (CDP screencast slows down in headless
  // Chromium when the page is mostly still); each frame keeps its own time.
  let capturing = false, loop = null
  async function captureLoop() {
    while (capturing) {
      const time = Date.now() / 1000
      try {
        // A capture during a navigation can hang: give up after 2 s and go on.
        const { data } = await Promise.race([cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, optimizeForSpeed: true }), sleep(2000).then(() => { throw new Error('timeout') })])
        const file = join(dir, 'frames', String(frameIndex++).padStart(6, '0') + '.jpg')
        writeFileSync(file, Buffer.from(data, 'base64'))
        frames.push({ file, time })
      } catch { await sleep(30) }
    }
  }
  // Wall-clock seconds; converted to video time (first frame = 0) at the end.
  const now = () => Date.now() / 1000

  async function overlay(fn, ...args) {
    try { return await page.evaluate(([fn, args]) => window.__tour?.[fn]?.(...args), [fn, args]) } catch { return null }
  }
  async function restoreCursor() { await overlay('set', cursor.x, cursor.y) }

  function tts(text) {
    const file = join(out, 'tts', createHash('sha1').update('br4|' + text).digest('hex').slice(0, 16) + '.wav')
    if (!existsSync(file)) execFileSync('espeak-ng', ['-v', 'mb-br4', '-s', '148', '-p', '48', '-w', file, spoken(text)], { stdio: ['ignore', 'ignore', 'ignore'] })
    return { file, duration: wavDuration(file) }
  }

  const rec = {
    page, context, api,
    async start(url) {
      await page.goto(baseUrl + url, { waitUntil: 'networkidle' })
      await overlay('caption', '', { font: captionFont, bottom: captionBottom })
      await restoreCursor()
      capturing = true
      loop = captureLoop()
      await sleep(600)
    },
    async goto(url, { wait = 'load' } = {}) {
      await page.goto(baseUrl + url, { waitUntil: wait })
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
      await overlay('caption', '', { font: captionFont, bottom: captionBottom })
      await restoreCursor()
    },
    // Narration: caption on screen and the voice; waits until it ends unless
    // { wait: false }, which returns a promise to await later.
    async say(text, { wait = true, hold = 350 } = {}) {
      await overlay('caption', text, { font: captionFont, bottom: captionBottom })
      const start = now()
      let duration = Math.max(2.2, text.split(/\s+/).length * 0.36)
      if (voice) {
        const audio = tts(text)
        duration = audio.duration
        events.push({ start, end: start + duration, text, audio: audio.file })
      } else events.push({ start, end: start + duration, text })
      const done = sleep(duration * 1000 + hold)
      return wait ? done : done.then(() => {})
    },
    async hideCaption() { await overlay('caption', '') },
    async chapter(kicker, title, text, ms = 3200) {
      chapters.push({ start: now(), title })
      await overlay('caption', '')
      await overlay('chapter', kicker, title, text)
      await sleep(ms)
      await overlay('chapter', '', '')
      await sleep(500)
    },
    async pause(ms) { await sleep(ms) },
    async box(target) {
      const locator = typeof target === 'string' ? page.locator(target).first() : target
      await locator.scrollIntoViewIfNeeded().catch(() => {})
      return locator.boundingBox()
    },
    async point(target, { ms = 800, ring = true } = {}) {
      const box = await rec.box(target)
      if (!box) return null
      cursor = { x: box.x + Math.min(box.width / 2, 160), y: box.y + box.height / 2 }
      if (ring) await overlay('ring', box)
      await overlay('move', cursor.x, cursor.y, ms)
      await sleep(ms + 80)
      return box
    },
    async unring() { await overlay('ring', null) },
    async click(target, options = {}) {
      const box = await rec.point(target, options)
      if (!box) throw new Error('Elemento não encontrado para clicar')
      await overlay('ripple')
      await sleep(180)
      await overlay('ring', null)
      await page.mouse.click(cursor.x, cursor.y)
      await sleep(options.after ?? 700)
      await restoreCursor()
    },
    async type(target, text, { delay = 55 } = {}) {
      await rec.click(target, { after: 200 })
      await page.keyboard.type(text, { delay })
      await sleep(300)
    },
    async scrollTo(y, ms = 1400) {
      await page.evaluate(([y, ms]) => new Promise(resolve => {
        const from = scrollY, start = performance.now(), ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        const step = now => { const t = Math.min(1, (now - start) / ms); scrollTo(0, from + (y - from) * ease(t)); t < 1 ? requestAnimationFrame(step) : resolve() }
        requestAnimationFrame(step)
      }), [y, ms])
      await sleep(250)
    },
    async scrollToElement(target, offset = 120, ms = 1300) {
      const y = await (typeof target === 'string' ? page.locator(target).first() : target).evaluate((el, offset) => el.getBoundingClientRect().top + scrollY - offset, offset)
      await rec.scrollTo(Math.max(0, y), ms)
    },
    // Writes <name>.mp4 (+ .srt, chapters) and returns the paths.
    async finish({ crf = 24, tail = 1.2 } = {}) {
      await overlay('caption', '')
      await sleep(tail * 1000)
      capturing = false
      await loop
      await browser.close()
      const list = frames.map((frame, index) => {
        const next = frames[index + 1]
        const duration = next ? Math.max(0.001, next.time - frame.time) : 1
        return `file '${frame.file}'\nduration ${duration.toFixed(4)}`
      }).join('\n') + `\nfile '${frames.at(-1).file}'\n`
      writeFileSync(join(dir, 'frames.txt'), list)
      const video = join(dir, 'video.mp4')
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'), '-vf', `fps=30,scale=${width}:${height}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-tune', 'stillimage', video])
      const base = frames[0].time
      for (const item of [...events, ...chapters]) { item.start -= base; if (item.end !== undefined) item.end -= base }
      const total = frames.at(-1).time - base + 1
      const voiced = events.filter(event => event.audio)
      const outputs = { srt: join(out, name + '.srt'), mp4: join(out, name + '.mp4') }
      const srtTime = s => { const ms = Math.max(0, Math.round(s * 1000)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` }
      writeFileSync(outputs.srt, events.map((event, index) => `${index + 1}\n${srtTime(event.start)} --> ${srtTime(event.end)}\n${event.text}\n`).join('\n'))
      const meta = [';FFMETADATA1', ...chapters.map((chapter, index) => {
        const end = chapters[index + 1]?.start ?? total
        return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.start * 1000)}\nEND=${Math.round(end * 1000)}\ntitle=${chapter.title}`
      })].join('\n')
      writeFileSync(join(dir, 'chapters.txt'), meta + '\n')
      if (voiced.length) {
        writeFileSync(join(dir, 'voice.json'), JSON.stringify({ total, events: voiced.map(event => ({ start: event.start, file: event.audio })) }))
        execFileSync('python3', ['-I', new URL('./mix.py', import.meta.url).pathname, join(dir, 'voice.json'), join(dir, 'voice.wav')])
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', join(dir, 'voice.wav'), '-i', join(dir, 'chapters.txt'), '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2', '-c:v', 'copy', '-af', 'highpass=f=90,loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', outputs.mp4])
      } else {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', join(dir, 'chapters.txt'), '-map', '0:v', '-map_metadata', '1', '-map_chapters', '1', '-c:v', 'copy', '-movflags', '+faststart', outputs.mp4])
      }
      return { ...outputs, chapters, total }
    }
  }
  return rec
}
