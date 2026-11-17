import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Canvas, CanvasEdge, CanvasNode, Item, Side } from '../api'
import { nextOf, over, relDay } from '../lib/days'
import { COLORS, openAnywhere, openItem, STATUSES, titleOf, useItemChanges, useItems } from '../lib/items'
import { miniMarkdown, plainExcerpt } from '../lib/minimd'
import { log } from '../lib/log'

// A board: an endless canvas of notes, cards, frames and arrows, like Miro,
// stored as JSON Canvas 1.0 (jsoncanvas.org) so it opens in other canvas
// apps too. A card for a task or a notebook is a "file" node pointing at
// "item/<id>": the card shows the real item, so ticking it off here ticks it
// off on the calendar as well. Colours are the JSON Canvas presets "1".."6",
// painted by the theme.
//
// A board opens to look at, not to change: nothing moves by accident.
// Pressing a card selects it; a selected card can then be dragged. "edit"
// turns on the rest (remembered per board):
//   drag the empty board       move around (or scroll; ctrl+scroll zooms)
//   shift+drag the empty board select an area
//   double-click the board     a new note there (edit)
//   drag a dot on a card's side to another card: an arrow (edit)
//   delete                     removes what is selected (edit; an item card
//                              only leaves the board, the item stays)

const GRID = 20
const snap = (v: number) => Math.round(v / GRID) * GRID
let counter = 0
const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

interface View {
  x: number
  y: number
  zoom: number
}

type Point = { x: number; y: number }
// Omit spread over each kind of node, so a new note may have text and a frame a label.
type NewNode = CanvasNode extends unknown ? (CanvasNode extends infer N ? (N extends CanvasNode ? Omit<N, 'id' | 'x' | 'y'> : never) : never) : never

function anchor(n: CanvasNode, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y }
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height }
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 }
    case 'right':
      return { x: n.x + n.width, y: n.y + n.height / 2 }
  }
}

/** The sides an arrow leaves and enters by when the file does not say. */
function sidesBetween(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2)
  const dy = b.y + b.height / 2 - (a.y + a.height / 2)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ['right', 'left'] : ['left', 'right']
  return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

const normal: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

function curve(p: Point, ps: Side, q: Point, qs: Side): string {
  // Side to the same side (left to left): a bracket, as in a tree, that
  // stays close instead of swinging wider the further apart the two are.
  const far = Math.hypot(q.x - p.x, q.y - p.y)
  const d = ps === qs ? Math.min(50, Math.max(24, far / 4)) : Math.max(40, far / 3)
  const c1 = { x: p.x + normal[ps].x * d, y: p.y + normal[ps].y * d }
  const c2 = { x: q.x + normal[qs].x * d, y: q.y + normal[qs].y * d }
  return `M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}`
}

const colorVar = (c?: string) => (!c ? undefined : /^[1-6]$/.test(c) ? `var(--c${c})` : /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined)
const itemIdOf = (n: CanvasNode) => (n.type === 'file' && n.file.startsWith('item/') ? n.file.slice(5) : null)
const assetIdOf = (n: CanvasNode) => (n.type === 'file' && n.file.startsWith('asset/') ? n.file.slice(6) : null)
const inside = (a: CanvasNode, g: CanvasNode) => a.x >= g.x && a.y >= g.y && a.x + a.width <= g.x + g.width && a.y + a.height <= g.y + g.height

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'move'; sx: number; sy: number; start: Map<string, Point>; moved: boolean }
  | { kind: 'resize'; id: string; sx: number; sy: number; w: number; h: number }
  | { kind: 'marquee'; a: Point; b: Point }
  | { kind: 'connect'; from: string; side: Side; to: Point }

interface Props {
  canvas: Canvas
  onChange: (c: Canvas) => void
  /** The board's own item, so a new card can say where it came from. */
  board: Item
}

