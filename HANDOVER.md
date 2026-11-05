# UI/UX overhaul: handover log

A running log of the web UI overhaul (`apps/web`). It is updated and pushed
after every step, so if a session stops part way through, a new one can read
this file and carry on from the first unchecked step.

Branch: `claude/quirky-rubin-wjvtim`

## What was asked

- Better UI/UX overall.
- **Keyboard control.** The owner browses with Vimium, so letter keys belong
  to Vimium. Use **arrow keys**, **Enter** and **Space** for everything
  (Escape/Backspace only as extras, never the only way to do something).
- Sprites may change: **higher resolution, still pixelated**.
- Panels ("divs") look ugly: restyle them.
- **Multiverse theme:** the Time Room (a yellow cube with a square hole in
  every face) floating **in the middle** of a blue void with a purple swirl,
  floating purple rocks and sparkly stars (reference: a still from the show,
  the cube seen a little from below).
- Time Room theme: Prismo's flat legs on the floor, folding up the back wall
  (already done in earlier commits on this branch).

## How to run and look at it

```bash
cd apps/web && pnpm install --frozen-lockfile
node apps/web/mock/server.mjs   # from the repo root: mock API on :8099
node apps/web/mock/dev.mjs      # from the repo root: Vite on :5173
```

The boot animation takes about 4 s. The mock may already be signed in; if
not, click "development sign-in". Theme is in localStorage `prismo.theme`
(`timeroom`, `multiverse`, `bmo`). Check with `pnpm typecheck` and
`pnpm build` in `apps/web`.

## Plan and status

1. [x] Keyboard navigation: arrows move focus spatially (by position on
       screen) across the whole app; dialogs trap it; the gallery moves by
       grid index and scrolls its virtual list; Enter opens, Space selects
       or activates; focus returns to the tile after the viewer closes;
       visible focus ring; key hints in the status bar.
2. [x] Pixel cube renderer: a ray-cast Time Room cube (holes in every face,
       see-through) drawn to a sprite sheet; replaces the CSS 3D loader.
3. [x] Multiverse backdrop: blue void, purple swirl, rocks, sparkles, the
       Time Room big in the middle; palette moved towards the reference.
4. [x] Restyle panels, tiles, buttons, fields, sidebar, status bar.
5. [x] Higher-resolution sprites (Prismo, folder, etc.).
6. [x] Final polish, screenshots, this file brought up to date.

Second round (asked for: all three "ideas for next time"):

7. [x] Pixel art for the folder tree's +/- and the arrow on dropdowns.
8. [x] Sample pictures in the mock API (screenshots, photos, phone
       captures, stickers with see-through backgrounds, animated gifs,
       video stills) in mixed sizes, some at the top level, so the file
       cards can be judged with real-looking pictures.
9. [x] A short key guide in Settings, next to the theme picker.

Third round (asked for: turn four ways in the room, each wall its own thing,
by keyboard; one wall is the files, the others placeholders with ideas):

10. [x] The room: four walls (files in front; time, wishes and lookout as
        placeholders listing ideas), Ctrl+arrow faces that wall with a
        stepped 3D turn, a D-pad in the header, Backspace turns back to the
        files, focus follows the turn, key guide and hints updated.

Correction (step 10 read the request wrong): what turns is the backdrop,
not the page. The Time Room turns round you and so does the Multiverse sky,
with the cube in view in one direction only; BMO has no backdrop and does
not change. The page itself cuts straight to the other wall, like an old
screen switching camera feeds: no swing, at most a moment of static.

11. [x] Turning rebuilt that way: instant cut of the page with a short
        feed-switch glitch, Time Room and Multiverse backdrops drawn for the
        wall faced.

## Log

- Start of the overhaul. Plan written.
- Step 1 done. `apps/web/src/lib/spatial.ts` (mounted by `useKeyboardNav()`
  in `App.tsx`) moves focus by screen position on arrows, inside the top
  `[aria-modal]` dialog if one is open. Opt out with `tabindex="-1"`, opt in
  without Tab with `data-nav`. `[data-nav-item]` marks files and folders (the
  start point, and they lift on focus). Space clicks links and `role=button`;
  Backspace closes the top dialog or goes back. The gallery (`Gallery.tsx`)
  moves by grid index, scrolls its virtual list, and fetches more on Down
  at the end; `focus` prop puts focus back on a tile (used when the viewer
  closes). The viewer (`AssetModal.tsx`) focuses its picture: Left/Right
  step files, Up/Down go to its buttons. Tested with Playwright key presses.
- Steps 2 and 3 done. `lib/pixelcube.ts` ray-casts the holed cube into a
  sprite sheet of a quarter turn (cached by size and colours); `Cube` in
  `sprites.tsx` shows it with a CSS `steps()` animation (`.pcube`), in the
  theme's `--cube-*` colours. `components/Multiverse.tsx` is the new void:
  a dithered swirl painted on a canvas at 4 px per pixel (repainted on
  resize), sparkles, ten procedurally drawn rocks (`ROCKS`), and the Time
  Room cube (`TIME_ROOM` colours, 24 frames) in the middle. `lib/size.ts`
  holds the shared `useSize` hook. Multiverse tokens in `theme.css` are now
  blue/indigo to match.
