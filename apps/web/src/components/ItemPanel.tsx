import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type Item, type ItemChange, type ItemKind, type Repeat } from '../api'
import { hhmm, length, minutesOf, plusDays, today } from '../lib/days'
import { COLORS, KINDS, openAnywhere, openItem, openOnLookout, STATUSES, titleOf, useItem, useItemChanges, useItems, useWholeItem } from '../lib/items'
import { errorText, log } from '../lib/log'
import { FolderPick } from './FolderPick'
import { useContentSaver } from '../lib/saver'
import { useStore } from '../lib/store'
import { Boundary } from './Boundary'
import { Cube } from './sprites'

const NotebookEditor = lazy(() => import('./NotebookEditor'))

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240, 480]
const REPEATS: { id: Repeat | ''; label: string }[] = [
  { id: '', label: 'does not repeat' },
  { id: 'daily', label: 'every day' },
  { id: 'weekly', label: 'every week' },
  { id: 'monthly', label: 'every month' },
  { id: 'yearly', label: 'every year' },
]

/** The side panel, on whichever wall: shows the item in openItem. */
export function ItemDrawer() {
  const id = useStore(openItem)
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLElement && e.target.closest('.nb-ask, .nb-slash'))) openItem.set(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])
  if (!id) return null
  return (
    <aside className="item-drawer panel px-raised" role="dialog" aria-label="item">
      <ItemView key={id} id={id} onClose={() => openItem.set(null)} />
    </aside>
  )
}

function ItemView({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: item, isPending, error } = useItem(id)
  if (isPending) return <Cube size={40} label="loading" />
  if (!item || error)
    return (
      <div className="flex flex-col gap-3 p-4">
        <p>&gt; {error ? errorText(error) : 'not found'}</p>
        <button type="button" className="btn btn-sm self-start" onClick={onClose}>
          close
        </button>
      </div>
    )
  return <ItemForm item={item} onClose={onClose} />
}

