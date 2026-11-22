// Draws the app icons (the pixel cube of apps/web/public/favicon.svg) into
// PNGs for the web app manifest. No image library: the favicon is a 16x16
// grid of square pixels, so each PNG is that grid scaled up by a whole
// number, written with node's zlib.
//
//   node scripts/make-icons.mjs
//
// Run it again after changing favicon.svg.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public')
const svg = readFileSync(join(root, 'favicon.svg'), 'utf8')

// The favicon's paths use only M, h, v, H, V and z: outlines of squares.
// Each becomes a list of polygons; a pixel is filled when its centre is
// inside (even-odd), and later paths paint over earlier ones.
function polygons(d) {
  const out = []
  let poly = []
  let x = 0
  let y = 0
  const tokens = d.match(/[MmHhVvZz]|-?\d+(\.\d+)?/g)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const num = () => Number(tokens[++i])
    if (t === 'M') { if (poly.length) out.push(poly); x = num(); y = num(); poly = [[x, y]] }
    else if (t === 'h') { x += num(); poly.push([x, y]) }
    else if (t === 'H') { x = num(); poly.push([x, y]) }
    else if (t === 'v') { y += num(); poly.push([x, y]) }
    else if (t === 'V') { y = num(); poly.push([x, y]) }
    else if (t === 'z' || t === 'Z') { if (poly.length) out.push(poly); poly = [] }
    else throw new Error(`favicon.svg: path command "${t}" is not handled`)
  }
  if (poly.length) out.push(poly)
  return out
}

function inside(px, py, polys) {
  let hit = false
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i]
      const [xj, yj] = p[j]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
    }
  }
  return hit
}

const grid = Array.from({ length: 16 }, () => Array(16).fill(null))
for (const [, fill, d] of svg.matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"/gi)) {
  const polys = polygons(d)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (inside(x + 0.5, y + 0.5, polys)) grid[y][x] = fill
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// size: the PNG's side; scale: pixels per grid square; bg: a colour behind
// it all (maskable icons need one, and room around the cube).
function draw(size, scale, bg) {
  const pad = (size - 16 * scale) / 2
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - pad) / scale)
      const gy = Math.floor((y - pad) / scale)
      const c = gx >= 0 && gx < 16 && gy >= 0 && gy < 16 ? grid[gy][gx] : null
      const hex = c ?? bg
      if (hex) row.set([...rgb(hex), 255], 1 + x * 4)
    }
    rows.push(row)
  }
  return png(size, Buffer.concat(rows))
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const ROOM = '#f6d54a' // Time Room's wall, the manifest's background colour
mkdirSync(join(root, 'icons'), { recursive: true })
const icons = {
  'icon-192.png': draw(192, 12, null),
  'icon-512.png': draw(512, 32, null),
  // Maskable: the launcher may cut it to a circle, so the cube keeps to the
  // middle 75% (the safe zone is the middle 80%) on the room's yellow.
  'maskable-512.png': draw(512, 24, ROOM),
  'apple-touch-icon.png': draw(192, 10, ROOM),
}
for (const [name, data] of Object.entries(icons)) {
  writeFileSync(join(root, 'icons', name), data)
  console.log(`icons/${name}  ${data.length} bytes`)
}
