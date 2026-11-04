// Pixel art from shapes: each layer is a shape and a colour, the grid is
// filled cell by cell from the topmost layer that covers the cell's centre,
// and runs of one colour along a row merge into one rect.

export type Shape = (x: number, y: number) => boolean

export const ellipse =
  (cx: number, cy: number, rx: number, ry = rx): Shape =>
  (x, y) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1

/** A stick from a to b, r0 thick at a and r1 at b, round at both ends. */
export const stick =
  (ax: number, ay: number, bx: number, by: number, r0: number, r1 = r0): Shape =>
  (x, y) => {
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    const r = r0 + (r1 - r0) * t
    return (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2 <= r * r
  }

export const polygon =
  (pts: [number, number][]): Shape =>
  (x, y) => {
    let hit = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }

export const any =
  (...shapes: Shape[]): Shape =>
  (x, y) =>
    shapes.some((s) => s(x, y))

export type Layer = { fill: string; shape: Shape }
export type Run = { x: number; y: number; w: number; fill: string }

/** Later layers are drawn on top of earlier ones. */
export function raster(width: number, height: number, layers: Layer[]): Run[] {
  const runs: Run[] = []
  for (let y = 0; y < height; y++) {
    let cur: Run | null = null
    for (let x = 0; x < width; x++) {
      let fill: string | null = null
      for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i].shape(x + 0.5, y + 0.5)) {
          fill = layers[i].fill
          break
        }
      }
      if (cur && fill === cur.fill) cur.w++
      else {
        if (cur) runs.push(cur)
        cur = fill ? { x, y, w: 1, fill } : null
      }
    }
    if (cur) runs.push(cur)
  }
  return runs
}
