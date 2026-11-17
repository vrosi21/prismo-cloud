import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Item } from '../api'
import { addDays, DAYS, iso, monthGrid, MONTHS, occurrences, parse, plusDays, short, today, weekday } from '../lib/days'
import { categories, hidden, NONE, setHidden, shown, type Hidden } from '../lib/categories'
import { openItem, titleOf, useItemChanges, useItems } from '../lib/items'
import { facing, WALLS } from '../lib/room'
import { typing } from '../lib/spatial'
import { useStore } from '../lib/store'
import { MonthGrid, QuickCreate, TimeGrid, type Draft } from './CalendarViews'
import { MoveChoice } from './Appearance'
import { KeyCap } from './KeyCap'

// The time wall: a calendar the way Google's works, and a task list beside
// it. Everything on it is an item (see lib/items): an event has a day, a
// task can be ticked off and may or may not have a day. Views: one day,
// three days, a week, a month, and several months side by side.

type View = 'day' | '3day' | 'week' | 'month' | 'months'
type Layout = '1x2' | '1x3' | '2x2'

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: 'day', label: 'day', key: 'd' },
  { id: '3day', label: '3 days', key: 'x' },
  { id: 'week', label: 'week', key: 'w' },
  { id: 'month', label: 'month', key: 'm' },
  { id: 'months', label: 'months', key: 'g' },
]
const LAYOUTS: { id: Layout; label: string; count: number; cols: number }[] = [
  { id: '1x2', label: '2 side by side', count: 2, cols: 2 },
  { id: '1x3', label: '3 side by side', count: 3, cols: 3 },
  { id: '2x2', label: '4 in a square', count: 4, cols: 2 },
]

function remembered<T extends string>(key: string, fallback: T, ok: readonly string[]): T {
  try {
    const v = localStorage.getItem(key)
    return v && ok.includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* not remembered */
  }
}

