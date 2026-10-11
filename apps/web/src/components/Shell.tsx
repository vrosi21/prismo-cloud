import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Me } from '../api'
import { bytes } from '../lib/format'
import { errorText, log, logLines } from '../lib/log'
import { useCollections, useRefreshLibrary, useStats } from '../lib/queries'
import { useStore } from '../lib/store'
import { setScanlines, setTheme, THEMES, useScanlines, useTheme } from '../lib/theme'
import { uploadFiles, uploads } from '../lib/uploads'
import { Boot, LogLines, Palette, UploadTray, type Command } from './Overlays'
import { BmoFace, Cube, type Mood } from './sprites'

const KINDS = [
  { id: 'image', label: 'images' },
  { id: 'gif', label: 'gifs' },
  { id: 'video', label: 'recordings' },
  { id: 'sticker', label: 'stickers' },
  { id: 'file', label: 'files' },
]

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const refresh = useRefreshLibrary()
  const picker = useRef<HTMLInputElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  const collection = params.get('collection')
  const targetCollection = collection && collection !== 'none' ? collection : null

  // New files go into the jar being looked at.
  const send = useCallback(
    (files: Iterable<File>) => uploadFiles(files, { collectionId: targetCollection, onStored: refresh }),
    [targetCollection, refresh],
  )

  // Drop a file anywhere, or paste a screenshot with Ctrl+V.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
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

  const search = useCallback(
    (text: string) => navigate(text ? `/?q=${encodeURIComponent(text)}` : '/'),
    [navigate],
  )

  const commands = useMemo<Command[]>(
    () => [
      { id: 'upload', label: 'wish upload', hint: 'pick files', run: () => picker.current?.click() },
      { id: 'library', label: 'go library', run: () => navigate('/') },
      ...KINDS.map((k) => ({ id: `kind-${k.id}`, label: `show ${k.label}`, run: () => navigate(`/?kind=${k.id}`) })),
      { id: 'trash', label: 'go trash', run: () => navigate('/trash') },
      { id: 'settings', label: 'go settings', run: () => navigate('/settings') },
      ...THEMES.map((t) => ({ id: `theme-${t.id}`, label: `theme ${t.name.toLowerCase()}`, hint: t.hint, run: () => setTheme(t.id) })),
      { id: 'scanlines', label: 'toggle scanlines', run: () => setScanlines(document.documentElement.dataset.scanlines !== 'on') },
    ],
    [navigate],
  )

  return (
    <div className="relative z-10 flex h-full flex-col">
      <Boot />
      <header className="panel px relative z-20 mx-3 mt-3 flex items-center gap-3 px-3 py-2">
        <button type="button" className="btn btn-sm md:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          menu
        </button>
        <Link to="/" className="flex items-center gap-3" aria-label="Prismo Cloud, library">
          <Cube size={22} still />
          <h1 className="hidden sm:block">PRISMO CLOUD</h1>
        </Link>
        <SearchBox key={params.get('q') ?? ''} initial={params.get('q') ?? ''} onSearch={search} />
        <button type="button" className="btn hidden sm:inline-flex" onClick={() => setPaletteOpen(true)} title="commands (Ctrl+K)">
          ctrl+k
        </button>
        <button type="button" className="btn btn-accent" onClick={() => picker.current?.click()}>
          make a wish
        </button>
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
        <Sidebar open={menuOpen} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <StatusBar email={me.user.email} />
      <LogLines />
      <UploadTray />
      {paletteOpen && <Palette commands={commands} onSearch={search} onClose={() => setPaletteOpen(false)} />}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
          <div className="panel px-raised flex flex-col items-center gap-5 px-10 py-8">
            <Cube size={56} />
            <h1>drop to make a wish</h1>
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
        aria-label="search library"
      />
    </form>
  )
}

function NavItem({ to, active, count, children }: { to: string; active: boolean; count?: number; children: ReactNode }) {
  return (
    <Link to={to} className="nav-item" aria-current={active ? 'page' : undefined}>
      <span className="truncate">{children}</span>
      {count !== undefined && <span className="opacity-70">{count}</span>}
    </Link>
  )
}

function Sidebar({ open }: { open: boolean }) {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const { data: collections = [] } = useCollections()
  const { data: stats } = useStats()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const create = useMutation({
    mutationFn: (n: string) => api.createCollection(n),
    onSuccess: () => {
      setAdding(false)
      setName('')
      void qc.invalidateQueries({ queryKey: ['collections'] })
    },
    onError: (e) => log('err', errorText(e)),
  })

  const home = pathname === '/'
  const kind = home ? params.get('kind') : null
  const collection = home ? params.get('collection') : null
  const filtered = Boolean(kind || collection || params.get('q') || params.get('tag'))

  return (
    <nav
      className={`panel px w-[230px] shrink-0 flex-col gap-4 overflow-y-auto py-3 md:flex ${
        open ? 'absolute bottom-[52px] left-3 top-[70px] z-30 flex' : 'hidden'
      }`}
      aria-label="library"
    >
      <div>
        <NavItem to="/" active={home && !filtered} count={stats?.assets}>
          everything
        </NavItem>
        {KINDS.map((k) => (
          <NavItem key={k.id} to={`/?kind=${k.id}`} active={kind === k.id}>
            {k.label}
          </NavItem>
        ))}
      </div>

      <div>
        <h3 className="dim px-[10px] pb-2">PICKLE JARS</h3>
        {collections.map((c) => (
          <NavItem key={c.id} to={`/?collection=${c.id}`} active={collection === c.id} count={c.count}>
            {c.name}
          </NavItem>
        ))}
        <NavItem to="/?collection=none" active={collection === 'none'}>
          no jar
        </NavItem>
        {adding ? (
          <form
            className="px-[10px] pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) create.mutate(name.trim())
            }}
          >
            <input
              className="field"
              autoFocus
              value={name}
              maxLength={60}
              placeholder="jar name"
              aria-label="new jar name"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name.trim() && setAdding(false)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            />
          </form>
        ) : (
          <button type="button" className="nav-item dim" onClick={() => setAdding(true)}>
            + new jar
          </button>
        )}
      </div>

      <div className="mt-auto">
        <NavItem to="/trash" active={pathname === '/trash'} count={stats?.trashed || undefined}>
          trash
        </NavItem>
        <NavItem to="/settings" active={pathname === '/settings'}>
          settings
        </NavItem>
      </div>
    </nav>
  )
}

function StatusBar({ email }: { email: string }) {
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
    if (sending > 0) return ['busy', `sending ${sending}`]
    if (processing > 0) return ['busy', `processing ${processing}`]
    if (lines.some((l) => l.level === 'ok')) return ['happy', 'wish granted']
    return ['idle', 'ready']
  }
  const [mood, text] = status()

  const nextTheme = THEMES[(THEMES.findIndex((t) => t.id === theme) + 1) % THEMES.length]

  return (
    <footer className="panel px relative z-20 mx-3 mb-3 flex h-[30px] shrink-0 items-center gap-4 overflow-hidden px-2 text-[18px]">
      <BmoFace mood={mood} scale={1.5} />
      <span className="shrink-0">{text}</span>
      {stats && (
        <span className="dim hidden truncate sm:inline">
          {stats.assets} items · {bytes(stats.bytes)}
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
