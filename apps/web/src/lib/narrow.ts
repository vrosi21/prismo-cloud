import { useSyncExternalStore } from 'react'

// "Narrow" is a phone: up to 640px wide, the same line as the CSS in
// theme.css ("Phones"). For layout decided in code; looks are left to CSS.
const QUERY = '(max-width: 640px)'
const list = typeof window !== 'undefined' ? window.matchMedia(QUERY) : null

export const isNarrow = () => list?.matches ?? false

export function useNarrow(): boolean {
  return useSyncExternalStore(
    (on) => {
      list?.addEventListener('change', on)
      return () => list?.removeEventListener('change', on)
    },
    isNarrow,
    () => false,
  )
}
