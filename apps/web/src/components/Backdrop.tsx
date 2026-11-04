import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
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

// --- Prismo, through his own eyes --------------------------------------------
// Prismo is flat: a pink shape painted on the room, not a body standing in it.
// You are him, lying on the floor and looking at the far wall. Your legs run
// flat along the floor and, where the floor meets the wall, fold and carry on
// straight up it, feet and all. Worked out for the screen's own size on a grid
// of big pixels, like every other sprite here.

// These must match the room TimeRoom draws, as shares of the screen.
const SEAM = 0.74 // where the floor meets the back wall
const WALL = { left: 0.24, right: 0.76, top: 0.16 }
// Where the floor's side edges would meet if carried on.
const VANISH = 1 - (1 - SEAM) * (0.5 / WALL.left)

type Pt = [number, number]
type Cap = { a: Pt; b: Pt; r0: number; r1: number }

// A stick from a to b, r0 thick at a and r1 at b, with round ends.
function inCap({ a, b, r0, r1 }: Cap, x: number, y: number): boolean {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
  const r = r0 + (r1 - r0) * t
  const px = x - a[0] - dx * t
  const py = y - a[1] - dy * t
  return px * px + py * py <= r * r
}

type Leg = { x: number; ankle: number; out: 1 | -1 }

// Everything from here on is measured in grid cells. A leg is six cells wide.
const HALF = 3

// The part of a leg on the wall. Wall coordinates: x from the middle of the
// screen, y up from the fold. The shin goes straight up; the foot leans out
// and ends in three toes fanned out like fingers, the way it does in the show.
function shin({ x, ankle }: Leg): Cap {
  return { a: [x, 0], b: [x, ankle], r0: HALF, r1: HALF }
}
function foot({ x, ankle, out }: Leg): Cap[] {
  const tilt = 0.6 // radians out from straight up
  const ray = (angle: number, length: number): Pt => [out * Math.sin(angle) * length, Math.cos(angle) * length]
  const end: Pt = [x + ray(tilt, 8)[0], ankle + ray(tilt, 8)[1]]
  const side = ray(tilt + Math.PI / 2, 1) // one cell towards the outer edge
  const toe = (across: number, turn: number, length: number): Cap => {
    const a: Pt = [end[0] + side[0] * across, end[1] + side[1] * across]
    const d = ray(tilt + turn, length)
    return { a, b: [a[0] + d[0], a[1] + d[1]], r0: 1.7, r1: 1.4 }
  }
  return [
    { a: [x, ankle], b: end, r0: HALF, r1: HALF + 0.8 },
    toe(-2.2, -0.1, 5.6),
    toe(0.8, 0.45, 5.2),
    toe(3.2, 1.0, 4.4),
  ]
}

type Run = { x: number; y: number; w: number; fill: string }
type Painting = { cell: number; still: Run[]; tapping: Run[] }

function paint(width: number, height: number): Painting {
  const wallW = (WALL.right - WALL.left) * width
  const wallH = (SEAM - WALL.top) * height
  const u = Math.min(wallW, wallH)
  const cell = Math.max(3, Math.min(6, Math.round(u / 80)))
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const mid = Math.round(width / 2 / cell)
  const seam = Math.round((SEAM * height) / cell)
  const vanish = (VANISH * height) / cell
  const tall = (wallH / cell) | 0
  const apart = Math.round((0.16 * u) / cell)
  const ankle = Math.round(tall * 0.66)
  const legs: Leg[] = [
    { x: -apart, ankle, out: -1 },
    { x: apart, ankle, out: 1 },
  ]
  const still = [...legs.map(shin), ...foot(legs[0])]
  const tapping = foot(legs[1])

  const runs = { still: [] as Run[], tapping: [] as Run[] }
  const push = (into: Run[], col: number, row: number, fill: string) => {
    const last = into[into.length - 1]
    if (last && last.y === row * cell && last.fill === fill && last.x + last.w === col * cell) last.w += cell
    else into.push({ x: col * cell, y: row * cell, w: cell, fill })
  }
  for (let row = 0; row < rows; row++) {
    const cy = row + 0.5
    for (let col = 0; col < cols; col++) {
      const cx = col + 0.5 - mid
      if (row >= seam) {
        // On the floor: undo the perspective and the legs are plain strips.
        const across = cx * ((seam - vanish) / (cy - vanish))
        if (legs.some((l) => Math.abs(across - l.x) < HALF)) push(runs.still, col, row, 'var(--pov-floor)')
      } else {
        const wy = seam - cy
        if (still.some((c) => inCap(c, cx, wy))) push(runs.still, col, row, 'var(--accent)')
        else if (tapping.some((c) => inCap(c, cx, wy))) push(runs.tapping, col, row, 'var(--accent)')
      }
    }
  }
  return { cell, ...runs }
}

function useSize(ref: RefObject<Element | null>): [number, number] {
  const [size, setSize] = useState<[number, number]>(() => [window.innerWidth, window.innerHeight])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setSize((old) => (old[0] === w && old[1] === h ? old : [w, h]))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function Runs({ runs, cell, className, style }: { runs: Run[]; cell: number; className?: string; style?: CSSProperties }) {
  return (
    <g className={className} style={style}>
      {runs.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={cell} fill={r.fill} />
      ))}
    </g>
  )
}

function PovLegs() {
  const ref = useRef<SVGSVGElement>(null)
  const [width, height] = useSize(ref)
  const art = useMemo(() => paint(width, height), [width, height])
  return (
    <svg ref={ref} className="pov-legs sprite" viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges">
      <Runs runs={art.still} cell={art.cell} />
      {/* One foot taps now and then: he is in no hurry. */}
      <Runs runs={art.tapping} cell={art.cell} className="pov-tap" style={{ '--cell': `${art.cell}px` } as CSSProperties} />
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
