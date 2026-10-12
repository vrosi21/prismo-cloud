// Pixel work for the sticker maker. Everything here takes plain ImageData and
// changes it in place, so none of it needs a page to be tried out.

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Rgb = [number, number, number]

/** How far a pixel is from a colour: the largest gap in any one channel, 0..255. */
function gap(d: Uint8ClampedArray, i: number, c: Rgb): number {
  return Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]))
}

/**
 * Erases every pixel that can be walked to from the seeds over pixels close
 * to `colour`. Returns how many it erased.
 */
function flood(img: ImageData, seeds: Iterable<number>, colour: Rgb, tolerance: number): number {
  const { data: d, width: w, height: h } = img
  // 1: erased. 2: an edge pixel that has been softened already.
  const state = new Uint8Array(w * h)
  // Every pixel is put on the stack at most once, so this never overflows.
  const stack = new Uint32Array(w * h)
  let top = 0
  const take = (p: number) => {
    if (state[p] || d[p * 4 + 3] === 0 || gap(d, p * 4, colour) > tolerance) return
    state[p] = 1
    stack[top++] = p
  }
  for (const p of seeds) take(p)

  const lastRow = w * (h - 1)
  let count = 0
  while (top > 0) {
    const p = stack[--top]
    count++
    const x = p % w
    if (x > 0) take(p - 1)
    if (x < w - 1) take(p + 1)
    if (p >= w) take(p - w)
    if (p < lastRow) take(p + w)
  }
  if (count === 0) return 0

  soften(img, state, colour)
  for (let p = 0; p < state.length; p++) if (state[p] === 1) d[p * 4 + 3] = 0
  return count
}

/**
 * The pixels right next to what was erased are a blend of the subject and the
 * erased colour: that blend is what makes an edge look smooth. Left alone they
 * become a pale rim on any other background. So each one is taken apart: how
 * much of it is subject becomes its opacity, and the erased colour is taken
 * out of what remains.
 */
function soften(img: ImageData, state: Uint8Array, colour: Rgb) {
  const { data: d, width: w, height: h } = img
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (let p = 0; p < state.length; p++) {
    if (state[p] !== 1) continue
    const x = p % w
    const y = (p - x) / w
    for (const [dx, dy] of steps) {
      const ex = x + dx
      const ey = y + dy
      if (ex < 0 || ex >= w || ey < 0 || ey >= h) continue
      const edge = ey * w + ex
      if (state[edge] || d[edge * 4 + 3] === 0) continue
      state[edge] = 2

      // One step further in is, with luck, pure subject: the yardstick.
      const ix = ex + dx
      const iy = ey + dy
      const inside = ix >= 0 && ix < w && iy >= 0 && iy < h ? iy * w + ix : -1
      const far = inside >= 0 && state[inside] !== 1 && d[inside * 4 + 3] !== 0 ? gap(d, inside * 4, colour) : 255
      const near = gap(d, edge * 4, colour)
      if (near >= far) continue // as far from the erased colour as what is behind it: not a blend

      const share = near / far
      const i = edge * 4
      for (let c = 0; c < 3; c++) d[i + c] = colour[c] + (d[i + c] - colour[c]) / share
      d[i + 3] = d[i + 3] * share
    }
  }
}

/** Erases the colour that was clicked, as far as it reaches from there. */
export function eraseAt(img: ImageData, x: number, y: number, tolerance: number): number {
  const p = y * img.width + x
  const i = p * 4
  const d = img.data
  if (d[i + 3] === 0) return 0
  return flood(img, [p], [d[i], d[i + 1], d[i + 2]], tolerance)
}

/**
 * Erases the background of a picture that has a plain one: the colour most of
 * the picture's edge has, as far as it reaches inward from the edge.
 */
export function eraseEdges(img: ImageData, tolerance: number): number {
  const { data: d, width: w, height: h } = img
  const edge: number[] = []
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1)

  // Count colours in coarse steps, so a slightly noisy background is still one colour.
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const p of edge) {
    const i = p * 4
    if (d[i + 3] === 0) continue
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)
    let bin = bins.get(key)
    if (!bin) bins.set(key, (bin = { n: 0, r: 0, g: 0, b: 0 }))
    bin.n++
    bin.r += d[i]
    bin.g += d[i + 1]
    bin.b += d[i + 2]
    if (!best || bin.n > best.n) best = bin
  }
  if (!best) return 0
  return flood(img, edge, [best.r / best.n, best.g / best.n, best.b / best.n], tolerance)
}

/** Keeps of each pixel only as much as the mask says (0..255 per pixel). */
export function applyMask(img: ImageData, mask: Uint8ClampedArray): number {
  const d = img.data
  let erased = 0
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4 + 3
    if (d[i] !== 0 && mask[p] === 0) erased++
    d[i] = (d[i] * mask[p]) / 255
  }
  return erased
}

// Fainter than this does not count as part of the picture.
const VISIBLE = 12

/** The smallest box that holds everything visible, or null when nothing is. */
export function contentBox(img: ImageData): Box | null {
  const { data: d, width: w, height: h } = img
  let left = w
  let right = -1
  let top = h
  let bottom = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4 + 3
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4] < VISIBLE) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      bottom = y
    }
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
}
