import type { Exception, Item, ItemChange, ItemKind, Repeat } from '../api'
import { iso, plusDays, today } from './days'

// Moving off Google: Google Calendar (.ics, one per calendar, as Takeout or
// "export" gives them) and Google Tasks (Takeout's Tasks.json) into Prismo
// items, without the doubles Google had:
//
//   - the calendars that only copy tasks (an Apps Script made "My Tasks",
//     "Buy", "Appointments" calendars of dated tasks) are skipped, and any
//     event with the same title on the same day as an imported task too
//   - 🧠 is not imported; BMO's "⏰ x" deadline events there only give their
//     time to the task "x" on that day (Google Tasks keep a day, no time)
//   - the same title at the same start twice in Google is one item
//   - anything already in Prismo (the same Google id, or the same title on
//     the same day) is left alone, so importing twice adds nothing
//
// Each item made keeps a short hash of its Google id in a "gid:" tag.
// No libraries: the .zip is read with the browser's DecompressionStream.

// --- files in, text out -----------------------------------------------------

export interface SourceFile {
  name: string
  text: string
}

/** The .ics and .json files in what was picked: plain files, or a Takeout .zip. */
export async function readFiles(files: File[]): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) out.push(...(await unzip(new Uint8Array(await f.arrayBuffer()))))
    else if (/\.(ics|json)$/i.test(f.name)) out.push({ name: f.name, text: await f.text() })
  }
  return out
}

async function unzip(buf: Uint8Array): Promise<SourceFile[]> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // The end-of-central-directory record, searched for from the end.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('this .zip could not be read')
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const out: SourceFile[] = []
  const names = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break
    const method = view.getUint16(at + 10, true)
    const size = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = names.decode(buf.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + extraLen + commentLen
    if (!/\.(ics|json)$/i.test(name) || !/(calendar|tasks)/i.test(name)) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = buf.subarray(start, start + size)
    let data: Uint8Array
    if (method === 0) data = raw
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
    else continue
    out.push({ name: name.split('/').pop() ?? name, text: new TextDecoder().decode(data) })
  }
  return out
}

// --- what Google had --------------------------------------------------------

/** One thing found in Google, already shaped as a Prismo item. */
export interface Found {
  gid: string
  kind: ItemKind
  title: string
  body: string
  date: string | null
  time: string | null
  minutes: number | null
  end_date: string | null
  repeat: Repeat | null
  repeat_until: string | null
  exceptions: Record<string, Exception>
  done: boolean
  /** A repeat Prismo cannot follow (every 2nd week...): only its first day came in. */
  check?: string
}

export interface Source {
  id: string
  name: string
  type: 'calendar' | 'tasks'
  found: Found[]
}

/** A short, stable id for a Google uid, fit for a tag (tags are at most 40 letters). */
export function gidOf(uid: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < uid.length; i++) {
    const c = uid.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// The Apps Script wrote "EVENT_ID:..." lines into task notes; they go.
const cleanNotes = (s: string) =>
  s
    .split(/\r?\n/)
    .filter((l) => !/^EVENT_ID:/.test(l.trim()))
    .join('\n')
    .trim()

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

function icsUnescape(v: string) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
}

/** A date-time value as local day and time ("Z" means UTC, else the wall clock). */
function when(p: Prop): { date: string; time: string | null } {
  const v = p.value.trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v)
  if (!m) throw new Error(`a date Prismo cannot read: ${v}`)
  const [, y, mo, d, h, mi, , z] = m
  if (p.params.VALUE === 'DATE' || h === undefined) return { date: `${y}-${mo}-${d}`, time: null }
  if (z) {
    const t = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi))
    return { date: iso(t), time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` }
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` }
}

const minutesBetween = (a: { date: string; time: string | null }, b: { date: string; time: string | null }) =>
  Math.round((new Date(`${b.date}T${b.time ?? '00:00'}:00`).getTime() - new Date(`${a.date}T${a.time ?? '00:00'}:00`).getTime()) / 60_000)

