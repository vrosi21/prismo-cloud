import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const api = process.env.PRISMO_API ?? 'http://localhost:8080'
// Keys are regexes on purpose: a plain '/s' prefix would also swallow '/src/...'.
const proxy = { '^/v1/': api, '^/i/': api, '^/s/': api }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy,
  },
  // The built app (pnpm build, then mock/preview.mjs): how the service
  // worker and the installed app are tried out, since neither runs in dev.
  preview: { port: 4173, proxy },
})
