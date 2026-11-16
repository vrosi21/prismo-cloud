import { lazy, Suspense, useEffect, useState } from 'react'
import type { Item } from '../api'
import { short } from '../lib/days'
import { lookout, openItem, openOnLookout, titleOf, useItem, useItemChanges, useItems } from '../lib/items'
import { useFolderTree } from '../lib/queries'
import { useContentSaver } from '../lib/saver'
import { useStore } from '../lib/store'
import { ConflictBar, Notes, SaveNote } from './ItemPanel'
import { Boundary } from './Boundary'
import { Cube, Prismo } from './sprites'

const Board = lazy(() => import('./Board'))

// The lookout wall: notebooks and boards. The list on the left, the one
// open on the right, as big as the wall. New ones go into the folder picked
// under the list, so they also show up in the library among the files.

const FOLDER_KEY = 'prismo.lookout.folder'
function savedFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function LookoutWall() {
  const open = useStore(lookout)
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState(savedFolder)
  const tree = useFolderTree()
  const { create } = useItemChanges()
  const { data: list = [], isPending } = useItems({ kind: 'notebook,board', q: q.trim() || undefined })

  // A folder that was deleted meanwhile is no folder.
  const into = folder && tree.byId.has(folder) ? folder : null
  const pickFolder = (id: string) => {
    setFolder(id)
    try {
      localStorage.setItem(FOLDER_KEY, id)
    } catch {
      /* not remembered */
    }
  }
  const make = (kind: 'notebook' | 'board') =>
    create.mutate({ item: { kind, title: '', collection_id: into } }, { onSuccess: (it) => openOnLookout(it.id) })

  return (
    <section className="lookout" aria-label="lookout wall: notebooks and boards">
      <aside className="lookout-side panel px">
        <h2 className="uppercase">notebooks &amp; boards</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-accent" disabled={create.isPending} onClick={() => make('notebook')}>
            + notebook
          </button>
          <button type="button" className="btn btn-sm btn-accent" disabled={create.isPending} onClick={() => make('board')}>
            + board
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="label">new ones go in</span>
          <select className="field" value={into ?? ''} onChange={(e) => pickFolder(e.target.value)}>
            <option value="">top of the library</option>
            {tree.flat.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path}
              </option>
            ))}
          </select>
        </label>
        <input className="field" placeholder="find in titles and text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="find" />
        <ul className="lookout-list">
          {isPending && <Cube size={32} label="loading" />}
          {!isPending && list.length === 0 && <p className="dim">&gt; {q ? 'nothing matches.' : 'none yet. make one above.'}</p>}
          {list.map((it) => (
            <li key={it.id}>
              <button type="button" className="lookout-row" aria-current={open === it.id || undefined} onClick={() => lookout.set(it.id)} data-nav-item>
                <span className="kind-tag">{it.kind}</span>
                <span className="min-w-0 flex-1 truncate">{titleOf(it)}</span>
                <span className="dim shrink-0 text-[16px]">{when(it.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="lookout-main">
        {open ? (
          <Page key={open} id={open} />
        ) : (
          <div className="panel px-raised lookout-empty">
            <Prismo />
            <p>&gt; pick a notebook or a board, or make a new one.</p>
            <p className="dim">notebooks take markdown and latex ($x^2$), and type like a normal editor. boards are endless canvases of notes, cards and arrows.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function when(at: string) {
  const d = new Date(at)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? d.toTimeString().slice(0, 5) : short(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
}

function Page({ id }: { id: string }) {
  const { data: item, isPending, isError } = useItem(id)
  if (isPending) return <Cube size={48} label="loading" />
  if (isError || !item || item.deleted_at)
    return (
      <div className="panel px-raised lookout-empty">
        <p>&gt; this one is gone (or in the trash).</p>
        <button type="button" className="btn btn-sm" onClick={() => lookout.set(null)}>
          close
        </button>
      </div>
    )
  return (
    <div className="lookout-page panel px-raised">
      <PageHead item={item} />
      {item.kind === 'board' ? <BoardBody item={item} /> : <Notes item={item} compact={false} />}
    </div>
  )
}

function PageHead({ item }: { item: Item }) {
  const { update } = useItemChanges()
  const tree = useFolderTree()
  const [title, setTitle] = useState(item.title)
  useEffect(() => setTitle(item.title), [item.title])
  const save = () => {
    const t = title.trim()
    if (t !== item.title && (t || (item.kind !== 'task' && item.kind !== 'event'))) update.mutate({ id: item.id, change: { title: t } })
  }
  const folder = item.collection_id ? tree.byId.get(item.collection_id)?.path : null
  return (
    <div className="lookout-head">
      <input
        className="lookout-title"
        value={title}
        placeholder={`untitled ${item.kind}`}
        maxLength={200}
        aria-label="title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="kind-tag">{item.kind}</span>
        <span className="dim">{folder ? `in ${folder}` : 'top of the library'}</span>
        {item.date && <span className="dim">· {short(item.date)}</span>}
        {(item.links?.length ?? 0) > 0 && <span className="dim">· {item.links!.length} linked</span>}
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" onClick={() => openItem.set(item.id)} title="folder, day, colour, links...">
          details
        </button>
        <button type="button" className="btn btn-sm" onClick={() => lookout.set(null)} aria-label="close">
          x
        </button>
      </div>
    </div>
  )
}

function BoardBody({ item }: { item: Item }) {
  const saver = useContentSaver(item, 'canvas', 600)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SaveNote state={saver.state} />
      {saver.conflict && <ConflictBar onMine={saver.keepMine} onTheirs={saver.takeTheirs} />}
      <Boundary what="board">
        <Suspense fallback={<Cube size={40} label="loading the board" />}>
          <Board canvas={saver.value} onChange={saver.change} board={item} />
        </Suspense>
      </Boundary>
    </div>
  )
}
