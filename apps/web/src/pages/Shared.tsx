import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import type { Asset, AssetFilter } from '../api'
import { AssetModal } from '../components/AssetModal'
import { Gallery } from '../components/Gallery'
import { BmoFace, Cube, FolderIcon, Prismo } from '../components/sprites'
import { errorText } from '../lib/log'
import { useShared, useSharedFolder } from '../lib/queries'
import { useUploadTarget } from '../lib/target'

// What other people shared with the signed-in person. Nothing here can be
// selected, moved or re-shared: those are the owner's to do.

const NOTHING_SELECTED = new Set<string>()
const EVERYTHING: AssetFilter = {}
const ignore = () => {}

interface WallProps {
  assets: Asset[]
  header?: ReactNode
  empty?: ReactNode
  hasMore?: boolean
  loadingMore?: boolean
  loadMore?: () => void
}

function Wall({ assets, header, empty, hasMore = false, loadingMore = false, loadMore = ignore }: WallProps) {
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
        header={header}
        empty={empty}
        onOpen={(a) => setOpenId(a.id)}
        onSelect={ignore}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMore={loadMore}
      />
      {open && <AssetModal asset={open} folders={[]} onClose={close} onStep={step} />}
    </>
  )
}

function Page({ title, note, children }: { title: ReactNode; note: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="panel px flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
        {title}
        <span className="dim">{note}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-5 p-6 text-center">{children}</div>
}

// A folder someone shared, or a folder inside one.
export function SharedFolderPage() {
  const { id = '' } = useParams()
  const shared = useShared()
  const query = useSharedFolder(id, EVERYTHING)
  const assets = useMemo(() => query.data?.pages.flatMap((p) => p.assets) ?? [], [query.data])
  const { fetchNextPage } = query
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  const first = query.data?.pages[0]
  const canAdd = first?.folder.role === 'edit'
  useUploadTarget(id, canAdd)

  if (query.isPending) {
    return (
      <Centered>
        <Cube size={56} label="loading" />
      </Centered>
    )
  }
  if (query.isError || !first) {
    return (
      <Centered>
        <BmoFace mood="sad" scale={5} />
        <p className="text-danger">&gt; {query.isError ? errorText(query.error) : 'not found'}</p>
        <p className="dim">this folder is not shared with you, or not any more.</p>
      </Centered>
    )
  }

  // The path stops at the folder that was shared: what lies above it is not
  // this person's to see.
  const owner = shared.data?.folders.find((f) => f.id === first.crumbs[0]?.id)?.owner
  const path = (
    <nav aria-label="path" className="pixel flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase">
      {first.crumbs.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && <span className="dim">/</span>}
          <Link to={`/shared/folder/${c.id}`} className={`crumb px-1 ${i === first.crumbs.length - 1 ? '' : 'dim'}`}>
            {c.name}
          </Link>
        </Fragment>
      ))}
    </nav>
  )
  const subfolders = first.folders.length > 0 && (
    <div className="mb-6 grid gap-[18px] px-[3px] pt-[3px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {first.folders.map((f) => (
        <Link key={f.id} to={`/shared/folder/${f.id}`} className="folder-tile" title={`${f.name}: ${f.count} files`}>
          <FolderIcon />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="dim shrink-0">{f.count}</span>
        </Link>
      ))}
    </div>
  )
  const empty =
    first.folders.length > 0 ? (
      <p className="dim px-1 py-4">&gt; no files directly in here.</p>
    ) : (
      <Centered>
        <Prismo scale={7} />
        <p>&gt; this folder is empty.</p>
        {canAdd && <p className="dim">drop a file anywhere, paste a screenshot, or press "upload".</p>}
      </Centered>
    )

  return (
    <Page title={path} note={<>&gt; shared{owner ? ` by ${owner}` : ''} · {canAdd ? 'you may add, rename and trash' : 'view only'}</>}>
      <Wall assets={assets} header={subfolders} empty={empty} hasMore={query.hasNextPage} loadingMore={query.isFetchingNextPage} loadMore={loadMore} />
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
    <Page title={<h2 className="uppercase">shared items</h2>} note="> single files people shared with you">
      <Wall
        assets={items}
        empty={
          <Centered>
            <Prismo scale={7} />
            <p>&gt; no single files are shared with you.</p>
          </Centered>
        }
      />
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
  if (shared.data?.folders.length) return <Navigate to={`/shared/folder/${shared.data.folders[0].id}`} replace />
  if (shared.data?.items.length) return <Navigate to="/shared/items" replace />
  return (
    <Centered>
      <Prismo scale={7} />
      <p>&gt; nothing is shared with you right now.</p>
      <p className="dim">when someone shares a folder or a file with this google account, it shows up here.</p>
    </Centered>
  )
}
