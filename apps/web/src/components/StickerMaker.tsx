import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Asset } from '../api'
import { displayName } from '../lib/format'
import { errorText, log } from '../lib/log'
import { useRefreshLibrary } from '../lib/queries'
import { applyMask, contentBox, eraseAt, eraseEdges, type Box } from '../lib/sticker'
import { uploadFiles } from '../lib/uploads'
import { Cube } from './sprites'

interface Props {
  asset: Asset
  onClose: () => void
}

type Tool = 'crop' | 'colour' | 'rub'
type Busy = 'opening' | 'thinking' | 'saving' | null

const TOOLS: { id: Tool; name: string; hint: string }[] = [
  { id: 'crop', name: 'crop', hint: 'drag a box around what you want to keep.' },
  { id: 'colour', name: 'erase colour', hint: 'click a colour in the picture: it is erased as far as it reaches from there.' },
  { id: 'rub', name: 'rub out', hint: 'rub over what should go.' },
]

const BUSY_TEXT = { opening: 'opening the picture', thinking: 'looking for the subject', saving: 'saving' } as const

// Chat programs show stickers at about this size.
const STICKER_SIDE = 512
// A picture bigger than this is scaled down when opened: every step that can
// be undone is a full copy of it in memory.
const MAX_PIXELS = 12_000_000
const UNDO_BYTES = 256 * 1024 * 1024

function fresh(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/** Scales a picture down. Halving first keeps thin lines from breaking up. */
function shrink(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let from = source
  while (from.width >= width * 2 && from.height >= height * 2) {
    const half = fresh(Math.ceil(from.width / 2), Math.ceil(from.height / 2))
    half.ctx.drawImage(from, 0, 0, half.canvas.width, half.canvas.height)
    from = half.canvas
  }
  const out = fresh(width, height)
  out.ctx.drawImage(from, 0, 0, width, height)
  return out.canvas
}

// Lets the browser draw what has just changed before a long job freezes it.
// A tab in the background draws nothing, so a timer stands in for the frame.
const nextPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
    setTimeout(resolve, 150)
  })

/**
 * Turns a picture into a sticker: cut it to size, take its background away,
 * save the result as a new file in the "stickers" folder. The original is
 * never changed.
 */
