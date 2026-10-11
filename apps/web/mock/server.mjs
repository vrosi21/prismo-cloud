// Stand-in for the real API, for working on the UI without the backend
// running. Data lives in memory and resets on restart. Sign in with the
// "development sign-in" button.
//
//   node mock/server.mjs            (port 8099)
//   PRISMO_API=http://localhost:8099 pnpm dev

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8099)
const PUBLIC = 'http://localhost:5173'
const PALETTE = ['#f48fb1', '#1f9c93', '#f6d54a', '#9484e6', '#ff7a72', '#7be39a', '#2a1a3e', '#5fe0d6']

let signedIn = false
let seq = 0
const uuid = () => `00000000-0000-7000-8000-${String(++seq).padStart(12, '0')}`

const collections = ['screenshots', 'gifs', 'stickers'].map((name) => ({ id: uuid(), name, created_at: new Date().toISOString() }))
const tokens = []
const KINDS = ['image', 'image', 'image', 'gif', 'video', 'sticker', 'file']
const assets = Array.from({ length: 150 }, (_, i) => makeAsset(i))

function makeAsset(i, extra = {}) {
  const id = uuid()
  const kind = KINDS[i % KINDS.length]
  const ext = { image: 'png', gif: 'gif', video: 'mp4', sticker: 'png', file: 'zip' }[kind]
  return {
    id,
    kind,
    status: i === 1 ? 'processing' : i === 4 ? 'failed' : 'ready',
    error: i === 4 ? 'could not process this file' : null,
    title: i % 3 === 0 ? `capture ${i}` : '',
    filename: `shot_${String(i).padStart(4, '0')}.${ext}`,
    mime: { image: 'image/png', gif: 'image/gif', video: 'video/mp4', sticker: 'image/png', file: 'application/zip' }[kind],
    bytes: 12000 + i * 9137,
    width: kind === 'file' ? null : 1280,
    height: kind === 'file' ? null : 720,
    duration_ms: kind === 'video' ? 4000 + i * 100 : null,
    visibility: ['private', 'unlisted', 'public'][i % 3],
    slug: `slug${i}`,
    source: ['web', 'sharex', 'watcher'][i % 3],
    tags: i % 4 === 0 ? ['cat', 'reaction'] : [],
    collection_id: kind === 'file' ? null : collections[i % 3].id,
    created_at: new Date(Date.now() - i * 3_600_000).toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...extra,
  }
}

function view(a) {
  const file = `/v1/assets/${a.id}/file`
  const media = a.kind !== 'file' && a.status === 'ready'
  return {
    ...a,
    variants: media ? ['thumb', ...(a.kind === 'video' ? ['gif'] : [])] : [],
    urls: {
      file: a.status === 'ready' ? `${file}?v=mock` : undefined,
      thumb: media ? `${file}?variant=thumb&v=mock` : undefined,
      share: `${PUBLIC}/s/${a.slug}`,
      raw: `${PUBLIC}/i/${a.slug}`,
      raw_gif: a.kind === 'video' ? `${PUBLIC}/i/${a.slug}.gif` : undefined,
    },
  }
}

// A different blocky picture per asset, so the grid does not look uniform.
function picture(id) {
  const n = Number(id.slice(-6))
  let cells = ''
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 16; x++) {
      const v = (x * 7 + y * 13 + n * 31 + ((x * y) % 5) * n) % 11
      if (v < 4) cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[(v + n) % PALETTE.length]}"/>`
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" width="1280" height="720" shape-rendering="crispEdges"><rect width="16" height="9" fill="${PALETTE[(n + 3) % PALETTE.length]}"/>${cells}</svg>`
}

