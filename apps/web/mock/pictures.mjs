// Sample pictures for the mock API (server.mjs): stand-ins for what a real
// library holds, so the file cards and the viewer can be judged with
// real-looking pictures. Landscape photos, desktop and phone screenshots,
// stickers on see-through backgrounds and animated gifs are SVGs drawn from a
// seed, so an asset looks the same on every request and every restart.
// Recordings are short clips made with ffmpeg, if it is installed.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function rng(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n1 = (n) => Math.round(n * 10) / 10
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
const SANS = `font-family="Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"`
const MONO = `font-family="'JetBrains Mono', Consolas, Menlo, 'DejaVu Sans Mono', monospace"`
const NAMES = ['sam', 'alex', 'jo', 'robin', 'kit', 'noor', 'mika']
const INK = '#2a1a3e'

function wrap(text, max) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

// --- Photos ----------------------------------------------------------------

export const SKIES = [
  { title: 'lake at dawn', sky: ['#22305a', '#b25f8c', '#f7b46c'], sun: '#ffe2a6', hills: ['#9a6a8e', '#673f66', '#341f3d'], water: true },
  { title: 'ridge walk', sky: ['#2c6bd0', '#78b1ea', '#d4ebfb'], sun: '#fffbe0', hills: ['#97b5cc', '#5b8a6a', '#2c5636'], clouds: true, trees: true },
  { title: 'dusk on the water', sky: ['#19214a', '#6e2a58', '#ff9058'], sun: '#ffd47e', hills: ['#6a3858', '#412344', '#21132a'], water: true },
  { title: 'night sky', sky: ['#060a1c', '#121e4e', '#28387a'], sun: '#f3f0da', hills: ['#222b54', '#151c3c', '#0a0f25'], stars: true, moon: true, trees: true },
  { title: 'first snow', sky: ['#6b8ec8', '#b6cce8', '#eff4fb'], sun: '#ffffff', hills: ['#c3d2e8', '#93aacd', '#e6edf7'], clouds: true },
]

// A mountain ridge by midpoint displacement: points across the width.
function ridge(r, w, base, amp, rough = 0.55) {
  const n = 64
  const ys = new Array(n + 1).fill(0)
  ys[0] = (r() - 0.5) * amp
  ys[n] = (r() - 0.5) * amp
  let disp = amp
  for (let step = n; step > 1; step /= 2) {
    for (let i = step / 2; i < n; i += step) ys[i] = (ys[i - step / 2] + ys[i + step / 2]) / 2 + (r() - 0.5) * disp
    disp *= rough
  }
  return ys.map((y, i) => [(i / n) * w, base + y])
}
const below = (pts, h) => `M0 ${h}` + pts.map(([x, y]) => `L${n1(x)} ${n1(y)}`).join('') + `L${n1(pts.at(-1)[0])} ${h}Z`

