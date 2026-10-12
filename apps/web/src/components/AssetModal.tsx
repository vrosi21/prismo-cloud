import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type Asset, type AssetPatch, type BulkAction, type Kind, type Visibility } from '../api'
import type { FolderNode } from '../lib/folders'
import { bytes, copyImage, copyText, displayName, duration, when } from '../lib/format'
import { errorText, log } from '../lib/log'
import { useRefreshLibrary } from '../lib/queries'
import { ShareDialog } from './ShareDialog'

// Only fetched when somebody makes a sticker.
const StickerMaker = lazy(() => import('./StickerMaker').then((m) => ({ default: m.StickerMaker })))

interface Props {
  asset: Asset
  /** Folders the file can be moved to, with their paths. */
  folders: FolderNode[]
  onClose: () => void
  onStep: (direction: 1 | -1) => void
}

const VISIBILITY_HINT: Record<Visibility, string> = {
  private: 'only you, signed in',
  unlisted: 'anyone who has the link',
  public: 'anyone, and may be indexed',
}

export function AssetModal({ asset, folders, onClose, onStep }: Props) {
  // Scanlines are chrome; switch them off while a picture is being looked at.
  useEffect(() => {
    document.documentElement.dataset.viewer = 'open'
    return () => {
      delete document.documentElement.dataset.viewer
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select')
      if (e.key === 'Escape') onClose()
      else if (!typing && e.key === 'ArrowRight') onStep(1)
      else if (!typing && e.key === 'ArrowLeft') onStep(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-8" role="dialog" aria-modal="true" aria-label={displayName(asset)}>
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="panel px pop relative flex max-h-full w-full max-w-[1180px] flex-col overflow-hidden md:flex-row">
        <div className="relative flex min-h-[220px] flex-1 items-center justify-center bg-bg-deep p-3 md:min-h-[480px]">
          <Preview asset={asset} />
          <button type="button" className="btn btn-sm absolute left-3 top-1/2" onClick={() => onStep(-1)} aria-label="previous">
            &lt;
          </button>
          <button type="button" className="btn btn-sm absolute right-3 top-1/2" onClick={() => onStep(1)} aria-label="next">
            &gt;
          </button>
        </div>
        {/* key: a fresh form per asset, so typed text never leaks to the next one */}
        <Details key={asset.id} asset={asset} folders={folders} onClose={onClose} />
      </div>
    </div>
  )
}

function Preview({ asset }: { asset: Asset }) {
  if (asset.status !== 'ready' || !asset.urls.file) {
    return <p className="dim">{asset.status === 'failed' ? `> ${asset.error ?? 'failed'}` : '> still being granted...'}</p>
  }
  if (asset.kind === 'video') {
    return (
      <video
        key={asset.id}
        src={asset.urls.mp4 ?? asset.urls.file}
        poster={asset.urls.thumb}
        controls
        autoPlay
        muted
        loop
        playsInline
        className="max-h-[78vh] max-w-full"
      />
    )
  }
  if (asset.kind === 'file') {
    return <p className="dim">&gt; no preview for {asset.mime}</p>
  }
  return <img key={asset.id} src={asset.urls.file} alt={displayName(asset)} className="max-h-[78vh] max-w-full object-contain" />
}

function Details({ asset, folders, onClose }: { asset: Asset; folders: FolderNode[]; onClose: () => void }) {
  const refresh = useRefreshLibrary()
  const [title, setTitle] = useState(asset.title)
  const [tags, setTags] = useState(asset.tags.join(', '))
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [making, setMaking] = useState(false)
  const stopMaking = useCallback(() => setMaking(false), [])
  const trashed = asset.deleted_at !== null
  // owner: everything. edit: rename, tag, trash. view: look and download.
  const owner = asset.access === 'owner'
  const canEdit = owner || asset.access === 'edit'

  const save = useMutation({
    mutationFn: (patch: AssetPatch) => api.patchAsset(asset.id, patch),
    onSuccess: refresh,
    onError: (e) => log('err', errorText(e)),
  })
  const bulk = useMutation({
    mutationFn: (change: BulkAction) => api.bulk([asset.id], change),
    onSuccess: (_, change) => {
      refresh()
      onClose()
      log('ok', change.action === 'restore' ? 'restored' : 'gone for good')
    },
    onError: (e) => log('err', errorText(e)),
  })
  const trash = useMutation({
    mutationFn: () => api.trashAsset(asset.id),
    onSuccess: () => {
      refresh()
      onClose()
      log('ok', 'moved to trash')
    },
    onError: (e) => log('err', errorText(e)),
  })

  const saveTags = () => {
    const next = [...new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
    if (next.join(',') !== asset.tags.join(',')) save.mutate({ tags: next })
  }

  const copy = async (label: string, text: string | undefined) => {
    if (!text) return
    const ok = await copyText(text)
    log(ok ? 'ok' : 'err', ok ? `${label} copied` : 'clipboard refused')
  }

  const copyPicture = async () => {
    const ok = await copyImage(asset.urls.file!)
    log(ok ? 'ok' : 'err', ok ? 'image on clipboard: paste it anywhere' : 'this browser refused to copy the image')
  }

  // A private asset has a link that only works for its owner, so sharing
  // first makes it unlisted.
  const share = async (label: string, url: string | undefined) => {
    if (asset.visibility === 'private') await save.mutateAsync({ visibility: 'unlisted' })
    await copy(label, url)
  }

  const isPicture = asset.kind === 'image' || asset.kind === 'sticker'
  const facts = [
    asset.mime,
    asset.width && asset.height ? `${asset.width}x${asset.height}` : null,
    asset.duration_ms ? duration(asset.duration_ms) : null,
    bytes(asset.bytes),
  ].filter(Boolean)

  return (
    <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto p-5 md:w-[360px]">
      <div className="flex items-start justify-between gap-3">
        <h2 className="break-all">{displayName(asset)}</h2>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="close">
          x
        </button>
      </div>
      <p className="dim text-[18px] leading-tight">
        {facts.join(' · ')}
        <br />
        added {when(asset.created_at)}
        {owner && ` · via ${asset.source}`}
      </p>
      {!owner && <p className="dim text-[17px]">&gt; shared with you: {canEdit ? 'you may rename, tag and move it to trash' : 'view only'}.</p>}

      {canEdit && (
        <>
          <label>
            <span className="label">title</span>
            <input
              className="field"
              value={title}
              placeholder={asset.filename}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== asset.title && save.mutate({ title })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>

          <label>
            <span className="label">tags, comma separated</span>
            <input
              className="field"
              value={tags}
              placeholder="cat, reaction"
              onChange={(e) => setTags(e.target.value)}
              onBlur={saveTags}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        </>
      )}

      {owner && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className="label">folder</span>
              <select className="field" value={asset.collection_id ?? ''} onChange={(e) => save.mutate({ collection_id: e.target.value || null })}>
                <option value="">none (top level)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.path}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">anyone with link</span>
              <select className="field" value={asset.visibility} onChange={(e) => save.mutate({ visibility: e.target.value as Visibility })}>
                <option value="private">private</option>
                <option value="unlisted">unlisted</option>
                <option value="public">public</option>
              </select>
            </label>
          </div>
          <p className="dim -mt-2 text-[17px]">&gt; {VISIBILITY_HINT[asset.visibility]}</p>

          {/* The cloud works this out from the file; where it guessed wrong, say so here. */}
          {(isPicture || asset.kind === 'gif') && (
            <label>
              <span className="label">listed as</span>
              <select className="field" value={asset.kind} onChange={(e) => save.mutate({ kind: e.target.value as Kind })}>
                <option value="image">picture</option>
                <option value="gif">gif</option>
                <option value="sticker">sticker</option>
              </select>
            </label>
          )}
        </>
      )}

      {!trashed && asset.status === 'ready' && (
        <div className="flex flex-wrap gap-x-3 gap-y-4 pt-1">
          {owner && (
            <>
              <button type="button" className="btn btn-accent" onClick={() => share('link', asset.urls.raw)}>
                {asset.visibility === 'private' ? 'share + copy link' : 'copy link'}
              </button>
              {asset.variants.includes('gif') && (
                <button type="button" className="btn" onClick={() => share('gif link', asset.urls.raw_gif)}>
                  copy gif link
                </button>
              )}
              <button type="button" className="btn" onClick={() => share('page link', asset.urls.share)}>
                copy page link
              </button>
              <button type="button" className="btn" onClick={() => setSharing(true)}>
                share with a person
              </button>
            </>
          )}
          {isPicture && (
            <button type="button" className="btn" onClick={copyPicture}>
              copy image
            </button>
          )}
          {isPicture && owner && (
            <button type="button" className="btn" onClick={() => setMaking(true)} title="crop it, take the background away, save it as a new sticker">
              make sticker
            </button>
          )}
          <a className="btn" href={`${asset.urls.file}&download=1`}>
            download
          </a>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-4 pt-3">
        {!trashed ? (
          canEdit && (
            <button type="button" className="btn" disabled={trash.isPending} onClick={() => trash.mutate()}>
              move to trash
            </button>
          )
        ) : confirmPurge ? (
          <>
            <p className="w-full text-danger">&gt; careful: this cannot be undone.</p>
            <button type="button" className="btn btn-danger" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'purge' })}>
              delete forever
            </button>
            <button type="button" className="btn" onClick={() => setConfirmPurge(false)}>
              keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-accent" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'restore' })}>
              restore
            </button>
            <button type="button" className="btn" onClick={() => setConfirmPurge(true)}>
              delete forever
            </button>
          </>
        )}
      </div>

      {sharing && <ShareDialog target={{ asset_id: asset.id }} name={displayName(asset)} onClose={() => setSharing(false)} />}
      {making && (
        <Suspense fallback={null}>
          <StickerMaker asset={asset} onClose={stopMaking} />
        </Suspense>
      )}
    </div>
  )
}
