import { useRef, useMemo, type CSSProperties } from 'react'
import { facing } from '../lib/room'
import { any, ellipse, polygon, stick, type Shape } from '../lib/raster'
import { useSize } from '../lib/size'
import { useStore } from '../lib/store'
import { useTheme } from '../lib/theme'
import { Multiverse } from './Multiverse'

// --- Prismo, painted on the room ----------------------------------------------
// Prismo is flat: a pink shape painted on the room, not a body standing in it.
// He lies on his back down the middle of the floor, and where the floor meets
// a wall he folds and carries on up it: his legs up the wall of the files, his
// head up the wall behind (the wishes). You stand over his middle. Facing the
// files you see his legs run off ahead and up; turn round and his face is on
// the wall; to either side he crosses the floor from one edge of the screen to
// the other, legs on one side wall, head on the other, both cut off by the
// edge. He idles: breathes, looks about, blinks, taps a foot.
//
// Worked out for the screen's own size on a grid of big pixels, like every
// other sprite here.

// These must match the room TimeRoom draws, as shares of the screen.
const SEAM = 0.74 // where the floor meets the back wall
const WALL = { left: 0.24, right: 0.76, top: 0.16 }

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

// Prismo is drawn on the strip of room he lies on, unrolled flat: up the
// wishes wall, along the floor, up the files wall, as one long sheet.
// `a` runs across it (east), `c` along it (north), both in grid cells;
// c = 0 is under your feet, ±fold where the floor meets the two walls.
type Sheet = { on: 'floor' | 'files' | 'wishes'; a: number; c: number }

function unroll(at: Spot, perX: number, perY: number): Sheet | null {
  const a = at.x * perX
  if (at.floor) return { on: 'floor', a, c: at.z * perY }
  if (at.z > 0.999) return { on: 'files', a, c: perY * (1 + at.y) }
  if (at.z < -0.999) return { on: 'wishes', a, c: -perY * (1 + at.y) }
  return null
}

// His shapes come from the sprite in sprites.tsx (a 32 by 56 grid, the neck's
// foot at 16, 27), laid onto the sheet at k cells per sprite pixel. On the
// wall behind, the sprite is the right way up and faces to your right when
// you face it; on the floor it carries on down from the neck.
const NECK = { x: 16, y: 27 }
const fromSprite = (shape: Shape, k: number, fold: number): Shape => (a, c) => shape(NECK.x - a / k, NECK.y + (c + fold) / k)

const HEAD = any(
  ellipse(16.5, 11.5, 8.5, 10.5),
  ellipse(9.5, 4.5, 3.6),
  ellipse(7.5, 9.5, 3.8),
  ellipse(7.5, 15, 3.8),
  ellipse(9.5, 19.5, 3.4),
  ellipse(13.5, 2, 2.8),
  polygon([[23.5, 12.5], [30.6, 17.4], [29.6, 18.6], [23, 18.2]]),
  stick(16, 20, 16, 27.5, 1.7),
)
const EYE = ellipse(20, 10, 3.9, 2.5)
const PUPIL = ellipse(18.8, 10, 1.7, 2.4)
const MOUTH = polygon([[18.4, 19.5], [24, 19.1], [24.4, 20.5], [18.8, 21]])
const limb = (pts: [number, number][], r: number) => any(...pts.slice(1).map((p, i) => stick(pts[i][0], pts[i][1], p[0], p[1], r)))
const ARMS = any(
  ...[1, -1].map((m) => {
    const x = (v: number) => 16 + m * (v - 16)
    return limb([[x(13.6), 28.5], [x(9.2), 33], [x(8.2), 38.6]], 1.15)
  }),
)
const TORSO = stick(16, 27, 16, 38, 3.3, 2.6)
// A pixel wider all round: the chest rising, now and then.
const CHEST = stick(16, 28, 16, 36, 3.3 + 0.7, 2.6 + 0.7)
const HIP = 37

