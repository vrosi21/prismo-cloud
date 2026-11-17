import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api, type LedgerEntry } from '../api'
import { openItem } from '../lib/items'
import { Cube } from './sprites'

// The ledger: what Claude sessions changed, newest first. Lines from one
// writer close together in time make one block: the session's notes on
// top, in full, the changes the server wrote down under them. Changes made
// in the browser are not here; they are the owner's own.

interface Block {
  who: string
  at: string
  notes: LedgerEntry[]
  changes: LedgerEntry[]
}

// Lines further apart than this start a new block.
const GAP = 30 * 60 * 1000

function blocks(entries: LedgerEntry[]): Block[] {
  const out: Block[] = []
  for (const e of entries) {
    const last = out[out.length - 1]
    const lastAt = last && Date.parse(last.notes.at(-1)?.at ?? last.changes.at(-1)?.at ?? last.at)
    if (!last || last.who !== e.who || lastAt - Date.parse(e.at) > GAP) {
      out.push({ who: e.who, at: e.at, notes: [], changes: [] })
    }
    const b = out[out.length - 1]
    ;(e.kind === 'note' ? b.notes : b.changes).push(e)
  }
  return out
}

function when(at: string): string {
  const d = new Date(at)
  const today = new Date()
  const time = d.toTimeString().slice(0, 5)
  if (d.toDateString() === today.toDateString()) return `today ${time}`
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `yesterday ${time}`
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' }).toLowerCase()} ${time}`
}

export function Ledger() {
  const [who, setWho] = useState<string | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['ledger', who],
    queryFn: ({ pageParam }) => api.ledger({ before: pageParam, who: who ?? undefined, limit: 200 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
    refetchInterval: 30_000,
  })
  const entries = useMemo(() => query.data?.pages.flatMap((p) => p.entries) ?? [], [query.data])
  const writers = useMemo(() => [...new Set(entries.map((e) => e.who))].sort(), [entries])
  const list = useMemo(() => blocks(entries), [entries])

  return (
    <div className="pins panel px-raised" aria-label="ledger">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="uppercase">ledger</h2>
        <span className="dim">what claude sessions changed</span>
        <span className="flex-1" />
        {(writers.length > 1 || who) && (
          <>
            <button type="button" className="chip" aria-pressed={who === null} onClick={() => setWho(null)}>
              everyone
            </button>
            {(who ? [who] : writers).map((w) => (
              <button key={w} type="button" className="chip" aria-pressed={who === w} onClick={() => setWho(who === w ? null : w)}>
                {w}
              </button>
            ))}
          </>
        )}
      </div>
      {query.isPending && <Cube size={40} label="loading" />}
      {!query.isPending && list.length === 0 && (
        <p className="dim">
          &gt; nothing yet. a claude session with a "plan" token (settings) writes here every change it makes, and a line on what it did.
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {list.map((b) => (
          <li key={(b.notes[0] ?? b.changes[0]).id} className="ledger-block panel px">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="tag-chip">{b.who}</span>
              <span className="dim text-[16px]">{when(b.at)}</span>
            </div>
            {b.notes.map((n) => (
              <p key={n.id} className="ledger-note">
                {n.message}
              </p>
            ))}
            {b.changes.length > 0 && (
              <ul className="ledger-changes">
                {b.changes.map((c) => (
                  <li key={c.id}>
                    {c.items[0] && !c.message.startsWith('trashed') && !c.message.startsWith('deleted') ? (
                      <button type="button" className="link-btn text-left" onClick={() => openItem.set(c.items[0])} title={when(c.at)}>
                        {c.message}
                      </button>
                    ) : (
                      <span title={when(c.at)}>{c.message}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <button type="button" className="btn btn-sm self-start" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          older
        </button>
      )}
    </div>
  )
}
