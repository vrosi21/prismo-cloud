import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Folder, type Item } from '../api'
import type { FolderNode } from '../lib/folders'
import { lookout, titleOf } from '../lib/items'
import { folderEntries, openMenu } from '../lib/menu'
import { useItemEntries } from './Menus'
import { errorText, log } from '../lib/log'
import { useFolderTree, useRefreshLibrary } from '../lib/queries'

// The lookout's list: notebooks and boards in their folders, the same
// folders the library has, so one folder holds a board and its pictures
// alike. A folder that only holds files (screenshots, stickers) stays out
// of the way; an empty one shows, so a folder just made has a place.
// Pressing a folder's name makes it where new ones and imports go.

const SHUT_KEY = 'prismo.lookout.shut'
function loadShut(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHUT_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

interface Props {
  items: Item[]
  open: string | null
  /** The folder new ones and imports go in. */
  target: string | null
  onTarget: (id: string | null) => void
  when: (at: string) => string
}

export function LookoutTree({ items, open, target, onTarget, when }: Props) {
  const tree = useFolderTree()
  const itemEntries = useItemEntries()
  const [shut, setShutState] = useState(loadShut)
  // undefined: not making one; null: at the top; an id: inside that folder.
  const [making, setMaking] = useState<string | null | undefined>(undefined)
  const setShut = (id: string, on: boolean) => {
    const next = new Set(shut)
    if (on) next.add(id)
    else next.delete(id)
    setShutState(next)
    try {
      localStorage.setItem(SHUT_KEY, JSON.stringify([...next]))
    } catch {
      /* not remembered */
    }
  }

  const byFolder = useMemo(() => {
    const m = new Map<string | null, Item[]>()
    for (const it of items) {
      const f = it.collection_id && tree.byId.has(it.collection_id) ? it.collection_id : null
      m.set(f, [...(m.get(f) ?? []), it])
    }
    for (const list of m.values()) list.sort((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true }))
    return m
  }, [items, tree])

  // Notebooks and boards, and files, in a folder and everything below it.
  const inside = useMemo(() => {
    const m = new Map<string, { items: number; files: number }>()
    const count = (n: FolderNode): { items: number; files: number } => {
      const c = { items: byFolder.get(n.id)?.length ?? 0, files: n.count }
      for (const ch of n.children) {
        const k = count(ch)
        c.items += k.items
        c.files += k.files
      }
      m.set(n.id, c)
      return c
    }
    tree.roots.forEach(count)
    return m
  }, [tree, byFolder])
  const shows = (n: FolderNode) => {
    const c = inside.get(n.id)
    return !c || c.items > 0 || c.files === 0
  }

  const itemRow = (it: Item, depth: number) => (
    <li key={it.id}>
      <button
        type="button"
        className="lookout-row"
        style={{ paddingLeft: 4 + depth * 14 }}
        aria-current={open === it.id || undefined}
        onClick={() => lookout.set(it.id)}
        onContextMenu={(e) => openMenu(e, itemEntries(it))}
        data-nav-item
      >
        <span className="kind-tag" data-kind={it.kind}>
          {it.kind}
        </span>
        <span className="min-w-0 flex-1 truncate">{titleOf(it)}</span>
        <span className="dim shrink-0 text-[length:calc(16px*var(--ft))]">{when(it.updated_at)}</span>
      </button>
    </li>
  )

  const folderRows = (nodes: FolderNode[], depth: number): ReactNode[] =>
    nodes.filter(shows).map((n) => {
      const isShut = shut.has(n.id)
      const c = inside.get(n.id)
      return (
        <li key={n.id}>
          <div
            className="tree-folder"
            style={{ paddingLeft: depth * 14 }}
            aria-current={target === n.id || undefined}
            onContextMenu={(e) => openMenu(e, folderEntries(n.id, [{ label: target === n.id ? 'new ones go to the top again' : 'new ones and imports go here', run: () => onTarget(target === n.id ? null : n.id) }, 'sep']))}
          >
            <button type="button" className="tree-toggle" onClick={() => setShut(n.id, !isShut)} aria-label={isShut ? `open ${n.name}` : `close ${n.name}`} aria-expanded={!isShut}>
              {isShut ? '+' : '-'}
            </button>
            <button type="button" className="tree-name" onClick={() => onTarget(target === n.id ? null : n.id)} title="new ones and imports go here">
              {n.name}
            </button>
            {c && c.items > 0 && <span className="dim text-[length:calc(16px*var(--ft))]">{c.items}</span>}
            <button
              type="button"
              className="tree-add"
              onClick={() => {
                setShut(n.id, false)
                setMaking(n.id)
              }}
              title={`a folder inside ${n.name}`}
              aria-label={`new folder inside ${n.name}`}
            >
              +
            </button>
            <button
              type="button"
              className="tree-add"
              onClick={(e) => openMenu(e, folderEntries(n.id))}
              title="rename, move, delete"
              aria-label={`more for ${n.name}`}
            >
              ...
            </button>
          </div>
          {!isShut && (
            <ul>
              {making === n.id && <NewFolder parent={n} depth={depth + 1} onDone={(id) => (setMaking(undefined), id && onTarget(id))} />}
              {folderRows(n.children, depth + 1)}
              {(byFolder.get(n.id) ?? []).map((it) => itemRow(it, depth + 1))}
            </ul>
          )}
        </li>
      )
    })

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="label flex-1">folders</span>
        <button type="button" className="btn btn-sm" onClick={() => setMaking(null)} title="a folder at the top of the library">
          + folder
        </button>
      </div>
      <ul className="lookout-list">
        {making === null && <NewFolder parent={null} depth={0} onDone={(id) => (setMaking(undefined), id && onTarget(id))} />}
        {folderRows(tree.roots, 0)}
        {(byFolder.get(null) ?? []).map((it) => itemRow(it, 0))}
      </ul>
    </>
  )
}

function NewFolder({ parent, depth, onDone }: { parent: FolderNode | null; depth: number; onDone: (id: string | null) => void }) {
  const [name, setName] = useState('')
  const qc = useQueryClient()
  const refresh = useRefreshLibrary()
  const make = useMutation({
    mutationFn: () => api.createFolder(name.trim(), parent?.id ?? null),
    onSuccess: (f) => {
      qc.setQueryData<Folder[]>(['folders'], (old) => old && [...old, f])
      refresh()
      log('ok', `folder "${f.name}" made${parent ? ` in ${parent.name}` : ''}`)
      onDone(f.id)
    },
    onError: (e) => log('err', errorText(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) make.mutate()
  }
  return (
    <li>
      <form className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 14 }} onSubmit={submit}>
        <input
          className="field min-w-0 flex-1"
          autoFocus
          value={name}
          maxLength={60}
          placeholder={parent ? `folder in ${parent.name}` : 'new folder'}
          aria-label="new folder name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onDone(null)}
        />
        <button type="submit" className="btn btn-sm btn-accent" disabled={!name.trim() || make.isPending}>
          make
        </button>
        <button type="button" className="btn btn-sm" onClick={() => onDone(null)} aria-label="cancel">
          x
        </button>
      </form>
    </li>
  )
}
