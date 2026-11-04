import { useEffect } from 'react'
import { useLocation } from 'react-router'

// Arrow keys move focus to the nearest thing in that direction on screen, the
// way a TV remote does. Letter keys are left alone: they belong to the browser
// and to extensions like Vimium. Arrows, Enter and Space do everything;
// Backspace is a shortcut for "back" and never the only way to get there.
//
// Parts of the app can take an arrow first (the gallery moves by grid index,
// the command list by row); whatever calls preventDefault keeps the key.

export type Dir = 'up' | 'down' | 'left' | 'right'

const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

// tabindex="-1" opts a control out (a tile's own select box: Space on the
// tile does that); data-nav opts one in that Tab skips, like the viewer's stage.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .concat('[data-nav]')
  .join(',')

/** Where arrows may go: the dialog on top, or the whole page. */
export function navScope(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
  return dialogs.length > 0 ? dialogs[dialogs.length - 1] : document.body
}

function shown(el: HTMLElement): boolean {
  if (el.closest('[inert], [aria-hidden="true"]')) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  return el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true } as CheckVisibilityOptions) : true
}

function candidates(scope: HTMLElement, from: HTMLElement | null): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el !== from && !(from && (el.contains(from) || from.contains(el))) && shown(el),
  )
}

// How far a box is from another in one direction, or null if it is not that
// way at all. Being lined up across the way of travel counts for a lot: from
// a tile, Down should land on the tile below, not on a nearer one off to the
// side.
function score(from: DOMRect, to: DOMRect, dir: Dir): number | null {
  const slack = 4
  let along: number
  if (dir === 'down') along = to.top - from.bottom
  else if (dir === 'up') along = from.top - to.bottom
  else if (dir === 'right') along = to.left - from.right
  else along = from.left - to.right
  if (along < -slack) return null
  const vertical = dir === 'up' || dir === 'down'
  const gap = vertical
    ? Math.max(0, to.left - from.right, from.left - to.right)
    : Math.max(0, to.top - from.bottom, from.top - to.bottom)
  const offset = vertical
    ? Math.abs((to.left + to.right) / 2 - (from.left + from.right) / 2)
    : Math.abs((to.top + to.bottom) / 2 - (from.top + from.bottom) / 2)
  return Math.max(0, along) + gap * 4 + offset * 0.15
}

function nearest(from: DOMRect, dir: Dir, els: HTMLElement[]): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of els) {
    const s = score(from, el.getBoundingClientRect(), dir)
    if (s !== null && s < bestScore) {
      best = el
      bestScore = s
    }
  }
  return best
}

/** Where to start when nothing has focus: the first file or folder on the page, else the first control. */
export function startOf(scope: HTMLElement): HTMLElement | null {
  const marked = [...scope.querySelectorAll<HTMLElement>('[data-nav-start], main [data-nav-item]')].find(shown)
  if (marked) return marked
  const main = scope === document.body ? document.querySelector('main') : null
  return (main && candidates(main, null)[0]) || candidates(scope, null)[0] || null
}

export function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** Move focus one step; true if it moved. */
export function move(dir: Dir): boolean {
  const scope = navScope()
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const from = active && active !== document.body && scope.contains(active) ? active : null
  if (!from) {
    // Nothing has focus (it was clicked away, or its element went away):
    // start from about where it last was, or from the top of the page.
    const spot = scope === document.body ? lastFocused : null
    const start = (spot && nearestTo(spot, candidates(scope, null))) || startOf(scope)
    if (start) focusEl(start)
    return Boolean(start)
  }
  const next = nearest(from.getBoundingClientRect(), dir, candidates(scope, from))
  if (next) focusEl(next)
  return Boolean(next)
}

// Where focus last was on screen.
let lastFocused: DOMRect | null = null

function nearestTo(spot: DOMRect, els: HTMLElement[]): HTMLElement | null {
  const x = (spot.left + spot.right) / 2
  const y = (spot.top + spot.bottom) / 2
  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    const d = Math.hypot((r.left + r.right) / 2 - x, (r.top + r.bottom) / 2 - y)
    if (d < bestDist) {
      best = el
      bestDist = d
    }
  }
  return best
}

function typing(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'color', 'file', 'image', 'range'].includes(el.type)
}

// Inside a text field the arrows move the caret; only at the very start (or
// end) does Left (or Right) leave the field. Up and Down always leave a
// one-line field. A closed dropdown never changes its value by arrow: here,
// changing a dropdown does something at once (moves files), so it is opened
// with Space or Enter and only then are arrows its own.
function keepsArrow(el: Element | null, dir: Dir): boolean {
  if (!el) return false
  if (el instanceof HTMLSelectElement) return false
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return true
  if (el instanceof HTMLInputElement) {
    if (el.type === 'range') return dir === 'left' || dir === 'right'
    if (el.type === 'number') return dir === 'up' || dir === 'down'
    if (!typing(el)) return false
    if (dir === 'up' || dir === 'down') return false
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start !== end) return true
    return dir === 'left' ? start > 0 : end < el.value.length
  }
  return false
}

let keyboardUser = false

function onKey(e: KeyboardEvent) {
  keyboardUser = true
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  const active = document.activeElement
  const dir = DIRS[e.key]
  if (dir) {
    if (keepsArrow(active, dir)) return
    if (move(dir)) e.preventDefault()
    else if (active instanceof HTMLSelectElement) e.preventDefault()
    return
  }
  if (typing(active)) return
  if (e.key === ' ' && active instanceof HTMLElement && (active instanceof HTMLAnchorElement || active.getAttribute('role') === 'button')) {
    // Space presses links too, not only buttons.
    e.preventDefault()
    active.click()
  } else if (e.key === 'Backspace') {
    // Back: close the dialog on top, else go back a page.
    if (navScope() !== document.body) {
      e.preventDefault()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } else if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) {
      e.preventDefault()
      window.history.back()
    }
  }
}

function onFocusIn(e: FocusEvent) {
  if (e.target instanceof HTMLElement) lastFocused = e.target.getBoundingClientRect()
}

/** Arrow-key navigation for the whole app; mount once, inside the router. */
export function useKeyboardNav() {
  useEffect(() => {
    const pointer = () => {
      keyboardUser = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', pointer, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  // Opening a folder with Enter replaces the tile that had focus. Carry on
  // from the first thing on the new page rather than from nowhere; wait a
  // little for it, as the page may still be loading.
  const { key } = useLocation()
  useEffect(() => {
    lastFocused = null
    if (!keyboardUser) return
    let frame = 0
    let tries = 0
    const tick = () => {
      const active = document.activeElement
      if (active && active !== document.body) return
      const start = startOf(navScope())
      if (start?.matches('[data-nav-item], [data-nav-start]')) focusEl(start)
      else if (tries++ < 90) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [key])
}
