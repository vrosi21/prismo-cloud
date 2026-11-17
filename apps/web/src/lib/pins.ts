import type { Item } from '../api'

// Pinned items make the quick-view board on the lookout wall. A pin is a
// tag, "pin:<section>" ("pin:labs", "pin:tests & exams"), so it travels with
// the item, in bundles too, and needs nothing of its own on the server. The
// board groups pins by category (the item's plain tags), then by section.

const PIN = 'pin:'

/** The section an item is pinned in, or null. */
export const pinOf = (it: Pick<Item, 'tags'>) => (it.tags ?? []).find((t) => t.startsWith(PIN))?.slice(PIN.length) ?? null

/** Tags with the item pinned in that section, or not pinned at all (null). */
export const withPin = (tags: string[], section: string | null) => [
  ...tags.filter((t) => !t.startsWith(PIN)),
  ...(section ? [`${PIN}${section.trim().toLowerCase()}`] : []),
]

/** Every section in use, in order. */
export const sectionsOf = (items: Item[]) => [...new Set(items.map(pinOf).filter((s): s is string => Boolean(s)))].sort()
