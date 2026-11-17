import type { Item } from '../api'
import { createStore } from './store'

// Categories come from items' tags, with no tree to set up. A plain tag
// ("dsai", "prismo") is a category. A "key:value" tag ("course:mai3",
// "type:exam") is a filter inside whichever categories the item has, so the
// calendar can offer DSAI > course > MAI3 and DSAI > type > exam on its own.
// An item with no plain tag is in "no category".

export const NONE = '' // the category of items without one

export interface Facet {
  key: string
  values: { value: string; count: number }[]
}
export interface Category {
  tag: string
  count: number
  facets: Facet[]
}

const isFacet = (t: string) => t.includes(':')
export const topsOf = (it: Pick<Item, 'tags'>) => {
  const tops = (it.tags ?? []).filter((t) => !isFacet(t))
  return tops.length ? tops : [NONE]
}
export const facetsOf = (it: Pick<Item, 'tags'>) => (it.tags ?? []).filter(isFacet)

/** Every category these items have, its count, and the facets inside it. */
export function categories(items: Item[]): Category[] {
  const map = new Map<string, { count: number; facets: Map<string, Map<string, number>> }>()
  for (const it of items) {
    for (const top of topsOf(it)) {
      const c = map.get(top) ?? { count: 0, facets: new Map() }
      c.count++
      for (const f of facetsOf(it)) {
        const [key, value] = [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)]
        const vals = c.facets.get(key) ?? new Map<string, number>()
        vals.set(value, (vals.get(value) ?? 0) + 1)
        c.facets.set(key, vals)
      }
      map.set(top, c)
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)))
    .map(([tag, c]) => ({
      tag,
      count: c.count,
      facets: [...c.facets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, vals]) => ({ key, values: [...vals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count })) })),
    }))
}

/** What is switched off: whole categories, and "category|key:value" facets. */
export interface Hidden {
  tops: string[]
  facets: string[]
}

const KEY = 'prismo.cal.hidden'
function load(): Hidden {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) ?? '') as Hidden
    if (Array.isArray(h.tops) && Array.isArray(h.facets)) return h
  } catch {
    /* nothing remembered */
  }
  return { tops: [], facets: [] }
}

export const hidden = createStore<Hidden>(load())
export function setHidden(next: Hidden) {
  hidden.set(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* not remembered */
  }
}

/** Shown if one of its categories is on and none of its facets is off there. */
export function shown(it: Pick<Item, 'tags'>, h: Hidden): boolean {
  if (h.tops.length === 0 && h.facets.length === 0) return true
  const facets = facetsOf(it)
  return topsOf(it).some((top) => !h.tops.includes(top) && facets.every((f) => !h.facets.includes(`${top}|${f}`)))
}