/** A landscape photo's markup, w by h. `id` keeps gradient ids apart when several share one picture. */
function photoBody(seed, w, h, id = `p${seed}`) {
  const r = rng(seed * 7 + 1)
  const s = SKIES[seed % SKIES.length]
  const horizon = h * (0.55 + r() * 0.1)
  const sx = w * (0.2 + r() * 0.6)
  const sy = horizon - h * (0.14 + r() * 0.2)
  const sr = Math.min(w, h) * (s.moon ? 0.045 : 0.06)
  let b = `<defs>
<linearGradient id="${id}s" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${n1(horizon)}"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset=".6" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[2]}"/></linearGradient>
<radialGradient id="${id}g"><stop offset="0" stop-color="${s.sun}" stop-opacity=".7"/><stop offset="1" stop-color="${s.sun}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[2]}"/><stop offset="1" stop-color="${s.sky[0]}"/></linearGradient>
<radialGradient id="${id}v" r=".75"><stop offset=".55" stop-opacity="0"/><stop offset="1" stop-opacity=".4"/></radialGradient>
</defs><rect width="${w}" height="${h}" fill="url(#${id}s)"/>`
  if (s.stars) for (let i = 0; i < 170; i++) b += `<circle cx="${n1(r() * w)}" cy="${n1(r() * horizon)}" r="${n1((0.6 + r() * 1.5) * Math.max(1, w / 1400))}" fill="#fff" opacity="${n1(0.3 + r() * 0.7)}"/>`
  b += `<circle cx="${n1(sx)}" cy="${n1(sy)}" r="${n1(sr * 7)}" fill="url(#${id}g)"/><circle cx="${n1(sx)}" cy="${n1(sy)}" r="${n1(sr)}" fill="${s.sun}"/>`
  if (s.moon) for (const [dx, dy, k] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.3], [0.1, -0.45, 0.14]]) b += `<circle cx="${n1(sx + dx * sr)}" cy="${n1(sy + dy * sr)}" r="${n1(k * sr)}" fill="#000" opacity=".08"/>`
  if (s.clouds)
    for (let c = 0; c < 4; c++) {
      const cx = r() * w
      const cy = h * (0.08 + r() * 0.3)
      const cw = w * (0.08 + r() * 0.1)
      b += `<g fill="#fff" opacity="${n1(0.55 + r() * 0.35)}">`
      for (let k = 0; k < 5; k++) b += `<ellipse cx="${n1(cx + (k - 2) * cw * 0.3)}" cy="${n1(cy - Math.sin((k / 4) * Math.PI) * cw * 0.16)}" rx="${n1(cw * (0.22 + r() * 0.1))}" ry="${n1(cw * (0.12 + r() * 0.06))}"/>`
      b += '</g>'
    }
  let near = []
  for (const [k, base, amp] of [[0, -0.1, 0.32], [1, -0.02, 0.18], [2, 0.05, 0.1]]) {
    near = ridge(r, w, horizon + base * h, amp * h)
    b += `<path d="${below(near, h)}" fill="${s.hills[k]}"/>`
  }
  if (s.trees) {
    for (let x = 0; x < w; x += w * (0.004 + r() * 0.02)) {
      const at = (x / w) * 64
      const i = Math.min(63, Math.floor(at))
      const y = near[i][1] + (near[i + 1][1] - near[i][1]) * (at - i)
      const th = h * (0.03 + r() * 0.05)
      b += `<path d="M${n1(x)} ${n1(y - th)}L${n1(x + th * 0.36)} ${n1(y + 3)}H${n1(x - th * 0.36)}Z" fill="${s.hills[2]}"/>`
    }
  }
  if (s.water) {
    const top = horizon + h * 0.08
    b += `<rect y="${n1(top)}" width="${w}" height="${n1(h - top)}" fill="url(#${id}w)"/>`
    for (let k = 0; k < 16; k++) {
      const lw = sr * (0.6 + r() * 1.8) * (1 + k * 0.1)
      b += `<rect x="${n1(sx - lw / 2)}" y="${n1(top + (h - top) * (k / 16) + r() * 6)}" width="${n1(lw)}" height="${n1(Math.max(2, h / 300))}" fill="${s.sun}" opacity="${n1(0.25 + r() * 0.4)}"/>`
    }
    for (let k = 0; k < 30; k++) b += `<rect x="${n1(r() * w)}" y="${n1(top + r() * (h - top))}" width="${n1(w * (0.02 + r() * 0.06))}" height="${n1(Math.max(1.5, h / 500))}" fill="#fff" opacity=".12"/>`
  }
  return b + `<rect width="${w}" height="${h}" fill="url(#${id}v)"/>`
}

export const photo = (seed, w, h) => svg(w, h, photoBody(seed, w, h))

// --- Desktop screenshots ----------------------------------------------------

const WALLS = [['#3a1c71', '#d76d77', '#ffaf7b'], ['#0f2027', '#2c5364', '#4ca1af'], ['#1a3890', '#5450cc', '#f48fb1'], ['#134e5e', '#71b280', '#d3f3b0']]
const HEADINGS = ['Weekend in the mountains', 'Trip notes: the lake loop', 'Five things I learned this week', 'Moving day, in pictures']
const MONTHS = ['Jan', 'Mar', 'May', 'Aug', 'Oct', 'Nov']
const PROSE = [
  'We left before sunrise and reached the ridge just as the light came over the far peaks.',
  'The trail was quiet, the lake was still, and the only sound was the wind in the pines.',
  'By noon the clouds rolled in, so we found a dry rock, ate far too many snacks and waited it out.',
  'Notes for next time: bring a warmer jacket, a second battery, and leave the big lens at home.',
  'The photos below are straight out of the camera, no edits, just cropped a little.',
  'Getting down took twice as long as going up, mostly because we kept stopping to take pictures.',
]

