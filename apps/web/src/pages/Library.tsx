import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api, type Asset, type AssetFilter, type BulkAction, type Visibility } from '../api'
import { AssetModal } from '../components/AssetModal'
import { Gallery, type SelectMode } from '../components/Gallery'
import { ShareDialog } from '../components/ShareDialog'
import { KINDS } from '../components/Shell'
import { BmoFace, Cube, FolderIcon, Prismo } from '../components/sprites'
import { bulkAll, moves, useAssetDrop } from '../lib/drag'
import { crumbsOf, isInside, type FolderNode } from '../lib/folders'
import { errorText, log } from '../lib/log'
import { useAssets, useFolders, useFolderTree, useMe, useRefreshLibrary } from '../lib/queries'
import { useStore } from '../lib/store'
import { useUploadTarget } from '../lib/target'

type Panel = null | 'new' | 'rename' | 'move' | 'delete'

// One page, two ways of looking:
//  - a folder (or the top level): its subfolders, then the files directly in
//    it, like a file manager;
//  - a flat list across all folders: everything, one type, a search, the trash.
export function Library({ trashed = false }: { trashed?: boolean }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const folderId = trashed ? null : params.get('folder')
  const kind = params.get('kind') ?? undefined
  const tag = params.get('tag') ?? undefined
  const q = params.get('q') ?? undefined
  const everything = params.get('view') === 'all'
  const flat = trashed || Boolean(kind || tag || q || everything)

  // What is shown lives in the URL: a view can be bookmarked, and Back works.
  const filter = useMemo<AssetFilter>(
    () => (trashed ? { trashed: true } : flat ? { kind, tag, q } : { collection: folderId ?? 'none' }),
    [trashed, flat, kind, tag, q, folderId],
  )
  const query = useAssets(filter)
  const assets = useMemo(() => query.data?.pages.flatMap((p) => p.assets) ?? [], [query.data])
  const tree = useFolderTree()
  const foldersLoaded = useFolders().isSuccess
  const { data: me } = useMe()
  const refresh = useRefreshLibrary()

  const folder = folderId ? tree.byId.get(folderId) : undefined
  const subfolders = flat ? [] : folderId ? (folder?.children ?? []) : tree.roots
  const crumbs = crumbsOf(tree, folderId)

  // New files land in the folder on screen. Nothing can be added to the trash.
  useUploadTarget(flat ? null : folderId, !trashed)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null) // where a Shift-click range starts
  const [openId, setOpenId] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [sharing, setSharing] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)

  useEffect(() => {
    setSelected(new Set())
    anchor.current = null
    setPanel(null)
    setConfirmPurge(false)
  }, [filter])

  // Files dragged onto a folder have left this view; forget they were selected.
  const moved = useStore(moves)
  useEffect(() => setSelected(new Set()), [moved])

  const select = useCallback(
    (asset: Asset, mode: SelectMode) => {
      const from = mode === 'range' && anchor.current ? assets.findIndex((a) => a.id === anchor.current) : -1
      const to = assets.findIndex((a) => a.id === asset.id)
      if (from < 0) anchor.current = asset.id
      setSelected((prev) => {
        const next = new Set(prev)
        if (from >= 0 && to >= 0) {
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(assets[i].id)
        } else if (!next.delete(asset.id)) {
          next.add(asset.id)
        }
        return next
      })
    },
    [assets],
  )

  // "All" means everything this view matches, not just the tiles loaded so
  // far, so the ids of the rest are fetched when there is a rest.
  const { hasNextPage } = query
  const selectAll = useCallback(async () => {
    if (!hasNextPage) {
      setSelected(new Set(assets.map((a) => a.id)))
      return
    }
    try {
      const all = await api.assetIds(filter)
      setSelected(new Set(all.ids))
      if (all.truncated) log('info', `selected the newest ${all.ids.length}; there are more`)
    } catch (e) {
      log('err', errorText(e))
    }
  }, [assets, filter, hasNextPage])

  const bulk = useMutation({
    mutationFn: (change: BulkAction) => bulkAll([...selected], change),
    onSuccess: (changed, change) => {
      const done = { trash: 'moved to trash', restore: 'restored', purge: 'deleted for good', collection: 'moved', visibility: 'updated' }
      log('ok', `${changed} ${done[change.action]}`)
      setSelected(new Set())
      setConfirmPurge(false)
      refresh()
    },
    onError: (e) => log('err', errorText(e)),
  })
  const { mutate: runBulk } = bulk

  // Ctrl+A, Escape and Delete, as in a file manager. Not while typing, and
  // not while a dialog is open on top.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || document.querySelector('[role=dialog]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        void selectAll()
      } else if (e.key === 'Escape' && selected.size > 0) {
        setSelected(new Set())
      } else if (e.key === 'Delete' && selected.size > 0 && !trashed) {
        runBulk({ action: 'trash' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectAll, selected, trashed, runBulk])

  const open = openId ? (assets.find((a) => a.id === openId) ?? null) : null
  const step = useCallback(
    (direction: 1 | -1) => {
      const i = assets.findIndex((a) => a.id === openId)
      if (i >= 0 && assets.length > 0) setOpenId(assets[(i + direction + assets.length) % assets.length].id)
    },
    [assets, openId],
  )
  const close = useCallback(() => setOpenId(null), [])

  const { fetchNextPage } = query
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  const dropParam = (name: string) => {
    const next = new URLSearchParams(params)
    next.delete(name)
    setParams(next)
  }

  const flatTitle = trashed ? 'trash' : q ? 'search' : kind ? (KINDS.find((k) => k.id === kind)?.label ?? kind) : tag ? `#${tag}` : 'everything'

  const header =
    selected.size > 0 ? (
      <>
        <h2>{selected.size} SELECTED</h2>
        <button type="button" className="btn btn-sm" onClick={() => void selectAll()}>
          select all
        </button>
        {trashed ? (
          confirmPurge ? (
            <>
              <span className="text-danger">&gt; this cannot be undone.</span>
              <button type="button" className="btn btn-sm btn-danger" disabled={bulk.isPending} onClick={() => runBulk({ action: 'purge' })}>
                delete forever
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmPurge(false)}>
                keep
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-accent" disabled={bulk.isPending} onClick={() => runBulk({ action: 'restore' })}>
                restore
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmPurge(true)}>
                delete forever
              </button>
            </>
          )
        ) : (
          <>
            <select
              className="field !w-auto max-w-[220px]"
              value=""
              aria-label="move selected to folder"
              onChange={(e) => runBulk({ action: 'collection', collection_id: e.target.value === 'none' ? null : e.target.value })}
            >
              <option value="" disabled>
                move to folder
              </option>
              <option value="none">no folder (top level)</option>
              {tree.flat.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
            </select>
            <select
              className="field !w-auto"
              value=""
              aria-label="change who can open selected by link"
              onChange={(e) => runBulk({ action: 'visibility', visibility: e.target.value as Visibility })}
            >
              <option value="" disabled>
                link access
              </option>
              <option value="private">private</option>
              <option value="unlisted">anyone with link</option>
              <option value="public">public</option>
            </select>
            <button type="button" className="btn btn-sm" disabled={bulk.isPending} onClick={() => runBulk({ action: 'trash' })}>
              move to trash
            </button>
          </>
        )}
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
          clear
        </button>
      </>
    ) : flat ? (
      <>
        <h2 className="uppercase">{flatTitle}</h2>
        {q && (
          <button type="button" className="chip" onClick={() => dropParam('q')} title="clear search">
            find: {q} x
          </button>
        )}
        {tag && (
          <button type="button" className="chip" onClick={() => dropParam('tag')} title="clear tag">
            #{tag} x
          </button>
        )}
        {trashed && me && <span className="dim">&gt; deleted for good after {me.limits.trash_retention_days} days</span>}
        {!trashed && <span className="dim hidden lg:inline">&gt; files from every folder</span>}
        <span className="flex-1" />
        {assets.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => void selectAll()} title="Ctrl+A">
            select all
          </button>
        )}
      </>
    ) : (
      <>
        <nav aria-label="path" className="pixel flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase">
          <Crumb to="/" folderId={null} name="all files" last={crumbs.length === 0} onMoved={refresh} />
          {crumbs.map((c, i) => (
            <Fragment key={c.id}>
              <span className="dim">/</span>
              <Crumb to={`/?folder=${c.id}`} folderId={c.id} name={c.name} last={i === crumbs.length - 1} onMoved={refresh} />
            </Fragment>
          ))}
        </nav>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" aria-pressed={panel === 'new'} onClick={() => setPanel(panel === 'new' ? null : 'new')}>
          new folder
        </button>
        {folder && (
          <>
            <button type="button" className="btn btn-sm" aria-pressed={panel === 'rename'} onClick={() => setPanel(panel === 'rename' ? null : 'rename')}>
              rename
            </button>
            <button type="button" className="btn btn-sm" aria-pressed={panel === 'move'} onClick={() => setPanel(panel === 'move' ? null : 'move')}>
              move
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setSharing(true)}>
              share
            </button>
            <button type="button" className="btn btn-sm" aria-pressed={panel === 'delete'} onClick={() => setPanel(panel === 'delete' ? null : 'delete')}>
              delete
            </button>
          </>
        )}
        {assets.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => void selectAll()} title="Ctrl+A">
            select all
          </button>
        )}
      </>
    )

  const missingFolder = Boolean(folderId) && foldersLoaded && !folder

  const emptyNote = flat ? (
    <Centered>
      <Prismo scale={7} />
      <p>{trashed ? '> trash is empty.' : '> nothing matches.'}</p>
    </Centered>
  ) : subfolders.length > 0 ? (
    <p className="dim px-1 py-4">&gt; no files directly in here.</p>
  ) : (
    <Centered>
      <Prismo scale={7} />
      <p>{folder ? '> this folder is empty.' : '> nothing here yet.'}</p>
      <p className="dim">drop a file anywhere, paste a screenshot, or press "upload".</p>
    </Centered>
  )

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="panel px flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-3 px-3 py-2">{header}</div>

      {panel && selected.size === 0 && !flat && (
        <FolderPanel
          key={panel}
          panel={panel}
          folder={folder}
          parentId={folderId}
          onClose={() => setPanel(null)}
          onDeleted={(parent) => navigate(parent ? `/?folder=${parent}` : '/')}
        />
      )}

      <div className="min-h-0 flex-1">
        {query.isPending ? (
          <Centered>
            <Cube size={56} label="loading" />
          </Centered>
        ) : missingFolder ? (
          <Centered>
            <BmoFace mood="sad" scale={5} />
            <p>&gt; this folder does not exist any more.</p>
            <Link to="/" className="btn">
              all files
            </Link>
          </Centered>
        ) : query.isError ? (
          <Centered>
            <BmoFace mood="sad" scale={5} />
            <p className="text-danger">&gt; {errorText(query.error)}</p>
            <button type="button" className="btn" onClick={() => void query.refetch()}>
              try again
            </button>
          </Centered>
        ) : (
          <Gallery
            assets={assets}
            selected={selected}
            header={
              subfolders.length > 0 && (
                <div className="mb-6 grid gap-[18px] px-[3px] pt-[3px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                  {subfolders.map((f) => (
                    <FolderTile key={f.id} folder={f} onMoved={refresh} />
                  ))}
                </div>
              )
            }
            empty={emptyNote}
            onOpen={(a) => setOpenId(a.id)}
            onSelect={select}
            hasMore={query.hasNextPage}
            loadingMore={query.isFetchingNextPage}
            loadMore={loadMore}
          />
        )}
      </div>

      {open && <AssetModal asset={open} folders={tree.flat} onClose={close} onStep={step} />}
      {sharing && folder && <ShareDialog target={{ collection_id: folder.id }} name={folder.name} onClose={() => setSharing(false)} />}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-5 p-6 text-center">{children}</div>
}

