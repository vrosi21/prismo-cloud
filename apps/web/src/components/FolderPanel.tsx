import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { isInside, type FolderNode } from '../lib/folders'
import { useItems } from '../lib/items'
import { errorText, log } from '../lib/log'
import { useFolderTree, useRefreshLibrary } from '../lib/queries'

export type FolderAction = 'new' | 'rename' | 'move' | 'delete'

interface Props {
  action: FolderAction
  /** The folder acted on; for "new", the one the new folder goes in (undefined: the top level). */
  folder: FolderNode | undefined
  onClose: () => void
  onDeleted?: (parentId: string | null) => void
}

/**
 * The one thing being done to a folder: a new one inside it, a new name,
 * another place, or deleting it. The library shows it under its header,
 * the side panels in a small dialog. Deleting says what is inside, files and
 * notebooks, boards and tasks alike, and lets them move up or go to the trash.
 */
export function FolderPanel({ action, folder, onClose, onDeleted }: Props) {
  const tree = useFolderTree()
  const refresh = useRefreshLibrary()
  const qc = useQueryClient()
  const { data: items = [] } = useItems({}, action === 'delete')
  const [name, setName] = useState(action === 'rename' ? (folder?.name ?? '') : '')
  const [dest, setDest] = useState<string>(folder?.parent_id ?? 'top')
  const fail = (e: unknown) => log('err', errorText(e))
  const done = () => {
    refresh()
    void qc.invalidateQueries({ queryKey: ['items'] })
    onClose()
  }

  const create = useMutation({ mutationFn: () => api.createFolder(name.trim(), folder?.id ?? null), onSuccess: done, onError: fail })
  const rename = useMutation({ mutationFn: () => api.updateFolder(folder!.id, { name: name.trim() }), onSuccess: done, onError: fail })
  const move = useMutation({
    mutationFn: () => api.updateFolder(folder!.id, { parent_id: dest === 'top' ? null : dest }),
    onSuccess: done,
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (trash: boolean) => api.deleteFolder(folder!.id, trash),
    onSuccess: (_, trash) => {
      log('ok', trash ? 'folder deleted; what was in it is in the trash' : 'folder deleted; what was in it moved up')
      refresh()
      void qc.invalidateQueries({ queryKey: ['items'] })
      onDeleted?.(folder!.parent_id)
      onClose()
    },
    onError: fail,
  })

  const submit = (run: () => void) => (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) run()
  }

  // What is in this folder and everything below it.
  const below = folder ? tree.flat.filter((f) => isInside(tree, f.id, folder.id)) : []
  const ids = new Set(below.map((f) => f.id))
  const files = below.reduce((n, f) => n + f.count, 0)
  const things = items.filter((it) => it.collection_id && ids.has(it.collection_id)).length
  const subfolders = below.length - 1
  const inside = [files ? `${files} file${files === 1 ? '' : 's'}` : '', things ? `${things} notebook${things === 1 ? '' : 's'}, board${things === 1 ? '' : 's'} or task${things === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' and ')

  return (
    <div className="panel px flex flex-wrap items-center gap-x-3 gap-y-3 px-3 py-2">
      {(action === 'new' || action === 'rename') && (
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-3" onSubmit={submit(() => (action === 'new' ? create.mutate() : rename.mutate()))}>
          <span className="dim shrink-0">&gt; {action === 'new' ? `new folder${folder ? ` in ${folder.name}` : ''}:` : `new name for "${folder?.name}":`}</span>
          <input
            className="field min-w-[160px] max-w-[340px] flex-1"
            autoFocus
            value={name}
            maxLength={60}
            aria-label="folder name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          <button type="submit" className="btn btn-sm btn-accent" disabled={!name.trim() || create.isPending || rename.isPending}>
            {action === 'new' ? 'create' : 'rename'}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            cancel
          </button>
        </form>
      )}

      {action === 'move' && folder && (
        <>
          <span className="dim shrink-0">&gt; move "{folder.name}" into:</span>
          <select className="field !w-auto max-w-[340px]" value={dest} aria-label="destination" onChange={(e) => setDest(e.target.value)}>
            <option value="top">top level</option>
            {/* A folder cannot go into itself or into its own subfolders. */}
            {tree.flat
              .filter((f) => !isInside(tree, f.id, folder.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
          </select>
          <button type="button" className="btn btn-sm btn-accent" disabled={move.isPending || dest === (folder.parent_id ?? 'top')} onClick={() => move.mutate()}>
            move
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            cancel
          </button>
        </>
      )}

      {action === 'delete' && folder && (
        <>
          <span className="shrink-0">
            &gt; delete "{folder.name}"{subfolders > 0 ? ` and its ${subfolders} subfolder${subfolders === 1 ? '' : 's'}` : ''}?
            {inside ? ` what about the ${inside} inside?` : ''}
          </span>
          {inside ? (
            <>
              <button type="button" className="btn btn-sm" disabled={remove.isPending} onClick={() => remove.mutate(false)}>
                keep them (move up)
              </button>
              <button type="button" className="btn btn-sm btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(true)}>
                to the trash
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(false)}>
              delete
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onClose}>
            cancel
          </button>
        </>
      )}
    </div>
  )
}
