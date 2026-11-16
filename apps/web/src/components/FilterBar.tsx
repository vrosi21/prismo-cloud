import type { SetURLSearchParams } from 'react-router'
import { FILTER_KEYS } from '../api'
import { KINDS } from './Shell'

// Filters for a listing of files. They live in the URL like everything else
// the library shows, so a filtered view can be bookmarked and Back undoes a
// change. Inside a folder they narrow that folder; at the top they search
// every folder.

const KB = 1024
const MB = 1024 * KB
const SIZES = [
  { bytes: 100 * KB, label: '100 kb' },
  { bytes: MB, label: '1 mb' },
  { bytes: 10 * MB, label: '10 mb' },
  { bytes: 100 * MB, label: '100 mb' },
  { bytes: 1024 * MB, label: '1 gb' },
]

const SORTS = [
  { id: '', label: 'newest first' },
  { id: 'old', label: 'oldest first' },
  { id: 'big', label: 'biggest first' },
  { id: 'small', label: 'smallest first' },
  { id: 'name', label: 'by name' },
]

const VIS = [
  { id: '', label: 'anyone' },
  { id: 'private', label: 'only me (private)' },
  { id: 'unlisted', label: 'anyone with the link' },
  { id: 'public', label: 'public' },
]

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return day(d)
}

// "Added" presets are a from day with no to day; anything else is custom.
const PERIODS = [
  { id: 'today', label: 'today', from: () => daysAgo(0) },
  { id: 'week', label: 'last 7 days', from: () => daysAgo(6) },
  { id: 'month', label: 'last 30 days', from: () => daysAgo(29) },
  { id: 'year', label: 'this year', from: () => `${new Date().getFullYear()}-01-01` },
]

/** How many filters are on (sorting is not a filter). */
export function activeFilters(params: URLSearchParams): number {
  return FILTER_KEYS.filter((k) => k !== 'sort' && params.get(k)).length
}

export function FilterBar({ params, setParams, onClose }: { params: URLSearchParams; setParams: SetURLSearchParams; onClose: () => void }) {
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next)
  }

  const kinds = new Set((params.get('kind') ?? '').split(',').filter(Boolean))
  const toggleKind = (id: string) => {
    const next = new Set(kinds)
    if (!next.delete(id)) next.add(id)
    set({ kind: KINDS.filter((k) => next.has(k.id)).map((k) => k.id).join(',') || null })
  }

  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const preset = !from && !to ? '' : (!to && PERIODS.find((p) => p.from() === from)?.id) || 'custom'
  const pickPeriod = (id: string) => {
    if (id === 'custom') set({ from: from || daysAgo(29), to: to || daysAgo(0) })
    else set({ from: PERIODS.find((p) => p.id === id)?.from() ?? null, to: null })
  }

  const clear = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))
  const any = activeFilters(params) > 0 || Boolean(params.get('sort'))

  return (
    <div className="panel px filter-bar" role="group" aria-label="filters">
      <div className="filter-group">
        <span className="label">type</span>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button key={k.id} type="button" className="chip" aria-pressed={kinds.has(k.id)} onClick={() => toggleKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="label">size</span>
        <div className="flex items-center gap-2">
          <select className="field !w-auto" aria-label="at least" value={params.get('min') ?? ''} onChange={(e) => set({ min: e.target.value || null })}>
            <option value="">any</option>
            {SIZES.map((s) => (
              <option key={s.bytes} value={s.bytes}>
                at least {s.label}
              </option>
            ))}
          </select>
          <select className="field !w-auto" aria-label="at most" value={params.get('max') ?? ''} onChange={(e) => set({ max: e.target.value || null })}>
            <option value="">any</option>
            {SIZES.map((s) => (
              <option key={s.bytes} value={s.bytes}>
                at most {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="filter-group">
        <span className="label">added</span>
        <div className="flex flex-wrap items-center gap-2">
          <select className="field !w-auto" aria-label="added" value={preset} onChange={(e) => pickPeriod(e.target.value)}>
            <option value="">any time</option>
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">between days...</option>
          </select>
          {preset === 'custom' && (
            <>
              <input type="date" className="field !w-auto" aria-label="from" value={from} max={to || undefined} onChange={(e) => set({ from: e.target.value || null })} />
              <span className="dim">to</span>
              <input type="date" className="field !w-auto" aria-label="to" value={to} min={from || undefined} onChange={(e) => set({ to: e.target.value || null })} />
            </>
          )}
        </div>
      </div>

      <div className="filter-group">
        <span className="label">who can open it</span>
        <select className="field !w-auto" value={params.get('vis') ?? ''} onChange={(e) => set({ vis: e.target.value || null })}>
          {VIS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <span className="label">order</span>
        <select className="field !w-auto" value={params.get('sort') ?? ''} onChange={(e) => set({ sort: e.target.value || null })}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ml-auto flex items-end gap-2 self-end">
        {any && (
          <button type="button" className="btn btn-sm" onClick={clear}>
            clear
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onClose}>
          hide
        </button>
      </div>
    </div>
  )
}
