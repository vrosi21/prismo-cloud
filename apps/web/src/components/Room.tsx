import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { facing, turnTo, wallFor, WALLS, type Wall } from '../lib/room'
import { focusEl, navScope, startOf, typing, usingKeyboard } from '../lib/spatial'
import { useStore } from '../lib/store'
import { KeyCap } from './KeyCap'
import { Arrow } from './sprites'
import { LookoutWall } from './LookoutWall'
import { TimeWall } from './TimeWall'

const KEYS: Record<string, (typeof WALLS)[number]['key']> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/**
 * The four walls of the room, all in one place, one faced at a time. The
 * files (the children) are on the front wall, tasks and the calendar
 * (TimeWall) on the right one, notebooks and boards (LookoutWall) on the
 * left one. Walls not faced stay mounted
 * but hidden and inert, so turning back finds the files as they were left:
 * same folder, same scroll, same tile focused.
 */
export function Room({ children }: { children: ReactNode }) {
  const f = useStore(facing)
  const walls = useRef<(HTMLElement | null)[]>([])
  const lastFocus = useRef<(HTMLElement | null)[]>([])
  const { key: page } = useLocation()

  // Going anywhere (a link, a search, a command) is going somewhere in the
  // files. Not the first page shown: the app opens on the wall it was left on.
  // (A change of page, not a first run: React runs effects twice in development.)
  const shown = useRef(page)
  useEffect(() => {
    if (shown.current === page) return
    shown.current = page
    turnTo(0)
  }, [page])

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

  // Someone on the keyboard turned: carry focus onto the wall now faced.
  useEffect(() => {
    if (f.n === 0 || !usingKeyboard()) return
    const wall = walls.current[f.wall]
    if (!wall || wall.contains(document.activeElement)) return
    const before = lastFocus.current[f.wall]
    const to = before?.isConnected && wall.contains(before) ? before : startOf(wall)
    if (to) focusEl(to)
  }, [f.n, f.wall])

  return (
    <div className="room min-h-0 flex-1">
      {WALLS.map((w, i) => {
        const state = i === f.wall ? 'faced' : 'away'
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
            {i === 0 ? children : w.id === 'time' ? <TimeWall /> : w.id === 'lookout' ? <LookoutWall /> : <EmptyWall wall={w} />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A wall with nothing on it yet: what it is for, and ideas for what could go
 * there. A sign in the corner, not a page over the middle, so the room shows:
 * Prismo's face is on the wishes wall.
 */
function EmptyWall({ wall }: { wall: Wall }) {
  return (
    <section className="flex h-full w-full overflow-y-auto" aria-label={`${wall.name} wall`}>
      <div className="panel px-raised mt-auto flex w-full max-w-[440px] flex-col gap-4 p-5">
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

// The order on the tabs: the files, then what is used most.
const TAB_ORDER = ['files', 'time', 'lookout', 'wishes']

/**
 * The walls as tabs with their names. In the top bar on a wide screen; on a
 * phone a bar along the bottom, under the thumb. Ctrl and an arrow still
 * turns, so each tab says which arrow in its tooltip.
 */
export function WallTabs({ where }: { where: 'top' | 'bottom' }) {
  const f = useStore(facing)
  return (
    <nav className={`wall-tabs wall-tabs-${where}`} aria-label="walls of the room">
      {TAB_ORDER.map((id) => {
        const i = WALLS.findIndex((w) => w.id === id)
        const w = WALLS[i]
        return (
          <button
            key={w.id}
            type="button"
            className="wall-tab"
            aria-pressed={f.wall === i}
            title={`${w.tab} (ctrl + ${w.key})`}
            onClick={() => turnTo(i)}
          >
            <Arrow dir={w.key} scale={1} />
            <span>{w.tab}</span>
          </button>
        )
      })}
    </nav>
  )
}
