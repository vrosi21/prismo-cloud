import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { Me } from '../api'
import { assetDragActive, useAssetDrop } from '../lib/drag'
import { crumbsOf, type FolderNode, type FolderTree } from '../lib/folders'
import { bytes } from '../lib/format'
import { log, logLines } from '../lib/log'
import { useFolderTree, useRefreshLibrary, useShared, useStats } from '../lib/queries'
import { useStore } from '../lib/store'
import { uploadTarget } from '../lib/target'
import { setScanlines, setTheme, THEMES, useScanlines, useTheme } from '../lib/theme'
import { uploadFiles, uploads } from '../lib/uploads'
import { Boot, LogLines, Palette, UploadTray, type Command } from './Overlays'
import { BmoFace, Cube, type Mood } from './sprites'

export const KINDS = [
  { id: 'image', label: 'images' },
  { id: 'gif', label: 'gifs' },
  { id: 'video', label: 'recordings' },
  { id: 'sticker', label: 'stickers' },
  { id: 'file', label: 'other files' },
]

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const refresh = useRefreshLibrary()
  const tree = useFolderTree()
  const { data: shared } = useShared()
  const target = useStore(uploadTarget)
  const picker = useRef<HTMLInputElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  // The page on screen says where new files go. No page saying anything
  // means: a member's library, in no folder; a guest has nowhere.
  const canUpload = target ? target.allowed : me.member
  const uploadFolder = target?.folderId ?? null

  const send = useCallback(
    (files: Iterable<File>) => {
      if (!canUpload) {
        log('err', 'nothing here you can add files to')
        return
      }
      uploadFiles(files, { collectionId: uploadFolder, onStored: refresh })
    },
    [canUpload, uploadFolder, refresh],
  )

  // Drop a file anywhere, or paste a screenshot with Ctrl+V.
  useEffect(() => {
    let depth = 0
    // Files from the desktop, not tiles being dragged around inside the page.
    const fromOutside = (e: DragEvent) => !assetDragActive() && (e.dataTransfer?.types.includes('Files') ?? false)
    const enter = (e: DragEvent) => {
      if (!fromOutside(e)) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => fromOutside(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!fromOutside(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      if (e.dataTransfer) send(e.dataTransfer.files)
    }
    const paste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files
      if (files && files.length > 0) {
        e.preventDefault()
        send(files)
      }
    }
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('paste', paste)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('paste', paste)
      window.removeEventListener('keydown', key)
    }
  }, [send])

  useEffect(() => setMenuOpen(false), [location])

  const search = useCallback((text: string) => navigate(text ? `/?q=${encodeURIComponent(text)}` : '/'), [navigate])

  const commands = useMemo<Command[]>(
    () => [
      ...(me.member
        ? [
            { id: 'upload', label: 'upload files', hint: 'pick files', run: () => picker.current?.click() },
            { id: 'root', label: 'go to all files', run: () => navigate('/') },
            ...tree.flat.slice(0, 40).map((f) => ({ id: `folder-${f.id}`, label: `open ${f.path}`, hint: 'folder', run: () => navigate(`/?folder=${f.id}`) })),
            ...KINDS.map((k) => ({ id: `kind-${k.id}`, label: `show ${k.label}`, hint: 'by type', run: () => navigate(`/?kind=${k.id}`) })),
            { id: 'trash', label: 'go to trash', run: () => navigate('/trash') },
          ]
        : []),
      ...(shared?.folders ?? []).map((f) => ({
        id: `shared-${f.id}`,
        label: `open ${f.name}`,
        hint: `shared by ${f.owner}`,
        run: () => navigate(`/shared/folder/${f.id}`),
      })),
      { id: 'settings', label: 'go to settings', run: () => navigate('/settings') },
      ...THEMES.map((t) => ({ id: `theme-${t.id}`, label: `theme ${t.name.toLowerCase()}`, hint: t.hint, run: () => setTheme(t.id) })),
      { id: 'scanlines', label: 'toggle scanlines', run: () => setScanlines(document.documentElement.dataset.scanlines !== 'on') },
    ],
    [navigate, me.member, shared, tree],
  )

  return (
    <div className="relative z-10 flex h-full flex-col">
      <Boot />
      <header className="panel px relative z-20 mx-3 mt-3 flex items-center gap-3 px-3 py-2">
        <button type="button" className="btn btn-sm md:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          menu
        </button>
        <Link to="/" className="flex items-center gap-3" aria-label="Prismo Cloud, all files">
          <Cube size={22} still />
          <h1 className="hidden sm:block">PRISMO CLOUD</h1>
        </Link>
        {me.member ? <SearchBox key={params.get('q') ?? ''} initial={params.get('q') ?? ''} onSearch={search} /> : <span className="flex-1" />}
        <button type="button" className="btn hidden sm:inline-flex" onClick={() => setPaletteOpen(true)} title="commands (Ctrl+K)">
          ctrl+k
        </button>
        {canUpload && (
          <button type="button" className="btn btn-accent" onClick={() => picker.current?.click()}>
            upload
          </button>
        )}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) send(e.target.files)
            e.target.value = ''
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <Sidebar open={menuOpen} member={me.member} tree={tree} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <StatusBar email={me.user.email} member={me.member} />
      <LogLines />
      <UploadTray />
      {paletteOpen && <Palette commands={commands} onSearch={search} onClose={() => setPaletteOpen(false)} />}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
          <div className="panel px-raised flex flex-col items-center gap-5 px-10 py-8">
            <Cube size={56} />
            <h1>{canUpload ? 'drop to upload' : 'nothing can be added here'}</h1>
          </div>
        </div>
      )}
    </div>
  )
}