const FREQ: Record<string, Repeat> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** RRULE to Prismo's repeat, when Prismo can follow it. */
function repeatOf(rule: string, start: string): { repeat: Repeat | null; until: string | null; check?: string } {
  const r = Object.fromEntries(rule.split(';').map((kv) => kv.split('=') as [string, string]))
  const repeat = FREQ[r.FREQ]
  const day = BYDAY[(new Date(`${start}T12:00:00`).getDay() + 6) % 7]
  // Prismo repeats every day, week, month or year on the start's own day.
  const plain = repeat && (!r.INTERVAL || r.INTERVAL === '1') && !r.BYMONTHDAY && !r.BYSETPOS
  const sameDay = !r.BYDAY || (repeat === 'weekly' && r.BYDAY === day)
  if (!plain || !sameDay) return { repeat: null, until: null, check: `repeats as "${rule}"` }
  let until: string | null = null
  if (r.UNTIL) until = when({ name: 'UNTIL', params: {}, value: r.UNTIL }).date
  else if (r.COUNT) {
    const n = Number(r.COUNT) - 1
    const d = new Date(`${start}T12:00:00`)
    if (repeat === 'daily') d.setDate(d.getDate() + n)
    if (repeat === 'weekly') d.setDate(d.getDate() + 7 * n)
    if (repeat === 'monthly') d.setMonth(d.getMonth() + n)
    if (repeat === 'yearly') d.setFullYear(d.getFullYear() + n)
    until = iso(d)
  }
  return { repeat, until }
}

/** One .ics calendar: its events, repeats with their skipped and moved days. */
export function parseIcs(name: string, text: string): Source {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  let calName = name.replace(/\.ics$/i, '').replace(/_/g, ' ')
  const events: Prop[][] = []
  let cur: Prop[] | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = []
    else if (line === 'END:VEVENT') {
      if (cur) events.push(cur)
      cur = null
    } else {
      const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      if (colon < 0) continue
      const [head, ...params] = line.slice(0, colon).split(';')
      const prop: Prop = { name: head.toUpperCase(), params: Object.fromEntries(params.map((p) => p.split('=') as [string, string])), value: line.slice(colon + 1) }
      if (cur) cur.push(prop)
      else if (prop.name === 'X-WR-CALNAME') calName = icsUnescape(prop.value)
    }
  }

  const byUid = new Map<string, Found>()
  const overrides: { uid: string; props: Prop[] }[] = []
  for (const ev of events) {
    const get = (n: string) => ev.find((p) => p.name === n)
    const uid = get('UID')?.value ?? `${calName}-${events.indexOf(ev)}`
    if (get('RECURRENCE-ID')) {
      overrides.push({ uid, props: ev })
      continue
    }
    const startP = get('DTSTART')
    if (!startP || get('STATUS')?.value === 'CANCELLED') continue
    const start = when(startP)
    const endP = get('DTEND')
    const end = endP ? when(endP) : null
    let minutes: number | null = null
    let endDate: string | null = null
    if (start.time && end) {
      const m = minutesBetween(start, end)
      if (m > 0 && m <= 1440) minutes = m
      else if (end.date > start.date) endDate = end.date
    } else if (!start.time && end && end.date > plusDays(start.date, 1)) endDate = plusDays(end.date, -1) // all-day ends are exclusive
    const rule = get('RRULE')
    const rep = rule ? repeatOf(rule.value, start.date) : { repeat: null, until: null }
    const exceptions: Record<string, Exception> = {}
    for (const ex of ev.filter((p) => p.name === 'EXDATE')) {
      for (const v of ex.value.split(',')) exceptions[when({ ...ex, value: v }).date] = { skip: true }
    }
    byUid.set(uid, {
      gid: gidOf(uid),
      kind: 'event',
      title: icsUnescape(get('SUMMARY')?.value ?? '').trim() || '(no title)',
      body: cleanNotes(icsUnescape(get('DESCRIPTION')?.value ?? '')),
      date: start.date,
      time: start.time,
      minutes,
      end_date: endDate,
      repeat: rep.repeat,
      repeat_until: rep.until,
      exceptions: rep.repeat ? exceptions : {},
      done: false,
      ...(rep.check ? { check: rep.check } : {}),
    })
  }
  // One appearance moved, renamed or cancelled: an exception of its repeat.
  for (const { uid, props } of overrides) {
    const base = byUid.get(uid)
    const get = (n: string) => props.find((p) => p.name === n)
    if (!base?.repeat) continue
    const orig = when(get('RECURRENCE-ID')!).date
    if (get('STATUS')?.value === 'CANCELLED') {
      base.exceptions[orig] = { skip: true }
      continue
    }
    const s = get('DTSTART') ? when(get('DTSTART')!) : null
    const e = get('DTEND') ? when(get('DTEND')!) : null
    const x: Exception = {}
    if (s && s.date !== orig) x.date = s.date
    if (s?.time && s.time !== base.time) x.time = s.time
    if (s?.time && e?.time) {
      const m = minutesBetween(s, e)
      if (m > 0 && m <= 1440 && m !== base.minutes) x.minutes = m
    }
    const t = icsUnescape(get('SUMMARY')?.value ?? '').trim()
    if (t && t !== base.title) x.title = t
    if (Object.keys(x).length) base.exceptions[orig] = x
  }
  return { id: `cal:${calName}`, name: calName, type: 'calendar', found: [...byUid.values()] }
}

