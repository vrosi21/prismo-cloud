import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Item } from '../api'
import { COLORS, titleOf, useItemChanges, useItems, useWholeItem, openAnywhere, openOnLookout, openItem } from '../lib/items'
import type { Occurrence } from '../lib/days'
import { errorText, log } from '../lib/log'
import { dialog, menu, openMenu, type MenuEntry } from '../lib/menu'
import { openAt, skipAppearance } from '../lib/repeats'
import { pinOf, sectionsOf, withPin } from '../lib/pins'
import { useFolderTree } from '../lib/queries'
import { useStore } from '../lib/store'
import { useNarrow } from '../lib/narrow'
import { FolderPanel } from './FolderPanel'
import { FolderPick } from './FolderPick'

/** The right-click menu and the dialogs it opens. Mounted once, in the shell. */
export function Menus() {
  return (
    <>
      <ContextMenu />
      <Dialogs />
    </>
  )
}

function ContextMenu() {
  const m = useStore(menu)
  const narrow = useNarrow()
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)

  // Kept on screen: flipped to the left or up when it would run off an edge.
  useLayoutEffect(() => {
    if (!m || !box.current) return setAt(null)
    const r = box.current.getBoundingClientRect()
    const x = m.x + r.width > window.innerWidth - 8 ? Math.max(8, m.x - r.width) : m.x
    const y = m.y + r.height > window.innerHeight - 8 ? Math.max(8, m.y - r.height) : m.y
    setAt({ x, y })
  }, [m])
  // Focus once it is placed and visible: a hidden button takes no focus.
  useEffect(() => {
    if (at) box.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [at])

  useEffect(() => {
    if (!m) return
    const close = () => menu.set(null)
    // A phone's address bar or keyboard changes the height; only a real
    // change of width (a turned phone, a resized window) closes the menu.
    const width = window.innerWidth
    const onResize = () => window.innerWidth !== width && close()
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const all = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const i = all.indexOf(document.activeElement as HTMLButtonElement)
        all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', close)
      window.removeEventListener('wheel', close)
    }
  }, [m])

  if (!m) return null
  const run = (f: () => void) => () => {
    menu.set(null)
    f()
  }
  return (
    <div
      ref={box}
      className={`context-menu panel px-raised ${narrow ? 'sheet' : ''}`}
      role="menu"
      style={{ left: at?.x ?? m.x, top: at?.y ?? m.y, visibility: at ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {m.entries.map((e, i) =>
        e === 'sep' ? (
          <hr key={i} className="context-sep" />
        ) : 'heading' in e ? (
          <span key={i} className="context-heading">
            {e.heading}
          </span>
        ) : 'swatches' in e ? (
          <div key={i} className="flex gap-1 px-2 py-1">
            <button type="button" role="menuitem" className="swatch" title="no colour" aria-pressed={e.current === null} onClick={run(() => e.swatches(null))}>
              <span className="swatch-none" />
            </button>
            {COLORS.map((c) => (
              <button key={c.id} type="button" role="menuitem" className="swatch" title={c.label} aria-pressed={e.current === c.id} onClick={run(() => e.swatches(c.id))}>
                <span style={{ background: `var(--c${c.id})` }} />
              </button>
            ))}
          </div>
        ) : (
          <button key={i} type="button" role="menuitem" className="context-item" data-danger={e.danger || undefined} disabled={e.disabled} onClick={run(e.run)} title={e.hint}>
            {e.label}
          </button>
        ),
      )}
    </div>
  )
}

function Dialogs() {
  const d = useStore(dialog)
  const tree = useFolderTree()
  useEffect(() => {
    if (!d) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dialog.set(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [d])
  if (!d) return null
  const close = () => dialog.set(null)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 pt-[12dvh]" role="dialog" aria-modal="true" aria-label={d.kind === 'folder' ? `folder: ${d.action}` : 'move to a folder'}>
      <div className="absolute inset-0 bg-black/60" onClick={close} />
      <div className="relative w-full max-w-[620px]">
        {d.kind === 'folder' ? (
          <FolderPanel action={d.action} folder={d.folderId ? tree.byId.get(d.folderId) : undefined} onClose={close} />
        ) : (
          <MoveItem item={d.item} onClose={close} />
        )}
      </div>
    </div>
  )
}

function MoveItem({ item, onClose }: { item: Item; onClose: () => void }) {
  const whole = useWholeItem()
  return (
    <div className="panel px flex flex-wrap items-center gap-3 px-3 py-2">
      <span className="dim shrink-0">&gt; move "{titleOf(item)}" into:</span>
      <FolderPick
        value={item.collection_id}
        onPick={(to) => {
          if (to !== item.collection_id) void whole.move(item, to)
          onClose()
        }}
        className="!w-auto max-w-[340px]"
      />
      <button type="button" className="btn btn-sm" onClick={onClose}>
        cancel
      </button>
    </div>
  )
}

/**
 * The entries every item's menu shares: open it, its details, done or not,
 * pin it in a section, move it, trash it. A board in the trash takes nothing
 * else along from here; its header asks about its cards.
 */
export function useItemEntries() {
  const { update, trash } = useItemChanges()
  const whole = useWholeItem()
  const { data: all = [] } = useItems({})
  const sections = useMemo(() => sectionsOf(all), [all])
  return (it: Item, opts: { details?: boolean; move?: boolean } = {}): MenuEntry[] => {
    const pinned = pinOf(it)
    const pin = (s: string | null) => update.mutate({ id: it.id, change: { tags: withPin(it.tags ?? [], s) } })
    return [
      { label: 'open', run: () => (it.kind === 'notebook' || it.kind === 'board' ? openOnLookout(it.id) : openAnywhere(it)) },
      ...(opts.details !== false && it.kind !== 'notebook' && it.kind !== 'board' ? [{ label: 'open as a page', run: () => openOnLookout(it.id) }] : []),
      ...(opts.details !== false && (it.kind === 'notebook' || it.kind === 'board') ? [{ label: 'details', run: () => openItem.set(it.id) }] : []),
      ...(it.status ? [{ label: it.status === 'done' ? 'not done' : 'done', run: () => update.mutate({ id: it.id, change: { status: it.status === 'done' ? 'todo' : 'done' } }) }] : []),
      'sep' as const,
      ...(sections.length ? [{ heading: pinned ? `pinned in ${pinned}` : 'pin in' }] : []),
      ...sections.filter((s) => s !== pinned).map((s) => ({ label: s, run: () => pin(s) })),
      ...(pinned ? [{ label: 'unpin', run: () => pin(null) }] : []),
      { label: sections.length ? 'pin in a new section...' : 'pin...', run: () => openItem.set(it.id), hint: 'details > pinned' },
      'sep' as const,
      ...(opts.move !== false ? [{ label: 'move to folder...', run: () => dialog.set({ kind: 'move-item', item: it }) }] : []),
      { label: 'to the trash', danger: true, run: () => (it.kind === 'board' ? void whole.trash(it, false) : trash.mutate(it.id)) },
    ]
  }
}

/** A calendar appearance's menu: the item's, plus this one of a repeat. */
export function useOccurrenceMenu() {
  const itemEntries = useItemEntries()
  const qc = useQueryClient()
  return (e: ReactMouseEvent, o: Occurrence) => {
    const it = o.item
    const here = () => {
      openAt.set({ id: it.id, orig: o.orig })
      openItem.set(it.id)
    }
    const skip = async () => {
      try {
        await skipAppearance(it, o.orig, true)
        log('ok', 'skipped this one')
      } catch (err) {
        log('err', errorText(err))
      } finally {
        void qc.invalidateQueries({ queryKey: ['items'] })
      }
    }
    openMenu(e, [
      { label: 'open', run: here },
      ...(it.repeat ? ([{ label: 'move this one...', run: here, hint: 'the panel\'s "this one" row' }, { label: 'skip this one', run: () => void skip() }] as MenuEntry[]) : []),
      ...itemEntries(it, { details: false }).slice(1),
    ])
  }
}
