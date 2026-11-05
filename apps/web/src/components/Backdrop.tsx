import { useRef, useMemo, type CSSProperties } from 'react'
import { facing } from '../lib/room'
import { useSize } from '../lib/size'
import { useStore } from '../lib/store'
import { useTheme } from '../lib/theme'
import { Multiverse } from './Multiverse'

// --- Prismo, through his own eyes --------------------------------------------
// Prismo is flat: a pink shape painted on the room, not a body standing in it.
// You are him, lying in the middle of the floor. Your legs run flat along the
// floor towards the wall of the files and, where the floor meets that wall,
// fold and carry on straight up it, feet and all. Turn to another wall
// (Ctrl and an arrow) and the room turns with you: the legs are then off to
// one side, or behind you, and the wall of the lookout is one big window out
// into the void. Worked out for the screen's own size on a grid of big
// pixels, like every other sprite here.

// These must match the room TimeRoom draws, as shares of the screen.
const SEAM = 0.74 // where the floor meets the back wall
const WALL = { left: 0.24, right: 0.76, top: 0.16 }

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

// Every wall of the room is drawn the same way: the wall ahead square on, the
// two beside it running off to the edges of the screen, the floor below. The
// side walls and the floor start a little behind you, at this depth.
const NEAR = -0.3
const depth = (t: number) => NEAR + (1 - NEAR) * t

type Spot = { floor: boolean; x: number; y: number; z: number }

/**
 * Where in the room a point of the screen is. X and Y are shares of the
 * screen; the answer is in room units: the room is 2 by 2 by 2, x east, z
 * north (towards the files), y up from the floor. wall is the wall faced,
 * clockwise from the files. null for the ceiling.
 */
function spot(X: number, Y: number, wall: number): Spot | null {
  const { left: L, right: R, top: T } = WALL
  // In the room as seen: across from left to right, ahead, up.
  let across: number
  let ahead: number
  let up: number
  let floor = false
  if (X >= L && X <= R && Y >= T && Y < SEAM) {
    across = ((X - L) / (R - L)) * 2 - 1
    ahead = 1
    up = ((SEAM - Y) / (SEAM - T)) * 2
  } else {
    const e = (1 - Y) / (1 - SEAM)
    const fl = L * e
    const fr = 1 - (1 - R) * e
    if (Y >= SEAM && X >= fl && X <= fr) {
      floor = true
      across = ((X - fl) / (fr - fl)) * 2 - 1
      ahead = depth(e)
      up = 0
    } else {
      const onLeft = X < 0.5
      const d = onLeft ? X / L : (1 - X) / (1 - R)
      const top = T * d
      const bottom = 1 - (1 - SEAM) * d
      if (d > 1 || Y < top) return null
      across = onLeft ? -1 : 1
      ahead = depth(d)
      up = ((bottom - Y) / (bottom - top)) * 2
    }
  }
  // Ahead is north for the files, east for the next wall clockwise, and so on.
  const sin = [0, 1, 0, -1][wall]
  const cos = [1, 0, -1, 0][wall]
  return { floor, x: across * cos + ahead * sin, z: -across * sin + ahead * cos, y: up }
}

// The window that is most of the west wall, the lookout's: in room units
// along the wall (z) and up from the floor, and the void beyond it in the
// Multiverse's own colours. Big, because the page covers the middle of
// whatever wall is faced; this way it shows round the edges too.
const DOOR = { half: 0.82, bottom: 0.22, top: 1.72 }
const VOID = '#1f3e9c'
const VOID_STAR = '#c4b1ff'

function paint(width: number, height: number, wall: number): Painting {
  const wallW = (WALL.right - WALL.left) * width
  const wallH = (SEAM - WALL.top) * height
  const u = Math.min(wallW, wallH)
  const cell = Math.max(3, Math.min(6, Math.round(u / 80)))
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  // Cells per room unit, measured on a wall seen square on: the legs keep
  // their size whichever wall they are on.
  const perX = wallW / cell / 2
  const perY = wallH / cell / 2
  const tall = (wallH / cell) | 0
  const apart = Math.round((0.16 * u) / cell)
  const ankle = Math.round(tall * 0.66)
  const legs: Leg[] = [
    { x: -apart, ankle, out: -1 },
    { x: apart, ankle, out: 1 },
  ]
  const still = [...legs.map(shin), ...foot(legs[0])]
  const tapping = foot(legs[1])
  const frame = 1.5 // the door frame, in cells

  const runs = { still: [] as Run[], tapping: [] as Run[] }
  const push = (into: Run[], col: number, row: number, fill: string) => {
    const last = into[into.length - 1]
    if (last && last.y === row * cell && last.fill === fill && last.x + last.w === col * cell) last.w += cell
    else into.push({ x: col * cell, y: row * cell, w: cell, fill })
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const at = spot(((col + 0.5) * cell) / width, ((row + 0.5) * cell) / height, wall)
      if (!at) continue
      if (at.floor) {
        // The legs, flat on the floor from under you to the files' wall.
        // Facing the other way they are behind you, out of sight.
        if (wall !== 2 && legs.some((l) => Math.abs(at.x * perX - l.x) < HALF)) push(runs.still, col, row, 'var(--pov-floor)')
      } else if (at.z > 0.999) {
        // Up the files' wall: shins, feet, toes.
        const cx = at.x * perX
        const wy = at.y * perY
        if (still.some((c) => inCap(c, cx, wy))) push(runs.still, col, row, 'var(--accent)')
        else if (tapping.some((c) => inCap(c, cx, wy))) push(runs.tapping, col, row, 'var(--accent)')
      } else if (at.x < -0.999 && Math.abs(at.z) < DOOR.half && at.y > DOOR.bottom && at.y < DOOR.top) {
        const edge = DOOR.half - Math.abs(at.z) < frame / perX || DOOR.top - at.y < frame / perY || at.y - DOOR.bottom < frame / perY
        // Stars beyond stay put on the screen: far enough away not to move.
        const star = !edge && ((col * 73856093) ^ (row * 19349663)) % 37 === 0
        push(runs.still, col, row, edge ? 'var(--bg-deep)' : star ? VOID_STAR : VOID)
      }
    }
  }
  return { cell, ...runs }
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

function PovLegs({ wall }: { wall: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [width, height] = useSize(ref)
  const art = useMemo(() => paint(width, height, wall), [width, height, wall])
  return (
    <svg ref={ref} className="pov-legs sprite" viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges">
      <Runs runs={art.still} cell={art.cell} />
      {/* One foot taps now and then: he is in no hurry. */}
      <Runs runs={art.tapping} cell={art.cell} className="pov-tap" style={{ '--cell': `${art.cell}px` } as CSSProperties} />
    </svg>
  )
}

// Inside the cube: the wall ahead, floor and the four edges running to the
// corners. Every wall looks like this; what is on it is PovLegs' business.
function TimeRoom() {
  const { wall } = useStore(facing)
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
      <PovLegs wall={wall} />
    </div>
  )
}

export function Backdrop() {
  const theme = useTheme()
  if (theme === 'multiverse') return <Multiverse />
  if (theme === 'timeroom') return <TimeRoom />
  return null
}
