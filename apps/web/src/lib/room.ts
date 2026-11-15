import { createStore } from './store'
import type { ArrowDir } from '../components/sprites'

// The room: you stand in the middle of the Time Room and can face any of its
// four walls. The front wall holds the files, the right one tasks and the
// calendar; the other two are empty for now, each with a list of ideas for
// what could go on it. Ctrl and an arrow
// faces the wall that way. The page cuts straight to that wall, like an old
// screen switching camera feeds; what turns is the room behind it (Backdrop).

export interface Wall {
  id: string
  name: string
  /** The arrow that faces it (with Ctrl). */
  key: ArrowDir
  blurb: string
  /** What could go on this wall; empty for a wall that has its own page. */
  ideas: string[]
}

// Clockwise from the front, so the next one along is a quarter turn right.
export const WALLS: Wall[] = [
  { id: 'files', name: 'files', key: 'up', blurb: 'the library: folders, pictures, everything you saved.', ideas: [] },
  { id: 'time', name: 'time', key: 'right', blurb: 'tasks and the calendar.', ideas: [] },
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
  /** The wall faced (an index into WALLS), clockwise from the files. */
  wall: number
  /** Counts turns: whatever reacts to a turn (the cut, focus) watches this. */
  n: number
}

export const facing = createStore<Facing>({ wall: 0, n: 0 })

export function turnTo(wall: number) {
  facing.set((f) => (f.wall === wall ? f : { wall, n: f.n + 1 }))
}
