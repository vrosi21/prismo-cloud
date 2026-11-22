import { createStore, useStore } from './store'

export const THEMES = [
  { id: 'timeroom', name: 'Time Room', hint: 'inside the cube' },
  { id: 'multiverse', name: 'Multiverse', hint: 'the void outside' },
  { id: 'bmo', name: 'BMO', hint: 'mint screen' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

// localStorage can throw (private windows, blocked storage); the app must
// still work, just without remembering.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* not remembered, nothing else to do */
  }
}

const saved = read('prismo.theme')
const themeStore = createStore<ThemeId>(THEMES.some((t) => t.id === saved) ? (saved as ThemeId) : 'timeroom')
const scanlineStore = createStore<boolean>(read('prismo.scanlines') === 'on')

// The phone's status bar and the installed app's title bar take this
// colour: the wall of the theme in use.
export function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  const meta = document.querySelector('meta[name="theme-color"]')
  if (bg && meta) meta.setAttribute('content', bg)
}
syncThemeColor()

export function setTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id
  write('prismo.theme', id)
  themeStore.set(id)
  syncThemeColor()
}

export function setScanlines(on: boolean) {
  document.documentElement.dataset.scanlines = on ? 'on' : 'off'
  write('prismo.scanlines', on ? 'on' : 'off')
  scanlineStore.set(on)
}

export const useTheme = () => useStore(themeStore)
export const useScanlines = () => useStore(scanlineStore)
export const currentTheme = () => themeStore.get()