type Leg = { x: number; ankle: number; out: 1 | -1 }

// A leg is six cells wide.
const HALF = 3

// The part of a leg on the files wall, measured from the fold: the shin goes
// straight up; the foot leans out and ends in three toes fanned out like
// fingers, the way it does in the show.
function shin({ x, ankle }: Leg): Shape {
  return stick(x, 0, x, ankle, HALF)
}
function foot({ x, ankle, out }: Leg): Shape {
  const tilt = 0.6 // radians out from straight up
  const ray = (angle: number, length: number): [number, number] => [out * Math.sin(angle) * length, Math.cos(angle) * length]
  const end: [number, number] = [x + ray(tilt, 8)[0], ankle + ray(tilt, 8)[1]]
  const side = ray(tilt + Math.PI / 2, 1) // one cell towards the outer edge
  const toe = (across: number, turn: number, length: number): Shape => {
    const a: [number, number] = [end[0] + side[0] * across, end[1] + side[1] * across]
    const d = ray(tilt + turn, length)
    return stick(a[0], a[1], a[0] + d[0], a[1] + d[1], 1.7, 1.4)
  }
  return any(stick(x, ankle, end[0], end[1], HALF, HALF + 0.8), toe(-2.2, -0.1, 5.6), toe(0.8, 0.45, 5.2), toe(3.2, 1.0, 4.4))
}

type Run = { x: number; y: number; w: number; fill: string }
// still: what never moves. The rest move on their own clocks (theme.css).
const PARTS = ['still', 'tap', 'breathe', 'look', 'blink'] as const
type Part = (typeof PARTS)[number]
type Painting = { cell: number; eye: Run[] } & Record<Part, Run[]>

// The window that is most of the west wall, the lookout's: in room units
// along the wall (z) and up from the floor, and the void beyond it in the
// Multiverse's own colours. Big, because the page covers the middle of
// whatever wall is faced; this way it shows round the edges too.
const DOOR = { half: 0.82, bottom: 0.22, top: 1.72 }
const VOID = '#1f3e9c'
const VOID_STAR = '#c4b1ff'

const BODY = 'var(--accent)'
const ON_FLOOR = 'var(--pov-floor)'