/** Every part of an item, each saved as soon as it changes. */
export function ItemForm({ item, onClose, full = false }: { item: Item; onClose?: () => void; full?: boolean }) {
  const { update, trash, create } = useItemChanges()
  const whole = useWholeItem()
  const [title, setTitle] = useState(item.title)
  useEffect(() => setTitle(item.title), [item.title])
  const set = (change: ItemChange) => update.mutate({ id: item.id, change })
  const saveTitle = () => title.trim() !== item.title && (title.trim() || (item.kind !== 'task' && item.kind !== 'event')) && set({ title: title.trim() })

  const dated = item.date !== null
  const timed = item.time !== null
  const isBoard = item.kind === 'board'

  return (
    <div className="item-form">
      <div className="flex items-start gap-2">
        {item.status && (
          <input
            type="checkbox"
            className="check mt-2"
            checked={item.status === 'done'}
            aria-label="done"
            onChange={(e) => set({ status: e.target.checked ? 'done' : 'todo' })}
          />
        )}
        <input
          className="item-title field"
          value={title}
          placeholder={`untitled ${item.kind}`}
          maxLength={200}
          aria-label="title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
        {onClose && (
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="close">
            x
          </button>
        )}
      </div>

      <Row label="is a">
        {isBoard ? (
          <span>board</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {KINDS.filter((k) => k.id !== 'board').map((k) => (
              <button
                key={k.id}
                type="button"
                className="chip"
                aria-pressed={item.kind === k.id}
                disabled={k.id === 'event' && !dated}
                title={k.id === 'event' && !dated ? 'give it a day first' : undefined}
                onClick={() => set({ kind: k.id as ItemKind })}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
      </Row>

      {item.status && (
        <Row label="status">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s.id} type="button" className="chip" data-status={s.id} aria-pressed={item.status === s.id} onClick={() => set({ status: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
        </Row>
      )}

      <Row label="day">
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="field !w-auto" value={item.date ?? ''} aria-label="day" onChange={(e) => e.target.value && set({ date: e.target.value })} />
          {dated ? (
            item.kind !== 'event' && (
              <button type="button" className="btn btn-sm" onClick={() => set({ date: null })} title="take it off the calendar">
                no day
              </button>
            )
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => set({ date: today() })}>
              today
            </button>
          )}
        </div>
      </Row>

      {dated && (
        <>
          <Row label="time">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                className="field !w-auto"
                value={item.time ?? ''}
                aria-label="time"
                onChange={(e) => set({ time: e.target.value || null, ...(e.target.value && !item.minutes ? { minutes: 60 } : {}) })}
              />
              {timed ? (
                <>
                  <select className="field !w-auto" aria-label="length" value={item.minutes ?? ''} onChange={(e) => set({ minutes: Number(e.target.value) || null })}>
                    <option value="">no length</option>
                    {[...new Set([...LENGTHS, item.minutes ?? 60])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {length(m)}
                          {item.time ? ` (to ${hhmm(minutesOf(item.time) + m)})` : ''}
                        </option>
                      ))}
                  </select>
                  <button type="button" className="btn btn-sm" onClick={() => set({ time: null })}>
                    all day
                  </button>
                </>
              ) : (
                <span className="dim">all day</span>
              )}
            </div>
          </Row>
          <Row label="until">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="field !w-auto"
                aria-label="last day"
                min={item.date ?? undefined}
                value={item.end_date ?? item.date ?? ''}
                onChange={(e) => set({ end_date: e.target.value && e.target.value !== item.date ? e.target.value : null })}
              />
              {item.end_date && (
                <button type="button" className="btn btn-sm" onClick={() => set({ end_date: null })}>
                  one day
                </button>
              )}
              {!item.end_date && item.date && (
                <button type="button" className="btn btn-sm" onClick={() => set({ end_date: plusDays(item.date!, 1) })}>
                  more days
                </button>
              )}
            </div>
          </Row>
          <Row label="repeat">
            <div className="flex flex-wrap items-center gap-2">
              <select className="field !w-auto" value={item.repeat ?? ''} onChange={(e) => set({ repeat: (e.target.value as Repeat) || null })}>
                {REPEATS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              {item.repeat && (
                <>
                  <span className="dim">until</span>
                  <input
                    type="date"
                    className="field !w-auto"
                    aria-label="repeat until"
                    min={item.date ?? undefined}
                    value={item.repeat_until ?? ''}
                    onChange={(e) => set({ repeat_until: e.target.value || null })}
                  />
                  {item.repeat_until && (
                    <button type="button" className="btn btn-sm" onClick={() => set({ repeat_until: null })}>
                      forever
                    </button>
                  )}
                </>
              )}
            </div>
          </Row>
        </>
      )}

      <Row label="colour">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="swatch" aria-pressed={item.color === null} title="no colour" onClick={() => set({ color: null })}>
            <span className="swatch-none" />
          </button>
          {COLORS.map((c) => (
            <button key={c.id} type="button" className="swatch" aria-pressed={item.color === c.id} title={c.label} onClick={() => set({ color: c.id })}>
              <span style={{ background: `var(--c${c.id})` }} />
            </button>
          ))}
        </div>
      </Row>

      <Tags item={item} onSave={(tags) => set({ tags })} />

      <Row label="folder">
        <FolderPick value={item.collection_id} onPick={(to) => to !== item.collection_id && void whole.move(item, to)} className="!w-auto max-w-full" />
      </Row>

      <Links item={item} />

      {!isBoard && (
        <div className="flex min-h-0 flex-col gap-2">
          <span className="label">notes</span>
          <Notes item={item} compact={!full} />
        </div>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        {!full && (
          <button type="button" className="btn btn-sm btn-accent" onClick={() => openOnLookout(item.id)} title="open it big, on the lookout wall">
            open as a page
          </button>
        )}
        {!isBoard && item.kind !== 'notebook' && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                { item: { kind: 'notebook', title: `${titleOf(item)} notes` }, linkFrom: item.id },
                { onSuccess: (nb) => openOnLookout(nb.id) },
              )
            }
          >
            + notebook for it
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            trash.mutate(item.id)
            onClose?.()
          }}
        >
          to trash
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="item-row">
      <span className="label">{label}</span>
      {children}
    </div>
  )
}

/** The item's text, saved as it is typed. */
export function Notes({ item, compact }: { item: Item; compact: boolean }) {
  const saver = useContentSaver(item, 'body')
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <SaveNote state={saver.state} />
      {saver.conflict && <ConflictBar onMine={saver.keepMine} onTheirs={saver.takeTheirs} />}
      <Boundary what="editor">
        <Suspense fallback={<Cube size={32} label="loading the editor" />}>
          <NotebookEditor value={saver.value} onChange={saver.change} compact={compact} />
        </Suspense>
      </Boundary>
    </div>
  )
}

export function SaveNote({ state }: { state: string }) {
  const text = { saved: 'saved', saving: 'saving...', conflict: 'not saved: changed elsewhere', error: 'not saved, will try again' }[state]
  return (
    <span className={`save-note ${state === 'error' || state === 'conflict' ? 'text-danger' : 'dim'}`} aria-live="polite">
      &gt; {text}
    </span>
  )
}

export function ConflictBar({ onMine, onTheirs }: { onMine: () => void; onTheirs: () => void }) {
  return (
    <div className="panel px flex flex-wrap items-center gap-3 p-2">
      <span>&gt; this was saved somewhere else while you edited it here.</span>
      <button type="button" className="btn btn-sm btn-accent" onClick={onMine}>
        keep mine
      </button>
      <button type="button" className="btn btn-sm" onClick={onTheirs}>
        show theirs
      </button>
    </div>
  )
}

/** What this item links to and what links to it; add a link by searching. */
function Links({ item }: { item: Item }) {
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const found = useItems({ q: q.trim() }, adding && q.trim().length > 1)
  const qc = useQueryClient()
  // The panel's own item and the other one both changed.
  const refresh = () => void qc.invalidateQueries({ queryKey: ['items', 'one'] })
  const link = async (to: string) => {
    try {
      await api.linkItems(item.id, to)
      setAdding(false)
      setQ('')
      refresh()
    } catch (e) {
      log('err', errorText(e))
    }
  }
  const unlink = async (other: string) => {
    try {
      await api.unlinkItems(item.id, other)
      refresh()
    } catch (e) {
      log('err', errorText(e))
    }
  }
  const links = item.links ?? []
  return (
    <div className="item-row items-start">
      <span className="label">linked</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {links.length === 0 && !adding && <span className="dim">nothing yet</span>}
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <span className="kind-tag">{l.kind}</span>
            <button type="button" className="link-btn min-w-0 flex-1 truncate text-left" onClick={() => openAnywhere(l)}>
              {titleOf(l)}
            </button>
            <button type="button" className="chip" onClick={() => unlink(l.id)} title="unlink">
              x
            </button>
          </div>
        ))}
        {adding ? (
          <div className="flex flex-col gap-1">
            <input className="field" autoFocus placeholder="find a task, notebook, board..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
            {(found.data ?? [])
              .filter((f) => f.id !== item.id && !links.some((l) => l.id === f.id))
              .slice(0, 8)
              .map((f) => (
                <button key={f.id} type="button" className="link-btn text-left" onClick={() => link(f.id)}>
                  <span className="kind-tag">{f.kind}</span> {titleOf(f)}
                </button>
              ))}
          </div>
        ) : (
          <button type="button" className="btn btn-sm self-start" onClick={() => setAdding(true)}>
            + link
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Categories, typed as words: "dsai" is a category, "course:mai3" a filter
 * inside it. The calendar's category list is made from these.
 */
function Tags({ item, onSave }: { item: Item; onSave: (tags: string[]) => void }) {
  const tags = item.tags ?? [] // a server from before tags sends none
  const [text, setText] = useState(tags.join(', '))
  useEffect(() => setText(tags.join(', ')), [tags.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    const next = [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
    if (next.join(',') !== tags.join(',')) onSave(next)
  }
  return (
    <Row label="tags">
      <input
        className="field"
        value={text}
        placeholder="dsai, course:mai3, type:exam"
        title='a plain word is a category; "key:value" is a filter inside it'
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </Row>
  )
}
