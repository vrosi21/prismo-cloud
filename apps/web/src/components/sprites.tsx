import { useMemo, type CSSProperties } from 'react'
import { cubeSheet, themeCube } from '../lib/pixelcube'
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

const PRISMO = [
  '....####....',
  '...######...',
  '..########..',
  '..#.####.#..',
  '..########..',
  '...######...',
  '....####....',
  '.....##.....',
  '..########..',
  '.##########.',
  '##.######.##',
  '#..######..#',
  '#..######..#',
  '...######...',
  '...######...',
  '...##..##...',
  '...##..##...',
  '..###..###..',
]

// The wishmaster as a flat shadow on the wall. Shown where there is nothing
// else to show: empty pages and the sign-in screen.
export function Prismo({ scale = 6 }: { scale?: number }) {
  return (
    <svg
      viewBox={`0 0 12 ${PRISMO.length}`}
      width={12 * scale}
      height={PRISMO.length * scale}
      shapeRendering="crispEdges"
      className="sprite"
      aria-hidden
    >
      {PRISMO.flatMap((row, y) =>
        [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="var(--accent)" /> : null)),
      )}
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

// A folder, on a 14x11 grid.
export function FolderIcon({ scale = 2 }: { scale?: number }) {
  return (
    <svg viewBox="0 0 14 11" width={14 * scale} height={11 * scale} shapeRendering="crispEdges" className="sprite shrink-0" aria-hidden>
      <path fill="var(--line)" d="M1 0h5v1h1v1h6v1h1v7h-1v1H1v-1H0V1h1z" />
      <path fill="var(--accent)" d="M1 1h4v1h1v1h7v7H1z" />
      <path fill="var(--panel-2)" d="M1 4h12v6H1z" />
    </svg>
  )
}