export function StickerMaker({ asset, onClose }: Props) {
  const refresh = useRefreshLibrary()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const picture = useRef<HTMLImageElement | null>(null)
  const undo = useRef<ImageData[]>([])
  const stroke = useRef<{ x: number; y: number } | null>(null)
  const dragFrom = useRef<{ x: number; y: number } | null>(null)

  // Read once: the link may come back different each time the library is
  // refreshed, and that must not reopen the picture over what has been done.
  const [source] = useState(asset.urls.file!)
  const [busy, setBusy] = useState<Busy>('opening')
  const [tool, setTool] = useState<Tool>('crop')
  const [box, setBox] = useState<Box | null>(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const [steps, setSteps] = useState(0)
  const [tolerance, setTolerance] = useState(28)
  const [brush, setBrush] = useState(26)
  const [keepSize, setKeepSize] = useState(false)

  const paper = useCallback(() => {
    const canvas = canvasRef.current!
    return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! }
  }, [])

  /** Replaces the whole picture, which may change its size. */
  const show = useCallback(
    (img: ImageData) => {
      const { canvas, ctx } = paper()
      canvas.width = img.width
      canvas.height = img.height
      ctx.putImageData(img, 0, 0)
      setSize({ w: img.width, h: img.height })
      setBox(null)
    },
    [paper],
  )

  const remember = useCallback((img: ImageData) => {
    const list = undo.current
    list.push(img)
    let bytes = list.reduce((sum, step) => sum + step.data.length, 0)
    while (bytes > UNDO_BYTES && list.length > 1) bytes -= list.shift()!.data.length
    setSteps(list.length)
  }, [])

  const drawOriginal = useCallback(() => {
    const img = picture.current!
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (img.naturalWidth * img.naturalHeight)))
    const { canvas, ctx } = paper()
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    setSize({ w: canvas.width, h: canvas.height })
    setBox(null)
  }, [paper])

  const [failed, setFailed] = useState(false)
  useEffect(() => {
    // onload rather than decode(): decode() waits for the tab to be looked at.
    const img = new Image()
    img.onload = () => {
      picture.current = img
      drawOriginal()
      setBusy(null)
    }
    img.onerror = () => setFailed(true)
    img.src = source
    return () => {
      img.onload = img.onerror = null
    }
  }, [source, drawOriginal])
  useEffect(() => {
    if (!failed) return
    log('err', 'this picture cannot be opened for editing')
    onClose()
  }, [failed, onClose])

  /** Runs a change on the pixels. A change that erased nothing is not a step. */
  const change = useCallback(
    (work: (img: ImageData) => number): number => {
      const { canvas, ctx } = paper()
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const img = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height)
      const erased = work(img)
      if (erased > 0) {
        remember(before)
        ctx.putImageData(img, 0, 0)
      }
      return erased
    },
    [paper, remember],
  )

  const stepBack = useCallback(() => {
    const last = undo.current.pop()
    if (!last) return
    show(last)
    setSteps(undo.current.length)
  }, [show])

  const startOver = () => {
    const { canvas, ctx } = paper()
    remember(ctx.getImageData(0, 0, canvas.width, canvas.height))
    drawOriginal()
  }

  const touched = steps > 0
  useEffect(() => {
    // Capture phase, and stop there: this sits on top of the item view and
    // the library, and no key should reach either of them.
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        if (touched) log('info', 'not saved yet. "x" throws it away')
        else onClose()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        stepBack()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, stepBack, touched])

  // --- pointer: where on the picture, in the picture's own pixels ---------------

  const spot = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    const within = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v)))
    return {
      x: within(((e.clientX - r.left) * canvas.width) / r.width, canvas.width),
      y: within(((e.clientY - r.top) * canvas.height) / r.height, canvas.height),
      // How many picture pixels one screen pixel covers.
      zoom: canvas.width / r.width,
    }
  }

  const rub = (from: { x: number; y: number }, to: { x: number; y: number }, width: number) => {
    const { ctx } = paper()
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.restore()
  }

  const down = (e: ReactPointerEvent) => {
    if (busy || e.button !== 0) return
    const at = spot(e)
    if (tool === 'colour') {
      if (change((img) => eraseAt(img, at.x, at.y, tolerance)) === 0) log('info', 'nothing there to erase')
      return
    }
    try {
      // Keeps the drag ours when the pointer leaves the picture.
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the pointer is already gone; the drag just ends at the edge */
    }
    if (tool === 'crop') {
      dragFrom.current = at
      setBox(null)
    } else {
      const { canvas, ctx } = paper()
      remember(ctx.getImageData(0, 0, canvas.width, canvas.height))
      stroke.current = at
      rub(at, at, brush * at.zoom)
    }
  }

  const move = (e: ReactPointerEvent) => {
    const at = spot(e)
    if (dragFrom.current) {
      const from = dragFrom.current
      setBox({ x: Math.min(from.x, at.x), y: Math.min(from.y, at.y), w: Math.abs(at.x - from.x) + 1, h: Math.abs(at.y - from.y) + 1 })
    } else if (stroke.current) {
      rub(stroke.current, at, brush * at.zoom)
      stroke.current = at
    }
  }

  const up = () => {
    dragFrom.current = null
    stroke.current = null
    // A click without a drag is not a box.
    setBox((b) => (b && b.w > 3 && b.h > 3 ? b : null))
  }

  // --- the buttons ---------------------------------------------------------------

  const crop = () => {
    if (!box) return
    const { canvas, ctx } = paper()
    remember(ctx.getImageData(0, 0, canvas.width, canvas.height))
    show(ctx.getImageData(box.x, box.y, box.w, box.h))
  }

  const eraseBackground = () => {
    if (change((img) => eraseEdges(img, tolerance)) === 0) log('info', 'no plain colour along the edge. click the colour instead')
  }

  const cutOut = async () => {
    setBusy('thinking')
    try {
      await nextPaint()
      const { subjectMask } = await import('../lib/cutout')
      const mask = await subjectMask(paper().canvas)
      if (change((img) => applyMask(img, mask)) === 0) log('info', 'found nothing to take away')
    } catch (e) {
      log('err', `cut-out failed: ${errorText(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('saving')
    try {
      await nextPaint()
      const { canvas, ctx } = paper()
      const keep = contentBox(ctx.getImageData(0, 0, canvas.width, canvas.height))
      if (!keep) {
        log('err', 'nothing left to save')
        return
      }
      // Empty margins are cut off, so the sticker is as big as it can be.
      const cut = fresh(keep.w, keep.h)
      cut.ctx.drawImage(canvas, keep.x, keep.y, keep.w, keep.h, 0, 0, keep.w, keep.h)
      const scale = keepSize ? 1 : Math.min(1, STICKER_SIDE / Math.max(keep.w, keep.h))
      const out = scale < 1 ? shrink(cut.canvas, Math.max(1, Math.round(keep.w * scale)), Math.max(1, Math.round(keep.h * scale))) : cut.canvas
      const png = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
      if (!png) {
        log('err', 'this browser could not write the sticker')
        return
      }
      const name = `${displayName(asset).replace(/\.[a-z0-9]+$/i, '')}-sticker.png`
      uploadFiles([new File([png], name, { type: 'image/png' })], { collectionPath: 'stickers', kind: 'sticker', onStored: refresh })
      log('ok', 'sticker is on its way to "stickers"')
      onClose()
    } finally {
      setBusy(null)
    }
  }

  const hint = TOOLS.find((t) => t.id === tool)!.hint
  const percent = (part: number, whole: number) => `${(part / whole) * 100}%`

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-3 md:p-6" role="dialog" aria-modal="true" aria-label="make a sticker">
      <div className="absolute inset-0 bg-black/80" />
      <div className="panel px pop relative flex max-h-full w-full max-w-[1240px] flex-col overflow-hidden md:flex-row">
        <div className="relative flex min-h-[240px] flex-1 items-center justify-center bg-bg-deep p-4 md:min-h-[520px]">
          {/* As wide as fits, never taller than the window, never blown up more than four times. */}
          <div
            className="checker relative overflow-hidden"
            style={{ aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc(72vh * ${size.w / size.h}), ${size.w * 4}px)` }}
          >
            <canvas
              ref={canvasRef}
              className="block h-full w-full touch-none"
              style={{ cursor: busy ? 'wait' : 'crosshair' }}
              aria-label="the sticker being made"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
            {box && (
              <div
                className="pointer-events-none absolute outline-dashed outline-[3px] outline-[var(--accent)]"
                data-crop-box
                style={{
                  left: percent(box.x, size.w),
                  top: percent(box.y, size.h),
                  width: percent(box.w, size.w),
                  height: percent(box.h, size.h),
                  // One huge shadow darkens everything outside the box.
                  boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
                }}
              />
            )}
          </div>
          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 text-white" role="status">
              <Cube size={44} />
              <p className="cursor">&gt; {BUSY_TEXT[busy]}</p>
            </div>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto p-5 md:w-[380px]">
          <div className="flex items-start justify-between gap-3">
            <h2 className="uppercase">make a sticker</h2>
            <button type="button" className="btn btn-sm" onClick={onClose} aria-label="close without saving">
              x
            </button>
          </div>
          <p className="dim text-[18px] leading-tight">
            &gt; from {displayName(asset)}. the original stays as it is.
            <br />
            &gt; now {size.w}x{size.h}
          </p>

          <div className="flex flex-wrap gap-x-3 gap-y-4">
            {TOOLS.map((t) => (
              <button key={t.id} type="button" className="btn" aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
          <p className="dim text-[18px] leading-tight">&gt; {hint}</p>

          {tool === 'crop' && (
            <div>
              <button type="button" className="btn" disabled={!box || busy !== null} onClick={crop}>
                crop to box
              </button>
            </div>
          )}
          {tool === 'colour' && (
            <>
              <label>
                <span className="label">how alike a colour must be: {tolerance}</span>
                <input
                  type="range"
                  className="w-full accent-[var(--accent-deep)]"
                  min={1}
                  max={120}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                />
              </label>
              <div>
                <button type="button" className="btn" disabled={busy !== null} onClick={eraseBackground} title="erases the colour the edge of the picture has">
                  erase background
                </button>
              </div>
            </>
          )}
          {tool === 'rub' && (
            <label>
              <span className="label">brush size: {brush}</span>
              <input type="range" className="w-full accent-[var(--accent-deep)]" min={4} max={120} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
            </label>
          )}

          <div className="flex flex-col gap-2 bg-panel-2 p-3">
            <div>
              <button type="button" className="btn" disabled={busy !== null} onClick={cutOut}>
                smart cut-out
              </button>
            </div>
            <p className="dim text-[17px] leading-tight">
              &gt; finds the subject by itself. best on photos: people, pets, things. it runs here in the browser: the picture goes nowhere.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-4">
            <button type="button" className="btn" disabled={!touched || busy !== null} onClick={stepBack} title="ctrl+z">
              undo
            </button>
            <button type="button" className="btn" disabled={!touched || busy !== null} onClick={startOver}>
              start over
            </button>
          </div>

          <div className="mt-auto flex flex-col gap-4 pt-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent-deep)]" checked={keepSize} onChange={(e) => setKeepSize(e.target.checked)} />
              <span>keep full size (otherwise {STICKER_SIDE} px, as chats show stickers)</span>
            </label>
            <div>
              <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={save}>
                save to stickers
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
