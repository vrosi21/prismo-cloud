import { createStore } from './store'

// Toasts, drawn as terminal log lines: "[ok] uploaded: shot.png".
export type LogLevel = 'ok' | 'err' | 'info'

export interface LogLine {
  id: number
  level: LogLevel
  text: string
}

export const logLines = createStore<LogLine[]>([])

let nextId = 1

export function log(level: LogLevel, text: string) {
  const id = nextId++
  logLines.set((lines) => [...lines.slice(-4), { id, level, text }])
  setTimeout(() => logLines.set((lines) => lines.filter((l) => l.id !== id)), level === 'err' ? 8000 : 4500)
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'something went wrong'
}
