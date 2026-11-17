import { useMemo, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type Item } from '../api'
import { NONE, topsOf } from '../lib/categories'
import { nextOf, over, relDay, type Occurrence } from '../lib/days'
import { openOnLookout, titleOf, useItemChanges, useItems } from '../lib/items'
import { errorText, log } from '../lib/log'
import { pinOf, withPin } from '../lib/pins'
import { Cube, Prismo } from './sprites'

// The pinned board, what the lookout shows when nothing is open: pinned
// items by category, then by section, each at its next appearance, the
// soonest first. What is done or over drops off the list; "unpin" clears
// those pins in one go.

interface Pin {
  it: Item
  next: Occurrence | null
  done: boolean
}

const facet = (it: Item, key: string) => (it.tags ?? []).find((t) => t.startsWith(`${key}:`))?.slice(key.length + 1)
// Undated ones: tests before the finals, then by title.
const rank = (it: Item) => ((it.tags ?? []).includes('type:exam') ? 1 : 0)

function order(a: Pin, b: Pin): number {
  const ka = a.next ? `${a.next.date} ${a.next.item.time ?? '99'}` : null
  const kb = b.next ? `${b.next.date} ${b.next.item.time ?? '99'}` : null
  if (ka && kb) return ka.localeCompare(kb)
  if (ka || kb) return ka ? -1 : 1
  return rank(a.it) - rank(b.it) || titleOf(a.it).localeCompare(titleOf(b.it), undefined, { numeric: true })
}

export function Pinned() {
  const { data: all = [], isPending } = useItems({})
  const { update } = useItemChanges()
  const qc = useQueryClient()

  const cats = useMemo(() => {
    const m = new Map<string, Map<string, Pin[]>>()
    for (const it of all) {
      const section = pinOf(it)
      if (!section) continue
      const next = nextOf(it)
      const done = it.status === 'done' || (it.date !== null && (next === null || (!it.repeat && over(next))))
      const cat = topsOf(it)[0]
      const sections = m.get(cat) ?? new Map<string, Pin[]>()
      sections.set(section, [...(sections.get(section) ?? []), { it, next, done }])
      m.set(cat, sections)
    }
    return [...m]
      .sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)))
      .map(([cat, sections]) => [cat, [...sections].sort(([a], [b]) => a.localeCompare(b)).map(([s, pins]) => [s, pins.sort(order)] as const)] as const)
  }, [all])

  const unpin = async (pins: Pin[]) => {
    try {
      await Promise.all(pins.map((p) => api.updateItem(p.it.id, { tags: withPin(p.it.tags ?? [], null) })))
      log('ok', `unpinned ${pins.length}`)
    } catch (e) {
      log('err', errorText(e))
    } finally {
      void qc.invalidateQueries({ queryKey: ['items'] })
    }
  }

  if (isPending) return <Cube size={48} label="loading" />
  if (cats.length === 0)
    return (
      <div className="panel px-raised lookout-empty">
        <Prismo />
        <p>&gt; nothing pinned yet. open a task, an event or a notebook: details &gt; pinned puts it here, in a section of your choice.</p>
        <p className="dim">notebooks take markdown and latex ($x^2$), and type like a normal editor. boards are endless canvases of notes, cards and arrows.</p>
      </div>
    )

  return (
    <div className="pins panel px-raised" aria-label="pinned">
      {cats.map(([cat, sections]) => (
        <section key={cat || 'none'} className="flex flex-col gap-3">
          <h2 className="uppercase">{cat || 'no category'}</h2>
          <div className="pins-grid">
            {sections.map(([section, pins]) => {
              const live = pins.filter((p) => !p.done)
              const gone = pins.filter((p) => p.done)
              return (
                <div key={section} className="pins-col panel px">
                  <h3 className="section-title uppercase">{section}</h3>
                  {live.length === 0 && <p className="dim">&gt; nothing left here.</p>}
                  <ul className="flex flex-col gap-1">
                    {live.map((p) => (
                      <PinRow key={p.it.id} p={p} onToggle={() => update.mutate({ id: p.it.id, change: { status: p.it.status === 'done' ? 'todo' : 'done' } })} />
                    ))}
                  </ul>
                  {gone.length > 0 && (
                    <button type="button" className="link-btn dim self-start" onClick={() => void unpin(gone)} title={gone.map((p) => titleOf(p.it)).join(', ')}>
                      {gone.length} done or over · unpin
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function PinRow({ p, onToggle }: { p: Pin; onToggle: () => void }) {
  const { it, next } = p
  const own = next && next.item.title !== it.title ? next.item.title : null
  const type = facet(it, 'type')
  const course = facet(it, 'course')
  const soon = next ? `${relDay(next.date)}${next.item.time ? ` ${next.item.time}` : ''}` : it.date ? '' : 'no day yet'
  return (
    <li className="pin-row" style={it.color ? ({ '--pin': `var(--c${it.color})` } as CSSProperties) : undefined}>
      {it.status && <input type="checkbox" className="check check-sm" checked={it.status === 'done'} aria-label={`done: ${titleOf(it)}`} onChange={onToggle} />}
      <button type="button" className="pin-title" onClick={() => openOnLookout(it.id)} title="open it as a page">
        {own ?? titleOf(it)}
        {own && <span className="dim"> · {titleOf(it)}</span>}
      </button>
      <span className="pin-meta">
        {course && <span className="tag-chip">{course}</span>}
        {type && (
          <span className="tag-chip" style={it.color ? ({ '--chip': `var(--c${it.color})` } as CSSProperties) : undefined}>
            {type}
          </span>
        )}
        <span className={soon === 'today' || soon.startsWith('today ') || soon.startsWith('tomorrow') ? 'pin-soon' : 'dim'}>{soon}</span>
      </span>
    </li>
  )
}
