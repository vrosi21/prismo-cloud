import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { cubeSheet, type CubeLook } from '../lib/pixelcube'
import { useSize } from '../lib/size'

// The void outside the Time Room, as in the show: deep blue, a purple swirl
// around the middle, purple rocks drifting, sparkles. The cube itself hangs in
// the middle of it, turning slowly. Everything is pixel art: the sky is
// painted once per screen size on a coarse grid and scaled up without
// smoothing.

const CELL = 4 // screen pixels per pixel of the sky

// Darkest to lightest: the void, then the swirl, then the glow by the cube.
const SKY = ['#1a3890', '#1f3e9c', '#2643a6', '#3045b0', '#3b45b9', '#4747c2', '#5450cc']
const STAR = { dot: '#7f8fe6', ring: '#c4b1ff', spark: '#e9cdff', core: '#ffffff' }

// Seeded, so the sky is the same on every load.
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = x - xi
  const v = y - yi
  const su = u * u * (3 - 2 * u)
  const sv = v * v * (3 - 2 * v)
  const a = hash(xi, yi, seed)
  const b = hash(xi + 1, yi, seed)
  const c = hash(xi, yi + 1, seed)
  const d = hash(xi + 1, yi + 1, seed)
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv
}
function fbm(x: number, y: number, seed: number): number {
  return noise(x, y, seed) * 0.55 + noise(x * 2.1, y * 2.1, seed + 1) * 0.3 + noise(x * 4.3, y * 4.3, seed + 2) * 0.15
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// Ordered dither: bands of colour break up into a pixel pattern at the edges.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16 - 0.5)

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function paintSky(ctx: CanvasRenderingContext2D, cols: number, rows: number) {
  const img = ctx.createImageData(cols, rows)
  const tones = SKY.map(rgb)
  const put = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return
    const o = (y * cols + x) * 4
    img.data.set([r, g, b, 255], o)
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = (x + 0.5 - cols / 2) / (cols / 2)
      const ny = (y + 0.5 - rows / 2) / (rows / 2)
      const r = Math.hypot(nx / 0.74, ny / 0.9)
      // Twist the noise more the further out it is: the swirl.
      const twist = 1.5 * r
      const tx = nx * Math.cos(twist) - ny * Math.sin(twist)
      const ty = nx * Math.sin(twist) + ny * Math.cos(twist)
      const n1 = fbm(tx * 2.4 + 10, ty * 2.4 + 10, 1)
      const n2 = fbm(tx * 5 + 3, ty * 5 + 7, 2)
      const ring = Math.exp(-(((r + (n1 - 0.5) * 0.4 - 1) / 0.21) ** 2)) * (0.5 + 0.65 * n2)
      const glow = Math.exp(-(((r + (n1 - 0.5) * 0.5) / 0.6) ** 2)) * (0.45 + 0.7 * n2)
      const v = Math.min(1, Math.max(ring * 0.85, glow) + 0.18 * n2)
      const t = Math.round(v * (SKY.length - 1) + BAYER[(y % 4) * 4 + (x % 4)])
      put(x, y, tones[Math.max(0, Math.min(SKY.length - 1, t))])
    }
  }
  // Sparkles: dots, little rings and four-pointed stars. None on the cube.
  const rnd = mulberry32(7)
  const count = Math.round((cols * rows) / 700)
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * cols)
    const y = Math.floor(rnd() * rows)
    if (Math.hypot((x - cols / 2) / cols, (y - rows / 2) / rows) < 0.12) continue
    const kind = rnd()
    if (kind < 0.55) put(x, y, rgb(STAR.dot))
    else if (kind < 0.8) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) put(x + dx, y + dy, rgb(STAR.ring))
    } else {
      const arm = rnd() < 0.5 ? 1 : 2
      for (let d = 1; d <= arm; d++) for (const [dx, dy] of [[0, -d], [d, 0], [0, d], [-d, 0]]) put(x + dx, y + dy, rgb(STAR.spark))
      put(x, y, rgb(STAR.core))
    }
  }
  ctx.putImageData(img, 0, 0)
}

// --- Rocks ----------------------------------------------------------------

const ROCK = {
  near: { light: '#9a5cf5', mid: '#7440dc', dark: '#5128b0', line: '#1b0d4a' },
  far: { light: '#4a3aa8', mid: '#36288c', dark: '#261c6c', line: '#120b3a' },
}

