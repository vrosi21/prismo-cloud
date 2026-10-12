import { useState, type DragEvent } from 'react'
import { api, BULK_LIMIT, type BulkAction } from '../api'
import { errorText, log } from './log'
import { createStore } from './store'

// Dragging files (tiles) onto a folder moves them there. This is a drag
// inside the page; dragging a file in from the desktop is an upload and is
// handled by the app shell, which asks here so it can tell the two apart.

const TYPE = 'application/x-prismo-assets'

/** Counts finished moves. A page holding a selection watches it: what was
 *  selected has just gone somewhere else, so the selection is stale. */
export const moves = createStore(0)

let dragging = false
export const assetDragActive = () => dragging

export function startAssetDrag(e: DragEvent, ids: string[]) {
  e.dataTransfer.setData(TYPE, JSON.stringify(ids))
  e.dataTransfer.effectAllowed = 'move'
  dragging = true
}

export function endAssetDrag() {
  dragging = false
}

/** Runs a bulk change on any number of items, a batch at a time. */
export async function bulkAll(ids: string[], change: BulkAction): Promise<number> {
  let changed = 0
  for (let i = 0; i < ids.length; i += BULK_LIMIT) {
    changed += (await api.bulk(ids.slice(i, i + BULK_LIMIT), change)).changed
  }
  return changed
}

/**
 * Makes an element a place to drop dragged files onto.
 * folderId null means "no folder" (the top level).
 */
export function useAssetDrop(folderId: string | null, folderName: string, onMoved: () => void) {
  const [over, setOver] = useState(false)
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(TYPE)
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        setOver(false)
        let ids: string[]
        try {
          ids = JSON.parse(e.dataTransfer.getData(TYPE)) as string[]
        } catch {
          return
        }
        bulkAll(ids, { action: 'collection', collection_id: folderId })
          .then((n) => {
            log('ok', `${n} moved to ${folderName}`)
            moves.set((count) => count + 1)
            onMoved()
          })
          .catch((err: unknown) => log('err', errorText(err)))
      },
    },
  }
}
