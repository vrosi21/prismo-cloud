import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const api = process.env.PRISMO_API ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Keys are regexes on purpose: a plain '/s' prefix would also swallow '/src/...'.
    proxy: {
      '^/v1/': api,
      '^/i/': api,
      '^/s/': api,
    },
  },
})