// A step of the path. Also a place to drop files, so they can be moved up.
function Crumb({ to, folderId, name, last, onMoved }: { to: string; folderId: string | null; name: string; last: boolean; onMoved: () => void }) {
  const drop = useAssetDrop(folderId, name, onMoved)
  return (
    <Link to={to} className={`crumb px-1 ${last ? '' : 'dim'} ${drop.over ? 'drop-over' : ''}`} aria-current={last ? 'page' : undefined} {...drop.handlers}>
      {name}
    </Link>
  )
}

function FolderTile({ folder, onMoved }: { folder: FolderNode; onMoved: () => void }) {
  const drop = useAssetDrop(folder.id, folder.name, onMoved)
  const inside = folder.children.length > 0 ? `${folder.count} files, ${folder.children.length} folders` : `${folder.count} files`
  return (
    <Link to={`/?folder=${folder.id}`} className={`folder-tile ${drop.over ? 'drop-over' : ''}`} title={`${folder.name}: ${inside}`} {...drop.handlers}>
      <FolderIcon />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      <span className="dim shrink-0">{folder.count}</span>
    </Link>
  )
}

interface FolderPanelProps {
  panel: Exclude<Panel, null>
  /** The folder on screen; undefined at the top level. */
  folder: FolderNode | undefined
  /** Where a new folder goes. */
  parentId: string | null
  onClose: () => void
  onDeleted: (parentId: string | null) => void
}

