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
    </div>
  )
}

export function Backdrop() {
  const theme = useTheme()
  if (theme === 'multiverse') return <Multiverse />
  if (theme === 'timeroom') return <TimeRoom />
  return null
}
