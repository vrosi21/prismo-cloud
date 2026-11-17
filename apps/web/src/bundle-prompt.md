# Make a Prismo bundle

Write a **Prismo bundle**: one JSON file of tasks, events, notebooks and boards that
Prismo Cloud imports in one go (lookout wall > "import"). Reply with the JSON only,
in one ```json code block, and suggest a file name ending in `.json`. Valid JSON: no
comments, no trailing commas.

## The file

```json
{
  "prismo": "bundle/1",
  "items": [],
  "links": []
}
```

`items` holds every task, event, notebook and board; `links` is optional.

Every item has a `ref` (your own short name for it, unique in the file, used only
inside the file) and a `kind`: `task`, `event`, `notebook` or `board`. Everything is
added as new: importing the same file twice makes everything twice. Leave out
`collection_id`; the folder is picked when importing.

## Item fields (all optional unless said)

| field | what | rules |
|---|---|---|
| `ref` | your name for it | required, unique |
| `kind` | `task` `event` `notebook` `board` | required |
| `title` | | at most 200 characters; tasks and events need one |
| `body` | the notes, Markdown | `# heading`, lists, `- [ ] checkbox`, tables, `**bold**`, `$x^2$` inline maths, `$$ ... $$` maths block (LaTeX) |
| `status` | `todo` `doing` `waiting` `done` | tasks only (a task without one is `todo`) |
| `date` | `"2026-11-20"` | the day; events need one |
| `time` | `"17:00"` | 24 h, local; needs `date` |
| `minutes` | length, `90` | 1 to 10080; needs `time` |
| `end_date` | last day of a multi-day item | not before `date` |
| `repeat` | `daily` `weekly` `monthly` `yearly` | needs `date`; repeats from `date` on |
| `repeat_until` | last day it may repeat on | needs `repeat`, not before `date` |
| `exceptions` | one appearance of a repeat changed | needs `repeat`; see below |
| `color` | `1` red, `2` orange, `3` yellow, `4` green, `5` cyan, `6` purple | a card on a board takes it |
| `tags` | `["dsai", "course:mai3", "type:test"]` | lowercase, at most 40 characters each, at most 30 |
| `canvas` | the board itself | boards only; see below |

**Task or event?** Something to *do* or hand in (it can be ticked off) is a `task`; a
deadline is a task with a `date` and `time`. Something that *happens* at a time (a
lab session, a lecture, a meeting) is an `event`. A `notebook` is a page of notes
(a course, a plan); a `board` is a canvas of cards.

**Repeats.** A weekly lab is one `event` with `"repeat": "weekly"`, not one item per
week. A weekly hand-in is one `task` with a repeat: ticked off, it moves on to the
next one. `exceptions` change single appearances, keyed by the day that appearance
would have had:

```json
"exceptions": {
  "2026-11-18": { "title": "rf lab 2 + lab 1 defense" },
  "2026-11-25": { "date": "2026-11-26", "time": "18:00" },
  "2026-12-23": { "skip": true }
}
```

**Tags** make the calendar's filters and the pinned board:

- a plain tag (`dsai`, `prismo`, `home`) is a *category*;
- a `key:value` tag (`course:mai3`, `type:exam`, `area:ops`) is a filter inside it;
- `pin:<section>` (`pin:labs`, `pin:tests & exams`) puts the item on the pinned board
  under that section. One pin per item.

Use the same category and keys for everything that belongs together, e.g. every
DSAI item has `dsai` and `course:<code>`, and its parts `type:<lab|lab-report|test|midterm|exam|project|seminar|presentation>`.
Give each type one colour and keep to it; the board's legend lists them.

## Links

`"links": [["mai3", "mai3-test2"], ...]`: the first item links to the second (a
course notebook to each of its parts, a task to the notebook with its notes). Both
refs must be in the file.

## Boards (JSON Canvas 1.0)

```json
{
  "ref": "board", "kind": "board", "title": "dsai", "tags": ["dsai"],
  "canvas": {
    "nodes": [
      { "id": "root", "type": "text", "x": 0, "y": 0, "width": 600, "height": 160, "color": "5",
        "text": "# DSAI\nWhat this board is for." },
      { "id": "n-mai3", "type": "file", "file": "ref:mai3", "x": 0, "y": 300, "width": 320, "height": 150 },
      { "id": "b-mai3-tests", "type": "text", "x": 24, "y": 520, "width": 210, "height": 56, "color": "2", "text": "### tests" },
      { "id": "n-mai3-test2", "type": "file", "file": "ref:mai3-test2", "x": 56, "y": 600, "width": 270, "height": 112 },
      { "id": "g-1", "type": "group", "label": "a frame", "x": -40, "y": 260, "width": 420, "height": 500 }
    ],
    "edges": [
      { "id": "e1", "fromNode": "root", "fromSide": "bottom", "toNode": "n-mai3", "toSide": "top", "toEnd": "none" },
      { "id": "e2", "fromNode": "n-mai3", "fromSide": "left", "toNode": "b-mai3-tests", "toSide": "left", "toEnd": "none", "color": "2" },
      { "id": "e3", "fromNode": "b-mai3-tests", "fromSide": "left", "toNode": "n-mai3-test2", "toSide": "left", "toEnd": "none", "color": "2" }
    ]
  }
}
```

- **Cards**: a `file` node with `"file": "ref:<ref>"` shows that item, live (ticking it
  off on the board ticks it off on the calendar). Every ref must be in the file.
- **Notes and labels**: `text` nodes, Markdown in `text`. **Frames**: `group` nodes
  with a `label`, listed before the nodes inside them.
- Node ids are unique strings. `x`, `y`, `width`, `height` in pixels, `y` grows
  downwards. Snap to 20 where you can. Sizes that read well: item card 260 x 112,
  notebook card 300 x 150, label 210 x 56, note 220 x 140.
- **No overlaps.** Leave 16 to 40 px between cards, 60+ between columns.
- **Edges**: `fromSide`/`toSide` are `top` `right` `bottom` `left`. `"toEnd": "none"`
  for tree lines, `"arrow"` (the default) for "this has to happen first" (hovering a
  card lights up everything that leads to it). Optional `label`, `color`.
- **Trees** read best like this: the root on top, its children in a row below
  (`bottom` to `top`), and inside each column the branches and their items stacked,
  joined `left` to `left` (Prismo draws those as tight brackets). Indent each level
  about 30 px to the right.

## Before you answer

- Dates are real days (`YYYY-MM-DD`), worked out from what I tell you; ask if a day
  is unknown instead of guessing, or leave `date` out (the item waits, undated).
- Every `file` node points at a ref in `items`; every link names two refs in `items`.
- Nothing private that does not belong in my own planner (passwords, other people's data).