const monthStart = (day: string) => {
  const d = parse(day)
  return { year: d.getFullYear(), month: d.getMonth() }
}
const addMonths = (day: string, n: number) => {
  const d = parse(day)
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

export function TimeWall() {
  const [view, setViewState] = useState<View>(() => remembered('prismo.cal.view', 'week', VIEWS.map((v) => v.id)))
  const [layout, setLayoutState] = useState<Layout>(() => remembered('prismo.cal.layout', '2x2', LAYOUTS.map((l) => l.id)))
  const [anchor, setAnchor] = useState(today)
  const [draft, setDraft] = useState<Draft | null>(null)
  const setView = (v: View) => {
    setViewState(v)
    remember('prismo.cal.view', v)
  }
  const setLayout = (l: Layout) => {
    setLayoutState(l)
    remember('prismo.cal.layout', l)
  }
  const lay = LAYOUTS.find((l) => l.id === layout)!

  // The days on screen, and the first and last day to ask the server for.
  const { days, from, to, title } = useMemo(() => {
    const a = parse(anchor)
    if (view === 'month' || view === 'months') {
      const count = view === 'month' ? 1 : lay.count
      const grids = Array.from({ length: count }, (_, i) => monthGrid(a.getFullYear(), a.getMonth() + i))
      const first = new Date(a.getFullYear(), a.getMonth(), 1)
      const last = new Date(a.getFullYear(), a.getMonth() + count - 1, 1)
      const name = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
      return {
        days: [] as string[],
        from: iso(grids[0][0]),
        to: iso(grids[count - 1][41]),
        title: count === 1 ? name(first) : `${MONTHS[first.getMonth()].slice(0, 3)} - ${name(last)}`,
      }
    }
    const n = view === 'day' ? 1 : view === '3day' ? 3 : 7
    const start = view === 'week' ? addDays(a, -weekday(a)) : a
    const list = Array.from({ length: n }, (_, i) => iso(addDays(start, i)))
    const s = parse(list[0])
    const e = parse(list[n - 1])
    const t =
      n === 1
        ? `${DAYS[weekday(s)]} ${s.getDate()} ${MONTHS[s.getMonth()]}`
        : s.getMonth() === e.getMonth()
          ? `${s.getDate()} - ${e.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`
          : `${s.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)} - ${e.getDate()} ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`
    return { days: list, from: list[0], to: list[n - 1], title: t }
  }, [anchor, view, lay.count])

  const { data: all = [], isError } = useItems({ from, to, someday: true })
  // What the category filter lets through.
  const off = useStore(hidden)
  const items = useMemo(() => all.filter((it) => shown(it, off)), [all, off])
  const occ = useMemo(() => occurrences(items, from, to), [items, from, to])

  const step = (dir: 1 | -1) => {
    if (view === 'month') setAnchor(addMonths(anchor, dir))
    else if (view === 'months') setAnchor(addMonths(anchor, dir * lay.count))
    else setAnchor(plusDays(anchor, dir * (view === 'day' ? 1 : view === '3day' ? 3 : 7)))
  }
  const openDay = (day: string) => {
    setAnchor(day)
    setView('day')
  }

  // Keys, as in Google Calendar: d x w m g pick a view, t is today, j/k or
  // n/p step, c makes something new. Only while this wall is faced.
  const wall = useStore(facing).wall
  const here = WALLS[wall]?.id === 'time'
  useEffect(() => {
    if (!here) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || typing(document.activeElement) || document.querySelector('[role=dialog]')) return
      const v = VIEWS.find((x) => x.key === e.key)
      if (v) setView(v.id)
      else if (e.key === 't') setAnchor(today())
      else if (e.key === 'j' || e.key === 'n') step(1)
      else if (e.key === 'k' || e.key === 'p') step(-1)
      else if (e.key === 'c') setDraft({ date: anchor, time: null, minutes: null, x: window.innerWidth / 2 - 150, y: 120 })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <section className="time-wall" aria-label="time wall: calendar and tasks">
      <aside className="time-side panel px">
        <MiniMonth anchor={anchor} onPick={setAnchor} items={items} />
        <Categories inRange={all} />
        <TaskList items={items} anchor={anchor} />
      </aside>
      <MoveChoice />

      <div className="time-main panel px">
        <div className="time-bar">
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={() => step(-1)} aria-label="back" title="back (k)">
              &lt;
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAnchor(today())} title="today (t)">
              today
            </button>
            <button type="button" className="btn btn-sm" onClick={() => step(1)} aria-label="forward" title="forward (j)">
              &gt;
            </button>
          </div>
          <h2 className="time-title">{title}</h2>
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="view">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className="chip" aria-pressed={view === v.id} onClick={() => setView(v.id)} title={`${v.label} (${v.key})`}>
                {v.label}
              </button>
            ))}
            {view === 'months' && (
              <select className="field !w-auto" aria-label="how many months" value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
                {LAYOUTS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-accent"
            title="new (c)"
            onClick={(e) => setDraft({ date: days.includes(today()) || view.startsWith('month') ? today() : anchor, time: null, minutes: null, x: e.clientX - 280, y: e.clientY + 16 })}
          >
            + new
          </button>
        </div>
        {isError && <p className="text-danger">&gt; the calendar could not be loaded.</p>}

        <div className="time-view">
          {view === 'month' ? (
            <MonthGrid {...monthStart(anchor)} occ={occ} onDraft={setDraft} onDay={openDay} />
          ) : view === 'months' ? (
            <div className="months" style={{ gridTemplateColumns: `repeat(${lay.cols}, minmax(0, 1fr))` }}>
              {Array.from({ length: lay.count }, (_, i) => (
                <MonthGrid key={i} {...monthStart(addMonths(anchor, i))} occ={occ} onDraft={setDraft} onDay={openDay} compact />
              ))}
            </div>
          ) : (
            <TimeGrid key={`${view}-${days[0]}`} days={days} occ={occ} onDraft={setDraft} />
          )}
        </div>
      </div>
      {draft && <QuickCreate draft={draft} onClose={() => setDraft(null)} />}
    </section>
  )
}

/** A small month to jump around with; dots on days that have something. */
function MiniMonth({ anchor, onPick, items }: { anchor: string; onPick: (day: string) => void; items: Item[] }) {
  const [shown, setShown] = useState(() => monthStart(anchor))
  useEffect(() => setShown(monthStart(anchor)), [anchor])
  const days = useMemo(() => monthGrid(shown.year, shown.month).map(iso), [shown])
  const busy = useMemo(() => new Set(occurrences(items, days[0], days[41]).flatMap((o) => (o.date === o.end ? [o.date] : [o.date, o.end]))), [items, days])
  const t = today()
  const go = (n: number) => setShown(({ year, month }) => monthStart(iso(new Date(year, month + n, 1))))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button type="button" className="chip" onClick={() => go(-1)} aria-label="previous month">
          &lt;
        </button>
        <span className="pixel text-[9px] uppercase">
          {MONTHS[shown.month].slice(0, 3)} {shown.year}
        </span>
        <button type="button" className="chip" onClick={() => go(1)} aria-label="next month">
          &gt;
        </button>
      </div>
      <div className="mini">
        {DAYS.map((d) => (
          <span key={d} className="mini-head">
            {d[0]}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className="mini-day"
            data-other={parse(d).getMonth() !== shown.month || undefined}
            data-today={d === t || undefined}
            data-busy={busy.has(d) || undefined}
            aria-pressed={d === anchor}
            onClick={() => onPick(d)}
            title={short(d)}
          >
            {parse(d).getDate()}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Tasks the way Google Tasks keeps them: add one at the top; below, what is
 * late, what has no day, and what was ticked off lately.
 */
function TaskList({ items, anchor }: { items: Item[]; anchor: string }) {
  const { create, update } = useItemChanges()
  const [title, setTitle] = useState('')
  const [onDay, setOnDay] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const t = today()
  const tasks = items.filter((it) => it.kind === 'task')
  const late = tasks.filter((it) => it.date && it.date < t && it.status !== 'done' && !it.repeat)
  const someday = tasks.filter((it) => !it.date && it.status !== 'done')
  const done = tasks.filter((it) => !it.date && it.status === 'done')
  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate({ item: { kind: 'task', title: title.trim(), date: onDay ? anchor : null } }, { onSuccess: () => setTitle('') })
  }
  const row = (it: Item) => (
    <li key={it.id} className="task" data-done={it.status === 'done' || undefined} data-status={it.status ?? undefined}>
      <input
        type="checkbox"
        className="check"
        checked={it.status === 'done'}
        aria-label={`done: ${titleOf(it)}`}
        onChange={(e) => update.mutate({ id: it.id, change: { status: e.target.checked ? 'done' : 'todo' } })}
      />
      <button type="button" className="task-title" onClick={() => openItem.set(it.id)}>
        {titleOf(it)}
      </button>
      {it.date && <span className="task-time">{short(it.date)}</span>}
    </li>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <h3 className="section-title uppercase !p-0">tasks</h3>
      <form className="flex flex-col gap-2" onSubmit={add}>
        <input className="field" placeholder="add a task" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="new task" />
        <label className="flex items-center gap-2 text-[18px]">
          <input type="checkbox" className="check check-sm" checked={onDay} onChange={(e) => setOnDay(e.target.checked)} />
          on {anchor === t ? 'today' : short(anchor)}
        </label>
      </form>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        {late.length > 0 && (
          <div>
            <span className="label text-danger">late</span>
            <ul>{late.map(row)}</ul>
          </div>
        )}
        <div>
          <span className="label">no day</span>
          {someday.length === 0 ? <p className="dim">&gt; nothing waiting.</p> : <ul>{someday.map(row)}</ul>}
        </div>
        {done.length > 0 && (
          <div>
            <button type="button" className="label link-btn" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
              done ({done.length}) {showDone ? 'v' : '>'}
            </button>
            {showDone && <ul>{done.map(row)}</ul>}
          </div>
        )}
      </div>
      <p className="dim hidden text-[16px] leading-tight xl:block">
        <KeyCap cap="d" />
        <KeyCap cap="x" />
        <KeyCap cap="w" />
        <KeyCap cap="m" />
        <KeyCap cap="g" /> views · <KeyCap cap="t" /> today · <KeyCap cap="c" /> new
      </p>
    </div>
  )
}

/**
 * The calendar's categories, like Google's list of calendars: each can be
 * switched off, or shown alone; open one to switch off parts of it (a
 * course, a type). Built from the items' tags, nothing to set up.
 */
function Categories({ inRange }: { inRange: Item[] }) {
  // Categories of everything, not only of what this range shows, so one
  // that was switched off does not vanish from the list.
  const { data: recent = [] } = useItems({})
  const cats = useMemo(() => {
    const seen = new Map<string, Item>()
    for (const it of [...recent, ...inRange]) seen.set(it.id, it)
    return categories([...seen.values()])
  }, [recent, inRange])
  const off = useStore(hidden)
  const [open, setOpen] = useState<string | null>(null)
  if (cats.length === 0 || (cats.length === 1 && cats[0].tag === NONE)) return null

  const toggle = (list: keyof Hidden, key: string) => {
    const has = off[list].includes(key)
    setHidden({ ...off, [list]: has ? off[list].filter((k) => k !== key) : [...off[list], key] })
  }
  const only = (tag: string) => setHidden({ tops: cats.map((c) => c.tag).filter((t) => t !== tag), facets: off.facets.filter((f) => f.startsWith(`${tag}|`)) })
  const any = off.tops.length > 0 || off.facets.length > 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="section-title uppercase !p-0">categories</h3>
        {any && (
          <button type="button" className="chip" onClick={() => setHidden({ tops: [], facets: [] })}>
            all
          </button>
        )}
      </div>
      <ul className="cats">
        {cats.map((c) => {
          const on = !off.tops.includes(c.tag)
          const name = c.tag === NONE ? 'no category' : c.tag
          return (
            <li key={c.tag || '-'}>
              <div className="cat-row">
                <input type="checkbox" className="check check-sm" checked={on} aria-label={`show ${name}`} onChange={() => toggle('tops', c.tag)} />
                <button type="button" className="cat-name" aria-expanded={c.facets.length ? open === c.tag : undefined} onClick={() => setOpen(open === c.tag ? null : c.tag)}>
                  {name}
                  {c.facets.length > 0 && <span className="dim"> {open === c.tag ? 'v' : '>'}</span>}
                </button>
                <button type="button" className="chip cat-only" onClick={() => only(c.tag)} title={`show only ${name}`}>
                  only
                </button>
              </div>
              {open === c.tag &&
                c.facets.map((f) => (
                  <div key={f.key} className="cat-facet">
                    <span className="label">{f.key}</span>
                    <div className="flex flex-wrap gap-1">
                      {f.values.map((v) => {
                        const key = `${c.tag}|${f.key}:${v.value}`
                        return (
                          <button key={v.value} type="button" className="chip" aria-pressed={!off.facets.includes(key)} onClick={() => toggle('facets', key)} title={`${v.count} items`}>
                            {v.value}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