/** A lumpy rock w by h pixels, lit from the top left, as a data URL. */
function rockSprite(seed: number, w: number, h: number, look: (typeof ROCK)[keyof typeof ROCK]): string {
  const rnd = mulberry32(seed)
  const corners = 7 + Math.floor(rnd() * 4)
  const poly: [number, number][] = []
  for (let i = 0; i < corners; i++) {
    const a = (i / corners) * Math.PI * 2 + rnd() * 0.5
    const k = 0.62 + rnd() * 0.38
    poly.push([w / 2 + Math.cos(a) * (w / 2 - 1) * k, h / 2 + Math.sin(a) * (h / 2 - 1) * k])
  }
  const inside = (x: number, y: number) => {
    let hit = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]
      const [xj, yj] = poly[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && inside(x + 0.5, y + 0.5)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const pits = new Set<number>()
  for (let i = 0; i < (w * h) / 60; i++) pits.add(Math.floor(rnd() * w) + Math.floor(rnd() * h) * w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue
      const edge = !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1)
      // Lit from the top left: a bright rim there, the far side in shade.
      const rim = !filled(x - 1, y - 1) || !filled(x - 2, y - 1)
      const side = ((x + 0.5 - w / 2) / w + (y + 0.5 - h / 2) / h) * 2 + (rnd() - 0.5) * 0.25
      const tone = rim && side < 0.2 ? look.light : side > 0.38 || pits.has(x + y * w) ? look.dark : side < -0.45 ? look.light : look.mid
      ctx.fillStyle = edge ? look.line : tone
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return canvas.toDataURL('image/png')
}

// Where the rocks float, in shares of the screen, and how big (in pixels of
// 3 screen pixels). Kept out of the middle, which is the cube's.
const ROCKS = [
  { x: 0.13, y: 0.11, w: 42, h: 30, seed: 3, far: false },
  { x: 0.26, y: 0.4, w: 16, h: 28, seed: 5, far: false },
  { x: 0.05, y: 0.7, w: 18, h: 20, seed: 8, far: true },
  { x: 0.32, y: 0.91, w: 24, h: 11, seed: 13, far: true },
  { x: 0.56, y: 0.04, w: 26, h: 16, seed: 21, far: false },
  { x: 0.8, y: 0.17, w: 58, h: 32, seed: 34, far: false },
  { x: 0.95, y: 0.52, w: 96, h: 30, seed: 55, far: false },
  { x: 0.82, y: 0.83, w: 36, h: 32, seed: 89, far: true },
  { x: 0.47, y: 0.93, w: 13, h: 12, seed: 144, far: true },
  { x: 0.67, y: 0.71, w: 11, h: 10, seed: 233, far: true },
]

// The Time Room in its own colours, whatever the theme: lemon walls, olive
// shade, dark inside.
const TIME_ROOM: CubeLook = {
  faces: ['#f4ea8c', '#e3d65d', '#b8b33f', '#8f8c2e'],
  inside: ['#8b862f', '#6f6a24', '#55511b'],
  line: '#2c2b14',
}
const FRAMES = 24

export function Multiverse() {
  const box = useRef<HTMLDivElement>(null)
  const sky = useRef<HTMLCanvasElement>(null)
  const [width, height] = useSize(box)
  const cols = Math.ceil(width / CELL)
  const rows = Math.ceil(height / CELL)

  useEffect(() => {
    const ctx = sky.current?.getContext('2d')
    if (ctx && cols > 0 && rows > 0) paintSky(ctx, cols, rows)
  }, [cols, rows])

  const rocks = useMemo(() => ROCKS.map((r) => ({ ...r, url: rockSprite(r.seed, r.w, r.h, r.far ? ROCK.far : ROCK.near) })), [])

  // The cube is about a quarter of the short side of the screen.
  const grid = Math.max(40, Math.min(84, Math.round((Math.min(width, height) * 0.25) / 3)))
  const sheet = useMemo(() => cubeSheet({ grid, frames: FRAMES, tilt: -0.42, roll: 0.22, hole: 0.32 }, TIME_ROOM), [grid])
  const px = grid * 3

  return (
    <div ref={box} className="backdrop" aria-hidden>
      <canvas ref={sky} width={cols} height={rows} className="mv-sky sprite" />
      {rocks.map((r, i) => (
        <img
          key={r.seed}
          src={r.url}
          alt=""
          className="mv-rock sprite"
          style={
            {
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: r.w * 3,
              height: r.h * 3,
              '--dur': `${7 + (i % 4) * 2.5}s`,
              '--drift': `${(i % 2 ? 1 : -1) * (6 + (i % 3) * 3)}px`,
            } as CSSProperties
          }
        />
      ))}
      <div className="mv-cube">
        <span
          className="sprite"
          style={
            {
              width: px,
              height: px,
              backgroundImage: `url(${sheet})`,
              backgroundSize: `${px * FRAMES}px ${px}px`,
              '--run': `${-px * FRAMES}px`,
            } as CSSProperties
          }
        />
      </div>
    </div>
  )
}
