import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Asset } from '../api'
import { endAssetDrag, startAssetDrag } from '../lib/drag'
import { displayName, duration } from '../lib/format'
import { focusEl } from '../lib/spatial'
import { BmoFace, Check, Cube, FileIcon } from './sprites'

const GAP = 20
const MIN_TILE = 168
const CAPTION = 29 // the name bar under each picture (.card-name)

/** How a click changes the selection. */
export type SelectMode = 'toggle' | 'range'

interface GalleryProps {
  assets: Asset[]
  selected: Set<string>
  /** false where there is nothing to do with a selection (shared views). */
  selectable?: boolean
  /** Shown above the files and scrolls away with them: subfolders, notes. */
  header?: ReactNode
  /** Shown instead of files when there are none. */
  empty?: ReactNode
  onOpen: (asset: Asset) => void
  onSelect: (asset: Asset, mode: SelectMode) => void
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  /** Put keyboard focus on this file's tile (n changes to ask again). */
  focus?: { id: string; n: number } | null
}

// Only the rows near the viewport exist in the DOM. A library of 50,000
// items scrolls like one of 50, because the page never holds more than a
// few dozen tiles at once.
export function Gallery({ assets, selected, selectable = true, header, empty, onOpen, onSelect, hasMore, loadingMore, loadMore, focus }: GalleryProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // How far below the top of the scroll area the files start: the header
  // above them is of unknown height, and the virtual list must be told.
  const [offset, setOffset] = useState(0)

  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    // Measure once right away: the observer only reports on the next frame,
    // and a background tab may not draw one for a long time.
    const measure = () => {
      setWidth(el.clientWidth)
      setOffset(el.offsetTop)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.previousElementSibling) ro.observe(el.previousElementSibling)
    return () => ro.disconnect()
  }, [])

  const cols = Math.max(2, Math.floor((width + GAP) / (MIN_TILE + GAP)))
  const tile = width > 0 ? Math.floor((width - GAP * (cols - 1)) / cols) : MIN_TILE
  const rowHeight = tile + CAPTION + GAP
  const rows = Math.ceil(assets.length / cols)

  const virtual = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin: offset,
  })
  useEffect(() => {
    virtual.measure()
  }, [rowHeight, virtual])

  const items = virtual.getVirtualItems()
  const lastRow = items.length > 0 ? items[items.length - 1].index : -1
  useEffect(() => {
    if (hasMore && !loadingMore && lastRow >= rows - 2) loadMore()
  }, [lastRow, rows, hasMore, loadingMore, loadMore])

  const selecting = selected.size > 0

  // Arrows move through the grid by position in the list, so a tile that is
  // not drawn yet (far down the virtual list) can still be reached: scroll
  // its row in, then focus it once it exists. Past the edge of the grid the
  // key is left to the page, which moves on to the sidebar or the toolbar.
  const pending = useRef<number | null>(null)
  const focusIndex = useCallback(
    (i: number) => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)
      if (el) {
        pending.current = null
        focusEl(el)
      } else {
        pending.current = i
        virtual.scrollToIndex(Math.floor(i / cols), { align: 'auto' })
      }
    },
    [virtual, cols],
  )
  useEffect(() => {
    const i = pending.current
    if (i === null) return
    if (i < assets.length) focusIndex(i)
    else if (!hasMore && !loadingMore) focusIndex(assets.length - 1)
  })
  const latest = useRef({ assets, focusIndex })
  latest.current = { assets, focusIndex }
  useEffect(() => {
    if (!focus) return
    const i = latest.current.assets.findIndex((a) => a.id === focus.id)
    if (i >= 0) latest.current.focusIndex(i)
  }, [focus])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = e.target instanceof HTMLElement ? e.target.dataset.index : undefined
    if (at === undefined || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const i = Number(at)
    const n = assets.length
    const col = i % cols
    let next: number | null = null
    if (e.key === 'ArrowDown' && Math.floor(i / cols) < Math.floor((n - 1) / cols)) next = Math.min(i + cols, n - 1)
    else if (e.key === 'ArrowUp' && i >= cols) next = i - cols
    else if (e.key === 'ArrowRight' && col < cols - 1 && i + 1 < n) next = i + 1
    else if (e.key === 'ArrowLeft' && col > 0) next = i - 1
    if (next === null && e.key === 'ArrowDown' && hasMore) {
      // The last row so far: fetch more and go down once they are in.
      e.preventDefault()
      pending.current = i + cols
      if (!loadingMore) loadMore()
      return
    }
    if (next === null) return
    e.preventDefault()
    focusIndex(next)
  }

  return (
    <div ref={scroller} className="screen-door relative h-full overflow-y-auto px-3 pt-3" onKeyDown={onKeyDown}>
      <div>{header}</div>
      <div ref={track} className="relative" style={{ height: virtual.getTotalSize() }}>
        {items.map((row) => (
          <div
            key={row.key}
            className="absolute left-0 top-0 flex w-full"
            style={{ transform: `translateY(${row.start - offset}px)`, gap: GAP, height: rowHeight }}
          >
            {assets.slice(row.index * cols, row.index * cols + cols).map((asset, j) => (
              <AssetCard
                key={asset.id}
                index={row.index * cols + j}
                asset={asset}
                size={tile}
                selected={selected.has(asset.id)}
                selection={selected}
                selecting={selecting}
                selectable={selectable}
                onOpen={onOpen}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>
      {assets.length === 0 && empty}
      {loadingMore && (
        <div className="flex justify-center py-6">
          <Cube size={28} label="loading more" />
        </div>
      )}
    </div>
  )
}

interface CardProps {
  index: number
  asset: Asset
  size: number
  selected: boolean
  selection: Set<string>
  selecting: boolean
  selectable: boolean
  onOpen: (asset: Asset) => void
  onSelect: (asset: Asset, mode: SelectMode) => void
}

function AssetCard({ index, asset, size, selected, selection, selecting, selectable, onOpen, onSelect }: CardProps) {
  const [hover, setHover] = useState(false)
  const ready = asset.status === 'ready'
  const still = asset.urls.thumb ?? (asset.kind === 'image' || asset.kind === 'sticker' ? asset.urls.file : undefined)
  // Animations play on hover only; a wall of moving GIFs is hard to look at
  // and costly to decode.
  const moving = hover && ready && (asset.kind === 'gif' || asset.kind === 'video')
  const clip = asset.urls.mp4 ?? (asset.kind === 'video' ? asset.urls.file : undefined)

  // Like a file manager: Ctrl adds or removes one, Shift takes everything
  // from the last one clicked to this one. A plain click opens the file,
  // unless a selection is already under way; then it adds to it.
  const click = (e: MouseEvent) => {
    if (!selectable) return onOpen(asset)
    if (e.shiftKey) return onSelect(asset, 'range')
    if (e.ctrlKey || e.metaKey || selecting) return onSelect(asset, 'toggle')
    onOpen(asset)
  }

  return (
    <div style={{ width: size }} className="shrink-0">
      <div
        role="button"
        tabIndex={0}
        data-nav-item
        data-index={index}
        aria-label={`${displayName(asset)}${selected ? ', selected' : ''}`}
        data-selected={selected || undefined}
        className="card group"
        style={{ width: size }}
        draggable={selectable}
        onDragStart={(e) => startAssetDrag(e, selected ? [...selection] : [asset.id])}
        onDragEnd={endAssetDrag}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={click}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(asset)
          if (e.key === ' ' && selectable) {
            e.preventDefault()
            onSelect(asset, e.shiftKey ? 'range' : 'toggle')
          }
        }}
      >
        <div className="card-thumb" style={{ height: size }}>
        {moving && clip ? (
          <video src={clip} poster={still} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        ) : moving && asset.urls.file ? (
          <img src={asset.urls.file} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : still ? (
          <img
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={`h-full w-full ${asset.kind === 'sticker' ? 'checker object-contain' : 'object-cover'}`}
          />
        ) : (
          <div className="pixel flex h-full w-full flex-col items-center justify-center gap-3 text-[9px] uppercase text-dim">
            {ready && (
              <>
                <FileIcon scale={4} />
                {asset.filename.includes('.') ? asset.filename.split('.').pop()?.slice(0, 5) : 'file'}
              </>
            )}
          </div>
        )}

        {asset.status === 'processing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-deep/85">
            <Cube size={30} label="processing" />
            <span className="text-[17px]">processing...</span>
          </div>
        )}
        {asset.status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-deep/90 px-2 text-center">
            <BmoFace mood="sad" />
            <span className="text-[17px] text-danger">{asset.error ?? 'failed'}</span>
          </div>
        )}

        <div className="pointer-events-none absolute left-[6px] top-[6px] flex gap-1">
          {asset.kind === 'gif' && <span className="badge">gif</span>}
          {asset.kind === 'sticker' && <span className="badge">sticker</span>}
          {asset.kind === 'video' && <span className="badge">{asset.duration_ms ? duration(asset.duration_ms) : 'vid'}</span>}
        </div>
        {asset.visibility !== 'private' && (
          <span
            className="badge pointer-events-none absolute bottom-[6px] left-[6px] !bg-accent !text-on-accent"
            title={asset.visibility === 'public' ? 'public: anyone can open it' : 'anyone who has the link can open it'}
          >
            {asset.visibility === 'public' ? 'public' : 'link'}
          </span>
        )}

        {selectable && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={selected ? 'deselect' : 'select'}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(asset, e.shiftKey ? 'range' : 'toggle')
            }}
            className={`absolute right-[6px] top-[6px] flex h-[22px] w-[22px] cursor-pointer items-center justify-center text-[18px] leading-none px ${
              selected ? 'bg-accent text-on-accent' : 'bg-panel text-ink opacity-0 focus:opacity-100 group-hover:opacity-100'
            } ${selecting ? '!opacity-100' : ''}`}
          >
            {selected && <Check />}
          </button>
        )}
        </div>
        <div className="card-name" title={displayName(asset)}>
          {displayName(asset)}
        </div>
      </div>
    </div>
  )
}
