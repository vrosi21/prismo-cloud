import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Folder } from '../api'
import { errorText, log } from '../lib/log'
import { useFolderTree, useRefreshLibrary } from '../lib/queries'

const NEW = '+new'

/**
 * Which folder something is in, with a way to one that does not exist yet:
 * "+ new folder" asks for a name, makes it at the top of the library and
 * picks it. The library can put it inside another folder later.
 */
export function FolderPick({ value, onPick, className = '' }: { value: string | null; onPick: (id: string | null) => void; className?: string }) {
  const tree = useFolderTree()
  const refresh = useRefreshLibrary()
  const qc = useQueryClient()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const make = useMutation({
    mutationFn: () => api.createFolder(name.trim(), null),
    onSuccess: (f) => {
      // In the list at once, so the picker can show it before the refetch.
      qc.setQueryData<Folder[]>(['folders'], (old) => old && [...old, f])
      refresh()
      log('ok', `folder "${f.name}" made`)
      setNaming(false)
      setName('')
      onPick(f.id)
    },
    onError: (e) => log('err', errorText(e)),
  })

  if (naming) {
    const submit = (e: FormEvent) => {
      e.preventDefault()
      if (name.trim()) make.mutate()
    }
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <input
          className="field !w-auto min-w-[140px]"
          autoFocus
          value={name}
          maxLength={60}
          placeholder="new folder"
          aria-label="new folder name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
        />
        <button type="submit" className="btn btn-sm btn-accent" disabled={!name.trim() || make.isPending}>
          make
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setNaming(false)}>
          cancel
        </button>
      </form>
    )
  }

  return (
    <select
      className={`field ${className}`}
      aria-label="folder"
      value={value ?? ''}
      onChange={(e) => (e.target.value === NEW ? setNaming(true) : onPick(e.target.value || null))}
    >
      <option value="">top of the library</option>
      {tree.flat.map((f) => (
        <option key={f.id} value={f.id}>
          {f.path}
        </option>
      ))}
      <option value={NEW}>+ new folder...</option>
    </select>
  )
}