function SearchBox({ initial, onSearch }: { initial: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSearch(text.trim())
  }
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2" role="search">
      <span className="hidden text-accent-deep sm:inline" aria-hidden>
        find&gt;
      </span>
      <input
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="title or file name"
        aria-label="search all files"
      />
    </form>
  )
}

function NavItem({ to, active, count, children }: { to: string; active: boolean; count?: number; children: ReactNode }) {
  return (
    <Link to={to} className="nav-item" aria-current={active ? 'page' : undefined}>
      <span className="grow">{children}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </Link>
  )
}

// Which folders are open in the tree. Remembered, so the tree looks the same
// after a reload; storage may be unavailable, and then it just is not.
function useOpenFolders() {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('prismo.tree') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const save = (next: Set<string>) => {
    try {
      localStorage.setItem('prismo.tree', JSON.stringify([...next]))
    } catch {
      /* not remembered */
    }
    return next
  }
  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return save(next)
    })
  }, [])
  const reveal = useCallback((ids: string[]) => {
    setOpen((prev) => (ids.every((id) => prev.has(id)) ? prev : save(new Set([...prev, ...ids]))))
  }, [])
  return { open, toggle, reveal }
}

interface TreeProps {
  node: FolderNode
  current: string | null
  open: Set<string>
  toggle: (id: string) => void
  refresh: () => void
}

function TreeRow({ node, current, open, toggle, refresh }: TreeProps) {
  const drop = useAssetDrop(node.id, node.name, refresh)
  const isOpen = open.has(node.id)
  return (
    <>
      <div className={`nav-item ${drop.over ? 'drop-over' : ''}`} aria-current={current === node.id ? 'page' : undefined} {...drop.handlers}>
        <span className="shrink-0" style={{ width: node.depth * 12 }} />
        {node.children.length > 0 ? (
          <button type="button" className="twist" aria-expanded={isOpen} aria-label={`${isOpen ? 'close' : 'open'} ${node.name}`} onClick={() => toggle(node.id)}>
            {isOpen ? '-' : '+'}
          </button>
        ) : (
          <span className="twist pointer-events-none" aria-hidden />
        )}
        <Link to={`/?folder=${node.id}`} className="grow">
          {node.name}
        </Link>
        <span className="count">{node.count}</span>
      </div>
      {isOpen && node.children.map((child) => <TreeRow key={child.id} node={child} current={current} open={open} toggle={toggle} refresh={refresh} />)}
    </>
  )
}

