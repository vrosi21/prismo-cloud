import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Me, type Token, type Visibility } from '../api'
import { copyText, when } from '../lib/format'
import { errorText, log } from '../lib/log'
import { useTokens } from '../lib/queries'
import { setScanlines, setTheme, THEMES, useScanlines, useTheme } from '../lib/theme'

export function Settings({ me }: { me: Me }) {
  return (
    <div className="h-full overflow-y-auto px-2 pt-2">
      <div className="mx-auto flex max-w-[900px] flex-col gap-6 pb-8">
        <Look />
        {/* Tokens belong to a library; a guest has none. */}
        {me.member && <CaptureClients publicUrl={me.public_url} />}
        <Account email={me.user.email} />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel px flex flex-col gap-4 p-5">
      <h2 className="uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Look() {
  const theme = useTheme()
  const scanlines = useScanlines()
  return (
    <Section title="look">
      <div className="flex flex-wrap gap-x-4 gap-y-5">
        {THEMES.map((t) => (
          <button key={t.id} type="button" className="btn" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <p className="dim">&gt; {THEMES.find((t) => t.id === theme)?.hint}</p>
      <label className="flex cursor-pointer items-center gap-3">
        <input type="checkbox" className="h-4 w-4 accent-[var(--accent-deep)]" checked={scanlines} onChange={(e) => setScanlines(e.target.checked)} />
        <span>scanlines (never drawn over an open picture)</span>
      </label>
    </Section>
  )
}

const SCOPE_TEXT: Record<Token['scope'], string> = {
  upload: 'may add files',
  device: 'may add and look',
  full: 'may do everything',
}

const VISIBILITY_TEXT: Record<Visibility, string> = {
  private: 'private',
  unlisted: 'anyone with link',
  public: 'public',
}

type LinkKind = 'url' | 'gif_url' | 'share_url'

// A ShareX "custom uploader" file. Importing it makes ShareX send every
// capture here.
function sharexConfig(publicUrl: string, secret: string, folder: string, link: LinkKind) {
  return {
    Version: '17.0.0',
    Name: folder ? `Prismo Cloud (${folder})` : 'Prismo Cloud',
    DestinationType: 'ImageUploader, FileUploader',
    RequestMethod: 'POST',
    RequestURL: `${publicUrl}/v1/upload`,
    Headers: { Authorization: `Bearer ${secret}` },
    Body: 'MultipartFormData',
    Arguments: folder ? { source: 'sharex', collection: folder } : { source: 'sharex' },
    FileFormName: 'file',
    URL: `{json:${link}}`,
    ThumbnailURL: '{json:thumb_url}',
    ErrorMessage: '{json:error}',
  }
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function CaptureClients({ publicUrl }: { publicUrl: string }) {
  const qc = useQueryClient()
  const { data: tokens = [] } = useTokens()
  const [name, setName] = useState('')
  // What the desktop helper needs; ShareX alone gets by with "add files".
  const [scope, setScope] = useState<Token['scope']>('device')
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [fresh, setFresh] = useState<{ token: Token; secret: string } | null>(null)
  const changed = () => void qc.invalidateQueries({ queryKey: ['tokens'] })
  const fail = (e: unknown) => log('err', errorText(e))

  const create = useMutation({
    mutationFn: () => api.createToken(name.trim(), scope, visibility),
    onSuccess: (res) => {
      setFresh(res)
      setName('')
      changed()
    },
    onError: fail,
  })
  const update = useMutation({
    mutationFn: (v: { id: string; default_visibility: Visibility }) => api.updateToken(v.id, { default_visibility: v.default_visibility }),
    onSuccess: (t) => {
      log('ok', `files from "${t.name}" will be ${VISIBILITY_TEXT[t.default_visibility]}`)
      changed()
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteToken(id),
    onSuccess: () => {
      log('ok', 'token revoked')
      changed()
    },
    onError: fail,
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }

  return (
    <Section title="programs that upload for you">
      <p className="dim">
        &gt; a token lets a program (the desktop helper, sharex) send files here. give each program its own, so one can be revoked without
        touching the others.
        <br />
        &gt; the desktop helper (windows) uploads every capture by itself, and on a hotkey pastes a sticker or gif from here into any
        chat. its token has to be one that may add files and look.
        <br />
        &gt; "new files" is what happens to a file that program sends: private stays with you; anyone with link can be opened by whoever
        gets the link.
      </p>

      {fresh && (
        <FreshToken publicUrl={publicUrl} secret={fresh.secret} name={fresh.token.name} mayLook={fresh.token.scope !== 'upload'} onDone={() => setFresh(null)} />
      )}

      {tokens.length > 0 && (
        <ul className="flex flex-col gap-1">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-panel-2 px-3 py-1">
              <span className="min-w-0 truncate">
                {t.name} <span className="dim">· {SCOPE_TEXT[t.scope]} · {t.last_used_at ? `used ${when(t.last_used_at)}` : 'never used'}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="dim">new files:</span>
                <select
                  className="field !w-auto"
                  value={t.default_visibility}
                  aria-label={`what happens to new files from ${t.name}`}
                  onChange={(e) => update.mutate({ id: t.id, default_visibility: e.target.value as Visibility })}
                >
                  <option value="private">private</option>
                  <option value="unlisted">anyone with link</option>
                  <option value="public">public</option>
                </select>
                <button type="button" className="chip" disabled={remove.isPending} onClick={() => remove.mutate(t.id)}>
                  revoke
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
        <label>
          <span className="label">new token for</span>
          <input className="field" value={name} maxLength={80} placeholder="helper on my pc" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="label">it may</span>
          <select className="field" value={scope} onChange={(e) => setScope(e.target.value as Token['scope'])}>
            <option value="device">add files and look</option>
            <option value="upload">add files</option>
            <option value="full">do everything</option>
          </select>
        </label>
        <label>
          <span className="label">new files are</span>
          <select className="field" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="private">private</option>
            <option value="unlisted">anyone with link</option>
            <option value="public">public</option>
          </select>
        </label>
        <button type="submit" className="btn btn-accent mb-[3px]" disabled={create.isPending || !name.trim()}>
          create
        </button>
      </form>
    </Section>
  )
}

interface FreshTokenProps {
  publicUrl: string
  secret: string
  name: string
  /** false for a token that may only add files: enough to upload, not for the picker. */
  mayLook: boolean
  onDone: () => void
}

function FreshToken({ publicUrl, secret, name, mayLook, onDone }: FreshTokenProps) {
  const [folder, setFolder] = useState('screenshots')
  const [link, setLink] = useState<LinkKind>('url')
  const copy = async (label: string, text: string) => {
    const ok = await copyText(text)
    log(ok ? 'ok' : 'err', ok ? `${label} copied` : 'clipboard refused')
  }
  // Sets up the desktop helper so it starts with Windows (scripts/install-helper.ps1).
  const helperCommand = `powershell -ExecutionPolicy Bypass -File scripts\\install-helper.ps1 -Url ${publicUrl} -Token ${secret}`

  return (
    <div className="px-accent flex flex-col gap-4 bg-panel-2 p-4">
      <p>
        &gt; token for "{name}" created. <span className="text-danger">it is shown only now.</span>
      </p>
      <code className="break-all bg-bg-deep px-3 py-1">{secret}</code>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label>
          <span className="label">sharex: put captures in folder</span>
          <input className="field" value={folder} maxLength={200} placeholder="screenshots or screenshots/2026" onChange={(e) => setFolder(e.target.value)} />
        </label>
        <label>
          <span className="label">sharex: link it gets back</span>
          <select className="field" value={link} onChange={(e) => setLink(e.target.value as LinkKind)}>
            <option value="url">the file itself</option>
            <option value="gif_url">gif version of recordings</option>
            <option value="share_url">page with preview</option>
          </select>
        </label>
      </div>
      <p className="dim -mt-2 text-[17px] leading-tight">
        &gt; a link to a private file opens only for you, until you share that file.
        <br />
        &gt; the helper and the sharex config both upload: use one. with the helper, switch "upload image to host" off in sharex.
        {!mayLook && (
          <>
            <br />
            &gt; <span className="text-danger">this token may only add files:</span> the helper will upload with it, but its picker stays
            empty. for the picker, make one that may add files and look.
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-4">
        <button type="button" className="btn" onClick={() => copy('token', secret)}>
          copy token
        </button>
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => download(`prismo-${folder.trim().replace(/[^a-z0-9]+/gi, '-') || 'cloud'}.sxcu`, JSON.stringify(sharexConfig(publicUrl, secret, folder.trim(), link), null, 2))}
        >
          download sharex config
        </button>
        <button
          type="button"
          className="btn"
          title="run it in a terminal opened in the prismo-cloud folder, after scripts\build-helper.ps1"
          onClick={() => copy('helper install command', helperCommand)}
        >
          copy helper install command
        </button>
        <button type="button" className="btn" onClick={onDone}>
          done
        </button>
      </div>
    </div>
  )
}

function Account({ email }: { email: string }) {
  // A full reload after signing out drops every cached response at once.
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => window.location.assign('/'),
  })
  return (
    <Section title="account">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span>{email}</span>
        <button type="button" className="btn" disabled={logout.isPending} onClick={() => logout.mutate()}>
          sign out
        </button>
      </div>
    </Section>
  )
}
