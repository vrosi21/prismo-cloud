import { lazy, Suspense, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Item } from '../api'
import { importBundle, readBundle } from '../lib/bundle'
import { short } from '../lib/days'
import { lookout, openItem, openOnLookout, titleOf, useItem, useItemChanges, useItems, useOwnCardCount, useWholeItem } from '../lib/items'
import { errorText, log } from '../lib/log'
import { useFolderTree } from '../lib/queries'
import { useContentSaver } from '../lib/saver'
import { useStore } from '../lib/store'
import { ConflictBar, Notes, SaveNote } from './ItemPanel'
import { Boundary } from './Boundary'
import { FolderPick } from './FolderPick'
import { LookoutTree } from './LookoutTree'
import { Pinned } from './Pinned'
import { Cube } from './sprites'

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
  const qc = useQueryClient()
  const [importing, setImporting] = useState<string | null>(null)
  const runImport = async (file: File) => {
    try {
      const bundle = readBundle(await file.text())
      setImporting('0%')
      const boards = await importBundle(bundle, into, (n, total) => setImporting(`${Math.round((n / total) * 100)}%`))
      log('ok', `added ${bundle.items.length} items from ${file.name}`)
      if (boards[0]) lookout.set(boards[0])
    } catch (e) {
      log('err', `import stopped: ${errorText(e)}`)
    } finally {
      setImporting(null)
      void qc.invalidateQueries({ queryKey: ['items'] })
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
          <label className="btn btn-sm cursor-pointer" title="add a Prismo bundle (.json): items, links and boards in one file" aria-disabled={importing !== null}>
            {importing ?? 'import'}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              disabled={importing !== null}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void runImport(file)
              }}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <span className="label">new ones &amp; imports go in</span>
          <FolderPick value={into} onPick={(id) => pickFolder(id ?? '')} />
        </div>
        <button type="button" className="lookout-row" aria-current={open === null || undefined} onClick={() => lookout.set(null)} data-nav-item>
          <span className="kind-tag" data-kind="pinned">
            pinned
          </span>
          <span className="min-w-0 flex-1 truncate">the pinned board</span>
        </button>
        <input className="field" placeholder="find in titles and text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="find" />
        {isPending && <Cube size={32} label="loading" />}
        {!isPending && q.trim() ? (
          <ul className="lookout-list">
            {list.length === 0 && <p className="dim">&gt; nothing matches.</p>}
            {list.map((it) => (
              <li key={it.id}>
                <button type="button" className="lookout-row" aria-current={open === it.id || undefined} onClick={() => lookout.set(it.id)} data-nav-item>
                  <span className="kind-tag" data-kind={it.kind}>
                    {it.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{titleOf(it)}</span>
                  <span className="dim shrink-0 text-[16px]">{when(it.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !isPending && <LookoutTree items={list} open={open} target={into} onTarget={(id) => pickFolder(id ?? '')} when={when} />
        )}
      </aside>

      <div className="lookout-main">
        {open ? (
          <Page key={open} id={open} />
        ) : (
          <Pinned />
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
  const whole = useWholeItem()
  const cards = useOwnCardCount(item)
  const [asking, setAsking] = useState(false)
  const [title, setTitle] = useState(item.title)
  useEffect(() => setTitle(item.title), [item.title])
  const save = () => {
    const t = title.trim()
    if (t !== item.title && (t || (item.kind !== 'task' && item.kind !== 'event'))) update.mutate({ id: item.id, change: { title: t } })
  }
  const toTrash = (withCards: boolean) => {
    lookout.set(null)
    void whole.trash(item, withCards)
  }
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
        <span className="kind-tag" data-kind={item.kind}>
          {item.kind}
        </span>
        <span className="dim">in</span>
        <span title={cards ? `its ${cards} cards in the same folder move along` : undefined}>
          <FolderPick value={item.collection_id} onPick={(to) => to !== item.collection_id && void whole.move(item, to)} className="!w-auto max-w-[260px]" />
        </span>
        {item.date && <span className="dim">· {short(item.date)}</span>}
        {(item.links?.length ?? 0) > 0 && <span className="dim">· {item.links!.length} linked</span>}
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" onClick={() => openItem.set(item.id)} title="day, colour, tags, links...">
          details
        </button>
        {asking ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="dim">trash:</span>
            <button type="button" className="btn btn-sm btn-accent" onClick={() => toTrash(true)}>
              board + its {cards} cards
            </button>
            <button type="button" className="btn btn-sm" onClick={() => toTrash(false)}>
              board only
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAsking(false)}>
              keep
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => (cards > 0 ? setAsking(true) : toTrash(false))} title="to the trash; the library's trash gives it back">
            trash
          </button>
        )}
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
