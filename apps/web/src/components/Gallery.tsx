import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Asset } from '../api'
import { displayName, duration } from '../lib/format'
import { BmoFace, Cube } from './sprites'

const GAP = 20
const MIN_TILE = 168
const CAPTION = 26

interface GalleryProps {
  assets: Asset[]
  selected: Set<string>
  onOpen: (asset: Asset) => void
  onToggle: (id: string) => void
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
}

// Only the rows near the viewport exist in the DOM. A library of 50,000
// items scrolls like one of 50, because the page never holds more than a
// few dozen tiles at once.
export function Gallery({ assets, selected, onOpen, onToggle, hasMore, loadingMore, loadMore }: GalleryProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    // Measure once right away: the observer only reports on the next frame,
    // and a background tab may not draw one for a long time.
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
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

  return (
    <div ref={scroller} className="h-full overflow-y-auto px-2 pt-2">
      <div ref={track} className="relative" style={{ height: virtual.getTotalSize() }}>
        {items.map((row) => (
          <div
            key={row.key}
            className="absolute left-0 top-0 flex w-full"
            style={{ transform: `translateY(${row.start}px)`, gap: GAP, height: rowHeight }}
          >
            {assets.slice(row.index * cols, row.index * cols + cols).map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                size={tile}
                selected={selected.has(asset.id)}
                selecting={selecting}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </div>
        ))}
      </div>
      {loadingMore && (
        <div className="flex justify-center py-6">
          <Cube size={28} label="loading more" />
        </div>
      )}
    </div>
  )
}

interface CardProps {
  asset: Asset
  size: number
  selected: boolean
  selecting: boolean
  onOpen: (asset: Asset) => void
  onToggle: (id: string) => void
}

function AssetCard({ asset, size, selected, selecting, onOpen, onToggle }: CardProps) {
  const [hover, setHover] = useState(false)
  const ready = asset.status === 'ready'
  const still = asset.urls.thumb ?? (asset.kind === 'image' || asset.kind === 'sticker' ? asset.urls.file : undefined)
  // Animations play on hover only; a wall of moving GIFs is hard to look at
  // and costly to decode.
  const moving = hover && ready && (asset.kind === 'gif' || asset.kind === 'video')
  const clip = asset.urls.mp4 ?? (asset.kind === 'video' ? asset.urls.file : undefined)

  return (
    <div style={{ width: size }} className="shrink-0">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${displayName(asset)}${selected ? ', selected' : ''}`}
        className={`group relative block cursor-pointer overflow-hidden bg-bg-deep ${selected ? 'px-accent' : 'px'}`}
        style={{ width: size, height: size }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => (selecting ? onToggle(asset.id) : onOpen(asset))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(asset)
          if (e.key === ' ') {
            e.preventDefault()
            onToggle(asset.id)
          }
        }}
      >
        {moving && clip ? (
          <video src={clip} poster={still} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        ) : moving && asset.urls.file ? (
          <img src={asset.urls.file} alt="" className="h-full w-full object-cover" />
        ) : still ? (
          <img src={still} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="pixel flex h-full w-full items-center justify-center text-[11px] uppercase text-dim">
            {ready ? asset.filename.split('.').pop()?.slice(0, 5) || 'file' : ''}
          </div>
        )}

        {asset.status === 'processing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-deep/85">
            <Cube size={30} label="processing" />
            <span className="text-[17px]">granting...</span>
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
          {asset.kind === 'sticker' && <span className="badge">stk</span>}
          {asset.kind === 'video' && <span className="badge">{asset.duration_ms ? duration(asset.duration_ms) : 'vid'}</span>}
        </div>
        {asset.visibility !== 'private' && (
          <span className="badge pointer-events-none absolute bottom-[6px] left-[6px] !bg-accent !text-on-accent">
            {asset.visibility === 'public' ? 'public' : 'link'}
          </span>
        )}

        <button
          type="button"
          aria-label={selected ? 'deselect' : 'select'}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(asset.id)
          }}
          className={`absolute right-[6px] top-[6px] flex h-[22px] w-[22px] cursor-pointer items-center justify-center text-[18px] leading-none px ${
            selected ? 'bg-accent text-on-accent' : 'bg-panel text-ink opacity-0 focus:opacity-100 group-hover:opacity-100'
          } ${selecting ? '!opacity-100' : ''}`}
        >
          {selected ? 'x' : ''}
        </button>
      </div>
      <div className="mt-[7px] truncate text-[18px]" title={displayName(asset)}>
        {displayName(asset)}
      </div>
    </div>
  )
}