/** A browser window with a blog post open, over a wallpaper, with a dock. */
export function desktop(seed, w = 1920, h = 1080) {
  const r = rng(seed * 13 + 5)
  const dark = seed % 3 === 2
  const ui = dark
    ? { chrome: '#2b2d31', page: '#1e1f22', ink: '#f2f3f5', dim: '#9a9ca3', line: '#3a3c42', field: '#1a1b1e' }
    : { chrome: '#e8e8ed', page: '#ffffff', ink: '#1d1d1f', dim: '#6e6e73', line: '#d6d6db', field: '#ffffff' }
  const wall = WALLS[seed % WALLS.length]
  const id = `d${seed}`
  const [X, Y, W, H] = [70, 40, w - 140, h - 130]
  const title = HEADINGS[seed % HEADINGS.length]
  let b = `<defs><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wall[0]}"/><stop offset=".55" stop-color="${wall[1]}"/><stop offset="1" stop-color="${wall[2]}"/></linearGradient>
<filter id="${id}f" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-opacity=".35"/></filter>
<clipPath id="${id}c"><rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="14"/></clipPath></defs>
<rect width="${w}" height="${h}" fill="url(#${id}b)"/>
<rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="14" fill="${ui.page}" filter="url(#${id}f)"/><g clip-path="url(#${id}c)">`
  b += `<rect x="${X}" y="${Y}" width="${W}" height="92" fill="${ui.chrome}"/><rect x="${X}" y="${Y + 92}" width="${W}" height="1" fill="${ui.line}"/>`
  ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => (b += `<circle cx="${X + 28 + i * 26}" cy="${Y + 26}" r="7.5" fill="${c}"/>`))
  b += `<rect x="${X + 120}" y="${Y + 8}" width="320" height="38" rx="9" fill="${ui.page}"/><text x="${X + 140}" y="${Y + 33}" font-size="17" fill="${ui.ink}" ${SANS}>${esc(title)}</text>`
  b += `<rect x="${X + 120}" y="${Y + 52}" width="${W - 240}" height="32" rx="16" fill="${ui.field}" stroke="${ui.line}"/>`
  b += `<text x="${X + 144}" y="${Y + 74}" font-size="16" fill="${ui.dim}" ${SANS}>notes.example.com/${esc(title.toLowerCase().replace(/[^a-z]+/g, '-'))}</text>`
  const col = X + Math.round(W * 0.2)
  const colW = Math.round(W * 0.6)
  let y = Y + 92 + 86
  b += `<text x="${col}" y="${y}" font-size="46" font-weight="700" fill="${ui.ink}" ${SANS}>${esc(title)}</text>`
  y += 42
  b += `<text x="${col}" y="${y}" font-size="18" fill="${ui.dim}" ${SANS}>${pick(r, NAMES)} · ${1 + Math.floor(r() * 28)} ${pick(r, MONTHS)} 2026 · ${3 + Math.floor(r() * 9)} min read</text>`
  y += 52
  const para = (text) => {
    for (const line of wrap(text, Math.floor(colW / 10.6))) {
      b += `<text x="${col}" y="${y}" font-size="21" fill="${ui.ink}" ${SANS}>${esc(line)}</text>`
      y += 34
    }
    y += 16
  }
  para(`${pick(r, PROSE)} ${pick(r, PROSE)}`)
  const gap = 18
  const pw = (colW - gap * 2) / 3
  const ph = pw * 0.7
  for (let k = 0; k < 3; k++) b += `<svg x="${n1(col + k * (pw + gap))}" y="${y}" width="${n1(pw)}" height="${n1(ph)}" viewBox="0 0 400 280" preserveAspectRatio="xMidYMid slice">${photoBody(seed * 3 + k, 400, 280, `${id}p${k}`)}</svg>`
  y += ph + 50
  while (y < Y + H) para(`${pick(r, PROSE)} ${pick(r, PROSE)}`)
  b += '</g>'
  const dock = 8 * 62 + 20
  b += `<rect x="${(w - dock) / 2}" y="${h - 80}" width="${dock}" height="68" rx="18" fill="#fff" opacity=".28"/>`
  for (let k = 0; k < 8; k++) b += `<rect x="${(w - dock) / 2 + 16 + k * 62}" y="${h - 70}" width="48" height="48" rx="12" fill="${['#2f6fe4', '#ff5f57', '#28c840', '#febc2e', '#bf5af2', '#5fe0d6', '#ff9f0a', '#1d1d1f'][k]}"/>`
  return svg(w, h, b)
}

// --- Code editor screenshots -------------------------------------------------

const CODE = `// Arrow keys move focus to the nearest thing in that direction.
export function move(dir: Dir): boolean {
  const scope = navScope()
  const from = document.activeElement
  if (!(from instanceof HTMLElement) || !scope.contains(from)) {
    const start = startOf(scope)
    if (start) focusEl(start)
    return Boolean(start)
  }
  const rect = from.getBoundingClientRect()
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of candidates(scope)) {
    if (el === from) continue
    const s = score(rect, el.getBoundingClientRect(), dir)
    if (s !== null && s < bestScore) {
      best = el
      bestScore = s
    }
  }
  if (best) focusEl(best)
  return best !== null
}

// How far a box is in a direction; null if it is not that way at all.
function score(from: DOMRect, to: DOMRect, dir: Dir): number | null {
  const slack = 4
  const along = dir === 'right' ? to.left - from.right : from.left - to.right
  if (along < -slack) return null
  const gap = Math.max(0, from.top - to.bottom, to.top - from.bottom)
  const offset = Math.abs(to.top + to.height / 2 - (from.top + from.height / 2))
  return Math.max(0, along) + gap * 4 + offset * 0.15
}

export function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}`.split('\n')

