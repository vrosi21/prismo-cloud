import { useMemo } from 'react'
import { useTheme } from '../lib/theme'
import { Cube } from './sprites'

// Seeded random numbers: the sky looks the same on every load.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SKY_HEIGHT = 2000

// Every star is one box-shadow. Each is listed twice, one sky-height apart,
// so the layer can scroll up by exactly that height and loop without a seam.
function starField(seed: number, count: number, colors: string[], repeat = true): string {
  const rnd = mulberry32(seed)
  const shadows: string[] = []
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * 3200)
    const y = Math.floor(rnd() * SKY_HEIGHT)
    const color = colors[Math.floor(rnd() * colors.length)]
    shadows.push(`${x}px ${y}px 0 0 ${color}`)
    if (repeat) shadows.push(`${x}px ${y + SKY_HEIGHT}px 0 0 ${color}`)
  }
  return shadows.join(',')
}

function Multiverse() {
  const layers = useMemo(
    () => ({
      far: starField(11, 260, ['#8f7fe0', '#c9bfff', '#6a5bbf']),
      mid: starField(23, 120, ['#f1eaff', '#f48fb1', '#5fe0d6']),
      near: starField(37, 45, ['#ffffff', '#ffe680']),
      blink: starField(53, 28, ['#ffffff', '#f48fb1'], false),
    }),
    [],
  )
  return (
    <div className="backdrop" aria-hidden>
      <div className="stars stars-far" style={{ boxShadow: layers.far }} />
      <div className="stars stars-mid" style={{ boxShadow: layers.mid }} />
      <div className="stars stars-near" style={{ boxShadow: layers.near }} />
      <div className="twinkle absolute left-0 top-0 h-[3px] w-[3px]" style={{ boxShadow: layers.blink }} />
      <div className="shooting-star" />
      {/* The Time Room itself, far away in the void. */}
      <div className="far-cube opacity-80">
        <Cube size={18} />
      </div>
    </div>
  )
}

// --- Prismo's legs, seen through his own eyes --------------------------------
// He is lying back on the Time Room floor, looking down the length of himself
// at the far wall, feet up. Each limb is a tapered stick worked out on a coarse
// grid, so it comes out as chunky pixels like every other sprite here.

const LEGS_W = 160
const LEGS_H = 80

type Pt = [number, number]
type Limb = { from: Pt; to: Pt; r0: number; r1: number }

// Where a point sits across a limb: -1 on its left edge as seen on screen,
// 1 on its right, null if it is outside.
function across(l: Limb, x: number, y: number): number | null {
  const [ax, ay] = l.from
  const dx = l.to[0] - ax
  const dy = l.to[1] - ay
  const len2 = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
  const r = l.r0 + (l.r1 - l.r0) * t
  const px = x - (ax + dx * t)
  const py = y - (ay + dy * t)
  if (px * px + py * py > r * r) return null
  const side = dy > 0 ? -1 : 1
  return (side * (py * dx - px * dy)) / Math.sqrt(len2) / r
}

// Thighs come in from below the screen, wide because they are close; the
// shins run off towards the far wall and the feet turn out, toes up, the way
// they do on his little sprite. Mirrored left to right.
const mirror = ({ from, to, r0, r1 }: Limb): Limb => ({
  from: [LEGS_W - from[0], from[1]],
  to: [LEGS_W - to[0], to[1]],
  r0,
  r1,
})
const LEG: Limb = { from: [30, 104], to: [67, 47], r0: 20, r1: 4.2 }
const FOOT: Limb = { from: [67, 48], to: [57, 27], r0: 4.4, r1: 7 }
// The bottom of his body, just showing between the thighs.
const BELLY: Limb = { from: [60, 104], to: [100, 104], r0: 27, r1: 27 }

type Run = { x: number; y: number; w: number; fill: string }

// Light from the left: the right edge of every limb sits in shade, unless one
// flat colour is asked for. Earlier limbs are in front. Neighbouring cells of
// one colour merge into one rect.
function rasterize(limbs: Limb[], flat?: string): Run[] {
  const runs: Run[] = []
  for (let y = 0; y < LEGS_H; y++) {
    let cur: Run | null = null
    for (let x = 0; x < LEGS_W; x++) {
      let fill: string | null = null
      for (const l of limbs) {
        const s = across(l, x + 0.5, y + 0.5)
        if (s === null) continue
        fill = flat ?? (s > 0.72 ? 'var(--pov-shade)' : s > 0.2 ? 'var(--accent-deep)' : 'var(--accent)')
        break
      }
      if (cur && fill === cur.fill) {
        cur.w++
      } else {
        if (cur) runs.push(cur)
        cur = fill ? { x, y, w: 1, fill } : null
      }
    }
    if (cur) runs.push(cur)
  }
  return runs
}

function Runs({ runs, className }: { runs: Run[]; className?: string }) {
  return (
    <g className={className}>
      {runs.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
      ))}
    </g>
  )
}

function PovLegs() {
  const layers = useMemo(
    () => ({
      // In his own shadow, so the thighs stand off it.
      belly: rasterize([BELLY], 'var(--accent-deep)'),
      legs: rasterize([FOOT, LEG, mirror(LEG)]),
      // Drawn on its own so it can tap: he is in no hurry.
      tapper: rasterize([mirror(FOOT)]),
    }),
    [],
  )
  return (
    <svg className="pov-legs sprite" viewBox={`0 0 ${LEGS_W} ${LEGS_H}`} shapeRendering="crispEdges">
      <Runs runs={layers.belly} />
      <Runs runs={layers.legs} />
      <Runs runs={layers.tapper} className="pov-tap" />
    </svg>
  )
}

// Inside the cube: back wall, floor and the four edges running to the corners.
function TimeRoom() {
  const line = { stroke: 'var(--bg-deep)', strokeWidth: 3, vectorEffect: 'non-scaling-stroke' as const, fill: 'none' }
  return (
    <div className="backdrop" aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" shapeRendering="crispEdges">
        <polygon points="0,100 24,74 76,74 100,100" fill="var(--bg-deep)" opacity="0.45" />
        <polygon points="24,16 76,16 76,74 24,74" fill="var(--panel-2)" opacity="0.4" />
        <line x1="0" y1="0" x2="24" y2="16" {...line} />
        <line x1="100" y1="0" x2="76" y2="16" {...line} />
        <line x1="0" y1="100" x2="24" y2="74" {...line} />
        <line x1="100" y1="100" x2="76" y2="74" {...line} />
        <rect x="24" y="16" width="52" height="58" {...line} />
      </svg>
      <PovLegs />
    </div>
  )
}

export function Backdrop() {
  const theme = useTheme()
  if (theme === 'multiverse') return <Multiverse />
  if (theme === 'timeroom') return <TimeRoom />
  return null
}