export default function Board({ canvas, onChange, board }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 80, y: 80, zoom: 1 })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | 'notebook'>(null)
  const [legend, setLegend] = useState(false)
  const editKey = `prismo.board.edit.${board.id}`
  const [edit, setEditState] = useState(() => {
    try {
      return localStorage.getItem(editKey) === '1'
    } catch {
      return false
    }
  })
  const setEdit = (on: boolean) => {
    setEditState(on)
    if (!on) setEditing(null)
    try {
      if (on) localStorage.setItem(editKey, '1')
      else localStorage.removeItem(editKey)
    } catch {
      /* not remembered */
    }
  }
  const { create, update } = useItemChanges()

  // Undo and redo: whole canvases, the last hundred.
  const past = useRef<Canvas[]>([])
  // The canvas as it was when a drag began, for undo.
  const before = useRef<Canvas | null>(null)
  const future = useRef<Canvas[]>([])
  const commit = useCallback(
    (next: Canvas) => {
      past.current.push(canvas)
      if (past.current.length > 100) past.current.shift()
      future.current = []
      onChange(next)
    },
    [canvas, onChange],
  )
  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(canvas)
    onChange(prev)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(canvas)
    onChange(next)
  }

  const byId = useMemo(() => new Map(canvas.nodes.map((n) => [n.id, n])), [canvas.nodes])
  const itemIds = useMemo(() => canvas.nodes.map(itemIdOf).filter((x): x is string => Boolean(x)), [canvas.nodes])
  const { data: cardItems = [] } = useItems({ ids: itemIds }, itemIds.length > 0)
  const items = useMemo(() => new Map(cardItems.map((it) => [it.id, it])), [cardItems])
  // A card takes its item's colour unless the board gave it one.
  const colorOf = useCallback(
    (n: CanvasNode) => {
      const id = itemIdOf(n)
      const c = id ? items.get(id)?.color : null
      return n.color ?? (c ? String(c) : undefined)
    },
    [items],
  )

  // Everything that has to happen before the card under the pointer.
  const upstream = useMemo(() => {
    if (!hover) return null
    const seen = new Set<string>([hover])
    const walk = (id: string) => {
      for (const e of canvas.edges) {
        const into = e.toEnd !== 'none' ? e.toNode : e.fromEnd === 'arrow' ? e.fromNode : null
        const outOf = into === e.toNode ? e.fromNode : e.toNode
        if (into === id && !seen.has(outOf)) {
          seen.add(outOf)
          walk(outOf)
        }
      }
    }
    walk(hover)
    return seen.size > 1 ? seen : null
  }, [hover, canvas.edges])

  // --- coordinates ---
  const toBoard = useCallback(
    (cx: number, cy: number): Point => {
      const r = host.current!.getBoundingClientRect()
      return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom }
    },
    [view],
  )
  const zoomAt = (z: number, cx?: number, cy?: number) => {
    const r = host.current!.getBoundingClientRect()
    const px = cx === undefined ? r.width / 2 : cx - r.left
    const py = cy === undefined ? r.height / 2 : cy - r.top
    setView((v) => {
      const zoom = Math.min(3, Math.max(0.15, z))
      return { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom }
    })
  }
  const fit = useCallback(() => {
    const el = host.current
    if (!el || canvas.nodes.length === 0) {
      setView({ x: 80, y: 80, zoom: 1 })
      return
    }
    const minX = Math.min(...canvas.nodes.map((n) => n.x))
    const minY = Math.min(...canvas.nodes.map((n) => n.y))
    const maxX = Math.max(...canvas.nodes.map((n) => n.x + n.width))
    const maxY = Math.max(...canvas.nodes.map((n) => n.y + n.height))
    const zoom = Math.min(1.25, Math.max(0.15, Math.min((el.clientWidth - 80) / (maxX - minX), (el.clientHeight - 80) / (maxY - minY))))
    setView({ zoom, x: (el.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (el.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom })
  }, [canvas.nodes])
  // Open on the whole board.
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && host.current) {
      fitted.current = true
      fit()
    }
  }, [fit])

  // Scroll moves, ctrl+scroll (and a touchpad pinch) zooms at the pointer.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.board-edit')) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const dy = Math.max(-40, Math.min(40, e.deltaY * (e.deltaMode === 1 ? 33 : 1)))
        setView((v) => {
          const r = el.getBoundingClientRect()
          const px = e.clientX - r.left
          const py = e.clientY - r.top
          const zoom = Math.min(3, Math.max(0.15, v.zoom * Math.exp(-dy * 0.01)))
          return { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom }
        })
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // --- making things ---
  const center = (): Point => {
    const el = host.current!
    return { x: (el.clientWidth / 2 - view.x) / view.zoom, y: (el.clientHeight / 2 - view.y) / view.zoom }
  }
  const add = (node: NewNode, at?: Point) => {
    const p = at ?? center()
    const n = { ...node, id: newId(), x: snap(p.x - node.width / 2), y: snap(p.y - node.height / 2) } as CanvasNode
    // A frame goes underneath everything else.
    commit({ ...canvas, nodes: n.type === 'group' ? [n, ...canvas.nodes] : [...canvas.nodes, n] })
    setSel(new Set([n.id]))
    if (n.type === 'text' || n.type === 'group') setEditing(n.id)
    return n
  }
  const addNote = (at?: Point) => add({ type: 'text', text: '', width: 220, height: 140, color: '3' }, at)
  const addCard = (it: Item) => add({ type: 'file', file: `item/${it.id}`, width: 240, height: 120 })
  const newTask = () =>
    create.mutate({ item: { kind: 'task', title: 'new task', collection_id: board.collection_id } }, { onSuccess: (it) => (addCard(it), openItem.set(it.id)) })

  // --- removing ---
  const removeSelected = () => {
    if (selEdge) {
      commit({ ...canvas, edges: canvas.edges.filter((e) => e.id !== selEdge) })
      setSelEdge(null)
      return
    }
    if (sel.size === 0) return
    commit({ nodes: canvas.nodes.filter((n) => !sel.has(n.id)), edges: canvas.edges.filter((e) => !sel.has(e.fromNode) && !sel.has(e.toNode)) })
    setSel(new Set())
  }
  const patchNodes = (ids: Set<string>, patch: Partial<CanvasNode>) =>
    commit({ ...canvas, nodes: canvas.nodes.map((n) => (ids.has(n.id) ? ({ ...n, ...patch } as CanvasNode) : n)) })
  const patchEdge = (id: string, patch: Partial<CanvasEdge>) => commit({ ...canvas, edges: canvas.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) })

  // --- keys ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!host.current?.closest('.wall')?.matches('[data-state=faced]')) return
      if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('.item-drawer')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSel(new Set(canvas.nodes.map((n) => n.id)))
      } else if (!edit && (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'n' || (mod && e.key.toLowerCase() === 'd'))) {
        return
      } else if (mod && e.key.toLowerCase() === 'd' && sel.size > 0) {
        e.preventDefault()
        const copies = canvas.nodes.filter((n) => sel.has(n.id)).map((n) => ({ ...n, id: newId(), x: n.x + GRID * 2, y: n.y + GRID * 2 }))
        commit({ ...canvas, nodes: [...canvas.nodes, ...copies] })
        setSel(new Set(copies.map((n) => n.id)))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.size || selEdge) {
          e.preventDefault()
          removeSelected()
        }
      } else if (e.key === 'Escape') {
        setSel(new Set())
        setSelEdge(null)
      } else if (e.key === 'Enter' && sel.size === 1 && edit) {
        const n = byId.get([...sel][0])
        if (n && (n.type === 'text' || n.type === 'group')) {
          e.preventDefault()
          setEditing(n.id)
        }
      } else if (!mod && e.key === 'n') {
        addNote()
      } else if (!mod && (e.key === '0' || e.key === 'f')) {
        fit()
      } else if (!mod && (e.key === '+' || e.key === '=')) {
        zoomAt(view.zoom * 1.2)
      } else if (!mod && e.key === '-') {
        zoomAt(view.zoom / 1.2)
      } else {
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- pointer gestures ---
  // The gesture lives in a ref while the pointer moves, so each move reads
  // the latest one; state only redraws the marquee and the draft arrow.
  const live = useRef<Gesture | null>(null)
  live.current = gesture
  useEffect(() => {
    if (!gesture) return
    const move = (e: PointerEvent) => {
      const g = live.current
      if (!g) return
      if (g.kind === 'pan') {
        setView({ ...g.view, x: g.view.x + e.clientX - g.sx, y: g.view.y + e.clientY - g.sy })
      } else if (g.kind === 'move') {
        const dx = (e.clientX - g.sx) / view.zoom
        const dy = (e.clientY - g.sy) / view.zoom
        if (!g.moved && Math.hypot(dx, dy) < 3) return
        onChange({
          ...canvas,
          nodes: canvas.nodes.map((n) => {
            const s = g.start.get(n.id)
            return s ? { ...n, x: snap(s.x + dx), y: snap(s.y + dy) } : n
          }),
        })
        if (!g.moved) setGesture({ ...g, moved: true })
      } else if (g.kind === 'resize') {
        const w = Math.max(80, snap(g.w + (e.clientX - g.sx) / view.zoom))
        const h = Math.max(40, snap(g.h + (e.clientY - g.sy) / view.zoom))
        onChange({ ...canvas, nodes: canvas.nodes.map((n) => (n.id === g.id ? { ...n, width: w, height: h } : n)) })
      } else if (g.kind === 'marquee') {
        setGesture({ ...g, b: toBoard(e.clientX, e.clientY) })
      } else {
        setGesture({ ...g, to: toBoard(e.clientX, e.clientY) })
      }
    }
    const up = (e: PointerEvent) => {
      const g = live.current
      setGesture(null)
      if (!g) return
      if (g.kind === 'marquee') {
        const b = toBoard(e.clientX, e.clientY)
        const [x1, x2] = [Math.min(g.a.x, b.x), Math.max(g.a.x, b.x)]
        const [y1, y2] = [Math.min(g.a.y, b.y), Math.max(g.a.y, b.y)]
        setSel(new Set(canvas.nodes.filter((n) => n.x < x2 && n.x + n.width > x1 && n.y < y2 && n.y + n.height > y1).map((n) => n.id)))
      } else if (g.kind === 'connect') {
        const target = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]') as HTMLElement | null)?.dataset.node
        const to = target ? byId.get(target) : undefined
        const from = byId.get(g.from)
        if (to && from && to.id !== from.id) {
          const p = toBoard(e.clientX, e.clientY)
          const sides: Side[] = ['top', 'right', 'bottom', 'left']
          const toSide = sides.reduce((best, s) => {
            const a = anchor(to, s)
            const c = anchor(to, best)
            return Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(c.x - p.x, c.y - p.y) ? s : best
          }, 'left' as Side)
          commit({ ...canvas, edges: [...canvas.edges, { id: newId(), fromNode: from.id, fromSide: g.side, toNode: to.id, toSide, toEnd: 'arrow' }] })
        }
      } else if (((g.kind === 'move' && g.moved) || g.kind === 'resize') && before.current) {
        // The canvas already shows the result; the history gets the state from before.
        past.current.push(before.current)
        future.current = []
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [gesture !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  // Two presses on the same spot of the empty board, quickly: a new note.
  // Counted here rather than with dblclick, which the pan between the two
  // clicks can swallow.
  const lastPress = useRef({ t: 0, x: 0, y: 0 })
  const pressBoard = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('board-plane')) return
    const prev = lastPress.current
    lastPress.current = { t: e.timeStamp, x: e.clientX, y: e.clientY }
    if (edit && e.button === 0 && !e.shiftKey && e.timeStamp - prev.t < 400 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 6) {
      lastPress.current.t = 0
      // No mousedown after this, so focus stays in the new note's text box.
      e.preventDefault()
      addNote(toBoard(e.clientX, e.clientY))
      return
    }
    setEditing(null)
    setSelEdge(null)
    if (e.button === 1 || (e.button === 0 && !e.shiftKey)) {
      if (e.button === 0) setSel(new Set())
      setGesture({ kind: 'pan', sx: e.clientX, sy: e.clientY, view })
    } else if (e.button === 0 && e.shiftKey) {
      const p = toBoard(e.clientX, e.clientY)
      setGesture({ kind: 'marquee', a: p, b: p })
    }
  }

  const pressNode = (n: CanvasNode) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || editing === n.id) return
    e.stopPropagation()
    setSelEdge(null)
    let next = sel
    if (e.shiftKey) {
      next = new Set(sel)
      if (!next.delete(n.id)) next.add(n.id)
    } else if (!sel.has(n.id)) {
      next = new Set([n.id])
    }
    setSel(next)
    // Not editing, a press on a card that was not selected only selects it;
    // dragging it moves the view, as on the empty board.
    if (!edit && (!sel.has(n.id) || e.shiftKey)) {
      setGesture({ kind: 'pan', sx: e.clientX, sy: e.clientY, view })
      return
    }
    // Moving a frame moves what is in it.
    const moving = new Set(next)
    for (const id of next) {
      const g = byId.get(id)
      if (g?.type === 'group') for (const m of canvas.nodes) if (m.id !== g.id && inside(m, g)) moving.add(m.id)
    }
    before.current = canvas
    setGesture({ kind: 'move', sx: e.clientX, sy: e.clientY, start: new Map(canvas.nodes.filter((m) => moving.has(m.id)).map((m) => [m.id, { x: m.x, y: m.y }])), moved: false })
  }

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(canvas, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(board.title || 'board').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.canvas`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importFile = async (file: File) => {
    try {
      const c = JSON.parse(await file.text()) as Canvas
      if (!Array.isArray(c.nodes) || !Array.isArray(c.edges)) throw new Error('not a JSON Canvas file')
      // New ids, placed to the right of what is there.
      const shiftX = canvas.nodes.length ? Math.max(...canvas.nodes.map((n) => n.x + n.width)) + 200 - Math.min(...c.nodes.map((n) => n.x)) : 0
      const ids = new Map(c.nodes.map((n) => [n.id, newId()]))
      commit({
        nodes: [...canvas.nodes, ...c.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: n.x + shiftX }))],
        edges: [...canvas.edges, ...c.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)).map((e) => ({ ...e, id: newId(), fromNode: ids.get(e.fromNode)!, toNode: ids.get(e.toNode)! }))],
      })
      log('ok', `added ${c.nodes.length} things from ${file.name}`)
      setTimeout(fit, 50)
    } catch (e) {
      log('err', `could not read that file: ${(e as Error).message}`)
    }
  }

  const selected = [...sel].map((id) => byId.get(id)).filter((n): n is CanvasNode => Boolean(n))
  const edge = selEdge ? canvas.edges.find((e) => e.id === selEdge) : undefined
  const groups = canvas.nodes.filter((n) => n.type === 'group')
  const rest = canvas.nodes.filter((n) => n.type !== 'group')

  return (
    <div className="board-wrap">
      <div className="board-tools" role="toolbar" aria-label="board">
        <button
          type="button"
          className={`btn btn-sm${edit ? ' btn-accent' : ''}`}
          aria-pressed={edit}
          onClick={() => setEdit(!edit)}
          title={edit ? 'back to looking: nothing moves by accident' : 'add, connect, resize and delete things'}
        >
          {edit ? 'done editing' : 'edit'}
        </button>
        {edit && (
          <>
            <button type="button" className="btn btn-sm" onClick={() => addNote()} title="note (n)">
              + note
            </button>
            <button type="button" className="btn btn-sm" onClick={() => add({ type: 'text', text: '', width: 260, height: 60 })}>
              + text
            </button>
            <button type="button" className="btn btn-sm" onClick={newTask} disabled={create.isPending}>
              + task
            </button>
            <button type="button" className="btn btn-sm" aria-pressed={adding === 'notebook'} onClick={() => setAdding(adding ? null : 'notebook')}>
              + card for...
            </button>
            <button type="button" className="btn btn-sm" onClick={() => add({ type: 'group', label: 'frame', width: 640, height: 360 })}>
              + frame
            </button>
          </>
        )}
        <button type="button" className="btn btn-sm" aria-pressed={legend} onClick={() => setLegend(!legend)} title="what the colours mean">
          legend
        </button>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" onClick={undo} title="undo (ctrl+z)" aria-label="undo">
          ↶
        </button>
        <button type="button" className="btn btn-sm" onClick={redo} title="redo (ctrl+shift+z)" aria-label="redo">
          ↷
        </button>
        <button type="button" className="btn btn-sm" onClick={() => zoomAt(view.zoom / 1.2)} aria-label="zoom out">
          -
        </button>
        <span className="pixel w-[46px] text-center text-[9px]">{Math.round(view.zoom * 100)}%</span>
        <button type="button" className="btn btn-sm" onClick={() => zoomAt(view.zoom * 1.2)} aria-label="zoom in">
          +
        </button>
        <button type="button" className="btn btn-sm" onClick={fit} title="fit (f)">
          fit
        </button>
        <button type="button" className="btn btn-sm" onClick={exportFile} title="download as a .canvas file (JSON Canvas)">
          .canvas
        </button>
        {edit && (
          <label className="btn btn-sm cursor-pointer" title="add the contents of a .canvas file">
            open
            <input type="file" accept=".canvas,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
          </label>
        )}
      </div>

      {legend && <Legend nodes={canvas.nodes} items={items} colorOf={colorOf} onClose={() => setLegend(false)} />}

      {adding && (
        <CardPicker
          onPick={(it) => {
            addCard(it)
            setAdding(null)
          }}
          onClose={() => setAdding(null)}
          exclude={new Set([...itemIds, board.id])}
        />
      )}

      {(selected.length > 0 || edge) && (
        <div className="board-sel panel px" role="toolbar" aria-label="selected">
          <span className="dim">{edge ? 'arrow' : selected.length === 1 ? selected[0].type === 'group' ? 'frame' : itemIdOf(selected[0]) ? 'card' : 'note' : `${selected.length} things`}</span>
          {!edit && <span className="dim">· drag it to move it</span>}
          {edit && <div className="flex gap-1">
            <button type="button" className="swatch" title="no colour" onClick={() => (edge ? patchEdge(edge.id, { color: undefined }) : patchNodes(sel, { color: undefined }))}>
              <span className="swatch-none" />
            </button>
            {COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="swatch"
                title={c.label}
                aria-pressed={(edge?.color ?? (selected.length === 1 ? selected[0].color : undefined)) === String(c.id)}
                onClick={() => (edge ? patchEdge(edge.id, { color: String(c.id) }) : patchNodes(sel, { color: String(c.id) }))}
              >
                <span style={{ background: `var(--c${c.id})` }} />
              </button>
            ))}
          </div>}
          {edge && edit && (
            <>
              <input className="field !w-[160px]" placeholder="label" defaultValue={edge.label ?? ''} key={edge.id} onBlur={(e) => patchEdge(edge.id, { label: e.target.value || undefined })} />
              <button type="button" className="chip" aria-pressed={edge.toEnd !== 'none'} onClick={() => patchEdge(edge.id, { toEnd: edge.toEnd === 'none' ? 'arrow' : 'none' })}>
                arrow
              </button>
            </>
          )}
          {selected.length === 1 && itemIdOf(selected[0]) && (
            <button type="button" className="btn btn-sm" onClick={() => openItem.set(itemIdOf(selected[0])!)}>
              open
            </button>
          )}
          {edit && (
            <button type="button" className="btn btn-sm" onClick={removeSelected} title="delete">
              {selected.some(itemIdOf) ? 'off the board' : 'delete'}
            </button>
          )}
        </div>
      )}

      <div
        ref={host}
        className="board"
        data-gesture={gesture?.kind}
        onPointerDown={pressBoard}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${GRID * view.zoom}px ${GRID * view.zoom}px` }}
      >
        <div className="board-plane" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {groups.map((n) => (
            <NodeBox key={n.id} n={n} edit={edit} selected={sel.has(n.id)} dim={Boolean(upstream)} onPress={pressNode(n)} onConnect={startConnect(n)} onResize={startResize(n)}>
              <GroupLabel n={n} editing={editing === n.id} onEdit={() => edit && setEditing(n.id)} onDone={(label) => (setEditing(null), patchNodes(new Set([n.id]), { label }))} />
            </NodeBox>
          ))}
          <svg className="board-edges" aria-hidden>
            <defs>
              <marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
              </marker>
            </defs>
            {canvas.edges.map((e) => {
              const a = byId.get(e.fromNode)
              const b = byId.get(e.toNode)
              if (!a || !b) return null
              const [fs, ts] = sidesBetween(a, b)
              const p = anchor(a, e.fromSide ?? fs)
              const q = anchor(b, e.toSide ?? ts)
              const d = curve(p, e.fromSide ?? fs, q, e.toSide ?? ts)
              const hot = upstream?.has(e.fromNode) && upstream.has(e.toNode)
              return (
                <g key={e.id} className="board-edge" data-selected={selEdge === e.id || undefined} data-hot={hot || undefined} data-dim={(upstream && !hot) || undefined}>
                  <path
                    d={d}
                    className="board-edge-hit"
                    onPointerDown={(ev) => {
                      if (!edit) return
                      ev.stopPropagation()
                      setSel(new Set())
                      setSelEdge(e.id)
                    }}
                  />
                  <path
                    d={d}
                    className="board-edge-line"
                    style={{ stroke: colorVar(e.color) }}
                    markerEnd={e.toEnd !== 'none' ? 'url(#board-arrow)' : undefined}
                    markerStart={e.fromEnd === 'arrow' ? 'url(#board-arrow)' : undefined}
                  />
                  {e.label && (
                    <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6} className="board-edge-label">
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}
            {gesture?.kind === 'connect' && byId.get(gesture.from) && (
              <path d={curve(anchor(byId.get(gesture.from)!, gesture.side), gesture.side, gesture.to, 'left')} className="board-edge-line board-edge-draft" />
            )}
          </svg>
          {rest.map((n) => (
            <NodeBox
              key={n.id}
              n={n}
              color={colorOf(n)}
              edit={edit}
              selected={sel.has(n.id)}
              dim={Boolean(upstream && !upstream.has(n.id))}
              hot={Boolean(upstream?.has(n.id))}
              onPress={pressNode(n)}
              onConnect={startConnect(n)}
              onResize={startResize(n)}
              onDoubleClick={() => {
                const id = itemIdOf(n)
                if (id) {
                  const it = items.get(id)
                  if (it) openAnywhere(it)
                } else if (n.type === 'text' && edit) setEditing(n.id)
              }}
              onHover={itemIdOf(n) ? (on) => setHover(on ? n.id : null) : undefined}
            >
              {n.type === 'text' ? (
                editing === n.id ? (
                  <textarea
                    className="board-edit"
                    autoFocus
                    defaultValue={n.text}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      setEditing(null)
                      if (e.target.value !== n.text) patchNodes(new Set([n.id]), { text: e.target.value })
                    }}
                    onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
                  />
                ) : (
                  <div className="board-text" dangerouslySetInnerHTML={{ __html: n.text ? miniMarkdown(n.text) : `<p class="dim">${edit ? 'double-click to write' : ''}</p>` }} />
                )
              ) : itemIdOf(n) ? (
                <ItemCard it={items.get(itemIdOf(n)!)} onToggle={(it) => update.mutate({ id: it.id, change: { status: it.status === 'done' ? 'todo' : 'done' } })} />
              ) : assetIdOf(n) ? (
                <img className="board-img" src={`/v1/assets/${assetIdOf(n)}/file?variant=thumb`} alt="" draggable={false} />
              ) : n.type === 'link' ? (
                <a className="board-link" href={/^https?:\/\//.test(n.url) ? n.url : undefined} target="_blank" rel="noreferrer noopener" onPointerDown={(e) => e.stopPropagation()}>
                  {n.url}
                </a>
              ) : n.type === 'file' ? (
                <span className="dim">{n.file}</span>
              ) : null}
            </NodeBox>
          ))}
          {gesture?.kind === 'marquee' && (
            <div
              className="board-marquee"
              style={{ left: Math.min(gesture.a.x, gesture.b.x), top: Math.min(gesture.a.y, gesture.b.y), width: Math.abs(gesture.b.x - gesture.a.x), height: Math.abs(gesture.b.y - gesture.a.y) }}
            />
          )}
        </div>
        {canvas.nodes.length === 0 && (
          <p className="board-empty dim">&gt; an empty board. {edit ? 'double-click anywhere for a note, or use the buttons above.' : 'press "edit" to add things.'}</p>
        )}
      </div>
    </div>
  )

  function startConnect(n: CanvasNode) {
    return (side: Side) => (e: ReactPointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setGesture({ kind: 'connect', from: n.id, side, to: anchor(n, side) })
    }
  }
  function startResize(n: CanvasNode) {
    return (e: ReactPointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      before.current = canvas
      setGesture({ kind: 'resize', id: n.id, sx: e.clientX, sy: e.clientY, w: n.width, h: n.height })
    }
  }
}

function NodeBox({
  n,
  color,
  edit,
  selected,
  dim,
  hot,
  onPress,
  onConnect,
  onResize,
  onDoubleClick,
  onHover,
  children,
}: {
  n: CanvasNode
  /** The colour to paint, when not the node's own (an item card takes its item's). */
  color?: string
  edit: boolean
  selected: boolean
  dim?: boolean
  hot?: boolean
  onPress: (e: ReactPointerEvent) => void
  onConnect: (side: Side) => (e: ReactPointerEvent) => void
  onResize: (e: ReactPointerEvent) => void
  onDoubleClick?: () => void
  onHover?: (on: boolean) => void
  children: ReactNode
}) {
  return (
    <div
      className="board-node"
      data-node={n.id}
      data-type={n.type}
      data-selected={selected || undefined}
      data-dim={dim || undefined}
      data-hot={hot || undefined}
      style={{ left: n.x, top: n.y, width: n.width, height: n.height, ...((color ?? n.color) ? { '--node': colorVar(color ?? n.color) } : {}) } as CSSProperties}
      onPointerDown={onPress}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick?.()
      }}
      onPointerEnter={onHover && (() => onHover(true))}
      onPointerLeave={onHover && (() => onHover(false))}
    >
      {children}
      {edit &&
        (['top', 'right', 'bottom', 'left'] as Side[]).map((s) => (
          <span key={s} className={`board-dot board-dot-${s}`} onPointerDown={onConnect(s)} title="drag to another card for an arrow" />
        ))}
      {edit && selected && <span className="board-resize" onPointerDown={onResize} aria-hidden />}
    </div>
  )
}

