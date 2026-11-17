---
name: prismo
description: Read and change the user's planner in Prismo Cloud (their self-hosted cloud): tasks, events, deadlines, notebooks, boards, folders and pins, and leave a note in its ledger. Use when the user says /prismo, or asks to put something in Prismo, on their calendar, board, roadmap or pinned board, to plan or reorganise their schedule there, or to tell their Prismo secretary something.
---

# Prismo

Prismo Cloud is the user's own cloud. Its planner holds **items**: `task` (can be ticked off;
a deadline is a task with a day and time), `event` (happens at a time: a lab, a meeting),
`notebook` (a page of notes, Markdown + LaTeX) and `board` (a canvas of cards and arrows).
Items live in **folders**. The user sees everything in the web app; what you change shows
there at once, and in its **ledger**.

## The tool

Everything goes through one script, next to this file:

```bash
node ~/.claude/skills/prismo/prismo.mjs <command> --as "<your session name>"
```

| command | what |
|---|---|
| `check` | is it set up? (address and token come from the user's environment) |
| `list [--q text] [--kind task,event] [--tag dsai] [--from D --to D] [--folder a/b] [--pinned] [--done] [--json]` | find items; open ones only unless `--done` |
| `get <id>` | one item in full (notes, board, links) |
| `folders` | every folder, as paths |
| `create '<json>'` | a new item; `"folder": "a/b"` picks or makes the folder |
| `patch <id> '<json>'` | change fields; `null` clears one; `"folder"` moves it |
| `trash <id>` | to the trash (the user can bring it back) |
| `link <from> <to>` | e.g. a course notebook to one of its tasks |
| `import <bundle.json> [--folder a/b]` | many items and a board at once (see below) |
| `log "<sentence>" [--items id,id]` | your note in the ledger |
| `ledger [--who name]` | what was changed lately, and by whom |

On Windows quote JSON for the shell you are in, or write it to a file and pass `--file x.json`.

Item fields: `title`, `body` (Markdown), `status` (`todo doing waiting done`, tasks only),
`date` (`2026-11-20`), `time` (`17:00`), `minutes`, `end_date`, `repeat`
(`daily weekly monthly yearly`), `repeat_until`, `exceptions` (one appearance of a repeat
moved, renamed or skipped: `{"2026-11-18": {"title": "rf lab 2"}, "2026-12-23": {"skip": true}}`),
`color` (1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple), `tags`. The full rules,
and how to write a board, are in [reference/bundle.md](reference/bundle.md).

## How the user organises things

- **Tags are categories.** A plain tag (`dsai`, `prismo`) is a category in the calendar's
  filters; `key:value` (`course:mai3`, `type:exam`) is a filter inside it. Reuse the keys
  that exist: run `list --tag <category>` first and copy what you see.
- **Pins**: the tag `pin:<section>` (`pin:labs`, `pin:projects`, `pin:tests & exams`)
  puts an item on the pinned board. One pin per item. Done and past ones drop off by
  themselves; do not unpin them for that.
- **Repeats**: a weekly lab is ONE event with `"repeat": "weekly"`, a weekly hand-in ONE
  task with a repeat. Change a single week with `exceptions`, never by making copies.
- **Colours follow the type** within a category (DSAI: labs cyan, lab work green, tests
  orange, exams red, projects purple, seminars yellow). Keep to what is there.
- Lab work and course details stay in Prismo; nothing private goes anywhere public.

## How to work

1. **Look first.** `list` (with `--tag`, `--folder`, `--q`) before you add: the item may
   exist already. Change it instead of making a second one.
2. **Change** with `create`, `patch`, `trash`, `import`. Every change is written to the
   ledger by itself, with the name you pass in `--as`.
3. **Log once at the end**: `log "moved the rf midterm to 3 dec and pinned it under tests & exams"`.
   One sentence per batch, in plain words, saying what and why.
4. **Ask before** trashing more than one thing, moving folders around, or anything the
   user did not ask for. Dates you are not sure of: ask, or leave the item without a day.
5. **Tell the user** what changed in a line or two, and that it is in the ledger.

`--as` is the name the ledger shows. Use your session's name, or what you do
("dsai-schedule", "prismo secretary"). Never print, log or repeat the token.

## Bigger things: bundles

A roadmap, a course plan, a board with many cards: write a bundle (the format is in
[reference/bundle.md](reference/bundle.md)), save it to a temporary file, then
`import <file> --folder <a/b>`. The command prints the new board's id. Importing twice
makes everything twice, so check with `list` first.

## The secretary

The user may keep a session named **prismo secretary** that keeps Prismo tidy. When the
user says "tell the secretary ..." (or the request is a larger reorganisation than your
task), hand it over instead of doing it yourself: find it with `ListAgents` and send it
the request with `SendMessage` to `"prismo secretary"`, in the user's words plus anything
it needs (ids, dates). If no such session is listed, do it yourself with the tool above.
