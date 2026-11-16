import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, type Item, type ItemChange, type ItemKind, type ItemQuery, type ItemStatus } from '../api'
import { errorText, log } from './log'
import { turnTo } from './room'
import { WALLS } from './room'
import { createStore } from './store'

// Everything about items the walls share: what they are called, the queries,
// the changes, and which one is open where.

export const KINDS: { id: ItemKind; label: string }[] = [
  { id: 'task', label: 'task' },
  { id: 'event', label: 'event' },
  { id: 'notebook', label: 'notebook' },
  { id: 'board', label: 'board' },
]

export const STATUSES: { id: ItemStatus; label: string }[] = [
  { id: 'todo', label: 'to do' },
  { id: 'doing', label: 'doing' },
  { id: 'waiting', label: 'waiting' },
  { id: 'done', label: 'done' },
]

/** The JSON Canvas colours 1..6; each theme paints them (--c1..--c6). */
export const COLORS = [
  { id: 1, label: 'red' },
  { id: 2, label: 'orange' },
  { id: 3, label: 'yellow' },
  { id: 4, label: 'green' },
  { id: 5, label: 'cyan' },
  { id: 6, label: 'purple' },
]

export const titleOf = (it: Pick<Item, 'title' | 'kind'>) => it.title || `untitled ${it.kind}`

export const useItems = (q: ItemQuery, enabled = true) =>
  useQuery({ queryKey: ['items', 'list', q], queryFn: () => api.items(q), enabled })

export const useItem = (id: string | null) => useQuery({ queryKey: ['items', 'one', id], queryFn: () => api.item(id!), enabled: Boolean(id) })

// A change shows at once in every list on screen, before the server answers:
// dragging an event to another hour must not wait for a round trip. Body and
// canvas are left to the editors that own them.
function patchLists(qc: QueryClient, id: string, change: ItemChange) {
  const { body: _b, canvas: _c, version: _v, trashed, ...plain } = change
  qc.setQueriesData<Item[]>({ queryKey: ['items', 'list'] }, (list) =>
    list && trashed
      ? list.filter((it) => it.id !== id)
      : list?.map((it) => (it.id === id ? ({ ...it, ...plain } as Item) : it)),
  )
}

export function useItemChanges() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['items'] })
  const onError = (e: unknown) => log('err', errorText(e))
  return {
    create: useMutation({
      mutationFn: ({ item, linkFrom }: { item: ItemChange & { kind: ItemKind }; linkFrom?: string }) => api.createItem(item, linkFrom),
      onSuccess: (it) => {
        qc.setQueryData(['items', 'one', it.id], it)
        void refresh()
      },
      onError,
    }),
    update: useMutation({
      mutationFn: ({ id, change }: { id: string; change: ItemChange }) => api.updateItem(id, change),
      onMutate: async ({ id, change }) => {
        await qc.cancelQueries({ queryKey: ['items', 'list'] })
        patchLists(qc, id, change)
      },
      onSuccess: (it) => qc.setQueryData(['items', 'one', it.id], it),
      onError,
      onSettled: refresh,
    }),
    trash: useMutation({
      mutationFn: (id: string) => api.trashItem(id),
      onMutate: (id) => patchLists(qc, id, { trashed: true }),
      onSuccess: () => log('ok', 'moved to the trash'),
      onError,
      onSettled: refresh,
    }),
  }
}

/** The item open in the side panel, whichever wall is faced. */
export const openItem = createStore<string | null>(null)

/** The notebook or board open on the lookout wall. */
export const lookout = createStore<string | null>(null)

export function openOnLookout(id: string) {
  openItem.set(null)
  lookout.set(id)
  turnTo(WALLS.findIndex((w) => w.id === 'lookout'))
}

/** Open an item where it lives best: notebooks and boards on the lookout, the rest in the panel. */
export function openAnywhere(it: Pick<Item, 'id' | 'kind'>) {
  if (it.kind === 'notebook' || it.kind === 'board') openOnLookout(it.id)
  else openItem.set(it.id)
}
