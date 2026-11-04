// Stand-in for the real API, for working on the UI without the backend
// running. Data lives in memory and resets on restart. Sign in with the
// "development sign-in" button. The pictures are drawn by pictures.mjs;
// the recordings are real clips if ffmpeg is installed.
//
//   node mock/server.mjs            (port 8099)
//   PRISMO_API=http://localhost:8099 pnpm dev

import { createServer } from 'node:http'
import { SKIES, desktop, editor, gif, phone, photo, recordings, sticker } from './pictures.mjs'

const PORT = Number(process.env.PORT ?? 8099)
const PUBLIC = 'http://localhost:5173'
// Short video clips for the recordings, filled in as ffmpeg makes them.
const CLIPS = recordings()

let signedIn = false
let seq = 0
const uuid = () => `00000000-0000-7000-8000-${String(++seq).padStart(12, '0')}`

const collections = ['screenshots', 'gifs', 'stickers'].map((name) => ({ id: uuid(), name, parent_id: null, created_at: new Date().toISOString() }))
collections.push({ id: uuid(), name: '2026', parent_id: collections[0].id, created_at: new Date().toISOString() })
const tokens = []
const shares = []
const folderId = (name) => collections.find((c) => c.name === name).id
// Which picture each file shows (see pictures.mjs), by asset id.
const looks = new Map()
const assets = Array.from({ length: 150 }, (_, i) => makeAsset(i))

// The samples repeat in runs of seven: a photo, a desktop screenshot, a phone
// screenshot, a gif, a recording, a sticker and a zip. Photos, recordings and
// zips are at the top level; the rest in the folder for them.
function sample(i) {
  const n = Math.floor(i / 7)
  const stamp = `2026-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + ((n * 5) % 28)).padStart(2, '0')}`
  switch (i % 7) {
    case 0: {
      const tall = n % 3 === 2
      return { kind: 'image', look: 'photo', width: tall ? 1080 : 1600, height: tall ? 1350 : 1067, mime: 'image/jpeg', filename: `IMG_${4102 + i}.jpg`, title: SKIES[n % SKIES.length].title, folder: null, bytes: 2_400_000 }
    }
    case 1:
      return { kind: 'image', look: n % 2 ? 'editor' : 'desktop', width: 1920, height: 1080, mime: 'image/png', filename: `Screenshot ${stamp} ${String(100000 + ((i * 7919) % 130000)).slice(-6)}.png`, folder: n % 3 === 0 ? '2026' : 'screenshots', bytes: 640_000 }
    case 2:
      return { kind: 'image', look: 'phone', width: 1170, height: 2532, mime: 'image/png', filename: `IMG_${5300 + i}.PNG`, folder: 'screenshots', bytes: 820_000 }
    case 3:
      return { kind: 'gif', look: 'gif', width: 480, height: 360, mime: 'image/gif', filename: `${['bounce', 'vibes', 'yay'][n % 3]}_${i}.gif`, title: ['bounce', 'vibes', 'yay'][n % 3], folder: 'gifs', bytes: 1_300_000 }
    case 4:
      return { kind: 'video', look: 'clip', width: 640, height: 360, mime: 'video/mp4', filename: `recording ${stamp}.mp4`, folder: null, bytes: 6_000_000, duration_ms: 6000 }
    case 5:
      return { kind: 'sticker', look: 'sticker', width: 512, height: 512, mime: 'image/png', filename: `sticker_${i}.png`, folder: 'stickers', bytes: 90_000 }
    default:
      return { kind: 'file', look: null, width: null, height: null, mime: 'application/zip', filename: `${['backup', 'project', 'fonts', 'old-site'][n % 4]}_${i}.zip`, folder: null, bytes: 4_000_000 }
  }
}