function paint(width: number, height: number, wall: number): Painting {
  const wallW = (WALL.right - WALL.left) * width
  const wallH = (SEAM - WALL.top) * height
  const u = Math.min(wallW, wallH)
  const cell = Math.max(3, Math.min(6, Math.round(u / 80)))
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  // Cells per room unit, measured on a wall seen square on: he keeps his
  // size whichever wall he is on.
  const perX = wallW / cell / 2
  const perY = wallH / cell / 2
  const tall = 2 * perY
  const fold = perY

  // The floor part at the legs' own scale, so the legs and the hips match;
  // the head bigger, so the face fills much of the wall.
  const kFloor = HALF / 1.55
  const kHead = (0.78 * tall) / NECK.y
  const head = fromSprite(HEAD, kHead, fold)
  const eye = fromSprite(EYE, kHead, fold)
  const pupil = fromSprite(PUPIL, kHead, fold)
  const mouth = fromSprite(MOUTH, kHead, fold)
  const torso = fromSprite(any(TORSO, ARMS), kFloor, fold)
  const chest = fromSprite(CHEST, kFloor, fold)

  const apart = Math.round((0.16 * u) / cell)
  const ankle = Math.round(tall * 0.66)
  const hip = -fold + (HIP - NECK.y) * kFloor
  const legs: Leg[] = [
    { x: -apart, ankle, out: -1 },
    { x: apart, ankle, out: 1 },
  ]
  // From the hips, across the floor, to where the floor meets the files' wall.
  const thighs = any(...legs.map((l) => stick(Math.sign(l.x) * 1.4 * kFloor, hip, l.x, fold, HALF)))
  const up = any(...legs.map(shin), foot(legs[0]))
  const tapping = foot(legs[1])
  const frame = 1.5 // the door frame, in cells

  const out: Painting = { cell, eye: [], still: [], tap: [], breathe: [], look: [], blink: [] }
  const push = (into: Run[], col: number, row: number, fill: string) => {
    const last = into[into.length - 1]
    if (last && last.y === row * cell && last.fill === fill && last.x + last.w === col * cell) last.w += cell
    else into.push({ x: col * cell, y: row * cell, w: cell, fill })
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const at = spot(((col + 0.5) * cell) / width, ((row + 0.5) * cell) / height, wall)
      if (!at) continue
      const s = unroll(at, perX, perY)
      if (s?.on === 'wishes') {
        const { a, c } = s
        if (eye(a, c)) {
          push(out.still, col, row, '#ffffff')
          push(out.eye, col, row, '#ffffff')
          push(out.blink, col, row, BODY)
          if (pupil(a, c)) push(out.look, col, row, '#19c9f0')
        } else if (mouth(a, c)) push(out.still, col, row, '#ffffff')
        else if (head(a, c)) push(out.still, col, row, BODY)
      } else if (s?.on === 'floor') {
        const { a, c } = s
        if (torso(a, c) || thighs(a, c)) push(out.still, col, row, ON_FLOOR)
        else if (chest(a, c)) push(out.breathe, col, row, ON_FLOOR)
      } else if (s?.on === 'files') {
        const a = s.a
        const y = s.c - fold
        if (up(a, y)) push(out.still, col, row, BODY)
        else if (tapping(a, y)) push(out.tap, col, row, BODY)
      } else if (at.x < -0.999 && Math.abs(at.z) < DOOR.half && at.y > DOOR.bottom && at.y < DOOR.top) {
        const edge = DOOR.half - Math.abs(at.z) < frame / perX || DOOR.top - at.y < frame / perY || at.y - DOOR.bottom < frame / perY
        // Stars beyond stay put on the screen: far enough away not to move.
        const star = !edge && ((col * 73856093) ^ (row * 19349663)) % 37 === 0
        push(out.still, col, row, edge ? 'var(--bg-deep)' : star ? VOID_STAR : VOID)
      }
    }
  }
  return out
}

function Runs({ runs, cell, className, clip }: { runs: Run[]; cell: number; className?: string; clip?: string }) {
  return (
    <g className={className} clipPath={clip}>
      {runs.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={cell} fill={r.fill} />
      ))}
    </g>
  )
}

function PrismoArt({ wall }: { wall: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [width, height] = useSize(ref)
  const art = useMemo(() => paint(width, height, wall), [width, height, wall])
  return (
    <svg
      ref={ref}
      className="prismo-art sprite"
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      style={{ '--cell': `${art.cell}px` } as CSSProperties}
    >
      <defs>
        {/* The pupil looks about without leaving the white of his eye. */}
        <clipPath id="prismo-eye">
          {art.eye.map((r) => (
            <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={art.cell} />
          ))}
        </clipPath>
      </defs>
      <Runs runs={art.still} cell={art.cell} />
      <Runs runs={art.breathe} cell={art.cell} className="prismo-breathe" />
      <Runs runs={art.tap} cell={art.cell} className="prismo-tap" />
      <Runs runs={art.look} cell={art.cell} className="prismo-look" clip="url(#prismo-eye)" />
      <Runs runs={art.blink} cell={art.cell} className="prismo-blink" />
    </svg>
  )
}

// Inside the cube: the wall ahead, floor and the four edges running to the
// corners. Every wall looks like this; what is on it is PrismoArt's business.
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
      <PrismoArt wall={wall} />
    </div>
  )
}

export function Backdrop() {
  const theme = useTheme()
  if (theme === 'multiverse') return <Multiverse />
  if (theme === 'timeroom') return <TimeRoom />
  return null
}
