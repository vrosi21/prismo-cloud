import { useMemo, type CSSProperties } from 'react'
import { cubeSheet, themeCube } from '../lib/pixelcube'
import { any, ellipse, polygon, raster, stick } from '../lib/raster'
import { useTheme } from '../lib/theme'

const SPIN_FRAMES = 8

// Prismo's cube, the Time Room, seen from outside and turning in steps like a
// sprite. Used as the loading indicator everywhere.
export function Cube({ size = 32, still = false, label }: { size?: number; still?: boolean; label?: string }) {
  const theme = useTheme()
  // Big cubes get bigger pixels, so every size reads as pixel art.
  const scale = size >= 48 ? 3 : size >= 32 ? 2 : 1
  const grid = Math.max(9, Math.round(size / scale))
  const px = grid * scale
  const sheet = useMemo(() => cubeSheet({ grid, frames: SPIN_FRAMES, tilt: 0.42 }, themeCube()), [grid, theme])
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`pcube sprite${still ? ' pcube-still' : ''}`}
      style={
        {
          width: px,
          height: px,
          backgroundImage: `url(${sheet})`,
          backgroundSize: `${px * SPIN_FRAMES}px ${px}px`,
          backgroundPositionX: still ? -px * 3 : undefined,
          '--pcube-run': `${-px * SPIN_FRAMES}px`,
        } as CSSProperties
      }
    />
  )
}

export type Mood = 'idle' | 'busy' | 'happy' | 'sad'

// Each entry: x, y, width, height on a 22x14 grid.
type Px = [number, number, number, number]

const EYES: Record<Mood, Px[]> = {
  idle: [[5, 4, 2, 3], [15, 4, 2, 3]],
  sad: [[5, 5, 2, 2], [15, 5, 2, 2]],
  busy: [[4, 5, 4, 1], [14, 5, 4, 1]],
  happy: [[4, 5, 1, 1], [5, 4, 2, 1], [7, 5, 1, 1], [14, 5, 1, 1], [15, 4, 2, 1], [17, 5, 1, 1]],
}

const MOUTH: Record<Mood, Px[]> = {
  idle: [[8, 9, 1, 1], [9, 10, 4, 1], [13, 9, 1, 1]],
  sad: [[8, 11, 1, 1], [9, 10, 4, 1], [13, 11, 1, 1]],
  busy: [[10, 9, 2, 2]],
  happy: [[8, 9, 6, 1], [9, 10, 4, 2]],
}

// A BMO-style face that mirrors what the app is doing.
export function BmoFace({ mood, scale = 2 }: { mood: Mood; scale?: number }) {
  const blink = mood === 'idle' || mood === 'sad'
  return (
    <svg
      viewBox="0 0 22 14"
      width={22 * scale}
      height={14 * scale}
      shapeRendering="crispEdges"
      className="sprite shrink-0"
      role="img"
      aria-label={`status: ${mood}`}
    >
      <rect width="22" height="14" fill="var(--bg-deep)" />
      <g fill="var(--ink)">
        {EYES[mood].map(([x, y, w, h], i) => (
          <rect key={`e${i}`} x={x} y={y} width={w} height={h} className={blink ? 'face-eye' : undefined} />
        ))}
        {MOUTH[mood].map(([x, y, w, h], i) => (
          <rect key={`m${i}`} x={x} y={y} width={w} height={h} />
        ))}
      </g>
    </svg>
  )
}

// The wishmaster, flat and pink, on a 32x56 grid: the bumpy back of his
// head, a long nose, one big eye, skinny limbs and toes that splay out.
const PRISMO_W = 32
const PRISMO_H = 56
const PRISMO_RUNS = (() => {
  const head = any(
    ellipse(16.5, 11.5, 8.5, 10.5),
    ellipse(9.5, 4.5, 3.6),
    ellipse(7.5, 9.5, 3.8),
    ellipse(7.5, 15, 3.8),
    ellipse(9.5, 19.5, 3.4),
    ellipse(13.5, 2, 2.8),
    polygon([[23.5, 12.5], [30.6, 17.4], [29.6, 18.6], [23, 18.2]]),
  )
  const limb = (pts: [number, number][], r: number) => any(...pts.slice(1).map((p, i) => stick(pts[i][0], pts[i][1], p[0], p[1], r)))
  const side = (m: 1 | -1) => {
    const x = (v: number) => 16 + m * (v - 16)
    return any(
      limb([[x(13.6), 28.5], [x(9.2), 33], [x(8.2), 38.6]], 1.15),
      limb([[x(14.6), 37], [x(13.2), 50.2]], 1.55),
      stick(x(13.2), 51, x(8.6), 52.6, 1.55, 1.75),
      stick(x(9.6), 52.1, x(6.6), 50.6, 0.95),
      stick(x(9.8), 53.1, x(6.6), 54, 0.95),
    )
  }
  const body = any(head, stick(16, 20, 16, 27, 1.7), stick(16, 27, 16, 38, 3.3, 2.6), side(1), side(-1))
  const eye = ellipse(20, 10, 3.9, 2.5)
  return raster(PRISMO_W, PRISMO_H, [
    { fill: 'var(--accent)', shape: body },
    { fill: '#ffffff', shape: eye },
    { fill: '#19c9f0', shape: (x, y) => eye(x, y) && ellipse(18.8, 10, 1.7, 2.4)(x, y) },
    { fill: '#ffffff', shape: polygon([[18.4, 19.5], [24, 19.1], [24.4, 20.5], [18.8, 21]]) },
  ])
})()