const KEYWORDS = new Set('const let function return export import from if else for of in continue break new null true false type interface async await while'.split(' '))
const SYNTAX = { com: '#6c7086', str: '#a6e3a1', num: '#fab387', kw: '#cba6f7', type: '#f9e2af', fn: '#89b4fa', id: '#cdd6f4', punct: '#9399b2' }
function tokens(line) {
  const out = []
  const re = /(\/\/.*$)|('[^']*'|"[^"]*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d'"]+)/g
  for (let m; (m = re.exec(line)); ) {
    const [t, com, str, num, word, space] = m
    const next = line.slice(re.lastIndex).trimStart()[0]
    const kind = com ? 'com' : str ? 'str' : num ? 'num' : word ? (KEYWORDS.has(word) ? 'kw' : /^[A-Z]/.test(word) ? 'type' : next === '(' ? 'fn' : 'id') : space ? 'id' : 'punct'
    out.push([t, kind])
  }
  return out
}

/** A dark code editor with a file open, scrolled a little differently each time. */
export function editor(seed, w = 1920, h = 1080) {
  const bg = '#1e1e2e'
  const side = '#181825'
  const bar = '#11111b'
  const dim = '#6c7086'
  const ink = '#cdd6f4'
  let b = `<rect width="${w}" height="${h}" fill="${bg}"/><rect width="56" height="${h}" fill="${bar}"/>`
  for (let i = 0; i < 5; i++) b += `<rect x="14" y="${22 + i * 56}" width="28" height="28" rx="6" fill="${i === 0 ? '#89b4fa' : '#45475a'}"/>`
  b += `<rect x="56" width="300" height="${h}" fill="${side}"/><text x="78" y="40" font-size="14" fill="${dim}" letter-spacing="1.5" ${SANS}>EXPLORER</text>`
  const tree = ['▾ apps', '  ▾ web', '    ▸ mock', '    ▾ src', '      ▸ components', '      ▾ lib', '          pixelcube.ts', '          raster.ts', '          spatial.ts', '          theme.ts', '      App.tsx', '      main.tsx', '      theme.css', '    package.json', '  ▸ api', '  README.md']
  tree.forEach((f, i) => {
    const open = f.trim() === 'spatial.ts'
    if (open) b += `<rect x="56" y="${62 + i * 30}" width="300" height="30" fill="#313244"/>`
    b += `<text x="78" y="${83 + i * 30}" font-size="17" fill="${open ? ink : '#a6adc8'}" style="white-space:pre" ${MONO}>${esc(f)}</text>`
  })
  b += `<rect x="356" width="${w - 356}" height="44" fill="${bar}"/>`
  ;['spatial.ts', 'Gallery.tsx', 'theme.css'].forEach((t, i) => {
    b += `<rect x="${356 + i * 190}" width="190" height="44" fill="${i === 0 ? bg : bar}"/><text x="${378 + i * 190}" y="28" font-size="16" fill="${i === 0 ? ink : dim}" ${SANS}>${t}</text>`
  })
  const first = seed % 9
  const cur = 7 + (seed % 5)
  for (let i = 0; 84 + i * 31 < h - 40 && first + i < CODE.length; i++) {
    const y = 84 + i * 31
    if (i === cur) b += `<rect x="356" y="${y - 22}" width="${w - 356}" height="31" fill="#2a2b3d"/><rect x="${436 + Math.min(40, CODE[first + i].length) * 11.4}" y="${y - 20}" width="3" height="26" fill="#f5e0dc"/>`
    b += `<text x="410" y="${y}" font-size="19" fill="${i === cur ? ink : dim}" text-anchor="end" ${MONO}>${first + i + 1}</text>`
    b += `<text x="436" y="${y}" font-size="19" style="white-space:pre" xml:space="preserve" ${MONO}>${tokens(CODE[first + i]).map(([t, k]) => `<tspan fill="${SYNTAX[k]}">${esc(t)}</tspan>`).join('')}</text>`
  }
  CODE.forEach((line, i) => {
    const lead = line.length - line.trimStart().length
    if (line.trim()) b += `<rect x="${w - 130 + lead * 1.6}" y="${60 + i * 5}" width="${Math.min(100, line.trim().length * 1.6)}" height="3" fill="${dim}" opacity=".5"/>`
  })
  b += `<rect y="${h - 30}" width="${w}" height="30" fill="#89b4fa"/><text x="70" y="${h - 9}" font-size="15" fill="${bar}" style="white-space:pre" ${SANS}>main    TypeScript    Ln ${first + cur + 1}, Col 7    Spaces: 2    UTF-8</text>`
  return svg(w, h, b)
}

