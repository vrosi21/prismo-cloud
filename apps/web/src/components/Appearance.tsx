import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Item } from '../api'
import { nextOf, relDay, short } from '../lib/days'
import { titleOf } from '../lib/items'
import { errorText, log } from '../lib/log'
import {
  moveAppearance,
  nameAppearance,
  openAt,
  pendingMove,
  resetAppearance,
  SCOPE_LABEL,
  scopesFor,
  skipAppearance,
  whereOf,
  type Scope,
  type Where,
} from '../lib/repeats'
import { useStore } from '../lib/store'

// One appearance of a repeating item: the choice a drag on the calendar
// asks for, and the "this one" row of the side panel.

function useRun() {
  const qc = useQueryClient()
  return async (what: () => Promise<unknown>, done?: string) => {
    try {
      const said = await what()
      log('ok', typeof said === 'string' ? said : (done ?? 'saved'))
    } catch (e) {
      log('err', errorText(e))
    } finally {
      void qc.invalidateQueries({ queryKey: ['items'] })
    }
  }
}

function Choice({ item, onPick, onCancel }: { item: Item; onPick: (s: Scope) => void; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {scopesFor(item).map((s) => (
        <button key={s} type="button" className={`btn btn-sm${s === 'one' ? ' btn-accent' : ''}`} onClick={() => onPick(s)}>
          {SCOPE_LABEL[s]}
        </button>
      ))}
      <button type="button" className="btn btn-sm" onClick={onCancel}>
        cancel
      </button>
    </div>
  )
}

/** Asks how much of a repeat a drag on the calendar moves. Mounted once, on the time wall. */
export function MoveChoice() {
  const p = useStore(pendingMove)
  const run = useRun()
  useEffect(() => {
    if (!p) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && pendingMove.set(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])
  if (!p) return null
  return (
    <div className="move-choice panel px-raised" role="dialog" aria-label="move a repeating one">
      <span>
        &gt; move "{titleOf(p.item)}" to {short(p.to.date)}
        {p.to.time ? ` ${p.to.time}` : ''}. it repeats {p.item.repeat}:
      </span>
      <Choice
        item={p.item}
        onPick={(s) => {
          pendingMove.set(null)
          void run(() => moveAppearance(p.item, p.orig, p.to, s))
        }}
        onCancel={() => pendingMove.set(null)}
      />
    </div>
  )
}

/**
 * The side panel's row for one appearance of a repeat: the one it was opened
 * on from the calendar, else the next one. Its own title, another day or
 * hour (only this one, later ones, or all), or skip it.
 */
export function ThisOne({ item }: { item: Item }) {
  const at = useStore(openAt)
  const run = useRun()
  const next = nextOf(item)
  const orig = at?.id === item.id ? at.orig : next?.orig
  const x = orig ? item.exceptions?.[orig] : undefined
  const here = orig ? whereOf(item, orig) : null
  const [title, setTitle] = useState(x?.title ?? '')
  const [move, setMove] = useState<Where | null>(null)
  useEffect(() => {
    setTitle(x?.title ?? '')
    setMove(null)
  }, [orig, x?.title])
  if (!orig || !here) return null

  const label = `${relDay(here.date)}${relDay(here.date) === short(here.date) ? '' : ` (${short(here.date)})`}${here.time ? ` ${here.time}` : ''}`
  return (
    <div className="this-one">
      <span className="label">{at?.id === item.id ? 'this one' : 'next one'}</span>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <b>{x?.skip ? <s>{label}</s> : label}</b>
          {x?.skip ? (
            <button type="button" className="btn btn-sm" onClick={() => run(() => skipAppearance(item, orig, false), 'it is back')}>
              bring it back
            </button>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => run(() => skipAppearance(item, orig, true), 'skipped this one')} title="this one does not happen">
              skip it
            </button>
          )}
          {(x?.date || x?.time || x?.minutes) && !x.skip && (
            <button type="button" className="btn btn-sm" onClick={() => run(() => resetAppearance(item, orig), 'back where the repeat has it')}>
              put back
            </button>
          )}
        </div>
        {!x?.skip && (
          <>
            <input
              className="field"
              value={title}
              maxLength={200}
              placeholder={`its own title (else "${item.title}")`}
              aria-label="title of this one"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() !== (x?.title ?? '') && run(() => nameAppearance(item, orig, title), 'named this one')}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="dim">move to</span>
              <input
                type="date"
                className="field !w-auto"
                aria-label="day of this one"
                value={(move ?? here).date}
                onChange={(e) => e.target.value && setMove({ ...(move ?? here), date: e.target.value })}
              />
              {here.time && (
                <input
                  type="time"
                  className="field !w-auto"
                  aria-label="time of this one"
                  value={(move ?? here).time ?? ''}
                  onChange={(e) => e.target.value && setMove({ ...(move ?? here), time: e.target.value })}
                />
              )}
            </div>
            {move && (move.date !== here.date || move.time !== here.time) && (
              <Choice
                item={item}
                onPick={(s) => {
                  setMove(null)
                  void run(() => moveAppearance(item, orig, move, s))
                }}
                onCancel={() => setMove(null)}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
