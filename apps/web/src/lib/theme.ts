import { createStore, useStore } from './store'

export const THEMES = [
  { id: 'timeroom', name: 'Time Room', hint: 'inside the cube' },
  { id: 'multiverse', name: 'Multiverse', hint: 'the void outside' },
  { id: 'bmo', name: 'BMO', hint: 'mint screen' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

// How things are drawn, apart from where you are (the theme): big pixels,
// finer pixels, or no pixels at all. theme.css, "Looks".
export const LOOKS = [
  { id: '8bit', name: '8-bit', hint: 'big pixels, as it was' },
  { id: '16bit', name: '16-bit', hint: 'finer pixels, easier to read' },
  { id: 'smooth', name: 'smooth', hint: 'no pixels: plain type, round corners' },
] as const

export type LookId = (typeof LOOKS)[number]['id']

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
const savedLook = read('prismo.look')
const lookStore = createStore<LookId>(LOOKS.some((l) => l.id === savedLook) ? (savedLook as LookId) : '8bit')

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

export function setLook(id: LookId) {
  document.documentElement.dataset.look = id
  write('prismo.look', id)
  lookStore.set(id)
}

export const useTheme = () => useStore(themeStore)
export const useLook = () => useStore(lookStore)
export const useScanlines = () => useStore(scanlineStore)
export const currentTheme = () => themeStore.get()