// --- Phone screenshots: a chat -----------------------------------------------

const CHAT = [
  [0, 'are you still up?'],
  [1, 'yeah, sorting screenshots'],
  [1, 'there are like four thousand of them'],
  [0, 'lol same'],
  [0, 'send me the one from the lake'],
  [1, '#photo'],
  [0, 'oh that one is so good'],
  [0, 'the colours!!'],
  [1, 'no edits, straight from the phone'],
  [0, 'can you make it a sticker'],
  [1, 'on it'],
  [1, 'done, it is in the stickers folder'],
  [0, 'legend'],
  [0, 'ok sleeping now for real'],
  [1, 'night'],
]

export function phone(seed, w = 1170, h = 2532) {
  const r = rng(seed * 19 + 7)
  const dark = seed % 2 === 0
  const ui = dark
    ? { bg: '#000000', head: '#121214', ink: '#ffffff', dim: '#8e8e93', them: '#26252a', line: '#2c2c2e', field: '#1c1c1e' }
    : { bg: '#ffffff', head: '#f6f6f6', ink: '#000000', dim: '#8e8e93', them: '#e9e9eb', line: '#d1d1d6', field: '#ffffff' }
  const me = pick(r, ['#0a84ff', '#30d158', '#bf5af2'])
  const name = pick(r, NAMES)
  const id = `c${seed}`
  let b = `<rect width="${w}" height="${h}" fill="${ui.bg}"/><text x="96" y="104" font-size="50" font-weight="600" fill="${ui.ink}" ${SANS}>9:41</text>`
  for (let i = 0; i < 4; i++) b += `<rect x="${872 + i * 22}" y="${88 - i * 9}" width="14" height="${14 + i * 9}" rx="3" fill="${ui.ink}"/>`
  b += `<rect x="982" y="64" width="88" height="42" rx="12" fill="none" stroke="${ui.ink}" stroke-opacity=".4" stroke-width="3"/><rect x="989" y="71" width="${40 + Math.floor(r() * 34)}" height="28" rx="7" fill="${ui.ink}"/><rect x="1075" y="77" width="6" height="16" rx="3" fill="${ui.ink}" opacity=".4"/>`
  b += `<rect y="140" width="${w}" height="250" fill="${ui.head}"/><rect y="389" width="${w}" height="2" fill="${ui.line}"/>`
  b += `<path d="M80 206l-32 36 32 36" fill="none" stroke="${me}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`
  b += `<circle cx="585" cy="236" r="62" fill="${pick(r, ['#ff9f0a', '#bf5af2', '#30d158', '#ff375f', '#64d2ff'])}"/><text x="585" y="258" font-size="60" font-weight="600" fill="#fff" text-anchor="middle" ${SANS}>${name[0].toUpperCase()}</text>`
  b += `<text x="585" y="350" font-size="34" fill="${ui.ink}" text-anchor="middle" ${SANS}>${name} ›</text>`
  let y = 470
  b += `<text x="585" y="${y}" font-size="30" fill="${ui.dim}" text-anchor="middle" ${SANS}>Today ${10 + (seed % 12)}:${10 + ((seed * 7) % 50)}</text>`
  y += 40
  let prev = -1
  for (let i = seed % 4; i < CHAT.length && y < h - 420; i++) {
    const [mine, text] = CHAT[i]
    y += mine === prev ? 10 : 30
    prev = mine
    if (text === '#photo') {
      const [pw, ph] = [620, 460]
      const x = mine ? w - 44 - pw : 44
      b += `<clipPath id="${id}k"><rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="46"/></clipPath><g clip-path="url(#${id}k)"><svg x="${x}" y="${y}" width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}">${photoBody(seed, pw, ph, `${id}p`)}</svg></g>`
      y += ph
      continue
    }
    const lines = wrap(text, 22)
    const tw = Math.max(...lines.map((l) => l.length)) * 24.5 + 76
    const bh = lines.length * 58 + 46
    const x = mine ? w - 44 - tw : 44
    b += `<rect x="${n1(x)}" y="${y}" width="${n1(tw)}" height="${bh}" rx="46" fill="${mine ? me : ui.them}"/>`
    lines.forEach((l, k) => (b += `<text x="${n1(x + 38)}" y="${y + 70 + k * 58}" font-size="46" fill="${mine ? '#fff' : ui.ink}" ${SANS}>${esc(l)}</text>`))
    y += bh
  }
  b += `<rect y="${h - 250}" width="${w}" height="250" fill="${ui.head}"/><circle cx="96" cy="${h - 170}" r="44" fill="${ui.them}"/>`
  b += `<path d="M96 ${h - 192}v44M74 ${h - 170}h44" stroke="${ui.dim}" stroke-width="7" stroke-linecap="round"/>`
  b += `<rect x="170" y="${h - 214}" width="${w - 210}" height="88" rx="44" fill="${ui.field}" stroke="${ui.line}" stroke-width="3"/><text x="214" y="${h - 156}" font-size="42" fill="${ui.dim}" ${SANS}>Message</text>`
  b += `<rect x="${w / 2 - 210}" y="${h - 42}" width="420" height="14" rx="7" fill="${ui.ink}"/>`
  return svg(w, h, b)
}

