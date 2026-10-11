import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Collection, type Me, type Token, type Visibility } from '../api'
import { copyText, when } from '../lib/format'
import { errorText, log } from '../lib/log'
import { useCollections, useTokens } from '../lib/queries'
import { setScanlines, setTheme, THEMES, useScanlines, useTheme } from '../lib/theme'

export function Settings({ me }: { me: Me }) {
  return (
    <div className="h-full overflow-y-auto px-2 pt-2">
      <div className="mx-auto flex max-w-[860px] flex-col gap-6 pb-8">
        <Look />
        {/* Tokens and jars belong to a library; a guest has none. */}
        {me.member && <CaptureClients publicUrl={me.public_url} />}
        {me.member && <Jars />}
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

type LinkKind = 'url' | 'gif_url' | 'share_url'

// A ShareX "custom uploader" file. Importing it makes ShareX send every
// capture here and put the returned link on the clipboard.
function sharexConfig(publicUrl: string, secret: string, jar: string, link: LinkKind) {
  return {
    Version: '17.0.0',
    Name: jar ? `Prismo Cloud (${jar})` : 'Prismo Cloud',
    DestinationType: 'ImageUploader, FileUploader',
    RequestMethod: 'POST',
    RequestURL: `${publicUrl}/v1/upload`,
    Headers: { Authorization: `Bearer ${secret}` },
    Body: 'MultipartFormData',
    Arguments: jar ? { source: 'sharex', collection: jar } : { source: 'sharex' },
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
  const [scope, setScope] = useState<Token['scope']>('upload')
  const [visibility, setVisibility] = useState<Visibility>('unlisted')
  const [fresh, setFresh] = useState<{ token: Token; secret: string } | null>(null)

  const create = useMutation({
    mutationFn: () => api.createToken(name.trim(), scope, visibility),
    onSuccess: (res) => {
      setFresh(res)
      setName('')
      void qc.invalidateQueries({ queryKey: ['tokens'] })
    },
    onError: (e) => log('err', errorText(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteToken(id),
    onSuccess: () => {
      log('ok', 'token revoked')
      void qc.invalidateQueries({ queryKey: ['tokens'] })
    },
    onError: (e) => log('err', errorText(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }

  return (
    <Section title="capture clients">
      <p className="dim">
        &gt; a token lets a program upload for you. give each program its own, so one can be revoked without touching the others.
      </p>

      {fresh && <FreshToken publicUrl={publicUrl} secret={fresh.secret} name={fresh.token.name} onDone={() => setFresh(null)} />}

      {tokens.length > 0 && (
        <ul className="flex flex-col gap-1">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-panel-2 px-3 py-1">
              <span className="truncate">
                {t.name} <span className="dim">· {t.scope === 'upload' ? 'upload only' : 'full access'} · new files {t.default_visibility}</span>
              </span>
              <span className="flex items-center gap-4">
                <span className="dim">{t.last_used_at ? `used ${when(t.last_used_at)}` : 'never used'}</span>
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
          <input className="field" value={name} maxLength={80} placeholder="sharex on my pc" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="label">may</span>
          <select className="field" value={scope} onChange={(e) => setScope(e.target.value as Token['scope'])}>
            <option value="upload">upload only</option>
            <option value="full">everything</option>
          </select>
        </label>
        <label>
          <span className="label">new files are</span>
          <select className="field" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="unlisted">unlisted</option>
            <option value="private">private</option>
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

function FreshToken({ publicUrl, secret, name, onDone }: { publicUrl: string; secret: string; name: string; onDone: () => void }) {
  const [jar, setJar] = useState('screenshots')
  const [link, setLink] = useState<LinkKind>('url')
  const copy = async (label: string, text: string) => {
    const ok = await copyText(text)
    log(ok ? 'ok' : 'err', ok ? `${label} copied` : 'clipboard refused')
  }
  // Installs the folder watcher so it starts with Windows (scripts/install-watcher.ps1).
  const watchCommand = `powershell -ExecutionPolicy Bypass -File scripts\\install-watcher.ps1 -Url ${publicUrl} -Token ${secret}`

  return (
    <div className="px-accent flex flex-col gap-4 bg-panel-2 p-4">
      <p>
        &gt; token for "{name}" created. <span className="text-danger">it is shown only now.</span>
      </p>
      <code className="break-all bg-bg-deep px-3 py-1">{secret}</code>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label>
          <span className="label">sharex: put captures in jar</span>
          <input className="field" value={jar} maxLength={60} onChange={(e) => setJar(e.target.value)} />
        </label>
        <label>
          <span className="label">sharex: link put on clipboard</span>
          <select className="field" value={link} onChange={(e) => setLink(e.target.value as LinkKind)}>
            <option value="url">the file itself</option>
            <option value="gif_url">gif version of recordings</option>
            <option value="share_url">page with preview</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-4">
        <button type="button" className="btn" onClick={() => copy('token', secret)}>
          copy token
        </button>
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => download(`prismo-${jar.trim() || 'cloud'}.sxcu`, JSON.stringify(sharexConfig(publicUrl, secret, jar.trim(), link), null, 2))}
        >
          download sharex config
        </button>
        <button
          type="button"
          className="btn"
          title="run it in a terminal opened in the prismo-cloud folder"
          onClick={() => copy('watcher install command', watchCommand)}
        >
          copy watcher install command
        </button>
        <button type="button" className="btn" onClick={onDone}>
          done
        </button>
      </div>
    </div>
  )
}

function Jars() {
  const qc = useQueryClient()
  const { data: collections = [] } = useCollections()
  const changed = () => void qc.invalidateQueries({ queryKey: ['collections'] })

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameCollection(id, name),
    onSuccess: changed,
    onError: (e) => {
      log('err', errorText(e))
      changed()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCollection(id),
    onSuccess: () => {
      log('ok', 'jar removed; its items were kept')
      changed()
      void qc.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (e) => log('err', errorText(e)),
  })

  return (
    <Section title="pickle jars">
      <p className="dim">&gt; removing a jar keeps what was in it.</p>
      <ul className="flex flex-col gap-3">
        {collections.map((c) => (
          <JarRow key={c.id} jar={c} onRename={(name) => rename.mutate({ id: c.id, name })} onRemove={() => remove.mutate(c.id)} />
        ))}
      </ul>
    </Section>
  )
}

function JarRow({ jar, onRename, onRemove }: { jar: Collection; onRename: (name: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(jar.name)
  const commit = () => {
    const next = name.trim()
    if (next && next !== jar.name) onRename(next)
    else setName(jar.name)
  }
  return (
    <li className="flex items-center gap-4">
      <input
        className="field"
        value={name}
        maxLength={60}
        aria-label={`name of jar ${jar.name}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="dim w-[90px] shrink-0 text-right">{jar.count} items</span>
      <button type="button" className="chip shrink-0" onClick={onRemove}>
        remove
      </button>
    </li>
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
