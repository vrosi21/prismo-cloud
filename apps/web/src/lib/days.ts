import type { Exception, Item } from '../api'

// Days as the calendar sees them: "2026-11-12" strings in the viewer's own
// calendar, no time zones. Monday starts the week.

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
export const plusDays = (day: string, n: number) => iso(addDays(parse(day), n))
/** Whole days from a to b. */
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)
/** 0 for Monday. */
export const weekday = (d: Date) => (d.getDay() + 6) % 7
export const today = () => iso(new Date())

/** "thu 12 nov" */
export function short(day: string): string {
  const d = parse(day)
  return `${DAYS[weekday(d)].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

/** Six weeks from the Monday on or before the 1st: every month fits. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = addDays(first, -weekday(first))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** "09:30" as minutes after midnight. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}
/** Minutes after midnight as "09:30" (wraps past midnight). */
export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** "1 h 30" */
export function length(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h && m ? `${h} h ${m}` : h ? `${h} h` : `${m} min`
}

/** One appearance of an item on the calendar: a repeating one has many. */
export interface Occurrence {
  /** The item; for an appearance with its own title, time or length, a copy that has them. */
  item: Item
  /** The day this appearance starts and the last day it covers. */
  date: string
  end: string
  /** The day it would have had without an exception: what exceptions are keyed by. */
  orig: string
  /** Unique per appearance. */
  key: string
}

const withException = (item: Item, x: Exception): Item => ({
  ...item,
  title: x.title ?? item.title,
  time: x.time ?? item.time,
  minutes: x.minutes ?? item.minutes,
})

// The n-th day of a repeat, or null where it does not exist (the 31st in a
// short month): those are skipped, not moved.
function nth(base: Date, repeat: Item['repeat'], n: number): Date | null {
  switch (repeat) {
    case 'daily':
      return addDays(base, n)
    case 'weekly':
      return addDays(base, 7 * n)
    case 'monthly': {
      const d = new Date(base.getFullYear(), base.getMonth() + n, base.getDate())
      return d.getDate() === base.getDate() ? d : null
    }
    case 'yearly': {
      const d = new Date(base.getFullYear() + n, base.getMonth(), base.getDate())
      return d.getDate() === base.getDate() ? d : null
    }
    default:
      return n === 0 ? base : null
  }
}

/** Every appearance of these items that touches from..to, exceptions applied. */
export function occurrences(items: Item[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = []
  for (const item of items) {
    if (!item.date) continue
    const ex = item.repeat ? (item.exceptions ?? {}) : {}
    // A moved appearance can land in the range from a day outside it.
    const reach = Object.entries(ex).reduce((m, [k, x]) => (x.date ? Math.max(m, Math.abs(daysBetween(k, x.date))) : m), 0)
    const lo = plusDays(from, -reach)
    const hi = plusDays(to, reach)
    const span = item.end_date ? daysBetween(item.date, item.end_date) : 0
    const base = parse(item.date)
    const step = { daily: 1, weekly: 7, monthly: 28, yearly: 365 }[item.repeat ?? 'daily']
    // Jump close to the range instead of walking from a start years back.
    let n = item.repeat ? Math.max(0, Math.floor((daysBetween(item.date, lo) - span) / step) - 1) : 0
    for (let guard = 0; guard < 500; guard++, n++) {
      const d = nth(base, item.repeat, n)
      if (d === null) {
        if (!item.repeat) break
        continue
      }
      const orig = iso(d)
      if (orig > hi || (item.repeat_until && orig > item.repeat_until)) break
      const x = ex[orig]
      if (!x?.skip) {
        const date = x?.date ?? orig
        const end = span ? plusDays(date, span) : date
        if (end >= from && date <= to) out.push({ item: x ? withException(item, x) : item, date, end, orig, key: `${item.id}@${orig}` })
      }
      if (!item.repeat) break
    }
  }
  return out
}

/** When an appearance is over: the end of its time, or the end of its last day. */
function isOver(o: Occurrence, now: Date): boolean {
  const day = iso(now)
  if (o.end !== day) return o.end < day
  if (!o.item.time) return false
  return minutesOf(o.item.time) + (o.item.minutes ?? 0) <= now.getHours() * 60 + now.getMinutes()
}

/**
 * The appearance to show for an item on a card or a pin: the next one that
 * is not over. A weekly lab that was yesterday shows next week's; a
 * deadline stays until its hour has gone by. Something that does not
 * repeat shows its own day, over or not; null when it has no day or its
 * repeat has ended.
 */
export function nextOf(item: Item, now = new Date()): Occurrence | null {
  if (!item.date) return null
  if (!item.repeat) return occurrences([item], item.date, item.end_date ?? item.date)[0] ?? null
  const day = iso(now)
  const ahead = occurrences([item], day < item.date ? item.date : day, plusDays(day < item.date ? item.date : day, 400))
  return ahead.find((o) => !isOver(o, now)) ?? null
}

/** Is this appearance over? For lists that dim what has been. */
export const over = (o: Occurrence, now = new Date()) => isOver(o, now)

/** "today", "tomorrow", "wed" within the week ahead, "wed 18 nov" further off. */
export function relDay(day: string, now = new Date()): string {
  const n = daysBetween(iso(now), day)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n > 1 && n < 7) return DAYS[weekday(parse(day))].slice(0, 3)
  return short(day)
}

/** Does this appearance cover that day? */
export const covers = (o: Occurrence, day: string) => o.date <= day && o.end >= day
