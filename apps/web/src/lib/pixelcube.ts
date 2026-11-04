// The Time Room as pixel art: a cube with a square hole in the middle of
// every face, drawn by casting one ray per pixel. Through a hole you see the
// inside of the far walls, and through two holes in line, right through it.
// A quarter turn looks the same as the start, so a quarter turn of frames
// loops forever. The frames go side by side into one sprite sheet, which CSS
// steps through: no script runs while it spins.

export interface CubeLook {
  /** Outside of the walls, lit to unlit: four tones. */
  faces: [string, string, string, string]
  /** Inside of the walls, lit to unlit: three tones. */
  inside: [string, string, string]
  /** The outline, and the rim of every hole. */
  line: string
}

export interface CubeView {
  /** Sprite size in pixels; the cube fills it. */
  grid: number
  /** Frames over a quarter turn. */
  frames: number
  /** Radians. Positive looks down on the top, negative up at the bottom. */
  tilt: number
  /** Radians the whole picture leans. */
  roll?: number
  /** Half the width of a hole, as a share of half a face. */
  hole?: number
}

type V3 = [number, number, number]

const LIGHT: V3 = (() => {
  const v: V3 = [-0.45, 0.75, 0.55]
  const n = Math.hypot(...v)
  return [v[0] / n, v[1] / n, v[2] / n]
})()

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Paint one frame into `out` (RGBA) at column offset `ox` of a sheet `stride` pixels wide. */
function frame(view: Required<CubeView>, look: CubeLook, angle: number, out: Uint8ClampedArray, ox: number, stride: number) {
  const { grid, tilt, roll, hole } = view
  // Object to camera: turn about the vertical, tilt, then lean.
  const [cy, sy] = [Math.cos(angle), Math.sin(angle)]
  const [ct, st] = [Math.cos(tilt), Math.sin(tilt)]
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)]
  const toCam = (v: V3): V3 => {
    const x1 = v[0] * cy + v[2] * sy
    const z1 = -v[0] * sy + v[2] * cy
    const y2 = v[1] * ct - z1 * st
    const z2 = v[1] * st + z1 * ct
    return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2]
  }
  const toObj = (v: V3): V3 => {
    const x1 = v[0] * cr + v[1] * sr
    const y1 = -v[0] * sr + v[1] * cr
    const y2 = y1 * ct + v[2] * st
    const z2 = -y1 * st + v[2] * ct
    return [x1 * cy - z2 * sy, y2, x1 * sy + z2 * cy]
  }
  const dir = toObj([0, 0, -1])
  // However it is turned, a cube is at most root 3 half-sides from its centre.
  const unit = (grid / 2 - 1) / 1.74

  // Which surface each pixel shows: 0 nothing, 1-6 a wall from outside,
  // 7-12 a wall from inside. Kept for the outline pass.
  const ids = new Uint8Array(grid * grid)
  const tones = new Array<string>(grid * grid)
  const shade = (axis: number, sign: number, palette: readonly string[]) => {
    const n: V3 = [0, 0, 0]
    n[axis] = sign
    const lit = toCam(n).reduce((sum, c, i) => sum + c * LIGHT[i], 0)
    const steps = palette.length
    const at = lit > 0.55 ? 0 : lit > 0.2 ? 1 : lit > -0.15 ? 2 : 3
    return palette[Math.min(steps - 1, at)]
  }
  const inHole = (p: V3, axis: number) => {
    const a = (axis + 1) % 3
    const b = (axis + 2) % 3
    return Math.abs(p[a]) < hole && Math.abs(p[b]) < hole
  }

  for (let py = 0; py < grid; py++) {
    for (let px = 0; px < grid; px++) {
      const o = toObj([(px + 0.5 - grid / 2) / unit, (grid / 2 - py - 0.5) / unit, 5])
      let near = -Infinity
      let far = Infinity
      let enter = 0
      let exit = 0
      let miss = false
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dir[a]) < 1e-9) {
          if (Math.abs(o[a]) > 1) miss = true
          continue
        }
        const t1 = (-1 - o[a]) / dir[a]
        const t2 = (1 - o[a]) / dir[a]
        if (Math.min(t1, t2) > near) {
          near = Math.min(t1, t2)
          enter = a
        }
        if (Math.max(t1, t2) < far) {
          far = Math.max(t1, t2)
          exit = a
        }
      }
      if (miss || near > far) continue
      const i = py * grid + px
      const p: V3 = [o[0] + dir[0] * near, o[1] + dir[1] * near, o[2] + dir[2] * near]
      const pSign = Math.sign(p[enter]) || 1
      if (!inHole(p, enter)) {
        ids[i] = 1 + enter * 2 + (pSign > 0 ? 1 : 0)
        tones[i] = shade(enter, pSign, look.faces)
        continue
      }
      const q: V3 = [o[0] + dir[0] * far, o[1] + dir[1] * far, o[2] + dir[2] * far]
      if (inHole(q, exit)) continue // right through two holes
      const qSign = Math.sign(q[exit]) || 1
      ids[i] = 7 + exit * 2 + (qSign > 0 ? 1 : 0)
      tones[i] = shade(exit, -qSign, look.inside)
    }
  }

  // Outline: any wall pixel next to empty space, and the outside of a wall
  // next to a view inside (the rim of a hole).
  const line = rgb(look.line)
  for (let py = 0; py < grid; py++) {
    for (let px = 0; px < grid; px++) {
      const i = py * grid + px
      const id = ids[i]
      if (!id) continue
      let edge = false
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx
        const ny = py + dy
        const other = nx < 0 || ny < 0 || nx >= grid || ny >= grid ? 0 : ids[ny * grid + nx]
        if (other === 0 || (id <= 6 && other > 6)) edge = true
      }
      const [r, g, b] = edge ? line : rgb(tones[i])
      const o = (py * stride + ox + px) * 4
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = 255
    }
  }
}

const sheets = new Map<string, string>()

/** A sprite sheet of a quarter turn, frames side by side, as a data URL. */
export function cubeSheet(view: CubeView, look: CubeLook): string {
  const full: Required<CubeView> = { roll: 0, hole: 0.36, ...view }
  const key = JSON.stringify([full, look])
  const cached = sheets.get(key)
  if (cached) return cached
  const { grid, frames } = full
  const canvas = document.createElement('canvas')
  canvas.width = grid * frames
  canvas.height = grid
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(canvas.width, canvas.height)
  for (let f = 0; f < frames; f++) frame(full, look, (Math.PI / 2) * (f / frames), img.data, f * grid, canvas.width)
  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL('image/png')
  sheets.set(key, url)
  return url
}

// --- Colours from the theme ----------------------------------------------

function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('')}`
}

let probe: CanvasRenderingContext2D | null = null
function cssColor(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe) return fallback
  probe.fillStyle = fallback
  probe.fillStyle = raw
  return probe.fillStyle.startsWith('#') ? probe.fillStyle : fallback
}

/** The cube in the current theme's colours (read from the --cube-* tokens). */
export function themeCube(): CubeLook {
  const top = cssColor('--cube-top', '#ffe680')
  const front = cssColor('--cube-front', '#f6d54a')
  const side = cssColor('--cube-side', '#dcae1c')
  const line = cssColor('--cube-line', '#2a1a3e')
  return {
    faces: [top, front, side, mix(side, line, 0.22)],
    inside: [mix(side, line, 0.3), mix(side, line, 0.45), mix(side, line, 0.6)],
    line,
  }
}