// Shown where there is nothing else to show: empty pages and the sign-in screen.
export function Prismo({ scale = 3 }: { scale?: number }) {
  return (
    <svg
      viewBox={`0 0 ${PRISMO_W} ${PRISMO_H}`}
      width={PRISMO_W * scale}
      height={PRISMO_H * scale}
      shapeRendering="crispEdges"
      className="sprite"
      aria-hidden
    >
      {PRISMO_RUNS.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
      ))}
    </svg>
  )
}

// A ten-block progress bar, filled in whole blocks.
export function Blocks({ value }: { value: number }) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * 10)
  return (
    <span className="inline-flex gap-[2px]" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className="block h-[10px] w-[7px]" style={{ background: i < filled ? 'var(--accent-deep)' : 'var(--bg-deep)' }} />
      ))}
    </span>
  )
}

// A folder, on a 16x13 grid: tab and back in the deep accent, the front flap
// in the accent with a lit top edge.
export function FolderIcon({ scale = 2 }: { scale?: number }) {
  return (
    <svg viewBox="0 0 16 13" width={16 * scale} height={13 * scale} shapeRendering="crispEdges" className="sprite shrink-0" aria-hidden>
      <path fill="var(--line)" d="M1 0h5v1h1v1h8v1h1v9h-1v1H1v-1H0V1h1z" />
      <path fill="var(--accent-deep)" d="M1 1h4v1h1v1h9v8H1z" />
      <path fill="var(--accent)" d="M1 5h14v6H1z" />
      <path fill="var(--hi)" d="M1 4h14v1H1z" />
    </svg>
  )
}

// The button that opens and closes a folder in the tree, on a 9x10 grid: a
// small raised box with a plus while the folder is shut, pressed in (down a
// pixel, its shadow gone, shade on top) with a minus while it is open, the way
// every button in the app presses. Colours come from --twist-face and
// --twist-sign, so a hover can recolour it.
export function Twist({ open, scale = 2 }: { open: boolean; scale?: number }) {
  const d = open ? 1 : 0
  return (
    <svg viewBox="0 0 9 10" width={9 * scale} height={10 * scale} shapeRendering="crispEdges" className="sprite" aria-hidden>
      {!open && <path fill="var(--shadow)" d="M1 9h7v1H1z" />}
      <path fill="var(--line)" d={`M1 ${d}h7v1h1v7h-1v1H1v-1H0v-7h1z`} />
      <path fill="var(--twist-face, var(--panel))" d={`M1 ${1 + d}h7v7H1z`} />
      <path fill={open ? 'var(--lo)' : 'var(--hi)'} d={`M1 ${1 + d}h7v1H1z`} />
      <path fill="var(--twist-sign, var(--ink))" d={open ? `M2 ${4 + d}h5v1H2z` : `M2 ${4 + d}h5v1H2zM4 ${2 + d}h1v5H4z`} />
    </svg>
  )
}

// An arrow for a key cap, on a 7x7 grid: drawn pointing up and turned for
// the other three, which keeps every pixel square.
const TURN = { up: 0, right: 90, down: 180, left: 270 }
export type ArrowDir = keyof typeof TURN
export function Arrow({ dir, scale = 2 }: { dir: ArrowDir; scale?: number }) {
  return (
    <svg viewBox="0 0 7 7" width={7 * scale} height={7 * scale} shapeRendering="crispEdges" className="sprite" style={{ transform: `rotate(${TURN[dir]}deg)` }} aria-hidden>
      <path fill="currentColor" d="M3 0h1v1h1v1h1v1h1v1H4v3H3V4H0V3h1V2h1V1h1z" />
    </svg>
  )
}

// A tick for a selected file, on a 7x6 grid.
export function Check({ scale = 2 }: { scale?: number }) {
  return (
    <svg viewBox="0 0 7 6" width={7 * scale} height={6 * scale} shapeRendering="crispEdges" className="sprite" aria-hidden>
      <path fill="currentColor" d="M6 0h1v2H6v1H5v1H4v1H3v1H2V5H1V4H0V2h1v1h1v1h1V3h1V2h1V1h1z" />
    </svg>
  )
}

// A page with its corner folded down, for files with no picture, on a 10x12 grid.
export function FileIcon({ scale = 3 }: { scale?: number }) {
  return (
    <svg viewBox="0 0 10 12" width={10 * scale} height={12 * scale} shapeRendering="crispEdges" className="sprite" aria-hidden>
      <path fill="var(--line)" d="M0 0h7v1h1v1h1v1h1v9H0z" />
      <path fill="var(--panel)" d="M1 1h5v3h3v7H1z" />
      <path fill="var(--hi)" d="M7 1v2h2V2H8V1z" />
      <path fill="var(--ink-dim)" d="M2 6h6v1H2zm0 2h6v1H2zm0 2h4v1H2z" />
    </svg>
  )
}

