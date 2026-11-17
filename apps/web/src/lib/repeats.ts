import { api, type Exception, type Item, type ItemChange } from '../api'
import { daysBetween, plusDays } from './days'
import { createStore } from './store'

// Changing one appearance of a repeat, like a calendar app asks: only this
// one, this one and the later ones, or all of them. "Only this one" is an
// exception on the item (keyed by the day the appearance would have had).
// "This and later" splits the series: the earlier appearances become a copy
// that ends the day before, and the item itself, with its cards, links and
// notes, carries on from the new day. "All" moves the series as a whole.

export type Scope = 'one' | 'later' | 'all'

export interface Where {
  date: string
  time: string | null
  minutes: number | null
}

/** Exceptions without the empty ones. */
function clean(ex: Record<string, Exception>): Record<string, Exception> {
  return Object.fromEntries(Object.entries(ex).filter(([, x]) => Object.values(x).some((v) => v !== undefined && v !== false)))
}

/** Exceptions from day `from` on, re-keyed for a series that moved by `by` days. */
const shifted = (ex: Record<string, Exception>, by: number, keep: (day: string) => boolean) =>
  Object.fromEntries(Object.entries(ex).filter(([k]) => keep(k)).map(([k, x]) => [plusDays(k, by), x]))

/** Where this appearance is, exception or not. */
export function whereOf(item: Item, orig: string): Where {
  const x = item.exceptions?.[orig] ?? {}
  return { date: x.date ?? orig, time: x.time ?? item.time, minutes: x.minutes ?? item.minutes }
}

/** Splitting makes no sense for a task: it has no past appearances, only the next one. */
export const scopesFor = (item: Item): Scope[] => (item.kind === 'event' ? ['one', 'later', 'all'] : ['one', 'all'])

export const SCOPE_LABEL: Record<Scope, string> = { one: 'only this one', later: 'this and later ones', all: 'all of them' }

export async function moveAppearance(item: Item, orig: string, to: Where, scope: Scope): Promise<string> {
  const ex = item.exceptions ?? {}
  if (scope === 'one') {
    const x: Exception = { ...ex[orig] }
    x.date = to.date !== orig ? to.date : undefined
    x.time = to.time && to.time !== item.time ? to.time : undefined
    x.minutes = to.minutes && to.minutes !== item.minutes ? to.minutes : undefined
    await api.updateItem(item.id, { exceptions: clean({ ...ex, [orig]: x }) })
    return 'moved, only this one'
  }
  const by = daysBetween(orig, to.date)
  const start = plusDays(item.date!, by)
  const series: ItemChange = { time: to.time, ...(to.time ? { minutes: to.minutes ?? item.minutes ?? 60 } : {}) }
  if (scope === 'all' || orig <= item.date!) {
    await api.updateItem(item.id, {
      ...series,
      date: start,
      ...(item.end_date ? { end_date: plusDays(item.end_date, by) } : {}),
      ...(item.repeat_until ? { repeat_until: plusDays(item.repeat_until, by) } : {}),
      exceptions: shifted(ex, by, () => true),
    })
    return 'moved, all of them'
  }
  // The earlier ones, as they were, end the day before.
  await api.createItem({
    kind: item.kind,
    title: item.title,
    collection_id: item.collection_id,
    date: item.date,
    time: item.time,
    minutes: item.minutes,
    end_date: item.end_date,
    repeat: item.repeat,
    repeat_until: plusDays(orig, -1),
    color: item.color,
    tags: item.tags,
    exceptions: clean(Object.fromEntries(Object.entries(ex).filter(([k]) => k < orig))),
  })
  const span = item.end_date ? daysBetween(item.date!, item.end_date) : 0
  await api.updateItem(item.id, {
    ...series,
    date: to.date,
    ...(span ? { end_date: plusDays(to.date, span) } : {}),
    ...(item.repeat_until && item.repeat_until < to.date ? { repeat_until: to.date } : {}),
    exceptions: shifted(ex, by, (k) => k > orig),
  })
  return 'moved, this and the later ones'
}

/** Give one appearance its own title, or take it away (""). */
export function nameAppearance(item: Item, orig: string, title: string) {
  const ex = item.exceptions ?? {}
  return api.updateItem(item.id, { exceptions: clean({ ...ex, [orig]: { ...ex[orig], title: title.trim() || undefined } }) })
}

/** Skip one appearance, or bring it back. */
export function skipAppearance(item: Item, orig: string, skip: boolean) {
  const ex = item.exceptions ?? {}
  return api.updateItem(item.id, { exceptions: clean({ ...ex, [orig]: skip ? { skip: true } : {} }) })
}

/** Put a moved or renamed appearance back as the series has it. */
export function resetAppearance(item: Item, orig: string) {
  const ex = { ...(item.exceptions ?? {}) }
  delete ex[orig]
  return api.updateItem(item.id, { exceptions: ex })
}

/** A move waiting for "only this one / later / all": a drag on the calendar sets it. */
export const pendingMove = createStore<{ item: Item; orig: string; to: Where } | null>(null)

/** The appearance the side panel was opened on, when opened from the calendar. */
export const openAt = createStore<{ id: string; orig: string } | null>(null)
