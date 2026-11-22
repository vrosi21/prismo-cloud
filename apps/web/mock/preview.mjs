// Serves the built app (dist/, from `pnpm build`) pointed at the mock API,
// to try what only a build has: the service worker and installing the app.
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'

process.env.PRISMO_API ??= 'http://localhost:8099'
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const server = await preview({ root })
server.printUrls()
