import { Arrow, type ArrowDir } from './sprites'

export const ARROWS: ArrowDir[] = ['up', 'down', 'left', 'right']

/** A key on a pixel keyboard: an arrow, or its name (enter, ctrl...). */
export function KeyCap({ cap }: { cap: ArrowDir | string }) {
  const arrow = (ARROWS as string[]).includes(cap)
  return (
    <kbd className="key">
      {arrow ? <Arrow dir={cap as ArrowDir} /> : cap}
      {arrow && <span className="sr-only">{cap} arrow</span>}
    </kbd>
  )
}
