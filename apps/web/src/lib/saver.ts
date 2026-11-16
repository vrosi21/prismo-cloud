import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ConflictError, type Canvas, type Item } from '../api'
import { errorText, log } from './log'

export type SaveState = 'saved' | 'saving' | 'conflict' | 'error'

type Field = 'body' | 'canvas'
type ValueOf<F extends Field> = F extends 'body' ? string : Canvas

/**
 * Keeps one item's text (or a board's canvas) saved while it is edited: a
 * moment after the last keystroke, with the version it was read at. If the
 * same item was saved from somewhere else meanwhile, nothing is overwritten:
 * state turns "conflict" and the caller offers keepMine / takeTheirs.
 */
export function useContentSaver<F extends Field>(item: Item, field: F, delay = 700) {
  const qc = useQueryClient()
  const initial = (field === 'body' ? (item.body ?? '') : (item.canvas ?? { nodes: [], edges: [] })) as ValueOf<F>
  const [value, setValue] = useState<ValueOf<F>>(initial)
  const [state, setState] = useState<SaveState>('saved')
  const [conflict, setConflict] = useState<Item | null>(null)
  const version = useRef(item.version)
  const pending = useRef<ValueOf<F> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const busy = useRef(false)
  const conflictRef = useRef(conflict)
  conflictRef.current = conflict

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (busy.current || pending.current === null) return
    const next = pending.current
    pending.current = null
    busy.current = true
    setState('saving')
    try {
      const it = await api.updateItem(item.id, { [field]: next, version: version.current })
      version.current = it.version
      qc.setQueryData(['items', 'one', it.id], it)
      void qc.invalidateQueries({ queryKey: ['items', 'list'] })
      setState(pending.current === null ? 'saved' : 'saving')
    } catch (e) {
      if (e instanceof ConflictError) {
        pending.current = next
        conflictRef.current = e.item // before the next render, so no retry is scheduled
        setConflict(e.item)
        setState('conflict')
      } else {
        pending.current ??= next
        setState('error')
        log('err', `not saved: ${errorText(e)}`)
      }
    } finally {
      busy.current = false
    }
    // Typed on while the save was out: send that too.
    if (pending.current !== null && !conflictRef.current) timer.current = setTimeout(() => void flush(), delay)
  }, [item.id, field, qc, delay])

  const change = useCallback(
    (next: ValueOf<F>) => {
      setValue(next)
      pending.current = next
      if (conflictRef.current) return
      setState('saving')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [flush, delay],
  )

  /** Overwrite what is there with what is here. */
  const keepMine = useCallback(() => {
    if (!conflict) return
    version.current = conflict.version
    conflictRef.current = null
    setConflict(null)
    void flush()
  }, [conflict, flush])

  /** Drop what is here and show what is there. */
  const takeTheirs = useCallback(() => {
    if (!conflict) return
    version.current = conflict.version
    pending.current = null
    setValue((field === 'body' ? (conflict.body ?? '') : (conflict.canvas ?? { nodes: [], edges: [] })) as ValueOf<F>)
    qc.setQueryData(['items', 'one', conflict.id], conflict)
    conflictRef.current = null
    setConflict(null)
    setState('saved')
  }, [conflict, field, qc])

  // Leaving: send what is left. Closing the tab with unsaved text asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current !== null) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      void flush()
    }
  }, [flush])

  return { value, change, state, conflict, keepMine, takeTheirs, flush }
}
