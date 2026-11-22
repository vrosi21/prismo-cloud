import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type Item } from '../api'
import { plusDays, short, today } from '../lib/days'
import { defaultTarget, parseAll, plan, readFiles, type Source, type Target } from '../lib/gimport'
import { errorText, log } from '../lib/log'

/**
 * "Import from Google": pick the Takeout .zip (or .ics files and Tasks.json),
 * see each Google calendar and task list with where it would go, change
 * that, then import. Nothing is written before the last button.
 */
export function GoogleImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<Source[] | null>(null)
  const [targets, setTargets] = useState<Map<string, Target>>(new Map())
  const [existing, setExisting] = useState<Item[]>([])
  const [since, setSince] = useState(() => plusDays(today(), -90))
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    setBusy('reading the files...')
    try {
      const found = parseAll(await readFiles([...files]))
      if (found.length === 0) throw new Error('no calendars (.ics) or Tasks.json in what was picked')
      // Everything Prismo has around these days, to leave out what is there.
      const items = await api.items({ from: plusDays(today(), -800), to: plusDays(today(), 800), someday: true })
      setExisting(items)
      setSources(found)
      setTargets(new Map(found.map((s) => [s.id, defaultTarget(s)])))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const result = useMemo(() => (sources ? plan(sources, targets, existing, since) : null), [sources, targets, existing, since])
  const tags = useMemo(() => [...new Set(['personal', 'health', 'dsai', 'work', ...[...targets.values()].map((t) => t.tag)])].sort(), [targets])
  const setTarget = (id: string, change: Partial<Target>) => setTargets((m) => new Map(m).set(id, { ...m.get(id)!, ...change }))

  const run = async () => {
    if (!result) return
    let made = 0
    setBusy(`importing 0 of ${result.make.length}...`)
    try {
      // A few at a time: quicker than one by one, kind to the server.
      const queue = [...result.make]
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let p = queue.shift(); p; p = queue.shift()) {
            await api.createItem(p.item)
            made++
            setBusy(`importing ${made} of ${result.make.length}...`)
          }
        }),
      )
      setDone(made)
      log('ok', `imported ${made} from google`)
    } catch (e) {
      setError(`${errorText(e)} (after ${made} were made; importing again skips those)`)
    } finally {
      setBusy(null)
      void qc.invalidateQueries({ queryKey: ['items'] })
    }
  }

  return (
    <>
      <div className="sheet-scrim" onClick={busy ? undefined : onClose} aria-hidden />
      <div className="panel px-raised gimport" role="dialog" aria-label="import from google">
        <div className="flex items-center justify-between gap-2">
          <h2 className="uppercase">import from google</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={Boolean(busy)} aria-label="close">
            x
          </button>
        </div>

        {done !== null ? (
          <>
            <p>&gt; {done} items made. they are in the calendar now.</p>
            <button type="button" className="btn btn-sm btn-accent self-start" onClick={onClose}>
              close
            </button>
          </>
        ) : !sources ? (
          <>
            <p>
              &gt; pick the .zip from Google Takeout (Calendar and Tasks), or .ics files and Tasks.json. You see everything before anything is
              written.
            </p>
            <input ref={picker} type="file" multiple hidden accept=".zip,.ics,.json" onChange={(e) => void pick(e.target.files)} />
            <button type="button" className="btn btn-accent self-start" disabled={Boolean(busy)} onClick={() => picker.current?.click()}>
              pick files
            </button>
          </>
        ) : (
          <>
            <ul className="gimport-list">
              {sources.map((s) => {
                const t = targets.get(s.id)!
                const newest = s.found.reduce<string | null>((m, f) => (f.date && (!m || f.date > m) ? f.date : m), null)
                return (
                  <li key={s.id} className="gimport-row" data-off={!t.on || undefined}>
                    <input type="checkbox" className="check" checked={t.on} aria-label={`import ${s.name}`} onChange={(e) => setTarget(s.id, { on: e.target.checked })} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <b className="font-normal">{s.name}</b>
                        <span className="dim text-[length:calc(16px*var(--ft))]">
                          {s.type === 'tasks' ? 'task list' : 'calendar'} · {s.found.length}
                          {newest ? ` · newest ${short(newest)}` : ''}
                        </span>
                      </div>
                      {t.why && <p className="dim text-[length:calc(16px*var(--ft))]">&gt; {t.why}</p>}
                      {t.on && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span className="dim text-[length:calc(16px*var(--ft))]">to</span>
                          <select className="field !w-auto" value={t.tag} aria-label={`calendar for ${s.name}`} onChange={(e) => setTarget(s.id, { tag: e.target.value })}>
                            {tags.map((tag) => (
                              <option key={tag} value={tag}>
                                {tag}
                              </option>
                            ))}
                          </select>
                          {t.extra.map((x) => (
                            <span key={x} className="tag-chip">
                              {x}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <label className="flex flex-wrap items-center gap-2">
              <span className="dim">leave out what ended before</span>
              <input type="date" className="field !w-auto" value={since} onChange={(e) => e.target.value && setSince(e.target.value)} />
            </label>
            {result && (
              <div className="gimport-sum">
                <p>
                  &gt; <b className="font-normal">{result.make.length} new</b> · {result.already} already in prismo · {result.doubles} doubles left out · {result.old} older
                  {result.timesFromBrain > 0 && ` · ${result.timesFromBrain} deadline times from 🧠`}
                </p>
                {result.check.length > 0 && (
                  <details>
                    <summary className="link-btn">check these {result.check.length}: only their first day comes in</summary>
                    <ul className="dim text-[length:calc(16px*var(--ft))]">
                      {result.check.map((c) => (
                        <li key={`${c.from}-${c.title}`}>
                          {c.title} ({c.from}): {c.why}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-accent" disabled={Boolean(busy) || !result?.make.length} onClick={() => void run()}>
                import {result?.make.length ?? 0}
              </button>
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => setSources(null)}>
                other files
              </button>
            </div>
          </>
        )}
        {busy && <p className="dim">&gt; {busy}</p>}
        {error && <p className="text-danger">&gt; {error}</p>}
      </div>
    </>
  )
}