function body(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const routes = [
  ['GET', /^\/v1\/auth\/config$/, () => [200, { google: false, dev: true }]],
  ['POST', /^\/v1\/auth\/dev$/, () => ((signedIn = true), [204])],
  ['POST', /^\/v1\/auth\/logout$/, () => ((signedIn = false), [204])],
  ['GET', /^\/v1\/me$/, () => [200, {
    user: { id: 'u1', email: 'you@example.com' },
    limits: { max_upload_bytes: 500 << 20, gif_max_seconds: 30, trash_retention_days: 30 },
    public_url: PUBLIC,
  }]],
  ['GET', /^\/v1\/stats$/, () => {
    const live = assets.filter((a) => !a.deleted_at)
    return [200, {
      assets: live.length,
      trashed: assets.length - live.length,
      bytes: assets.reduce((s, a) => s + a.bytes, 0),
      processing: live.filter((a) => a.status === 'processing').length,
    }]
  }],
  ['GET', /^\/v1\/assets$/, (req, m, q) => {
    let list = assets.filter((a) => Boolean(a.deleted_at) === (q.get('trashed') === '1'))
    if (q.get('kind')) list = list.filter((a) => a.kind === q.get('kind'))
    if (q.get('collection') === 'none') list = list.filter((a) => !a.collection_id)
    else if (q.get('collection')) list = list.filter((a) => a.collection_id === q.get('collection'))
    if (q.get('q')) list = list.filter((a) => (a.title + a.filename).includes(q.get('q')))
    const start = q.get('cursor') ? list.findIndex((a) => a.id === q.get('cursor')) + 1 : 0
    const page = list.slice(start, start + 60)
    return [200, { assets: page.map(view), next_cursor: start + 60 < list.length ? page.at(-1).id : null }]
  }],
  ['POST', /^\/v1\/assets\/bulk$/, async (req) => {
    const { ids, action, collection_id, visibility } = await body(req)
    let changed = 0
    for (const id of ids) {
      const i = assets.findIndex((a) => a.id === id)
      if (i < 0) continue
      changed++
      if (action === 'trash') assets[i].deleted_at = new Date().toISOString()
      if (action === 'restore') assets[i].deleted_at = null
      if (action === 'purge') assets.splice(i, 1)
      if (action === 'collection') assets[i].collection_id = collection_id
      if (action === 'visibility') assets[i].visibility = visibility
    }
    return [200, { changed }]
  }],
  ['POST', /^\/v1\/assets$/, async (req) => {
    const { filename, bytes } = await body(req)
    const a = makeAsset(0, { filename, bytes, title: '', status: 'pending', created_at: new Date().toISOString() })
    assets.unshift(a)
    return [201, { asset: view(a), duplicate: false, upload: { method: 'PUT', url: `/v1/mock-put/${a.id}` } }]
  }],
  ['PUT', /^\/v1\/mock-put\/([^/]+)$/, (req) => new Promise((resolve) => req.resume().on('end', () => resolve([200, {}])))],
  ['POST', /^\/v1\/assets\/([^/]+)\/complete$/, (req, m) => {
    const a = assets.find((x) => x.id === m[1])
    a.status = 'processing'
    setTimeout(() => (a.status = 'ready'), 2500) // stands in for the worker
    return [200, view(a)]
  }],
  ['GET', /^\/v1\/assets\/([^/]+)\/file$/, (req, m) => [200, picture(m[1]), 'image/svg+xml']],
  ['PATCH', /^\/v1\/assets\/([^/]+)$/, async (req, m) => {
    const a = assets.find((x) => x.id === m[1])
    Object.assign(a, await body(req))
    return [200, view(a)]
  }],
  ['GET', /^\/v1\/collections$/, () => [200, {
    collections: collections.map((c) => ({ ...c, count: assets.filter((a) => a.collection_id === c.id && !a.deleted_at).length })),
  }]],
  ['POST', /^\/v1\/collections$/, async (req) => {
    const c = { id: uuid(), name: (await body(req)).name, created_at: new Date().toISOString() }
    collections.push(c)
    return [201, { ...c, count: 0 }]
  }],
  ['PATCH', /^\/v1\/collections\/([^/]+)$/, async (req, m) => {
    collections.find((c) => c.id === m[1]).name = (await body(req)).name
    return [204]
  }],
  ['DELETE', /^\/v1\/collections\/([^/]+)$/, (req, m) => {
    collections.splice(collections.findIndex((c) => c.id === m[1]), 1)
    return [204]
  }],
  ['GET', /^\/v1\/tokens$/, () => [200, { tokens }]],
  ['POST', /^\/v1\/tokens$/, async (req) => {
    const { name, scope, default_visibility } = await body(req)
    const token = { id: uuid(), name, scope, default_visibility, created_at: new Date().toISOString(), last_used_at: null }
    tokens.unshift(token)
    return [201, { token, secret: 'prismo_mockmockmockmockmockmockmockmockmock' }]
  }],
  ['DELETE', /^\/v1\/tokens\/([^/]+)$/, (req, m) => {
    tokens.splice(tokens.findIndex((t) => t.id === m[1]), 1)
    return [204]
  }],
]

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const open = url.pathname.startsWith('/v1/auth/')
  for (const [method, pattern, handler] of routes) {
    const m = req.method === method && url.pathname.match(pattern)
    if (!m) continue
    const [status, data, type] = !open && !signedIn ? [401, { error: 'not signed in' }] : await handler(req, m, url.searchParams)
    res.writeHead(status, { 'Content-Type': type ?? 'application/json' })
    return res.end(data === undefined ? undefined : type ? data : JSON.stringify(data))
  }
  res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not found"}')
}).listen(PORT, () => console.log(`mock api on http://localhost:${PORT}`))
