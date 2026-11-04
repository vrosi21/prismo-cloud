import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { facing, settle, TURN_MS, turnTo, wallFor, WALLS, type Wall } from '../lib/room'
import { focusEl, navScope, startOf, typing, usingKeyboard } from '../lib/spatial'
import { useStore } from '../lib/store'
import { KeyCap } from './KeyCap'
import { Arrow } from './sprites'

const KEYS: Record<string, (typeof WALLS)[number]['key']> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/**
 * The four walls of the room, all in one place, one faced at a time. The
 * files (the children) are on the front wall. Walls not faced stay mounted
 * but hidden and inert, so turning back finds the files as they were left:
 * same folder, same scroll, same tile focused.
 */
export function Room({ children }: { children: ReactNode }) {
  const f = useStore(facing)
  const walls = useRef<(HTMLElement | null)[]>([])
  const lastFocus = useRef<(HTMLElement | null)[]>([])
  const { key: page } = useLocation()

  // Going anywhere (a link, a search, a command) is going somewhere in the files.
  useEffect(() => turnTo(0), [page])

  // Ctrl and an arrow faces that wall. Not while typing, where Ctrl and an
  // arrow jumps a word, and not while a dialog is open. Backspace on another
  // wall turns back to the files instead of leaving the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || typing(document.activeElement) || navScope() !== document.body) return
      const dir = KEYS[e.key]
      if (e.ctrlKey && !e.shiftKey && dir) {
        e.preventDefault()
        turnTo(wallFor(dir))
      } else if (!e.ctrlKey && e.key === 'Backspace' && facing.get().wall !== 0) {
        e.preventDefault()
        turnTo(0)
      }
    }
    // Capture, so it is seen before the arrow keys move focus or Backspace goes back.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Remember where focus was on each wall, to put it back on the way round.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const i = walls.current.findIndex((w) => w?.contains(e.target as Node))
      if (i >= 0) lastFocus.current[i] = e.target as HTMLElement
    }
    window.addEventListener('focusin', onFocus)
    return () => window.removeEventListener('focusin', onFocus)
  }, [])

  // The turn plays out, then the wall behind is put away.
  useEffect(() => {
    if (f.from === null) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = window.setTimeout(settle, reduced ? 0 : TURN_MS)
    return () => window.clearTimeout(t)
  }, [f.from, f.n])

  // Someone on the keyboard turned: carry focus onto the wall now faced.
  useEffect(() => {
    if (f.from !== null || f.n === 0 || !usingKeyboard()) return
    const wall = walls.current[f.wall]
    if (!wall || wall.contains(document.activeElement)) return
    const before = lastFocus.current[f.wall]
    const to = before?.isConnected && wall.contains(before) ? before : startOf(wall)
    if (to) focusEl(to)
  }, [f.from, f.n, f.wall])

  return (
    <div className="room min-h-0 flex-1" data-turn={f.turn ?? undefined}>
      {WALLS.map((w, i) => {
        const state = i === f.wall ? (f.from === null ? 'faced' : 'coming') : i === f.from ? 'going' : 'away'
        return (
          <div
            key={w.id}
            ref={(el) => {
              walls.current[i] = el
            }}
            className="wall"
            data-state={state}
            inert={state !== 'faced'}
            aria-hidden={state === 'away' || undefined}
          >
            {i === 0 ? children : <EmptyWall wall={w} />}
          </div>
        )
      })}
    </div>
  )
}

/** A wall with nothing on it yet: what it is for, and ideas for what could go there. */
function EmptyWall({ wall }: { wall: Wall }) {
  return (
    <section className="flex h-full w-full overflow-y-auto" aria-label={`${wall.name} wall`}>
      <div className="panel px-raised m-auto flex w-full max-w-[660px] flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1>{wall.name.toUpperCase()}</h1>
          <span className="flex items-center" title={`ctrl and ${wall.key} faces this wall`}>
            <KeyCap cap="ctrl" />
            <KeyCap cap={wall.key} />
          </span>
        </div>
        <p>&gt; {wall.blurb}</p>
        <div className="wall-sign">
          <p className="dim">&gt; nothing on this wall yet. ideas for it:</p>
          <ul className="wall-ideas">
            {wall.ideas.map((idea) => (
              <li key={idea}>{idea}</li>
            ))}
          </ul>
        </div>
        <WallMap here={wall.id} />
      </div>
    </section>
  )
}

/**
 * Which arrow faces which wall, for the bottom of an empty wall; each is also
 * a button that turns there. Focus lands on the way back to the files.
 */
function WallMap({ here }: { here: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="section-title uppercase !p-0">turn round</h3>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {WALLS.map((w, i) => (
          <button key={w.id} type="button" className="wall-turn" disabled={w.id === here} data-nav-start={i === 0 || undefined} onClick={() => turnTo(i)}>
            <KeyCap cap="ctrl" />
            <KeyCap cap={w.key} />
            <span className="ml-1">{w.id === here ? `${w.name} (here)` : w.name}</span>
          </button>
        ))}
      </div>
      <p className="dim">&gt; backspace turns back to the files too.</p>
    </div>
  )
}

/**
 * Four arrows in a cross, like a game pad: the lit one is the wall faced.
 * Pressing one turns to that wall; arrow keys move between them.
 */
export function Compass() {
  const f = useStore(facing)
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="compass" role="group" aria-label="walls of the room">
        {WALLS.map((w, i) => (
          <button
            key={w.id}
            type="button"
            className={`compass-${w.key}`}
            aria-pressed={f.wall === i}
            aria-label={`face ${w.name}, ctrl ${w.key}`}
            title={`${w.name} (ctrl + ${w.key})`}
            onClick={() => turnTo(i)}
          >
            <Arrow dir={w.key} scale={1} />
          </button>
        ))}
        <span className="compass-hub" aria-hidden />
      </div>
      <span className="pixel hidden w-[64px] text-[8px] uppercase lg:inline" aria-live="polite">
        {WALLS[f.wall].name}
      </span>
    </div>
  )
}
