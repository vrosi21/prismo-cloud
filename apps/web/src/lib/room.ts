import { createStore } from './store'
import type { ArrowDir } from '../components/sprites'

// The room: you stand in the middle of the Time Room and can face any of its
// four walls. The front wall holds the files; the other three are empty for
// now, each with a list of ideas for what could go on it. Ctrl and an arrow
// faces the wall that way; the view turns like looking round inside a cube.

export interface Wall {
  id: string
  name: string
  /** The arrow that faces it (with Ctrl). */
  key: ArrowDir
  blurb: string
  /** What could go on this wall; empty for the files. */
  ideas: string[]
}

// Clockwise from the front, so the next one along is a quarter turn right.
export const WALLS: Wall[] = [
  { id: 'files', name: 'files', key: 'up', blurb: 'the library: folders, pictures, everything you saved.', ideas: [] },
  {
    id: 'time',
    name: 'time',
    key: 'right',
    blurb: 'everything you saved, laid out by when.',
    ideas: [
      'a calendar with one square per day, brighter the more you saved that day',
      'on this day: what you captured a year ago, and two years ago',
      'a film strip to scroll back through, month by month',
      'jump to a date, or right back to the first thing you ever uploaded',
    ],
  },
  {
    id: 'wishes',
    name: 'wishes',
    key: 'down',
    blurb: 'prismo grants wishes: the things you want close at hand.',
    ideas: [
      'pinned files and folders, one key away',
      'a board to arrange stickers and pictures on, like a fridge door',
      'notes and bits of text kept next to the files',
      'an inbox of new uploads still waiting to be sorted into folders',
    ],
  },
  {
    id: 'lookout',
    name: 'lookout',
    key: 'left',
    blurb: 'what is going on in the library.',
    ideas: [
      'a live feed of uploads from sharex, the folder watcher and the web',
      'storage by type and folder, and the biggest files to clear out',
      'shared links: who opened what, and when the links run out',
      'files still processing or failed, with a button to try again',
    ],
  },
]

export const wallFor = (key: ArrowDir) => WALLS.findIndex((w) => w.key === key)

export interface Facing {
  /** The wall faced (an index into WALLS). */
  wall: number
  /** While turning: the wall being turned away from; otherwise null. */
  from: number | null
  turn: 'left' | 'right' | null
  /** Counts turns, so the same turn twice still starts afresh. */
  n: number
}

/** How long a turn takes; matches --turn in theme.css. */
export const TURN_MS = 420

export const facing = createStore<Facing>({ wall: 0, from: null, turn: null, n: 0 })

export function turnTo(wall: number) {
  facing.set((f) => {
    if (f.wall === wall) return f
    // A half turn goes the right way round, like a quarter turn: the wall
    // behind you comes in from the right.
    const turn = (wall - f.wall + 4) % 4 === 3 ? 'left' : 'right'
    return { wall, from: f.wall, turn, n: f.n + 1 }
  })
}

/** The turn is over: the wall turned away from is put away. */
export function settle() {
  facing.set((f) => (f.from === null ? f : { ...f, from: null, turn: null }))
}
