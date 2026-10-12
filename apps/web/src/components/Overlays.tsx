import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { logLines } from '../lib/log'
import { useStore } from '../lib/store'
import { clearFinished, uploads } from '../lib/uploads'
import { Blocks } from './sprites'

// --- Log lines (toasts) -------------------------------------------------------

const LEVEL_COLOR = { ok: 'text-ok', err: 'text-danger', info: 'text-teal' } as const

export function LogLines() {
  const lines = useStore(logLines)
  return (
    <div className="pointer-events-none fixed bottom-[46px] left-3 z-[60] flex max-w-[min(560px,92vw)] flex-col gap-2" aria-live="polite">
      {lines.map((l) => (
        <div key={l.id} className="panel px pop px-3 py-1">
          <span className={LEVEL_COLOR[l.level]}>[{l.level}]</span> {l.text}
        </div>
      ))}
    </div>
  )
}

// --- Upload tray --------------------------------------------------------------

const STATE_TEXT = {
  waiting: 'queued',
  checking: 'checking',
  sending: 'sending',
  done: 'done',
  duplicate: 'already there',
  error: 'failed',
} as const

export function UploadTray() {
  const items = useStore(uploads)
  if (items.length === 0) return null
  const active = items.filter((i) => i.state === 'waiting' || i.state === 'checking' || i.state === 'sending').length
  return (
    <div className="panel px-raised fixed bottom-[52px] right-4 z-40 w-[min(380px,92vw)]">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <h3>{active > 0 ? `uploading ${active} file${active === 1 ? '' : 's'}` : 'uploads finished'}</h3>
        {active === 0 && (
          <button type="button" className="btn btn-sm" onClick={clearFinished}>
            clear
          </button>
        )}
      </div>
      <ul className="max-h-[220px] overflow-y-auto px-3 pb-3 text-[18px]">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 py-[2px]">
            <span className="truncate" title={it.error ?? it.name}>
              {it.name}
            </span>
            {it.state === 'sending' ? (
              <Blocks value={it.progress} />
            ) : (
              <span className={`shrink-0 ${it.state === 'error' ? 'text-danger' : 'dim'}`}>{STATE_TEXT[it.state]}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- Boot sequence ------------------------------------------------------------

const BOOT_LINES = [
  'PRISMO CLOUD v0.1',
  '> waking time room ......... ok',
  '> opening folders .......... ok',
  '> spinning up the cube ..... ok',
  '> ready.',
]

function bootAlreadyShown(): boolean {
  try {
    if (sessionStorage.getItem('prismo.booted')) return true
    sessionStorage.setItem('prismo.booted', '1')
  } catch {
    return true // storage blocked: skip the show rather than repeat it forever
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Decided once when the module loads, not inside the component: React may
// run a component's setup twice in development, and the second run would
// see the flag the first one just set.
const skipBoot = bootAlreadyShown()

// Shown once per browser session; any key or click skips it.
export function Boot() {
  const [shown, setShown] = useState(0)
  const [done, setDone] = useState(skipBoot)

  useEffect(() => {
    if (done) return
    const skip = () => setDone(true)
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    const timer = setInterval(() => setShown((n) => n + 1), 230)
    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [done])

  useEffect(() => {
    if (shown > BOOT_LINES.length + 1) setDone(true)
  }, [shown])

  if (done) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg p-6" role="status" aria-label="starting">
      <pre className="m-0 font-term text-[22px] leading-snug text-ink">
        {BOOT_LINES.slice(0, shown).join('\n')}
        <span className="cursor" />
      </pre>
    </div>
  )
}

// --- Command palette ----------------------------------------------------------

export interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

interface PaletteProps {
  commands: Command[]
  onSearch: (text: string) => void
  onClose: () => void
}

export function Palette({ commands, onSearch, onClose }: PaletteProps) {
  const [text, setText] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase()
    const list = needle ? commands.filter((c) => c.label.toLowerCase().includes(needle)) : commands
    // Anything typed can always be run as a search of the library.
    return needle ? [...list, { id: 'find', label: `find "${text.trim()}"`, hint: 'search library', run: () => onSearch(text.trim()) }] : list
  }, [text, commands, onSearch])

  const active = Math.min(index, matches.length - 1)

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((active + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((active - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' && matches[active]) {
      matches[active].run()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[14vh]" role="dialog" aria-modal="true" aria-label="commands">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="panel px-raised pop relative w-full max-w-[560px]">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-accent-deep" aria-hidden>
            prismo&gt;
          </span>
          <input
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setIndex(0)
            }}
            onKeyDown={onKey}
            placeholder="type a command"
            aria-label="command"
            className="w-full bg-transparent outline-none placeholder:text-dim"
            style={{ caretShape: 'block' } as CSSProperties}
          />
        </div>
        <ul className="max-h-[46vh] overflow-y-auto pb-2">
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className="nav-item"
                aria-current={i === active ? 'page' : undefined}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  c.run()
                  onClose()
                }}
              >
                <span className="grow">{c.label}</span>
                {c.hint && <span className="count">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
