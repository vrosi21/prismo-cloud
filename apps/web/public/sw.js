// The service worker: what makes Prismo an installable app that opens even
// with no connection. It keeps a copy of the app itself (the page and its
// scripts, styles and fonts) and nothing else. Your files, items and
// sign-in (/v1, /i, /s) always go straight to the server, never through
// this cache.
//
// - opening a page: the network first, so a new version shows at once;
//   offline, the last copy of the app
// - /assets/*: built files whose names change with their content, so a
//   copy never goes stale; kept after the first fetch

const CACHE = 'prismo-app-v1'
const KEEP = 120 // built files kept; older ones go first
const SERVER = /^\/(v1|i|s)\//

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/')).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || SERVER.test(url.pathname)) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              void caches.open(CACHE).then(async (c) => {
                await c.put(req, copy)
                const keys = (await c.keys()).filter((k) => new URL(k.url).pathname.startsWith('/assets/'))
                for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) await c.delete(old)
              })
            }
            return res
          }),
      ),
    )
  }
})
