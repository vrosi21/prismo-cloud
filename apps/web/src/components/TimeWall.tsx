import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Task, type TaskChange } from '../api'
import { errorText, log } from '../lib/log'
import { KeyCap } from './KeyCap'

// The time wall: a month on the left, the day picked in it on the right, and
// under that "someday", for what has no date. One kind of thing throughout:
// a task. Give it a date and it is on the calendar; take the date away and it
// is back in someday.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** 2026-11-12 for a local date. */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
/** Monday is the first day of the week. */
const weekday = (d: Date) => (d.getDay() + 6) % 7
/** "thu 12 nov" */
const short = (day: string) => {
  const d = parse(day)
  return `${DAYS[weekday(d)].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

/** Six weeks from the Monday on or before the 1st: every month fits. */
function grid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = addDays(first, -weekday(first))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

// Not done first, by time; the done ones sink to the bottom.
const order = (a: Task, b: Task) => Number(a.done) - Number(b.done) || (a.time ?? '').localeCompare(b.time ?? '')

function useTaskChanges() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] })
  const onError = (e: unknown) => log('err', errorText(e))
  return {
    create: useMutation({
      mutationFn: ({ title, date, time }: { title: string; date: string | null; time: string | null }) => api.createTask(title, date, time),
      onSuccess: refresh,
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, change }: { id: string; change: TaskChange }) => api.updateTask(id, change),
      onSuccess: refresh,
      onError,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteTask(id), onSuccess: refresh, onError }),
  }
}

export function TimeWall() {
  const today = iso(new Date())
  const [picked, setPicked] = useState(today)
  const [shown, setShown] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const days = useMemo(() => grid(shown.year, shown.month), [shown])
  const from = iso(days[0])
  const to = iso(days[days.length - 1])
  const { data: tasks = [], isPending } = useQuery({ queryKey: ['tasks', from, to], queryFn: () => api.tasks(from, to) })

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) if (t.date) m.set(t.date, [...(m.get(t.date) ?? []), t])
    return m
  }, [tasks])
  const someday = useMemo(() => tasks.filter((t) => !t.date).sort(order), [tasks])

  const turnMonth = (by: number) => setShown(({ year, month }) => ({ year: year + Math.floor((month + by) / 12), month: (((month + by) % 12) + 12) % 12 }))
  const pick = (day: string) => {
    const d = parse(day)
    setPicked(day)
    setShown({ year: d.getFullYear(), month: d.getMonth() })
  }

  return (
    <section className="flex h-full w-full overflow-y-auto" aria-label="time wall">
      <div className="panel px-raised m-auto flex w-full max-w-[1040px] flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1>TIME</h1>
          <span className="flex items-center" title="ctrl and right faces this wall">
            <KeyCap cap="ctrl" />
            <KeyCap cap="right" />
          </span>
        </div>
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-sm" aria-label="month before" onClick={() => turnMonth(-1)}>
                &lt;
              </button>
              <h2 className="grow text-center">
                {MONTHS[shown.month]} {shown.year}
              </h2>
              <button type="button" className="btn btn-sm" aria-label="month after" onClick={() => turnMonth(1)}>
                &gt;
              </button>
              <button type="button" className="btn btn-sm" onClick={() => pick(today)}>
                today
              </button>
            </div>
            <div className="cal" role="grid" aria-label={`${MONTHS[shown.month]} ${shown.year}`} aria-busy={isPending}>
              {DAYS.map((d) => (
                <span key={d} className="cal-head" aria-hidden>
                  {d.slice(0, 2)}
                </span>
              ))}
              {days.map((d) => {
                const day = iso(d)
                const on = byDay.get(day) ?? []
                const open = on.filter((t) => !t.done).length
                return (
                  <button
                    key={day}
                    type="button"
                    className="cal-day"
                    aria-pressed={day === picked}
                    data-today={day === today || undefined}
                    data-other={d.getMonth() !== shown.month || undefined}
                    data-nav-start={day === picked || undefined}
                    aria-label={`${DAYS[weekday(d)]} ${d.getDate()} ${MONTHS[d.getMonth()]}${on.length ? `, ${open} to do of ${on.length}` : ''}`}
                    onClick={() => pick(day)}
                  >
                    <span>{d.getDate()}</span>
                    <span className="cal-pips" aria-hidden>
                      {on.slice(0, 4).map((t) => (
                        <i key={t.id} data-done={t.done || undefined} />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-col gap-6">
            <TaskList title={`${short(picked)}${picked === today ? ' · today' : ''}`} date={picked} tasks={[...(byDay.get(picked) ?? [])].sort(order)} />
            <TaskList title="someday" date={null} tasks={someday} />
          </div>
        </div>
      </div>
    </section>
  )
}

/** The tasks of one day, or the undated ones, with a line to add another. */
function TaskList({ title, date, tasks }: { title: string; date: string | null; tasks: Task[] }) {
  const { create } = useTaskChanges()
  const [text, setText] = useState('')
  const [time, setTime] = useState('')

  const add = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    create.mutate({ title: t, date, time: date && time ? time : null }, { onSuccess: () => (setText(''), setTime('')) })
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="section-title uppercase !p-0">{title}</h3>
      {tasks.length === 0 ? (
        <p className="dim">&gt; {date ? 'nothing on this day.' : 'nothing waiting.'}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={add}>
        <input
          className="field"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          placeholder={date ? `add to ${short(date)}` : 'add something, no date'}
          aria-label={date ? `new task on ${short(date)}` : 'new task without a date'}
        />
        {date && <input className="field !w-[96px] shrink-0" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="at (optional)" />}
        <button type="submit" className="btn btn-accent shrink-0" disabled={!text.trim() || create.isPending}>
          add
        </button>
      </form>
    </div>
  )
}

function TaskRow({ task }: { task: Task }) {
  const { update, remove } = useTaskChanges()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: task.title, date: task.date ?? '', time: task.time ?? '' })

  const open = () => {
    setDraft({ title: task.title, date: task.date ?? '', time: task.time ?? '' })
    setEditing(true)
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    const title = draft.title.trim()
    if (!title) return
    const date = draft.date || null
    update.mutate({ id: task.id, change: { title, date, time: date && draft.time ? draft.time : null } }, { onSuccess: () => setEditing(false) })
  }

  if (editing) {
    return (
      <li>
        <form className="task-edit" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))}>
          <input className="field" value={draft.title} maxLength={200} autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="task" />
          <div className="flex flex-wrap gap-2">
            <input className="field !w-[150px]" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="day (empty: someday)" />
            <input className="field !w-[96px]" type="time" value={draft.time} disabled={!draft.date} onChange={(e) => setDraft({ ...draft, time: e.target.value })} aria-label="at (optional)" />
            <button type="submit" className="btn btn-accent btn-sm" disabled={!draft.title.trim() || update.isPending}>
              save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              cancel
            </button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="task" data-done={task.done || undefined}>
      <input
        type="checkbox"
        checked={task.done}
        onChange={(e) => update.mutate({ id: task.id, change: { done: e.target.checked } })}
        aria-label={`${task.done ? 'not done' : 'done'}: ${task.title}`}
      />
      {task.time && <span className="task-time">{task.time}</span>}
      <button type="button" className="task-title" onClick={open} title="change">
        {task.title}
      </button>
      <button type="button" className="btn btn-sm" aria-label={`delete ${task.title}`} title="delete" onClick={() => remove.mutate(task.id)} disabled={remove.isPending}>
        x
      </button>
    </li>
  )
}
