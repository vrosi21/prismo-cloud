import type { CSSProperties } from 'react'
import { api } from '../api'
import { openOnLookout, titleOf, useItems, useWholeItem } from '../lib/items'
import { plainExcerpt } from '../lib/minimd'
import { errorText, log } from '../lib/log'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Notebooks and boards in the library, above the files: those in the folder
 * on screen, those matching a search, or those in the trash. Opening one
 * turns to the lookout wall.
 */
export function ItemTiles({ folderId, q, trashed, hidden }: { folderId?: string; q?: string; trashed: boolean; hidden: boolean }) {
  const qc = useQueryClient()
  const whole = useWholeItem()
  // The trash shows tasks and events too: it is the only place to get one back.
  const { data = [] } = useItems({ kind: trashed ? undefined : 'notebook,board', collection: trashed ? undefined : folderId, q: q || undefined, trashed }, !hidden)
  if (hidden || data.length === 0) return null

  const act = async (run: () => Promise<void>, done: string) => {
    try {
      await run()
      log('ok', done)
      void qc.invalidateQueries({ queryKey: ['items'] })
    } catch (e) {
      log('err', errorText(e))
    }
  }

  return (
    <section aria-label="notebooks and boards">
      <h3 className="section-title uppercase">{trashed ? 'notebooks, boards & tasks in the trash' : 'notebooks & boards'}</h3>
      <div className="item-tiles">
        {data.map((it) => (
          <div key={it.id} className="item-tile" style={it.color ? ({ '--tile': `var(--c${it.color})` } as CSSProperties) : undefined}>
            <button type="button" className="flex min-w-0 flex-col gap-1 text-left" data-nav-item onClick={() => !trashed && openOnLookout(it.id)} disabled={trashed}>
              <span className="flex items-center gap-2">
                <span className="kind-tag">{it.kind}</span>
                <span className="truncate">{titleOf(it)}</span>
              </span>
              {it.excerpt && <span className="item-tile-text">{plainExcerpt(it.excerpt, 90)}</span>}
            </button>
            {trashed && (
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn btn-sm btn-accent" onClick={() => void whole.restore(it)}>
                  restore
                </button>
                <button type="button" className="btn btn-sm" onClick={() => act(() => api.purgeItem(it.id), 'deleted for good')}>
                  delete forever
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