interface TakeoutTasks {
  items?: { id?: string; title?: string; items?: { id?: string; title?: string; notes?: string; status?: string; due?: string; deleted?: boolean }[] }[]
}

/** Takeout's Tasks.json: one source per task list. */
export function parseTasks(text: string): Source[] {
  const data = JSON.parse(text) as TakeoutTasks
  return (data.items ?? []).map((list) => ({
    id: `tasks:${list.title ?? list.id}`,
    name: list.title ?? 'tasks',
    type: 'tasks' as const,
    found: (list.items ?? [])
      .filter((t) => !t.deleted && (t.title ?? '').trim())
      .map((t) => ({
        gid: gidOf(t.id ?? `${list.title}-${t.title}`),
        kind: 'task' as const,
        title: t.title!.trim(),
        body: cleanNotes(t.notes ?? ''),
        date: t.due ? t.due.slice(0, 10) : null,
        time: null,
        minutes: null,
        end_date: null,
        repeat: null,
        repeat_until: null,
        exceptions: {},
        done: t.status === 'completed',
      })),
  }))
}

export function parseAll(files: SourceFile[]): Source[] {
  const out: Source[] = []
  for (const f of files) {
    if (/\.ics$/i.test(f.name)) out.push(parseIcs(f.name, f.text))
    else if (/tasks/i.test(f.name) && /\.json$/i.test(f.name)) out.push(...parseTasks(f.text))
  }
  return out
}

// --- where each goes --------------------------------------------------------

export interface Target {
  on: boolean
  /** The Prismo calendar (a plain tag). */
  tag: string
  /** Extra tags, e.g. "type:errand". */
  extra: string[]
  /** Skipped and why, when it is off by default. */
  why?: string
}

const has = (name: string, ...words: string[]) => words.some((w) => name.toLowerCase().includes(w))
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'imported'

/** The first guess for each source; the preview lets every one be changed. */
export function defaultTarget(s: Source): Target {
  const n = s.name.trim().toLowerCase()
  if (s.type === 'tasks') {
    if (n === 'buy') return { on: true, tag: 'personal', extra: ['type:errand'] }
    if (n === 'appointments') return { on: true, tag: 'personal', extra: ['type:appointment'] }
    if (n === 'dsai' || has(n, 'uni')) return { on: true, tag: 'dsai', extra: ['type:deadline'] }
    return { on: true, tag: 'personal', extra: [] }
  }
  if (['my tasks', 'buy', 'appointments'].includes(n)) return { on: false, tag: 'personal', extra: [], why: 'copies of tasks (the Apps Script)' }
  if (has(n, '🧠')) return { on: false, tag: 'personal', extra: [], why: 'not moved; gives deadline times to tasks' }
  if (has(n, '🤲')) return { on: false, tag: 'prayer', extra: [], why: 'Prismo will make prayer times itself' }
  if (['grafit', 'grafitba', 'pop', 'n8n'].includes(n)) return { on: false, tag: slug(n), extra: [], why: 'not wanted' }
  if (has(n, 'curriculum', 'dsai')) return { on: true, tag: 'dsai', extra: [] }
  if (has(n, '🏋', 'gym', 'workout')) return { on: true, tag: 'health', extra: ['type:workout'] }
  if (has(n, 'holiday', 'birthday', 'contacts')) return { on: false, tag: slug(n), extra: [], why: "Google's own calendar" }
  return { on: false, tag: slug(n), extra: [] }
}

