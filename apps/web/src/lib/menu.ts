import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Item } from '../api'
import type { FolderAction } from '../components/FolderPanel'
import { createStore } from './store'

// Right-click menus. Whatever is right-clicked builds its list of entries
// and calls openMenu; one host (components/Menus.tsx) draws the menu at the
// pointer. Entries that need more than a click (a new name, a folder to
// move to) open a small dialog through the same host.

export type MenuEntry =
  | { label: string; run: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { heading: string }
  | { swatches: (color: number | null) => void; current?: number | null }
  | 'sep'

export const menu = createStore<{ x: number; y: number; entries: MenuEntry[] } | null>(null)

export type Dialog = { kind: 'folder'; action: FolderAction; folderId: string | null } | { kind: 'move-item'; item: Item }

export const dialog = createStore<Dialog | null>(null)

/**
 * Opens a menu at the pointer instead of the browser's. A right-click in a
 * text field keeps the browser's menu: copy and paste live there.
 */
export function openMenu(e: ReactMouseEvent, entries: MenuEntry[]) {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, [contenteditable="true"]') || entries.length === 0) return
  e.preventDefault()
  e.stopPropagation()
  menu.set({ x: e.clientX, y: e.clientY, entries })
}

/** The usual entries for a folder. */
export function folderEntries(folderId: string, extra: MenuEntry[] = []): MenuEntry[] {
  const open = (action: FolderAction) => () => dialog.set({ kind: 'folder', action, folderId })
  return [
    ...extra,
    { label: 'new folder inside', run: open('new') },
    { label: 'rename', run: open('rename') },
    { label: 'move', run: open('move') },
    'sep',
    { label: 'delete...', run: open('delete'), danger: true },
  ]
}
