#!/usr/bin/env node
// prismo: the planner of Prismo Cloud from a terminal, for Claude sessions
// (the /prismo skill) and for people. No dependencies; Node 22 or newer.
//
//   node prismo.mjs list [--q text] [--kind task,event] [--tag dsai] [--from 2026-11-01 --to 2026-11-30]
//                        [--folder school/dsai] [--pinned] [--done] [--json]
//   node prismo.mjs get <id>
//   node prismo.mjs folders
//   node prismo.mjs create '<json>'          (or --file item.json; "folder": "a/b" picks or makes the folder)
//   node prismo.mjs patch <id> '<json>'      (or --file change.json; "folder" works here too)
//   node prismo.mjs trash <id>
//   node prismo.mjs link <from-id> <to-id>
//   node prismo.mjs import <bundle.json> [--folder a/b]
//   node prismo.mjs log "<what you did, in a sentence>" [--items id,id]
//   node prismo.mjs ledger [--who name]
//   node prismo.mjs check
//
// Every command takes --as <name>: who the ledger says made the change
// (default: $PRISMO_SESSION, else the name of the current folder).
//
// Address and token: PRISMO_URL and PRISMO_PLANNER_TOKEN, from the
// environment or, on Windows, from the user's stored variables (a session
// started before scripts\install-skill.ps1 ran still finds them). The token
// is never printed.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2)
const flags = {}
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else flags[key] = argv[++i]
  } else args.push(a)
}
const [command, ...rest] = args

function fail(msg) {
  console.error(`prismo: ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------- settings

function userVariable(name) {
  if (process.env[name]) return process.env[name]
  if (process.platform !== 'win32') return ''
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const m = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`))
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

const BASE = userVariable('PRISMO_URL').replace(/\/+$/, '')
const TOKEN = userVariable('PRISMO_PLANNER_TOKEN')
const WHO = String(flags.as || process.env.PRISMO_SESSION || basename(process.cwd()) || 'claude').slice(0, 60)

// ---------------------------------------------------------------- the API

async function call(method, path, body) {
  if (!BASE || !TOKEN) fail('no address or token: run scripts\\install-skill.ps1 from the prismo-cloud folder (Settings > new token > plan gives the line)')
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Prismo-Session': WHO, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  if (!res.ok) fail(`${method} ${path}: ${res.status} ${json?.error ?? text.slice(0, 200)}`)
  return json
}

let folderCache = null
async function folders() {
  if (!folderCache) {
    const { collections } = await call('GET', '/v1/collections')
    const byId = new Map(collections.map((c) => [c.id, c]))
    const pathOf = (c) => (c.parent_id && byId.get(c.parent_id) ? `${pathOf(byId.get(c.parent_id))}/${c.name}` : c.name)
    folderCache = collections.map((c) => ({ ...c, path: pathOf(c) })).sort((a, b) => a.path.localeCompare(b.path))
  }
  return folderCache
}

/** The id of folder "a/b/c", made where missing. "" or "/" is the top. */
async function folderId(path, make = true) {
  const parts = String(path).split('/').map((p) => p.trim()).filter(Boolean)
  let parent = null
  let sofar = ''
  for (const name of parts) {
    sofar = sofar ? `${sofar}/${name}` : name
    const have = (await folders()).find((f) => f.path.toLowerCase() === sofar.toLowerCase())
    if (have) {
      parent = have.id
      continue
    }
    if (!make) fail(`no folder "${sofar}"`)
    const made = await call('POST', '/v1/collections', { name, parent_id: parent })
    folderCache = null
    parent = made.id
  }
  return parent
}

/** An item change from JSON: "folder": "a/b" becomes collection_id. */
async function change(json) {
  const c = { ...json }
  if ('folder' in c) {
    c.collection_id = c.folder ? await folderId(c.folder) : null
    delete c.folder
  }
  return c
}

function jsonArg(i) {
  if (flags.file) return JSON.parse(readFileSync(flags.file, 'utf8'))
  if (rest[i] === undefined) fail('the change is missing: give it as JSON, or --file')
  try {
    return JSON.parse(rest[i])
  } catch (e) {
    fail(`that is not valid JSON: ${e.message}`)
  }
}

// ---------------------------------------------------------------- showing

function line(it, paths) {
  const when = [it.date, it.time, it.repeat ? `(${it.repeat}${it.repeat_until ? ` until ${it.repeat_until}` : ''})` : ''].filter(Boolean).join(' ')
  const tags = (it.tags ?? []).map((t) => `#${t}`).join(', ')
  const folder = it.collection_id ? paths.get(it.collection_id) : ''
  return [it.id, it.kind.padEnd(8), it.status ? `[${it.status}]` : '', JSON.stringify(it.title), when, tags, folder && `in ${folder}`]
    .filter(Boolean)
    .join('  ')
}

// ---------------------------------------------------------------- commands

