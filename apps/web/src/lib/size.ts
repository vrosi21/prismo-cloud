import { useEffect, useState, type RefObject } from 'react'

/** The size of an element in CSS pixels, kept up to date. Starts at the window's size. */
export function useSize(ref: RefObject<Element | null>): [number, number] {
  const [size, setSize] = useState<[number, number]>(() => [window.innerWidth, window.innerHeight])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setSize((old) => (old[0] === w && old[1] === h ? old : [w, h]))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
