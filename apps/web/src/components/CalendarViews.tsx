import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ItemKind } from '../api'
import { covers, DAYS, daysBetween, hhmm, iso, minutesOf, monthGrid, MONTHS, parse, plusDays, short, today, weekday, type Occurrence } from '../lib/days'
import { openItem, titleOf, useItemChanges, useItems } from '../lib/items'
import { categories, NONE } from '../lib/categories'
import { useNarrow } from '../lib/narrow'
import { useColorOf } from '../lib/calendars'
import { openAt, pendingMove } from '../lib/repeats'
import { useOccurrenceMenu } from './Menus'

// The calendar's views. All of them get the appearances (Occurrence) of the
// items in range and say what the person did: open one, move one, make one.
//   TimeGrid    one to seven days side by side, hour by hour
//   MonthGrid   one month, six weeks of cells
// Dragging works the same everywhere: press, move, let go. A press that did
// not move is a click. With a finger the page has to scroll, so a drag only
// starts after holding still for a moment (LONG_PRESS); a finger that moves
// before that is scrolling, and a quick tap is a click.

export const HOUR = 44 // px per hour in the time grid
const SNAP = 15 // minutes
const LONG_PRESS = 400 // ms a finger holds still before a chip is picked up
const SLOP = 8 // px a finger may wander and still be a tap

export interface Draft {
  date: string
  time: string | null
  minutes: number | null
  /** Where to show the quick-create box, in viewport pixels. */
  x: number
  y: number
}

interface ViewProps {
  occ: Occurrence[]
  onDraft: (d: Draft) => void
}

type OnMenu = (e: ReactMouseEvent, o: Occurrence) => void

// The colour comes from the calendar (lib/calendars.ts: the item's own,
// else its tag's, else its calendar's).
const colorStyle = (c: number | null): CSSProperties => (c ? ({ '--chip': `var(--c${c})` } as CSSProperties) : {})

