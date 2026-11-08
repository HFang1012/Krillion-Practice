import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Actions sets BASE_PATH to /<repo>/ for project sites, or / for a user site.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
  },
})