// --- the plan: what will be made, and what is left out ---------------------

export interface Planned {
  item: ItemChange & { kind: ItemKind }
  from: string
}

export interface Plan {
  make: Planned[]
  already: number
  doubles: number
  timesFromBrain: number
  old: number
  check: { title: string; from: string; why: string }[]
}

const key = (title: string, date: string | null) => `${title.trim().toLowerCase().replace(/^⏰\s*/u, '')}|${date ?? ''}`

/**
 * What an import would make. existing: the items Prismo has now. since:
 * nothing that ended before this day comes in (repeats that still run do).
 */
export function plan(sources: Source[], targets: Map<string, Target>, existing: Item[], since = plusDays(today(), -90)): Plan {
  const out: Plan = { make: [], already: 0, doubles: 0, timesFromBrain: 0, old: 0, check: [] }
  const have = new Set(existing.map((it) => key(it.title, it.date)))
  const haveGid = new Set(existing.flatMap((it) => (it.tags ?? []).filter((t) => t.startsWith('gid:'))))

  // 🧠's "⏰ x" events: the time of each deadline, by title and day.
  const brainTimes = new Map<string, string>()
  for (const s of sources) {
    if (s.type !== 'calendar' || !has(s.name, '🧠')) continue
    for (const f of s.found) if (f.time && /^⏰/u.test(f.title)) brainTimes.set(key(f.title, f.date), f.time)
  }

  const on = sources.filter((s) => targets.get(s.id)?.on)
  // Tasks first: an event that copies one of them is then seen as a double.
  const taskKeys = new Set(on.filter((s) => s.type === 'tasks').flatMap((s) => s.found.map((f) => key(f.title, f.date))))
  const seen = new Set<string>()
  for (const s of [...on.filter((x) => x.type === 'tasks'), ...on.filter((x) => x.type === 'calendar')]) {
    const t = targets.get(s.id)!
    for (const f of s.found) {
      const k = key(f.title, f.date)
      const last = f.repeat ? (f.repeat_until ?? '9999-12-31') : (f.end_date ?? f.date)
      if (last && last < since && !(f.kind === 'task' && !f.done)) {
        out.old++
        continue
      }
      if (haveGid.has(`gid:${f.gid}`) || have.has(k)) {
        out.already++
        continue
      }
      if (seen.has(k) || (s.type === 'calendar' && !f.repeat && taskKeys.has(k))) {
        out.doubles++
        continue
      }
      seen.add(k)
      let time = f.time
      if (f.kind === 'task' && !time && brainTimes.has(k)) {
        time = brainTimes.get(k)!
        out.timesFromBrain++
      }
      if (f.check) out.check.push({ title: f.title, from: s.name, why: f.check })
      out.make.push({
        from: s.name,
        item: {
          kind: f.kind,
          title: f.title.slice(0, 200),
          body: f.body,
          date: f.date,
          time: f.date ? time : null,
          minutes: f.date && time ? f.minutes : null,
          end_date: f.end_date,
          repeat: f.repeat,
          repeat_until: f.repeat_until,
          exceptions: f.exceptions,
          ...(f.kind === 'task' ? { status: f.done ? 'done' : 'todo' } : {}),
          tags: [t.tag, ...t.extra, `gid:${f.gid}`].filter(Boolean),
        },
      })
    }
  }
  return out
}
