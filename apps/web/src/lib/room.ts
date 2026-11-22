import { createStore } from './store'
import type { ArrowDir } from '../components/sprites'

// The room: you stand in the middle of the Time Room and can face any of its
// four walls. The front wall holds the files, the right one tasks and the
// calendar, the left one notebooks and boards; the back one (wishes, where
// Prismo's face is) is empty for now, with a list of ideas for it. Ctrl and an arrow
// faces the wall that way. The page cuts straight to that wall, like an old
// screen switching camera feeds; what turns is the room behind it (Backdrop).

export interface Wall {
  id: string
  name: string
  /** Its name on the tabs: what is on it, in plain words. */
  tab: string
  /** The arrow that faces it (with Ctrl). */
  key: ArrowDir
  blurb: string
  /** What could go on this wall; empty for a wall that has its own page. */
  ideas: string[]
}

// Clockwise from the front, so the next one along is a quarter turn right.
export const WALLS: Wall[] = [
  { id: 'files', name: 'files', tab: 'files', key: 'up', blurb: 'the library: folders, pictures, everything you saved.', ideas: [] },
  { id: 'time', name: 'time', tab: 'calendar', key: 'right', blurb: 'tasks and the calendar.', ideas: [] },
  {
    id: 'wishes',
    name: 'wishes',
    tab: 'wishes',
    key: 'down',
    blurb: 'prismo grants wishes: the things you want close at hand.',
    ideas: [
      'pinned files and folders, one key away',
      'a board to arrange stickers and pictures on, like a fridge door',
      'notes and bits of text kept next to the files',
      'an inbox of new uploads still waiting to be sorted into folders',
      'mail: letters fly out of the window on the right when sent (planned)',
    ],
  },
  { id: 'lookout', name: 'lookout', tab: 'notebooks', key: 'left', blurb: 'notebooks and boards.', ideas: [] },
]

export const wallFor = (key: ArrowDir) => WALLS.findIndex((w) => w.key === key)

export interface Facing {
  /** The wall faced (an index into WALLS), clockwise from the files. */
  wall: number
  /** Counts turns: whatever reacts to a turn (the cut, focus) watches this. */
  n: number
}

// The wall faced is remembered, so the app opens where it was left (most of
// all the installed app on a phone). Storage may be unavailable; then it
// opens on the files.
const SAVED = 'prismo.wall'
function savedWall(): number {
  try {
    const i = Number(localStorage.getItem(SAVED))
    return Number.isInteger(i) && i >= 0 && i < WALLS.length ? i : 0
  } catch {
    return 0
  }
}

export const facing = createStore<Facing>({ wall: savedWall(), n: 0 })

export function turnTo(wall: number) {
  facing.set((f) => (f.wall === wall ? f : { wall, n: f.n + 1 }))
  try {
    localStorage.setItem(SAVED, String(wall))
  } catch {
    /* not remembered */
  }
}