// --- Stickers: a cartoon on a see-through background, with a white border ---

function ghostPath() {
  let d = 'M106 440V250C106 150 172 74 256 74S406 150 406 250V440'
  for (let k = 0; k < 6; k++) d += `Q${n1(406 - (k + 0.5) * 50)} ${k % 2 ? 470 : 404} ${n1(406 - (k + 1) * 50)} 440`
  return d + 'Z'
}
function starPath() {
  const pts = []
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const rad = k % 2 ? 96 : 206
    pts.push(`${n1(256 + Math.cos(a) * rad)} ${n1(272 + Math.sin(a) * rad)}`)
  }
  return `M${pts.join('L')}Z`
}
const HEX = [[256, 66], [420, 161], [420, 351], [256, 446], [92, 351], [92, 161]]
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
function rhombus(c, a, b, d, holeOnly = false) {
  // A face of the cube (corners c-a-b-d) and the hole in its middle.
  const mid = [(c[0] + b[0]) / 2, (c[1] + b[1]) / 2]
  const face = [c, a, b, d]
  const hole = face.map((p) => lerp(mid, p, 0.38))
  const path = (q) => `M${q.map((p) => `${n1(p[0])} ${n1(p[1])}`).join('L')}Z`
  return holeOnly ? path(hole) : [path(face), path(hole)]
}

const SHAPES = [
  { name: 'blob', d: 'M256 78C372 78 446 160 446 268S362 442 256 442 66 382 66 268 140 78 256 78Z', face: 270 },
  { name: 'cat', d: 'M256 112C372 112 446 186 446 286S362 448 256 448 66 386 66 286 140 112 256 112ZM98 222 112 66 222 138ZM414 222 400 66 290 138Z', face: 296, ears: true },
  { name: 'ghost', d: ghostPath(), face: 236 },
  { name: 'star', d: starPath(), face: 292, small: true },
  { name: 'heart', d: 'M256 440C120 348 66 268 66 194 66 122 122 80 180 80 214 80 240 100 256 130 272 100 298 80 332 80 390 80 446 122 446 194 446 268 392 348 256 440Z', face: 230 },
  { name: 'bubble', d: 'M100 120H412Q446 120 446 154V330Q446 364 412 364H226L150 436 170 364H100Q66 364 66 330V154Q66 120 100 120Z', text: true },
  { name: 'cube', d: `M${HEX.map((p) => p.join(' ')).join('L')}Z`, cube: true },
]
const STICKER_COLORS = ['#f48fb1', '#7be39a', '#5fe0d6', '#f6d54a', '#9484e6', '#ff7a72', '#ffb86b']

function face(cy, mood, k = 1) {
  const c = 256
  let f = [-1, 1].map((s) => `<ellipse cx="${c + s * 88 * k}" cy="${cy + 44 * k}" rx="${26 * k}" ry="${14 * k}" fill="#ff5c8a" opacity=".45"/>`).join('')
  f +=
    mood === 'happy'
      ? [-1, 1].map((s) => `<path d="M${c + s * 50 * k - 22 * k} ${cy + 8 * k}q${22 * k} ${-30 * k} ${44 * k} 0" fill="none" stroke="${INK}" stroke-width="${11 * k}" stroke-linecap="round"/>`).join('')
      : [-1, 1].map((s) => `<ellipse cx="${c + s * 50 * k}" cy="${cy}" rx="${20 * k}" ry="${28 * k}" fill="${INK}"/><circle cx="${c + s * 50 * k - 7 * k}" cy="${cy - 10 * k}" r="${7 * k}" fill="#fff"/>`).join('')
  f +=
    mood === 'wow'
      ? `<ellipse cx="${c}" cy="${cy + 58 * k}" rx="${15 * k}" ry="${19 * k}" fill="${INK}"/>`
      : `<path d="M${c - 26 * k} ${cy + 46 * k}q${26 * k} ${30 * k} ${52 * k} 0" fill="none" stroke="${INK}" stroke-width="${10 * k}" stroke-linecap="round"/>`
  return f
}

