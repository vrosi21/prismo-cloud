// Starts the Vite dev server pointed at the mock API (see server.mjs).
// Works from any working directory.
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

process.env.PRISMO_API ??= 'http://localhost:8099'
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const server = await createServer({ root })
await server.listen()
server.printUrls()
