import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { api, type AssetFilter, type BulkAction, type Visibility } from '../api'
import { AssetModal } from '../components/AssetModal'
import { Gallery } from '../components/Gallery'
import { ShareDialog } from '../components/ShareDialog'
import { BmoFace, Cube, Prismo } from '../components/sprites'
import { errorText, log } from '../lib/log'
import { useAssets, useCollections, useMe, useRefreshLibrary } from '../lib/queries'

const KIND_TITLE: Record<string, string> = {
  image: 'images',
  gif: 'gifs',
  video: 'recordings',
  sticker: 'stickers',
  file: 'files',
}

export function Library({ trashed = false }: { trashed?: boolean }) {
  const [params, setParams] = useSearchParams()
  const kind = params.get('kind') ?? undefined
  const collection = params.get('collection') ?? undefined
  const tag = params.get('tag') ?? undefined
  const q = params.get('q') ?? undefined

  // The filter lives in the URL: a view can be bookmarked, and Back works.
  const filter = useMemo<AssetFilter>(
    () => (trashed ? { trashed: true } : { kind, collection, tag, q }),
    [trashed, kind, collection, tag, q],
  )
  const query = useAssets(filter)
  const assets = useMemo(() => query.data?.pages.flatMap((p) => p.assets) ?? [], [query.data])
  const { data: collections = [] } = useCollections()
  const { data: me } = useMe()
  const refresh = useRefreshLibrary()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [sharingJar, setSharingJar] = useState(false)

  useEffect(() => {
    setSelected(new Set())
    setConfirmPurge(false)
  }, [filter])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const bulk = useMutation({
    mutationFn: (change: BulkAction) => api.bulk([...selected], change),
    onSuccess: (res, change) => {
      const done = { trash: 'moved to trash', restore: 'restored', purge: 'deleted for good', collection: 'moved', visibility: 'updated' }
      log('ok', `${res.changed} ${done[change.action]}`)
      setSelected(new Set())
      setConfirmPurge(false)
      refresh()
    },
    onError: (e) => log('err', errorText(e)),
  })

  const open = openId ? assets.find((a) => a.id === openId) ?? null : null
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

  const title = trashed
    ? 'trash'
    : collection === 'none'
      ? 'no jar'
      : collection
        ? (collections.find((c) => c.id === collection)?.name ?? 'jar')
        : kind
          ? KIND_TITLE[kind]
          : 'everything'

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="panel px flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
        {selected.size === 0 ? (
          <>
            <h2 className="uppercase">{title}</h2>
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
            {!trashed && collection && collection !== 'none' && (
              <button type="button" className="btn btn-sm" onClick={() => setSharingJar(true)}>
                share jar
              </button>
            )}
            {trashed && me && (
              <span className="dim">&gt; deleted for good after {me.limits.trash_retention_days} days</span>
            )}
          </>
        ) : (
          <>
            <h2>{selected.size} SELECTED</h2>
            {trashed ? (
              confirmPurge ? (
                <>
                  <span className="text-danger">&gt; this wish cannot be unwished.</span>
                  <button type="button" className="btn btn-sm btn-danger" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'purge' })}>
                    delete forever
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmPurge(false)}>
                    keep
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-sm btn-accent" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'restore' })}>
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
                  className="field !w-auto"
                  value=""
                  aria-label="move selected to jar"
                  onChange={(e) => bulk.mutate({ action: 'collection', collection_id: e.target.value === 'none' ? null : e.target.value })}
                >
                  <option value="" disabled>
                    move to jar
                  </option>
                  <option value="none">no jar</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className="field !w-auto"
                  value=""
                  aria-label="change who can see selected"
                  onChange={(e) => bulk.mutate({ action: 'visibility', visibility: e.target.value as Visibility })}
                >
                  <option value="" disabled>
                    who can see
                  </option>
                  <option value="private">private</option>
                  <option value="unlisted">unlisted</option>
                  <option value="public">public</option>
                </select>
                <button type="button" className="btn btn-sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'trash' })}>
                  move to trash
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
              clear
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {query.isPending ? (
          <Centered>
            <Cube size={56} label="loading" />
            <p>&gt; opening the time room...</p>
          </Centered>
        ) : query.isError ? (
          <Centered>
            <BmoFace mood="sad" scale={5} />
            <p className="text-danger">&gt; {errorText(query.error)}</p>
            <button type="button" className="btn" onClick={() => void query.refetch()}>
              try again
            </button>
          </Centered>
        ) : assets.length === 0 ? (
          <Centered>
            <Prismo scale={7} />
            <p>{trashed ? '> trash is empty.' : q || tag || kind || collection ? '> nothing matches.' : '> nothing here yet.'}</p>
            {!trashed && <p className="dim">drop a file anywhere, paste a screenshot, or press "make a wish".</p>}
          </Centered>
        ) : (
          <Gallery
            assets={assets}
            selected={selected}
            onOpen={(a) => setOpenId(a.id)}
            onToggle={toggle}
            hasMore={query.hasNextPage}
            loadingMore={query.isFetchingNextPage}
            loadMore={loadMore}
          />
        )}
      </div>

      {open && <AssetModal asset={open} collections={collections} onClose={close} onStep={step} />}
      {sharingJar && collection && <ShareDialog target={{ collection_id: collection }} name={title} onClose={() => setSharingJar(false)} />}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">{children}</div>
}