/** One sticker's markup on a 512 square, without the outer svg. */
function stickerBody(seed) {
  const r = rng(seed * 23 + 11)
  const shape = SHAPES[seed % SHAPES.length]
  const color = STICKER_COLORS[(seed * 3) % STICKER_COLORS.length]
  const mood = pick(r, ['smile', 'happy', 'wow'])
  const outline = 'stroke-linejoin="round" stroke-linecap="round"'
  let b = `<path d="${shape.d}" transform="translate(9 13)" fill="${INK}" stroke="${INK}" stroke-width="56" ${outline} opacity=".24"/>`
  b += `<path d="${shape.d}" fill="#fff" stroke="#fff" stroke-width="56" ${outline}/>`
  if (shape.cube) {
    const [t, ur, lr, bt, ll, ul] = HEX
    const c = [256, 256]
    for (const [corners, wall, inside] of [
      [[ul, t, ur, c], '#f4ea8c', '#6f6a24'],
      [[ul, c, bt, ll], '#e3d65d', '#55511b'],
      [[c, ur, lr, bt], '#b8b33f', '#8b862f'],
    ]) {
      const [faceD, holeD] = rhombus(corners[0], corners[1], corners[2], corners[3])
      b += `<path d="${faceD}" fill="${wall}"/><path d="${holeD}" fill="${inside}" stroke="${INK}" stroke-width="8" ${outline}/>`
    }
    return b + `<path d="${shape.d}M${ul.join(' ')}L256 256L${ur.join(' ')}M256 256V${bt[1]}" fill="none" stroke="${INK}" stroke-width="12" ${outline}/>`
  }
  b += `<path d="${shape.d}" fill="${color}" stroke="${INK}" stroke-width="12" ${outline} paint-order="stroke"/>`
  b += `<path d="${shape.d}" fill="none" stroke="#fff" stroke-width="10" opacity=".35" transform="translate(256 256) scale(.86) translate(-256 -256)" stroke-dasharray="90 2000" stroke-dashoffset="${-60 - (seed % 3) * 40}" stroke-linecap="round"/>`
  if (shape.ears) b += `<path d="M120 184 128 104 184 142ZM392 184 384 104 328 142Z" fill="#ff9ec4"/>`
  if (shape.face) b += face(shape.face, mood, shape.small ? 0.72 : 1)
  if (shape.text) b += `<text x="256" y="282" font-size="118" font-weight="900" fill="${INK}" text-anchor="middle" ${SANS}>${pick(r, ['lol', 'ok!', 'nope', 'brb', 'yes!'])}</text>`
  return b
}

export const sticker = (seed, size = 512) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-12 -12 536 536">${stickerBody(seed)}</svg>`

// --- Gifs: animated SVGs; the thumbnail is the same picture standing still ---

