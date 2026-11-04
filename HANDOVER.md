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
5. [ ] Higher-resolution sprites (Prismo, folder, etc.).
6. [ ] Final polish, screenshots, this file brought up to date.

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