// The strip under the header for the one thing being done to a folder.
function FolderPanel({ panel, folder, parentId, onClose, onDeleted }: FolderPanelProps) {
  const tree = useFolderTree()
  const refresh = useRefreshLibrary()
  const [name, setName] = useState(panel === 'rename' ? (folder?.name ?? '') : '')
  const [dest, setDest] = useState<string>(folder?.parent_id ?? 'top')
  const fail = (e: unknown) => log('err', errorText(e))
  const done = () => {
    refresh()
    onClose()
  }

  const create = useMutation({ mutationFn: () => api.createFolder(name.trim(), parentId), onSuccess: done, onError: fail })
  const rename = useMutation({ mutationFn: () => api.updateFolder(folder!.id, { name: name.trim() }), onSuccess: done, onError: fail })
  const move = useMutation({
    mutationFn: () => api.updateFolder(folder!.id, { parent_id: dest === 'top' ? null : dest }),
    onSuccess: done,
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (trashFiles: boolean) => api.deleteFolder(folder!.id, trashFiles),
    onSuccess: (_, trashFiles) => {
      log('ok', trashFiles ? 'folder deleted; its files are in the trash' : 'folder deleted; its files were kept')
      refresh()
      onDeleted(folder!.parent_id)
    },
    onError: fail,
  })

  const submit = (run: () => void) => (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) run()
  }

  // Files in this folder and in everything below it.
  const filesInside = folder ? tree.flat.filter((f) => isInside(tree, f.id, folder.id)).reduce((n, f) => n + f.count, 0) : 0
  const foldersInside = folder ? tree.flat.filter((f) => f.id !== folder.id && isInside(tree, f.id, folder.id)).length : 0

  return (
    <div className="panel px flex flex-wrap items-center gap-x-3 gap-y-3 px-3 py-2">
      {(panel === 'new' || panel === 'rename') && (
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-3" onSubmit={submit(() => (panel === 'new' ? create.mutate() : rename.mutate()))}>
          <span className="dim shrink-0">&gt; {panel === 'new' ? `new folder${folder ? ` in ${folder.name}` : ''}:` : 'new name:'}</span>
          <input
            className="field min-w-[160px] max-w-[340px] flex-1"
            autoFocus
            value={name}
            maxLength={60}
            aria-label="folder name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          <button type="submit" className="btn btn-sm btn-accent" disabled={!name.trim() || create.isPending || rename.isPending}>
            {panel === 'new' ? 'create' : 'rename'}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            cancel
          </button>
        </form>
      )}

      {panel === 'move' && folder && (
        <>
          <span className="dim shrink-0">&gt; move "{folder.name}" into:</span>
          <select className="field !w-auto max-w-[340px]" value={dest} aria-label="destination" onChange={(e) => setDest(e.target.value)}>
            <option value="top">top level</option>
            {/* A folder cannot go into itself or into its own subfolders. */}
            {tree.flat
              .filter((f) => !isInside(tree, f.id, folder.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
          </select>
          <button type="button" className="btn btn-sm btn-accent" disabled={move.isPending || dest === (folder.parent_id ?? 'top')} onClick={() => move.mutate()}>
            move
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            cancel
          </button>
        </>
      )}

      {panel === 'delete' && folder && (
        <>
          <span className="shrink-0">
            &gt; delete "{folder.name}"{foldersInside > 0 ? ` and its ${foldersInside} subfolder${foldersInside === 1 ? '' : 's'}` : ''}?
            {filesInside > 0 ? ` what about the ${filesInside} file${filesInside === 1 ? '' : 's'} inside?` : ''}
          </span>
          {filesInside > 0 ? (
            <>
              <button type="button" className="btn btn-sm" disabled={remove.isPending} onClick={() => remove.mutate(false)}>
                keep files (move up)
              </button>
              <button type="button" className="btn btn-sm btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(true)}>
                files to trash
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(false)}>
              delete
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onClose}>
            cancel
          </button>
        </>
      )}
    </div>
  )
}