/** A short looping animation, 480 by 360. With moving=false, its first frame. */
export function gif(seed, moving = true) {
  const r = rng(seed * 29 + 13)
  const A = (s) => (moving ? s : '')
  const loop = (attr, values, dur, extra = '') => A(`<animate attributeName="${attr}" values="${values}" dur="${dur}s" repeatCount="indefinite"${extra}/>`)
  const [w, h] = [480, 360]
  const id = `g${seed}`
  const kind = seed % 3
  let b
  if (kind === 0) {
    // A ball bouncing on the floor, squashing as it lands.
    const [top, bottom] = pick(r, [['#ffe8f0', '#ffc9dc'], ['#e6f7ff', '#bfe3ff'], ['#f1ffe6', '#cdf2b8']])
    const ball = pick(r, ['#ff5c8a', '#2f80ed', '#f6a700', '#8f5cf5'])
    const ease = ' calcMode="spline" keyTimes="0;.46;.5;.54;1" keySplines=".55 0 1 .45;0 0 1 1;0 0 1 1;0 .55 .45 1"'
    b = `<defs><linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
<radialGradient id="${id}b" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".22" stop-color="${ball}"/><stop offset="1" stop-color="${INK}" stop-opacity=".9"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#${id}a)"/><rect y="292" width="${w}" height="68" fill="${INK}" opacity=".12"/>`
    b += `<ellipse cx="240" cy="296" rx="26" ry="9" fill="${INK}" opacity=".2">${loop('rx', '26;60;66;60;26', 1.1, ease)}</ellipse>`
    b += `<ellipse cx="240" cy="96" rx="52" ry="52" fill="url(#${id}b)">${loop('cy', '96;240;254;240;96', 1.1, ease)}${loop('ry', '52;52;38;52;52', 1.1, ease)}${loop('rx', '52;52;64;52;52', 1.1, ease)}</ellipse>`
  } else if (kind === 1) {
    // Music bars.
    b = `<defs><linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1440"/><stop offset="1" stop-color="#0b0820"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${id}a)"/>`
    b += `<text x="40" y="54" font-size="17" fill="#8f86c9" letter-spacing="2" ${SANS}>NOW PLAYING</text><text x="40" y="86" font-size="26" font-weight="700" fill="#fff" ${SANS}>time room (slowed)</text>`
    for (let k = 0; k < 12; k++) {
      const hs = Array.from({ length: 5 }, () => Math.round(30 + r() * 150))
      hs.push(hs[0])
      const x = 40 + k * 34
      const fill = `hsl(${Math.round(280 + k * 9)}, 90%, ${62 + (k % 3) * 4}%)`
      b += `<rect x="${x}" y="${290 - hs[0]}" width="24" height="${hs[0]}" rx="4" fill="${fill}">${loop('height', hs.join(';'), 1.2 + (k % 4) * 0.15)}${loop('y', hs.map((v) => 290 - v).join(';'), 1.2 + (k % 4) * 0.15)}</rect>`
      b += `<rect x="${x}" y="298" width="24" height="${Math.round(hs[0] * 0.3)}" rx="4" fill="${fill}" opacity=".22">${loop('height', hs.map((v) => Math.round(v * 0.3)).join(';'), 1.2 + (k % 4) * 0.15)}</rect>`
    }
  } else {
    // A sticker character hopping, with confetti falling and a "yay".
    b = `<defs><radialGradient id="${id}a" r=".8"><stop offset="0" stop-color="#fff6c9"/><stop offset="1" stop-color="#ffc0d6"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#${id}a)"/>`
    for (let k = 0; k < 36; k++) {
      const x = Math.round(r() * w)
      const dur = (1.6 + r() * 1.6).toFixed(2)
      const y0 = Math.round(r() * h)
      b += `<rect x="${x}" y="${y0}" width="10" height="16" rx="2" fill="${pick(r, STICKER_COLORS)}" transform="rotate(${Math.round(r() * 90)} ${x} ${y0})">${loop('y', `-20;${h + 20}`, dur, ` begin="-${(r() * 3).toFixed(2)}s"`)}</rect>`
    }
    b += `<ellipse cx="240" cy="318" rx="70" ry="12" fill="${INK}" opacity=".18">${loop('rx', '70;44;70', 0.8)}</ellipse>`
    b += `<g>${A('<animateTransform attributeName="transform" type="translate" values="0 0;0 -64;0 0" dur=".8s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines="0 .55 .45 1;.55 0 1 .45"/>')}<g transform="translate(240 222) scale(.42) translate(-256 -256)">${stickerBody(0)}</g></g>`
    b += `<text x="240" y="82" font-size="64" font-weight="900" fill="${INK}" text-anchor="middle" ${SANS}>yay!${loop('opacity', '1;.35;1', 0.8)}</text>`
  }
  return svg(w, h, b)
}

// --- Recordings: real video, if ffmpeg is installed -------------------------

const CLIPS = [
  'life=s=160x90:rate=12:ratio=0.22:mold=12:life_color=#f6d54a:death_color=#1a3890:mold_color=#5450cc,scale=640:360:flags=neighbor',
  // end_pts counts frames: the zoom lasts the whole six seconds.
  'mandelbrot=s=640x360:rate=20:start_scale=2.5:end_scale=0.02:end_pts=120:maxiter=250:inner=black',
  'cellauto=s=320x180:rate=20:rule=110:scroll=1:start_full=1,scale=640:360:flags=neighbor,lutrgb=r=val*0.35+40:g=val*0.2+30:b=val*0.55+80',
]
const DIR = join(tmpdir(), 'prismo-mock-clips-2')

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const run = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'ignore' })
    run.on('error', reject)
    run.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg stopped with ${code}`))))
  })
}

/**
 * The recordings, as a list with one place per clip: null until that clip is
 * made, then { mp4, poster } buffers. They are made in the background the
 * first time (about half a minute) and kept in the temp folder, so later
 * starts have them at once. Without ffmpeg every place stays null.
 */
export function recordings() {
  const clips = CLIPS.map(() => null)
  ;(async () => {
    mkdirSync(DIR, { recursive: true })
    for (const [i, source] of CLIPS.entries()) {
      const mp4 = join(DIR, `clip${i}.mp4`)
      const png = join(DIR, `clip${i}.png`)
      if (!existsSync(mp4) || !existsSync(png)) {
        await ffmpeg(['-f', 'lavfi', '-i', source, '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${mp4}.part.mp4`])
        await ffmpeg(['-ss', '2', '-i', `${mp4}.part.mp4`, '-frames:v', '1', png])
        renameSync(`${mp4}.part.mp4`, mp4)
      }
      clips[i] = { mp4: readFileSync(mp4), poster: readFileSync(png) }
    }
  })().catch((e) => console.log(`no recordings (${e.code === 'ENOENT' ? 'ffmpeg is not installed' : e.message}): they show a still picture only`))
  return clips
}
