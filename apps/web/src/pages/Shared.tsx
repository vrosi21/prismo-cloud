import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router'
import type { Asset, AssetFilter } from '../api'
import { AssetModal } from '../components/AssetModal'
import { Gallery } from '../components/Gallery'
import { BmoFace, Cube, Prismo } from '../components/sprites'
import { errorText } from '../lib/log'
import { useShared, useSharedJarAssets } from '../lib/queries'

// What other people shared with the signed-in person. Nothing here can be
// selected, moved or re-shared: those are the owner's to do.

const NOTHING_SELECTED = new Set<string>()
const EVERYTHING: AssetFilter = {}
const ignore = () => {}

interface WallProps {
  assets: Asset[]
  hasMore?: boolean
  loadingMore?: boolean
  loadMore?: () => void
}

function Wall({ assets, hasMore = false, loadingMore = false, loadMore = ignore }: WallProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = openId ? (assets.find((a) => a.id === openId) ?? null) : null
  const step = useCallback(
    (direction: 1 | -1) => {
      const i = assets.findIndex((a) => a.id === openId)
      if (i >= 0) setOpenId(assets[(i + direction + assets.length) % assets.length].id)
    },
    [assets, openId],
  )
  const close = useCallback(() => setOpenId(null), [])
  return (
    <>
      <Gallery
        assets={assets}
        selected={NOTHING_SELECTED}
        selectable={false}
        onOpen={(a) => setOpenId(a.id)}
        onToggle={ignore}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMore={loadMore}
      />
      {open && <AssetModal asset={open} collections={[]} onClose={close} onStep={step} />}
    </>
  )
}

function Page({ title, note, children }: { title: string; note: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="panel px flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
        <h2 className="uppercase">{title}</h2>
        <span className="dim">{note}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">{children}</div>
}

export function SharedJar() {
  const { id = '' } = useParams()
  const shared = useShared()
  const query = useSharedJarAssets(id, EVERYTHING)
  const assets = useMemo(() => query.data?.pages.flatMap((p) => p.assets) ?? [], [query.data])
  const { fetchNextPage } = query
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  const jar = query.data?.pages[0]?.jar
  const owner = shared.data?.jars.find((j) => j.id === id)?.owner

  if (query.isPending) {
    return (
      <Centered>
        <Cube size={56} label="loading" />
      </Centered>
    )
  }
  if (query.isError || !jar) {
    return (
      <Centered>
        <BmoFace mood="sad" scale={5} />
        <p className="text-danger">&gt; {query.isError ? errorText(query.error) : 'not found'}</p>
        <p className="dim">this jar is not shared with you, or not any more.</p>
      </Centered>
    )
  }
  return (
    <Page
      title={jar.name}
      note={
        <>
          &gt; shared{owner ? ` by ${owner}` : ''} · {jar.role === 'edit' ? 'you may add, rename and trash' : 'view only'}
        </>
      }
    >
      {assets.length === 0 ? (
        <Centered>
          <Prismo scale={7} />
          <p>&gt; this jar is empty.</p>
          {jar.role === 'edit' && <p className="dim">drop a file anywhere, paste a screenshot, or press "make a wish".</p>}
        </Centered>
      ) : (
        <Wall assets={assets} hasMore={query.hasNextPage} loadingMore={query.isFetchingNextPage} loadMore={loadMore} />
      )}
    </Page>
  )
}

export function SharedItems() {
  const shared = useShared()
  const items = shared.data?.items ?? []
  if (shared.isPending) {
    return (
      <Centered>
        <Cube size={56} label="loading" />
      </Centered>
    )
  }
  return (
    <Page title="shared items" note="> single items people shared with you">
      {items.length === 0 ? (
        <Centered>
          <Prismo scale={7} />
          <p>&gt; no single items are shared with you.</p>
        </Centered>
      ) : (
        <Wall assets={items} />
      )}
    </Page>
  )
}

// Where a guest lands: the first thing shared with them.
export function SharedHome() {
  const shared = useShared()
  if (shared.isPending) {
    return (
      <Centered>
        <Cube size={56} label="loading" />
      </Centered>
    )
  }
  if (shared.data?.jars.length) return <Navigate to={`/shared/jar/${shared.data.jars[0].id}`} replace />
  if (shared.data?.items.length) return <Navigate to="/shared/items" replace />
  return (
    <Centered>
      <Prismo scale={7} />
      <p>&gt; nothing is shared with you right now.</p>
      <p className="dim">when someone shares a jar or an item with this google account, it shows up here.</p>
    </Centered>
  )
}