function Sidebar({ open, member, tree }: { open: boolean; member: boolean; tree: FolderTree }) {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const { data: stats } = useStats()
  const { data: shared } = useShared()
  const refresh = useRefreshLibrary()
  const folders = useOpenFolders()
  const rootDrop = useAssetDrop(null, 'all files', refresh)

  const home = pathname === '/'
  const kind = home ? params.get('kind') : null
  const folder = home ? params.get('folder') : null
  const everything = home && params.get('view') === 'all'
  const atRoot = home && !folder && !kind && !everything && !params.get('q') && !params.get('tag')
  const sharedFolders = shared?.folders ?? []
  const sharedItems = shared?.items.length ?? 0

  // Keep the folder being looked at visible in the tree.
  const { reveal } = folders
  useEffect(() => {
    if (folder) reveal(crumbsOf(tree, folder).slice(0, -1).map((f) => f.id))
  }, [folder, tree, reveal])

  return (
    <nav
      className={`panel px w-[250px] shrink-0 flex-col gap-4 overflow-y-auto py-3 md:flex ${
        open ? 'absolute bottom-[52px] left-3 top-[70px] z-30 flex' : 'hidden'
      }`}
      aria-label="files"
    >
      {/* A guest has no library of their own, only what was shared. */}
      {member && (
        <>
          <div>
            <h3 className="dim px-[14px] pb-2">FOLDERS</h3>
            <div className={`nav-item ${rootDrop.over ? 'drop-over' : ''}`} aria-current={atRoot ? 'page' : undefined} {...rootDrop.handlers}>
              <Link to="/" className="grow">
                all files
              </Link>
            </div>
            {tree.roots.map((node) => (
              <TreeRow key={node.id} node={node} current={folder} open={folders.open} toggle={folders.toggle} refresh={refresh} />
            ))}
          </div>

          <div>
            <h3 className="dim px-[14px] pb-2">BY TYPE</h3>
            <NavItem to="/?view=all" active={everything} count={stats?.assets}>
              everything
            </NavItem>
            {KINDS.map((k) => (
              <NavItem key={k.id} to={`/?kind=${k.id}`} active={kind === k.id}>
                {k.label}
              </NavItem>
            ))}
          </div>
        </>
      )}

      {(sharedFolders.length > 0 || sharedItems > 0 || !member) && (
        <div>
          <h3 className="dim px-[14px] pb-2">SHARED WITH ME</h3>
          {sharedFolders.map((f) => (
            <NavItem key={f.id} to={`/shared/folder/${f.id}`} active={pathname === `/shared/folder/${f.id}`} count={f.count}>
              {f.name}
            </NavItem>
          ))}
          {sharedItems > 0 && (
            <NavItem to="/shared/items" active={pathname === '/shared/items'} count={sharedItems}>
              single items
            </NavItem>
          )}
          {sharedFolders.length === 0 && sharedItems === 0 && <p className="dim px-[14px]">nothing yet</p>}
        </div>
      )}

      <div className="mt-auto">
        {member && (
          <NavItem to="/trash" active={pathname === '/trash'} count={stats?.trashed || undefined}>
            trash
          </NavItem>
        )}
        <NavItem to="/settings" active={pathname === '/settings'}>
          settings
        </NavItem>
      </div>
    </nav>
  )
}

function StatusBar({ email, member }: { email: string; member: boolean }) {
  const { data: stats } = useStats()
  const items = useStore(uploads)
  const lines = useStore(logLines)
  const theme = useTheme()
  const scanlines = useScanlines()

  const sending = items.filter((i) => i.state === 'waiting' || i.state === 'checking' || i.state === 'sending').length
  const processing = stats?.processing ?? 0

  // The face follows the app: trouble first, then work, then good news.
  const status = (): [Mood, string] => {
    if (lines.some((l) => l.level === 'err')) return ['sad', 'something went wrong']
    if (sending > 0) return ['busy', `uploading ${sending}`]
    if (processing > 0) return ['busy', `processing ${processing}`]
    if (lines.some((l) => l.level === 'ok')) return ['happy', 'done']
    return ['idle', 'ready']
  }
  const [mood, text] = status()

  const nextTheme = THEMES[(THEMES.findIndex((t) => t.id === theme) + 1) % THEMES.length]

  return (
    <footer className="panel px relative z-20 mx-3 mb-3 flex h-[30px] shrink-0 items-center gap-4 overflow-hidden px-2 text-[18px]">
      <BmoFace mood={mood} scale={1.5} />
      <span className="shrink-0">{text}</span>
      {stats && member && (
        <span className="dim hidden truncate sm:inline">
          {stats.assets} files · {bytes(stats.bytes)}
        </span>
      )}
      <span className="flex-1" />
      <span className="dim hidden truncate lg:inline">{email}</span>
      <button type="button" className="chip shrink-0" onClick={() => setScanlines(!scanlines)} aria-pressed={scanlines}>
        scanlines
      </button>
      <button type="button" className="chip shrink-0" onClick={() => setTheme(nextTheme.id)} title={`switch to ${nextTheme.name}`}>
        {THEMES.find((t) => t.id === theme)?.name.toLowerCase()}
      </button>
    </footer>
  )
}
