import { useEffect, useRef } from 'react'
import { facing } from '../lib/room'
import { useStore } from '../lib/store'

// Turning to another wall is a cut, the way an old screen switches from one
// camera feed to the next: for a fifth of a second the picture breaks up into
// static and torn lines, then the other wall is simply there. Drawn on a
// coarse grid of big pixels and scaled up, like the rest of the app.

const CELL = 4 // screen pixels per pixel of static
const FRAME_MS = 55

type Frame = (img: ImageData, cols: number, rows: number) => void

function snowAt(img: ImageData, cols: number, row: number, alpha: number, density = 1) {
  for (let x = 0; x < cols; x++) {
    if (density < 1 && Math.random() > density) continue
    const v = Math.random() * 255
    img.data.set([v, v, v, alpha], (row * cols + x) * 4)
  }
}

function line(img: ImageData, cols: number, row: number, rgba: [number, number, number, number]) {
  for (let x = 0; x < cols; x++) img.data.set(rgba, (row * cols + x) * 4)
}

// The signal is gone: the whole screen is snow, a few rows brighter.
const snow: Frame = (img, cols, rows) => {
  for (let y = 0; y < rows; y++) snowAt(img, cols, y, 225)
  for (let i = 0; i < 3; i++) line(img, cols, Math.floor(Math.random() * rows), [235, 235, 235, 200])
}

// It comes back in strips: bands of snow across a picture that is already there.
const tear: Frame = (img, cols, rows) => {
  for (let i = 0; i < 5; i++) {
    const top = Math.floor(Math.random() * rows)
    const tall = 2 + Math.floor(Math.random() * Math.max(3, rows / 12))
    for (let y = top; y < Math.min(rows, top + tall); y++) snowAt(img, cols, y, 190)
  }
  line(img, cols, Math.floor(Math.random() * rows), [255, 255, 255, 255])
}

// Last of it: a dark bar rolling through, and a little snow left over.
const roll: Frame = (img, cols, rows) => {
  const top = Math.floor(Math.random() * rows * 0.8)
  for (let y = top; y < Math.min(rows, top + Math.ceil(rows / 10)); y++) line(img, cols, y, [0, 0, 0, 110])
  for (let y = 0; y < rows; y++) snowAt(img, cols, y, 140, 0.06)
}

const FRAMES: Frame[] = [snow, tear, roll]

export function FeedCut() {
  const { n } = useStore(facing)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx || n === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const cols = Math.ceil(window.innerWidth / CELL)
    const rows = Math.ceil(window.innerHeight / CELL)
    el.width = cols
    el.height = rows
    const root = document.documentElement

    // A turn straight after another starts the jolt over.
    delete root.dataset.cut
    void root.offsetWidth
    root.dataset.cut = 'on'

    let frame = 0
    const draw = () => {
      const img = ctx.createImageData(cols, rows)
      FRAMES[frame](img, cols, rows)
      ctx.putImageData(img, 0, 0)
      el.hidden = false
    }
    draw()
    const timer = window.setInterval(() => {
      frame++
      if (frame < FRAMES.length) draw()
      else stop()
    }, FRAME_MS)
    function stop() {
      window.clearInterval(timer)
      el!.hidden = true
      delete root.dataset.cut
    }
    return stop
  }, [n])

  return <canvas ref={canvas} className="feed-cut sprite" hidden aria-hidden />
}