const commands = {
  async check() {
    await call('GET', '/v1/items?limit=1')
    console.log(`ok: ${BASE}, as "${WHO}"`)
  },

  async list() {
    const q = new URLSearchParams()
    if (flags.q) q.set('q', flags.q)
    if (flags.kind) q.set('kind', flags.kind)
    if (flags.from || flags.to) {
      q.set('from', flags.from || flags.to)
      q.set('to', flags.to || flags.from)
    }
    if (flags.folder) q.set('collection', await folderId(flags.folder, false))
    let { items } = await call('GET', `/v1/items?${q}`)
    if (flags.tag) items = items.filter((it) => String(flags.tag).split(',').every((t) => it.tags?.includes(t.trim().toLowerCase())))
    if (flags.pinned) items = items.filter((it) => it.tags?.some((t) => t.startsWith('pin:')))
    if (!flags.done) items = items.filter((it) => it.status !== 'done')
    if (flags.json) return console.log(JSON.stringify(items, null, 2))
    const paths = new Map((await folders()).map((f) => [f.id, f.path]))
    for (const it of items) console.log(line(it, paths))
    if (!items.length) console.log('(nothing)')
  },

  async get() {
    const id = rest[0] ?? fail('which id?')
    console.log(JSON.stringify(await call('GET', `/v1/items/${id}`), null, 2))
  },

  async folders() {
    for (const f of await folders()) console.log(`${f.id}  ${f.path}`)
  },

  async create() {
    const it = await call('POST', '/v1/items', await change(jsonArg(0)))
    console.log(`made ${it.kind} ${it.id} ${JSON.stringify(it.title)}`)
  },

  async patch() {
    const id = rest[0] ?? fail('which id?')
    const it = await call('PATCH', `/v1/items/${id}`, await change(jsonArg(1)))
    console.log(`changed ${it.kind} ${it.id} ${JSON.stringify(it.title)}`)
  },

  async trash() {
    const id = rest[0] ?? fail('which id?')
    await call('DELETE', `/v1/items/${id}`)
    console.log(`trashed ${id} (the trash in the library gives it back)`)
  },

  async link() {
    const [a, b] = rest
    if (!a || !b) fail('link needs two ids: from, to')
    await call('POST', `/v1/items/${a}/links`, { to: b })
    console.log(`linked ${a} -> ${b}`)
  },

  // The same steps as the web app's import (apps/web/src/lib/bundle.ts):
  // items first, then boards with their cards pointing at the new ids, then links.
  async import() {
    const file = rest[0] ?? fail('which bundle file?')
    const b = JSON.parse(readFileSync(file, 'utf8'))
    if (b?.prismo !== 'bundle/1' || !Array.isArray(b.items)) fail('not a Prismo bundle ("prismo": "bundle/1")')
    const refs = new Set()
    for (const it of b.items) {
      if (!it.ref || !it.kind) fail('every item needs a ref and a kind')
      if (refs.has(it.ref)) fail(`ref "${it.ref}" is used twice`)
      refs.add(it.ref)
    }
    for (const [x, y] of b.links ?? []) if (!refs.has(x) || !refs.has(y)) fail(`link ${x} -> ${y} names a ref that is not in the file`)
    const folder = flags.folder ? await folderId(flags.folder) : null
    const ids = new Map()
    const boards = []
    for (const pass of ['things', 'boards']) {
      for (const { ref, ...item } of b.items) {
        if ((item.kind === 'board') !== (pass === 'boards')) continue
        const fields = await change({ ...item, ...(item.collection_id === undefined && item.folder === undefined ? { collection_id: folder } : {}) })
        if (fields.canvas) {
          fields.canvas = {
            edges: fields.canvas.edges,
            nodes: fields.canvas.nodes.map((n) => {
              if (n.type !== 'file' || !n.file.startsWith('ref:')) return n
              const id = ids.get(n.file.slice(4))
              if (id) return { ...n, file: `item/${id}` }
              const { file: _f, subpath: _s, ...keep } = n
              return { ...keep, type: 'text', text: `missing: ${n.file}` }
            }),
          }
        }
        const made = await call('POST', '/v1/items', fields)
        ids.set(ref, made.id)
        if (made.kind === 'board') boards.push(made.id)
      }
    }
    for (const [x, y] of b.links ?? []) await call('POST', `/v1/items/${ids.get(x)}/links`, { to: ids.get(y) })
    console.log(`added ${b.items.length} items and ${(b.links ?? []).length} links${flags.folder ? ` in ${flags.folder}` : ''}`)
    for (const id of boards) console.log(`board ${id}`)
  },

  async log() {
    const message = rest.join(' ').trim() || fail('what did you do? log "<a sentence>"')
    const items = flags.items ? String(flags.items).split(',').map((s) => s.trim()).filter(Boolean) : []
    await call('POST', '/v1/ledger', { message, items })
    console.log('noted in the ledger')
  },

  async ledger() {
    const q = new URLSearchParams({ limit: String(flags.limit || 30) })
    if (flags.who) q.set('who', flags.who)
    const { entries } = await call('GET', `/v1/ledger?${q}`)
    for (const e of entries) console.log(`${e.at.slice(0, 16).replace('T', ' ')}  ${e.who}  ${e.kind === 'note' ? '> ' : '  '}${e.message}`)
  },
}

if (!command || !commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 24).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(command ? 1 : 0)
}
await commands[command]()
