import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Calendar, type CalendarGroup, type Item } from '../api'
import { facetsOf, topsOf, NONE } from './categories'
import { useFolderTree } from './queries'

// Calendars, the way Google has them: each category (a plain tag on items,
// lib/categories.ts) is a calendar with a colour, in a group. Tags inside it
// ("type:exam") can have their own colour, as an event can in Google; an
// item's own colour beats both. Settings live on the server (/v1/calendars),
// so the phone and the PC agree. The row "*" holds the colours by tag that
// every calendar shares.

export const GROUPS: { id: CalendarGroup; label: string }[] = [
  { id: 'me', label: 'me' },
  { id: 'study', label: 'study' },
  { id: 'work', label: 'work' },
  { id: 'projects', label: 'projects' },
]

/** Shared colours by tag until the owner sets their own ("*"). */
export const DEFAULT_TAG_COLORS: Record<string, number> = {
  'type:exam': 1,
  'type:deadline': 2,
  'type:test': 2,
  'type:errand': 3,
  'type:workout': 4,
  'type:lab': 5,
  'type:appointment': 6,
}

export const ALL = '*'

export function useCalendars() {
  const { data = [] } = useQuery({ queryKey: ['calendars'], queryFn: api.calendars, staleTime: 60_000 })
  return useMemo(() => new Map(data.map((c) => [c.tag, c])), [data])
}

export function useSaveCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Pick<Calendar, 'tag' | 'name' | 'color' | 'group' | 'tag_colors'>) => api.putCalendar(c),
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendars'] }),
  })
}

/**
 * The group of each calendar: its own setting; else "projects" when its
 * items live under a folder called projects (the project boards do); else "me".
 */
export function useGroupOf(items: Item[]) {
  const cals = useCalendars()
  const tree = useFolderTree()
  const inProjects = useMemo(() => {
    const out = new Set<string>()
    for (const it of items) {
      const path = it.collection_id ? tree.byId.get(it.collection_id)?.path : undefined
      if (path && /^projects( \/ |$)/i.test(path)) for (const t of topsOf(it)) out.add(t)
    }
    return out
  }, [items, tree])
  return useCallback((tag: string): CalendarGroup => cals.get(tag)?.group ?? (inProjects.has(tag) ? 'projects' : 'me'), [cals, inProjects])
}

/** The colour an item shows in, 1 to 6, or null for the theme's accent. */
export function useColorOf() {
  const cals = useCalendars()
  return useCallback(
    (it: Pick<Item, 'tags' | 'color'>): number | null => {
      if (it.color) return it.color
      const shared = { ...DEFAULT_TAG_COLORS, ...(cals.get(ALL)?.tag_colors ?? {}) }
      const facets = facetsOf(it)
      for (const top of topsOf(it)) {
        if (top === NONE) continue
        const own = cals.get(top)?.tag_colors ?? {}
        const hit = facets.find((f) => own[f])
        if (hit) return own[hit]
      }
      const sharedHit = facets.find((f) => shared[f])
      if (sharedHit) return shared[sharedHit]
      for (const top of topsOf(it)) {
        const c = cals.get(top)?.color
        if (c) return c
      }
      return null
    },
    [cals],
  )
}

/** A calendar's name to show: its own, else the tag. */
export const nameOf = (tag: string, cals: Map<string, Calendar>) => (tag === NONE ? 'no category' : cals.get(tag)?.name || tag)
