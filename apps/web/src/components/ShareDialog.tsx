import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Role, type Share, type ShareTarget } from '../api'
import { copyText } from '../lib/format'
import { errorText, log } from '../lib/log'

interface Props {
  target: ShareTarget
  /** Name of the jar or item, for the heading. */
  name: string
  onClose: () => void
}

// Sharing with a specific person. They get in with their own Google account,
// so access can be taken back, and the link is useless to anyone else.
export function ShareDialog({ target, name, onClose }: Props) {
  const qc = useQueryClient()
  const isJar = 'collection_id' in target
  const key = ['shares', target]
  const { data: shares = [], isPending } = useQuery({ queryKey: key, queryFn: () => api.shares(target) })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('view')

  useEffect(() => {
    // Capture phase, and stop there: this dialog can sit on top of the item
    // view, and one Escape should close one layer, not both.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const changed = () => void qc.invalidateQueries({ queryKey: key })
  const fail = (e: unknown) => log('err', errorText(e))

  const copyInvite = async (share: Share) => {
    const ok = await copyText(share.invite_url)
    log(ok ? 'ok' : 'err', ok ? `invitation link copied: send it to ${share.email}` : 'clipboard refused')
  }

  const create = useMutation({
    mutationFn: () => api.createShare(target, email.trim(), role),
    onSuccess: (share) => {
      setEmail('')
      changed()
      void copyInvite(share)
    },
    onError: fail,
  })
  const update = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api.updateShare(v.id, v.role),
    onSuccess: changed,
    onError: fail,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.deleteShare(id),
    onSuccess: () => {
      log('ok', 'access taken back')
      changed()
    },
    onError: fail,
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (email.trim()) create.mutate()
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto px-3 py-[10vh]" role="dialog" aria-modal="true" aria-label={`share ${name}`}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="panel px-raised pop relative flex w-full max-w-[620px] flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="break-all uppercase">
            share {isJar ? 'jar' : 'item'}: {name}
          </h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="close">
            x
          </button>
        </div>

        <p className="dim text-[18px] leading-tight">
          &gt; view: look and download.
          <br />
          &gt; edit: also {isJar ? 'add files, ' : ''}rename, tag and move to trash. never: delete for good, share further.
          <br />
          &gt; they sign in with that google account. the link works for nobody else.
        </p>

        <form onSubmit={submit} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto_auto]">
          <label>
            <span className="label">google account</span>
            <input
              className="field"
              type="email"
              required
              autoFocus
              value={email}
              placeholder="friend@gmail.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            <span className="label">may</span>
            <select className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="view">view</option>
              <option value="edit">edit</option>
            </select>
          </label>
          <button type="submit" className="btn btn-accent mb-[3px]" disabled={create.isPending || !email.trim()}>
            share
          </button>
        </form>

        {isPending ? (
          <p className="dim cursor">&gt; looking</p>
        ) : shares.length === 0 ? (
          <p className="dim">&gt; not shared with anyone yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {shares.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-panel-2 px-3 py-1">
                <span className="truncate">{s.email}</span>
                <span className="flex items-center gap-3">
                  <select
                    className="field !w-auto"
                    value={s.role}
                    aria-label={`what ${s.email} may do`}
                    onChange={(e) => update.mutate({ id: s.id, role: e.target.value as Role })}
                  >
                    <option value="view">view</option>
                    <option value="edit">edit</option>
                  </select>
                  <button type="button" className="chip" onClick={() => copyInvite(s)}>
                    copy link
                  </button>
                  <button type="button" className="chip" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                    revoke
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