/** One appearance, as a chip: colour, a box to tick for a task, the title. */
function Chip({ o, showTime = true, onPointerDown, onMenu }: { o: Occurrence; showTime?: boolean; onPointerDown?: (e: ReactPointerEvent) => void; onMenu?: OnMenu }) {
  const { update } = useItemChanges()
  const colorOf = useColorOf()
  const it = o.item
  const done = it.status === 'done'
  const continues = o.date !== o.end
  return (
    <div
      className="cal-chip"
      onContextMenu={onMenu && ((e) => onMenu(e, o))}
      data-kind={it.kind}
      data-done={done || undefined}
      data-status={it.status ?? undefined}
      style={colorStyle(colorOf(it))}
      title={`${titleOf(it)}${it.time ? ` · ${it.time}` : ''}${continues ? ` · until ${short(o.end)}` : ''}`}
      onPointerDown={onPointerDown}
    >
      {it.status && (
        <input
          type="checkbox"
          className="check check-sm"
          checked={done}
          aria-label={`done: ${titleOf(it)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => update.mutate({ id: it.id, change: { status: e.target.checked ? 'done' : 'todo' } })}
        />
      )}
      {showTime && it.time && <span className="cal-chip-time">{it.time}</span>}
      <span className="truncate">{titleOf(it)}</span>
    </div>
  )
}

// --- dragging -------------------------------------------------------------

interface Drag {
  o: Occurrence
  mode: 'move' | 'resize'
  x: number
  y: number
  moved: boolean
  /** Where it would land now. */
  date: string
  start: number // minutes, timed only
  minutes: number
}

/** The cell under the pointer: [data-day] gives the day. */
function dayAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-day]') as HTMLElement | null
  return el?.dataset.day ?? null
}

function useDragItems(onDone: (d: Drag) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const live = useRef<Drag | null>(null)
  live.current = drag
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const d = live.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) < 5) return
      const day = dayAt(e.clientX, e.clientY) ?? d.date
      const step = Math.round(((dy / HOUR) * 60) / SNAP) * SNAP
      const it = d.o.item
      const start0 = it.time ? minutesOf(it.time) : 0
      const len0 = it.minutes ?? 60
      setDrag({
        ...d,
        moved: true,
        date: d.mode === 'move' ? day : d.date,
        start: d.mode === 'move' ? Math.max(0, Math.min(1440 - SNAP, start0 + step)) : start0,
        minutes: d.mode === 'resize' ? Math.max(SNAP, Math.min(1440 - start0, len0 + step)) : len0,
      })
    }
    const up = () => {
      const d = live.current
      setDrag(null)
      if (d) onDone(d)
    }
    // The browser took the pointer (a scroll, a system gesture): nothing happened.
    const cancel = () => setDrag(null)
    // A finger that picked a chip up must not scroll the page while it moves.
    const noScroll = (e: TouchEvent) => e.cancelable && e.preventDefault()
    // A long-press also opens the menu. Held still, that is what was meant;
    // once the chip moved, it is a drag and the menu stays shut.
    const onMenu = (e: Event) => {
      if (live.current?.moved) {
        e.preventDefault()
        e.stopPropagation()
      } else setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', cancel, { once: true })
    window.addEventListener('touchmove', noScroll, { passive: false })
    window.addEventListener('contextmenu', onMenu, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', noScroll)
      window.removeEventListener('contextmenu', onMenu, true)
    }
  }, [drag !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = (o: Occurrence, mode: Drag['mode']) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const it = o.item
    const at = { o, mode, x: e.clientX, y: e.clientY, moved: false, date: o.date, start: it.time ? minutesOf(it.time) : 0, minutes: it.minutes ?? 60 }
    if (e.pointerType !== 'touch') {
      e.preventDefault()
      setDrag(at)
      return
    }
    // A finger: wait. Held still, the chip is picked up; moved, it was a
    // scroll; let go quickly, it was a tap and opens the item.
    const done = () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wander)
      window.removeEventListener('pointerup', tap)
      window.removeEventListener('pointercancel', done)
    }
    const timer = window.setTimeout(() => {
      done()
      navigator.vibrate?.(10)
      setDrag(at)
    }, LONG_PRESS)
    const wander = (ev: PointerEvent) => Math.hypot(ev.clientX - at.x, ev.clientY - at.y) > SLOP && done()
    const tap = () => {
      done()
      onDone(at)
    }
    window.addEventListener('pointermove', wander)
    window.addEventListener('pointerup', tap, { once: true })
    window.addEventListener('pointercancel', done, { once: true })
  }
  return { drag, start }
}

/** What a finished drag changes; a click opens the item instead. */
function useDropChange() {
  const { update } = useItemChanges()
  return (d: Drag) => {
    const it = d.o.item
    if (!d.moved) {
      openAt.set({ id: it.id, orig: d.o.orig })
      openItem.set(it.id)
      return
    }
    // A repeating one asks: only this one, this and later, or all of them.
    if (it.repeat) {
      const to = { date: d.date, time: it.time ? hhmm(d.start) : null, minutes: it.time ? d.minutes : null }
      if (to.date !== d.o.date || to.time !== it.time || to.minutes !== it.minutes) pendingMove.set({ item: it, orig: d.o.orig, to })
      return
    }
    const shift = daysBetween(d.o.date, d.date)
    const change: Parameters<typeof update.mutate>[0]['change'] = {}
    if (shift && it.date) {
      change.date = plusDays(it.date, shift)
      if (it.end_date) change.end_date = plusDays(it.end_date, shift)
    }
    if (it.time && d.mode === 'move' && hhmm(d.start) !== it.time) change.time = hhmm(d.start)
    if (d.mode === 'resize' && d.minutes !== it.minutes) change.minutes = d.minutes
    if (Object.keys(change).length) update.mutate({ id: it.id, change })
  }
}

// --- time grid --------------------------------------------------------------

interface Placed {
  o: Occurrence
  start: number
  end: number
  col: number
  cols: number
}

/** Side by side where they overlap, full width where they do not. */
function place(list: Occurrence[]): Placed[] {
  const items = list
    .map((o) => {
      const start = minutesOf(o.item.time!)
      return { o, start, end: Math.min(1440, start + Math.max(o.item.minutes ?? 30, 20)), col: 0, cols: 1 }
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)
  let cluster: Placed[] = []
  let ends: number[] = []
  let reach = -1
  const close = () => {
    for (const p of cluster) p.cols = ends.length
    cluster = []
    ends = []
  }
  for (const p of items) {
    if (p.start >= reach) close()
    let col = ends.findIndex((e) => e <= p.start)
    if (col < 0) col = ends.push(0) - 1
    ends[col] = p.end
    p.col = col
    cluster.push(p)
    reach = Math.max(reach, p.end)
  }
  close()
  return items
}

export function TimeGrid({ days, occ, onDraft }: ViewProps & { days: string[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  const now = useNow()
  const drop = useDropChange()
  const occMenu = useOccurrenceMenu()
  const colorOf = useColorOf()
  const { drag, start } = useDragItems(drop)
  const [making, setMaking] = useState<{ date: string; from: number; to: number; x: number; y: number } | null>(null)

  // Open at the morning, or a bit before now when today is shown.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const at = days.includes(today()) ? Math.max(0, now - 90) : 7.5 * 60
    el.scrollTop = (at / 60) * HOUR
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const allDay = (day: string) => occ.filter((o) => covers(o, day) && !o.item.time)
  const timed = (day: string) => {
    const shown = occ.filter((o) => o.date === day && o.item.time && !(drag?.moved && drag.o.key === o.key))
    return place(shown)
  }

  // Press on an empty hour and drag down: a new event for that stretch.
  const minuteAt = (e: { clientY: number }, col: HTMLElement) => {
    const y = e.clientY - col.getBoundingClientRect().top
    return Math.max(0, Math.min(1440 - SNAP, Math.floor(((y / HOUR) * 60) / SNAP) * SNAP))
  }
  const press = (day: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const col = e.currentTarget
    const m = minuteAt(e, col)
    if (e.pointerType === 'touch') {
      // A finger scrolls the hours. Only a tap that stayed put makes an
      // hour-long event there.
      const x = e.clientX
      const y = e.clientY
      const off = () => {
        window.removeEventListener('pointerup', tap)
        window.removeEventListener('pointercancel', off)
        window.removeEventListener('pointermove', wander)
      }
      const wander = (ev: PointerEvent) => Math.hypot(ev.clientX - x, ev.clientY - y) > SLOP && off()
      const tap = () => {
        off()
        onDraft({ date: day, time: hhmm(m - (m % 60)), minutes: 60, x, y })
      }
      window.addEventListener('pointermove', wander)
      window.addEventListener('pointerup', tap, { once: true })
      window.addEventListener('pointercancel', off, { once: true })
      return
    }
    setMaking({ date: day, from: m, to: m + 60, x: e.clientX, y: e.clientY })
    const move = (ev: PointerEvent) => {
      const to = Math.max(m + SNAP, minuteAt(ev, col) + SNAP)
      setMaking((s) => (s ? { ...s, to, x: ev.clientX, y: ev.clientY } : s))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      setMaking((s) => {
        if (s) onDraft({ date: s.date, time: hhmm(s.from), minutes: s.to - s.from, x: s.x, y: s.y })
        return null
      })
    }
    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMaking(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', cancel, { once: true })
  }

  const cols = { gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }
  return (
    <div className="tg">
      <div className="tg-head" style={cols}>
        <span />
        {days.map((d) => (
          <div key={d} className="tg-day-name" data-today={d === today() || undefined}>
            <span>{DAYS[weekday(parse(d))].slice(0, 3)}</span>
            <b>{parse(d).getDate()}</b>
          </div>
        ))}
      </div>
      <div className="tg-allday" style={cols}>
        <span className="tg-gutter">all day</span>
        {days.map((d) => (
          <div
            key={d}
            className="tg-allday-cell"
            data-day={d}
            onClick={(e) => e.target === e.currentTarget && onDraft({ date: d, time: null, minutes: null, x: e.clientX, y: e.clientY })}
          >
            {allDay(d).map((o) => (
              <Chip key={o.key} o={o} onPointerDown={start(o, 'move')} onMenu={occMenu} />
            ))}
          </div>
        ))}
      </div>
      <div className="tg-body" ref={scroller}>
        <div className="tg-grid" style={{ ...cols, height: 24 * HOUR }}>
          <div className="tg-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="tg-col" data-day={d} data-today={d === today() || undefined} onPointerDown={press(d)}>
              {timed(d).map((p) => (
                <Block key={p.o.key} p={p} onMove={start(p.o, 'move')} onResize={start(p.o, 'resize')} onMenu={occMenu} />
              ))}
              {drag?.moved && drag.date === d && drag.o.item.time && (
                <div className="tg-block tg-ghost" style={{ top: (drag.start / 60) * HOUR, height: (drag.minutes / 60) * HOUR, left: 2, right: 2, ...colorStyle(colorOf(drag.o.item)) }}>
                  <span className="cal-chip-time">
                    {hhmm(drag.start)}-{hhmm(drag.start + drag.minutes)}
                  </span>
                  <span className="truncate">{titleOf(drag.o.item)}</span>
                </div>
              )}
              {making?.date === d && (
                <div className="tg-block tg-ghost" style={{ top: (making.from / 60) * HOUR, height: ((making.to - making.from) / 60) * HOUR, left: 2, right: 2 }}>
                  <span className="cal-chip-time">
                    {hhmm(making.from)}-{hhmm(making.to)}
                  </span>
                </div>
              )}
              {d === today() && <div className="tg-now" style={{ top: (now / 60) * HOUR }} aria-hidden />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Block({ p, onMove, onResize, onMenu }: { p: Placed; onMove: (e: ReactPointerEvent) => void; onResize: (e: ReactPointerEvent) => void; onMenu: OnMenu }) {
  const it = p.o.item
  const height = Math.max(((p.end - p.start) / 60) * HOUR, 18)
  const { update } = useItemChanges()
  const colorOf = useColorOf()
  return (
    <div
      className="tg-block"
      onContextMenu={(e) => onMenu(e, p.o)}
      data-kind={it.kind}
      data-done={it.status === 'done' || undefined}
      data-status={it.status ?? undefined}
      style={{
        top: (p.start / 60) * HOUR,
        height,
        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
        width: `calc(${100 / p.cols}% - 4px)`,
        ...colorStyle(colorOf(it)),
      }}
      onPointerDown={onMove}
      title={titleOf(it)}
    >
      <div className="flex items-center gap-1">
        {it.status && (
          <input
            type="checkbox"
            className="check check-sm"
            checked={it.status === 'done'}
            aria-label={`done: ${titleOf(it)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => update.mutate({ id: it.id, change: { status: e.target.checked ? 'done' : 'todo' } })}
          />
        )}
        <span className="truncate">{titleOf(it)}</span>
      </div>
      {height > 30 && (
        <span className="cal-chip-time">
          {it.time}
          {it.minutes ? `-${hhmm(p.start + it.minutes)}` : ''}
        </span>
      )}
      {it.minutes !== null && <span className="tg-resize" onPointerDown={onResize} aria-hidden />}
    </div>
  )
}

/** Minutes since midnight, kept current. */
function useNow() {
  const get = () => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
  const [now, setNow] = useState(get)
  useEffect(() => {
    const t = setInterval(() => setNow(get()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

// --- month ------------------------------------------------------------------

export function MonthGrid({
  year,
  month,
  occ,
  onDraft,
  onDay,
  compact = false,
}: ViewProps & { year: number; month: number; onDay: (day: string) => void; compact?: boolean }) {
  const days = useMemo(() => monthGrid(year, month).map(iso), [year, month])
  const drop = useDropChange()
  const occMenu = useOccurrenceMenu()
  const { drag, start } = useDragItems(drop)
  const max = compact ? 2 : 4
  const t = today()
  return (
    <div className={`mg ${compact ? 'mg-compact' : ''}`}>
      {compact && <h3 className="mg-title">{MONTHS[month]} {year}</h3>}
      <div className="mg-head">
        {DAYS.map((d) => (
          <span key={d}>{compact ? d.slice(0, 1) : d.slice(0, 3)}</span>
        ))}
      </div>
      <div className="mg-cells">
        {days.map((day) => {
          const here = occ
            .filter((o) => covers(o, day))
            .sort((a, b) => Number(Boolean(a.item.time)) - Number(Boolean(b.item.time)) || (a.item.time ?? '').localeCompare(b.item.time ?? ''))
          const other = parse(day).getMonth() !== month
          return (
            <div
              key={day}
              className="mg-cell"
              data-day={day}
              data-other={other || undefined}
              data-today={day === t || undefined}
              data-drop={(drag?.moved && drag.date === day) || undefined}
              onClick={(e) => e.target === e.currentTarget && onDraft({ date: day, time: null, minutes: null, x: e.clientX, y: e.clientY })}
            >
              <button type="button" className="mg-num" onClick={() => onDay(day)} title={`open ${short(day)}`}>
                {parse(day).getDate()}
              </button>
              {here.slice(0, max).map((o) => (
                <Chip key={o.key} o={o} showTime={!compact} onPointerDown={start(o, 'move')} onMenu={occMenu} />
              ))}
              {here.length > max && (
                <button type="button" className="mg-more" onClick={() => onDay(day)}>
                  +{here.length - max} more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --- making a new one -------------------------------------------------------

/**
 * A small box where the pointer was: a title, event or task, Enter. On a
 * phone it comes up from the bottom instead, with the day, the time and a
 * category to pick, since there was no drag to say when.
 */
export function QuickCreate({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { create } = useItemChanges()
  const narrow = useNarrow()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ItemKind>(draft.time ? 'event' : 'task')
  const [date, setDate] = useState<string | null>(draft.date)
  const [time, setTime] = useState<string | null>(draft.time)
  const [category, setCategory] = useState('')
  const { data: recent = [] } = useItems({}, narrow)
  const cats = useMemo(() => categories(recent).map((c) => c.tag).filter((t) => t !== NONE), [recent])
  const box = useRef<HTMLFormElement>(null)
  const [pos, setPos] = useState({ left: draft.x, top: draft.y })
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect()
    if (!r || narrow) return
    setPos({ left: Math.max(8, Math.min(draft.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(draft.y, window.innerHeight - r.height - 8)) })
  }, [draft, narrow])
  const make = (more: boolean) => {
    if (!title.trim()) return
    const minutes = time ? (time === draft.time ? draft.minutes : 60) : null
    create.mutate(
      {
        item: {
          kind,
          title: title.trim(),
          // An event needs a day; a task may have none.
          date: date ?? (kind === 'event' ? today() : null),
          time: date || kind === 'event' ? time : null,
          minutes: kind === 'event' || time ? minutes : null,
          ...(category ? { tags: [category] } : {}),
        },
      },
      {
        onSuccess: (it) => {
          if (more) openItem.set(it.id)
          onClose()
        },
      },
    )
  }
  const when = `${short(draft.date)}${draft.time ? ` · ${draft.time}-${hhmm(minutesOf(draft.time) + (draft.minutes ?? 60))}` : ' · all day'}`
  const t = today()
  const form = (
    <form
      ref={box}
      className={`panel px-raised quick-create ${narrow ? 'sheet' : ''}`}
      style={narrow ? undefined : { left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="new on the calendar"
      onSubmit={(e) => {
        e.preventDefault()
        make(false)
      }}
    >
      <input
        className="field"
        autoFocus
        placeholder="title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      />
      <div className="flex flex-wrap items-center gap-2">
        {(['event', 'task'] as const).map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
        {!narrow && <span className="dim">{when}</span>}
      </div>
      {narrow && (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="day">
            {kind === 'task' && (
              <button type="button" className="chip" aria-pressed={date === null} onClick={() => setDate(null)}>
                no day
              </button>
            )}
            <button type="button" className="chip" aria-pressed={date === t} onClick={() => setDate(t)}>
              today
            </button>
            <button type="button" className="chip" aria-pressed={date === plusDays(t, 1)} onClick={() => setDate(plusDays(t, 1))}>
              tomorrow
            </button>
            <input type="date" className="field !w-auto" aria-label="pick a day" value={date ?? ''} onChange={(e) => setDate(e.target.value || null)} />
          </div>
          {(date || kind === 'event') && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="chip" aria-pressed={time === null} onClick={() => setTime(null)}>
                all day
              </button>
              <input type="time" className="field !w-auto" aria-label="time" value={time ?? ''} onChange={(e) => setTime(e.target.value || null)} />
            </div>
          )}
          {cats.length > 0 && (
            <select className="field" aria-label="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">no category</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-accent" disabled={!title.trim() || create.isPending}>
          save
        </button>
        <button type="button" className="btn btn-sm" disabled={!title.trim() || create.isPending} onClick={() => make(true)}>
          more
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          cancel
        </button>
      </div>
    </form>
  )
  return narrow ? (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      {form}
    </>
  ) : (
    form
  )
}

// --- agenda -----------------------------------------------------------------

/**
 * The days ahead as one list, like Google Calendar's schedule: a heading per
 * day that has something, then its all-day things and the rest by time.
 * Today always shows, even empty. Reaching the end asks for more days.
 */
export function Agenda({ from, to, occ, onMore }: { from: string; to: string; occ: Occurrence[]; onMore: () => void }) {
  const { update } = useItemChanges()
  const occMenu = useOccurrenceMenu()
  const colorOf = useColorOf()
  const end = useRef<HTMLDivElement>(null)
  const t = today()

  // Reaching the bottom loads more days.
  useEffect(() => {
    const el = end.current
    if (!el) return
    const seen = new IntersectionObserver((e) => e[0]?.isIntersecting && onMore(), { rootMargin: '200px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [onMore])

  const days = useMemo(() => {
    const out: { day: string; list: Occurrence[] }[] = []
    for (let d = from; d <= to; d = plusDays(d, 1)) {
      const list = occ
        .filter((o) => covers(o, d))
        .sort((a, b) => Number(Boolean(a.item.time)) - Number(Boolean(b.item.time)) || (a.item.time ?? '').localeCompare(b.item.time ?? ''))
      if (list.length || d === t) out.push({ day: d, list })
    }
    return out
  }, [from, to, occ, t])

  const open = (o: Occurrence) => {
    openAt.set({ id: o.item.id, orig: o.orig })
    openItem.set(o.item.id)
  }
  return (
    <div className="agenda">
      {days.map(({ day, list }) => {
        const d = parse(day)
        return (
          <section key={day} className="agenda-day" data-today={day === t || undefined}>
            <h3 className="agenda-date">
              <b>{d.getDate()}</b>
              <span>
                {DAYS[weekday(d)].slice(0, 3)} {MONTHS[d.getMonth()].slice(0, 3)}
              </span>
              {day === t ? <span>today</span> : day === plusDays(t, 1) ? <span>tomorrow</span> : null}
            </h3>
            {list.length === 0 && <p className="dim">&gt; nothing on today.</p>}
            <ul>
              {list.map((o) => {
                const it = o.item
                return (
                  <li
                    key={o.key}
                    className="agenda-row"
                    style={colorStyle(colorOf(it))}
                    data-kind={it.kind}
                    data-done={it.status === 'done' || undefined}
                    onContextMenu={(e) => occMenu(e, o)}
                  >
                    {it.status ? (
                      <input
                        type="checkbox"
                        className="check"
                        checked={it.status === 'done'}
                        aria-label={`done: ${titleOf(it)}`}
                        onChange={(e) => update.mutate({ id: it.id, change: { status: e.target.checked ? 'done' : 'todo' } })}
                      />
                    ) : (
                      <span className="agenda-bar" aria-hidden />
                    )}
                    <button type="button" className="agenda-title" onClick={() => open(o)}>
                      <span className="agenda-when">
                        {it.time ? `${it.time}${it.minutes ? `-${hhmm(minutesOf(it.time) + it.minutes)}` : ''}` : o.date !== o.end ? `until ${short(o.end)}` : 'all day'}
                      </span>
                      <span>{titleOf(it)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      <div ref={end} className="agenda-end">
        <button type="button" className="btn btn-sm" onClick={onMore}>
          later days
        </button>
      </div>
    </div>
  )
}