function GroupLabel({ n, editing, onEdit, onDone }: { n: CanvasNode; editing: boolean; onEdit: () => void; onDone: (label: string) => void }) {
  const label = n.type === 'group' ? (n.label ?? '') : ''
  return editing ? (
    <input
      className="board-group-label board-edit"
      autoFocus
      defaultValue={label}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
    />
  ) : (
    <span className="board-group-label" onDoubleClick={(e) => (e.stopPropagation(), onEdit())}>
      {label || 'frame'}
    </span>
  )
}

/**
 * A card for one of the owner's items: what it is, its status, when it is
 * next (a repeat shows its next appearance, with that one's own title), its
 * first lines.
 */
function ItemCard({ it, onToggle }: { it: Item | undefined; onToggle: (it: Item) => void }) {
  if (!it) return <span className="dim">&gt; this item is gone (or in the trash).</span>
  const status = STATUSES.find((s) => s.id === it.status)
  const next = nextOf(it)
  const past = it.date !== null && (next === null || (!it.repeat && over(next)))
  const own = next && next.item.title !== it.title ? next.item.title : null
  return (
    <div className="board-card" data-status={it.status ?? undefined} data-kind={it.kind} data-past={past || undefined}>
      <div className="board-card-top">
        <span className="kind-tag" data-kind={it.kind}>
          {it.kind}
        </span>
        {status && <span className="status-pill" data-status={status.id}>{status.label}</span>}
        {(it.tags ?? [])
          .filter((t) => t.startsWith('type:'))
          .map((t) => (
            <span key={t} className="tag-chip" style={it.color ? ({ '--chip': `var(--c${it.color})` } as CSSProperties) : undefined}>
              {t.slice(5)}
            </span>
          ))}
        {next ? (
          <span className="dim">
            {it.repeat && !own ? 'next ' : ''}
            {relDay(next.date)}
            {next.item.time ? ` ${next.item.time}` : ''}
            {it.repeat ? ` · ${it.repeat}` : ''}
          </span>
        ) : (
          it.date && <span className="dim">{it.repeat ? 'repeat ended' : relDay(it.date)}</span>
        )}
      </div>
      {own && <b className="board-card-title">{own}</b>}
      <div className="flex items-start gap-2">
        {it.status && (
          <input
            type="checkbox"
            className="check check-sm mt-1"
            checked={it.status === 'done'}
            aria-label={`done: ${titleOf(it)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={() => onToggle(it)}
          />
        )}
        {own ? <span className="dim">{titleOf(it)}</span> : <b className="board-card-title">{titleOf(it)}</b>}
      </div>
      {it.excerpt && <p className="board-card-text">{plainExcerpt(it.excerpt)}</p>}
    </div>
  )
}

/**
 * What the colours on this board mean, read off its cards: each colour with
 * the types ("type:lab") of the items painted with it, else their kinds.
 */
function Legend({ nodes, items, colorOf, onClose }: { nodes: CanvasNode[]; items: Map<string, Item>; colorOf: (n: CanvasNode) => string | undefined; onClose: () => void }) {
  const byColor = new Map<string, Map<string, number>>()
  for (const n of nodes) {
    const id = itemIdOf(n)
    const it = id ? items.get(id) : undefined
    const c = colorOf(n)
    if (!it || !c) continue
    const types = (it.tags ?? []).filter((t) => t.startsWith('type:')).map((t) => t.slice(5))
    const names = byColor.get(c) ?? new Map<string, number>()
    for (const t of types.length ? types : [it.kind]) names.set(t, (names.get(t) ?? 0) + 1)
    byColor.set(c, names)
  }
  const rows = [...byColor].sort(([a], [b]) => a.localeCompare(b))
  return (
    <div className="board-legend panel px-raised" role="dialog" aria-label="legend">
      {rows.length === 0 && <p className="dim">&gt; no coloured cards here.</p>}
      {rows.map(([c, names]) => (
        <div key={c} className="flex items-center gap-2">
          <span className="board-legend-swatch" style={{ background: colorVar(c) }} />
          <span>
            {[...names]
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => `${name} (${count})`)
              .join(', ')}
          </span>
        </div>
      ))}
      <p className="dim">a card takes its item's colour (details &gt; colour) unless the board gives it one.</p>
      <button type="button" className="btn btn-sm self-start" onClick={onClose}>
        close
      </button>
    </div>
  )
}

/** Find an item (task, notebook, another board) to put on the board as a card. */
function CardPicker({ onPick, onClose, exclude }: { onPick: (it: Item) => void; onClose: () => void; exclude: Set<string> }) {
  const [q, setQ] = useState('')
  const { data = [] } = useItems({ q: q.trim() || undefined })
  return (
    <div className="board-picker panel px-raised" role="dialog" aria-label="add a card">
      <input className="field" autoFocus placeholder="find a task, notebook, event, board..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      <ul className="flex max-h-[260px] flex-col gap-1 overflow-y-auto">
        {data
          .filter((it) => !exclude.has(it.id))
          .slice(0, 30)
          .map((it) => (
            <li key={it.id}>
              <button type="button" className="link-btn w-full text-left" onClick={() => onPick(it)}>
                <span className="kind-tag" data-kind={it.kind}>
                  {it.kind}
                </span>{' '}
                {titleOf(it)}
              </button>
            </li>
          ))}
      </ul>
      <button type="button" className="btn btn-sm self-start" onClick={onClose}>
        close
      </button>
    </div>
  )
}
