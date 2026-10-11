import type { CSSProperties } from 'react'

// Prismo's cube: the Time Room seen from outside, turning in steps.
// Used as the loading indicator everywhere.
export function Cube({ size = 32, still = false, label }: { size?: number; still?: boolean; label?: string }) {
  return (
    <span className="cube-scene" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className={`cube block${still ? ' cube-still' : ''}`} style={{ '--s': `${size}px` } as CSSProperties}>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
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