- Step 4 done (`theme.css`). New tokens `--hi`/`--lo` per theme (lit and
  shaded inner edges). `.panel.px`/`.panel.px-raised` are windows with a
  bevel and a stepped shadow; `.btn` has a bevel and presses down; `.field`
  is sunken; files are `.card` (picture + `.card-name` bar, `data-selected`
  turns it the accent colour) with a pixel tick (`Check`) and a page icon
  (`FileIcon`) for files without a picture; sidebar titles are
  `.section-title` with a dotted rule; the current row is accent coloured;
  folder tiles lift and show counts in a badge. The gallery sits on a
  `.screen-door` dither so backdrop bits between tiles read as background.
- Steps 5 and 6 done. `lib/raster.ts` turns shapes (ellipse, stick,
  polygon) into pixel runs; `Prismo` in `sprites.tsx` is now a 32x56
  drawing made with it (bumpy head, cyan eye, nose, splayed toes), and the
  folder icon is 16x13. The header cube is 32 px. The `.screen-door` dither
  moved from the gallery to `<main>` in `Shell.tsx`, so every page mutes the
  backdrop behind its panels. The sign-in box sits low on the screen so the
  Time Room (Multiverse) and the feet on the wall (Time Room) stay in view.
- Second round started: steps 7 to 9 added to the plan.
- Step 7 done. `Twist` in `sprites.tsx` (9x10: a raised box with a plus,
  pressed in with a minus when open; `--twist-face`/`--twist-sign` recolour
  it on hover) replaces the text +/- in the folder tree (`Shell.tsx`).
  In `theme.css`: `select.field` draws a pixel triangle with three gradient
  rows; checkboxes are sunken squares that turn accent with the pixel tick
  (a `clip-path` of the `Check` sprite); sliders are a sunken groove with a
  raised block. Checked in all three themes.
- Step 8 done. `apps/web/mock/pictures.mjs` draws seeded SVGs: landscape
  photos (5 skies, wide and tall), desktop screenshots (a browser with a blog
  post, light or dark), code editor screenshots, phone chat screenshots,
  stickers (7 cartoons with a white border on a see-through background) and
  animated gifs (SMIL; `?variant=thumb` gives the still first frame). Videos
  are real mp4 clips made by ffmpeg in the background on the first start
  (about 3 s) and kept in the temp folder (`prismo-mock-clips-2`); without
  ffmpeg they show a still only. In `server.mjs` the 150 samples repeat in
  runs of seven (photo, desktop, phone, gif, recording, sticker, zip) with
  real sizes and names; photos, recordings and zips are at the top level,
  the rest in their folders (some screenshots in `2026`).
- Step 9 done. Settings has a "keys" section right under "look"
  (`Keys`/`KEY_GUIDE` in `pages/Settings.tsx`): pixel key caps (`.key` in
  `theme.css`, arrows drawn by the new `Arrow` sprite) and what each key does,
  in groups (everywhere, looking at a file, with files selected, anywhere).
  It lists only keys the code handles: arrows, Enter, Space, Shift+Space,
  Backspace, Esc, Ctrl+A, Delete, Ctrl+K. Two columns on wide screens.
- Step 10 done. `lib/room.ts` holds the walls (`WALLS`: files in front,
  then clockwise time, wishes, lookout, each with a blurb and ideas) and the
  `facing` store (`turnTo`, `settle`). `components/Room.tsx` renders all four
  walls in one place (`.room`/`.wall` in `theme.css`); the walls not faced
  are hidden and `inert` but stay mounted, so the files keep their folder,
  scroll and focused tile. Ctrl+arrow faces that wall (skipped while typing,
  where it is a word jump, and while a dialog is open); Backspace on another
  wall turns back to the files; following any link or command turns back to
  the files too. A turn is a stepped 3D swing (420 ms, `steps(7)`, off with
  reduced motion). `Compass` in the header is a D-pad of the four walls. An
  empty wall (`EmptyWall`) shows its ideas and buttons to turn to the others;
  keyboard focus lands on "files". To fill a wall, replace `EmptyWall` for
  that wall in `Room`. Key guide (Settings) and status bar hint updated;
  `KeyCap` moved to `components/KeyCap.tsx`.

- Step 11 done. `lib/room.ts`: `facing` is just `{ wall, n }`; `turnTo` is
  instant (no `settle`, no `TURN_MS`); `Room.tsx` has only faced and away
  walls, and the 3D swing is gone from `theme.css`.
  `components/FeedCut.tsx` (mounted in `App.tsx`) is the cut: three frames
  of 55 ms on a 4 px grid (full snow, torn bands with a white line, a dark
  bar rolling through) while `[data-cut="on"]` jolts `#root` sideways and
  drains its colour (`feed-jolt`); nothing at all with reduced motion.
  Time Room (`Backdrop.tsx`): `spot()` maps a point of the screen to a
  point in the room (2x2x2, x east, z north = the files' wall) for the wall
  faced; `paint()` uses it, so the same room works every way round. The
  legs run along the floor and up the files' wall: ahead when facing the
  files, on the left wall facing time, on the right facing lookout, out of
  sight facing wishes. The lookout (west) wall is one big window onto the
  void (`DOOR`), seen on a side wall facing files or wishes; facing it, the
  page covers most of it. Multiverse (`Multiverse.tsx`): `VIEWS` gives each
  wall its part of the sky (the cube's swirl ahead, at the left or right
  edge after a quarter turn, a far galaxy behind), `rocksFor` shuffles the
  rocks, the cube shows facing the files only; skies are painted once per
  wall and size and kept (`skies`), so a turn is instant. Checked all four
  ways in Time Room, Multiverse and BMO with the mock.

## Ideas for next time

- (The three earlier ideas are steps 7 to 9 above.)