function makeAsset(i, extra = {}) {
  const id = uuid()
  const { look, folder, title = '', bytes, duration_ms = null, ...s } = sample(i)
  looks.set(id, { look, seed: Math.floor(i / 7) })
  return {
    id,
    ...s,
    status: i === 1 ? 'processing' : i === 4 ? 'failed' : 'ready',
    error: i === 4 ? 'could not process this file' : null,
    title,
    bytes: Math.round(bytes * (0.6 + ((i * 37) % 80) / 100)),
    duration_ms,
    visibility: ['private', 'unlisted', 'public'][i % 3],
    slug: `slug${i}`,
    source: ['web', 'sharex', 'watcher'][i % 3],
    tags: i % 4 === 0 ? ['cat', 'reaction'] : [],
    collection_id: folder ? folderId(folder) : null,
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
    access: 'owner',
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

// The file itself, or with ?variant=thumb its thumbnail: for a gif the first
// frame, for a recording a still from it.
function draw(id, variant) {
  const { look, seed } = looks.get(id) ?? { look: 'photo', seed: 0 }
  const a = assets.find((x) => x.id === id)
  const SVG = 'image/svg+xml'
  const thumb = variant === 'thumb'
  switch (look) {
    case 'photo':
      return [200, photo(seed, a?.width ?? 1600, a?.height ?? 1067), SVG]
    case 'desktop':
      return [200, desktop(seed), SVG]
    case 'editor':
      return [200, editor(seed), SVG]
    case 'phone':
      return [200, phone(seed), SVG]
    case 'gif':
      return [200, gif(seed, !thumb), SVG]
    case 'sticker':
      return [200, sticker(seed), SVG]
    case 'clip': {
      const clip = CLIPS[seed % CLIPS.length]
      if (clip) return thumb ? [200, clip.poster, 'image/png'] : [200, clip.mp4, 'video/mp4']
      return thumb ? [200, editor(seed), SVG] : [404, { error: 'recordings need ffmpeg' }]
    }
    default:
      return [404, { error: 'no picture for this file' }]
  }
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
    member: true,
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
  ['GET', /^\/v1\/assets\/([^/]+)\/file$/, (req, m, q) => draw(m[1], q.get('variant'))],
  ['PATCH', /^\/v1\/assets\/([^/]+)$/, async (req, m) => {
    const a = assets.find((x) => x.id === m[1])
    Object.assign(a, await body(req))
    return [200, view(a)]
  }],
  ['GET', /^\/v1\/collections$/, () => [200, {
    collections: collections.map((c) => ({ ...c, count: assets.filter((a) => a.collection_id === c.id && !a.deleted_at).length })),
  }]],
  ['POST', /^\/v1\/collections$/, async (req) => {
    const sent = await body(req)
    const c = { id: uuid(), name: sent.name, parent_id: sent.parent_id ?? null, created_at: new Date().toISOString() }
    collections.push(c)
    return [201, { ...c, count: 0 }]
  }],
  ['PATCH', /^\/v1\/collections\/([^/]+)$/, async (req, m) => {
    const sent = await body(req)
    const c = collections.find((x) => x.id === m[1])
    if (sent.name) c.name = sent.name
    if ('parent_id' in sent) c.parent_id = sent.parent_id
    return [204]
  }],
  ['DELETE', /^\/v1\/collections\/([^/]+)$/, (req, m) => {
    collections.splice(collections.findIndex((c) => c.id === m[1]), 1)
    return [204]
  }],
  ['GET', /^\/v1\/shared$/, () => [200, { folders: [], items: [] }]],
  ['GET', /^\/v1\/shares$/, () => [200, { shares }]],
  ['POST', /^\/v1\/shares$/, async (req) => {
    const share = { id: uuid(), collection_id: null, asset_id: null, ...(await body(req)), created_at: new Date().toISOString(), invite_url: `${PUBLIC}/?invite=${'m'.repeat(40)}` }
    shares.push(share)
    return [201, share]
  }],
  ['PATCH', /^\/v1\/shares\/([^/]+)$/, async (req, m) => [200, Object.assign(shares.find((s) => s.id === m[1]), await body(req))]],
  ['DELETE', /^\/v1\/shares\/([^/]+)$/, (req, m) => {
    shares.splice(shares.findIndex((s) => s.id === m[1]), 1)
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
