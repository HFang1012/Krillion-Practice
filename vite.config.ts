import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Actions sets BASE_PATH to /<repo>/ for project sites, or / for a user site.
const base = process.env.BASE_PATH || '/'

// Snapshot committed under public/assets so the branch publisher (which serves
// this repo as-is) can boot the app. The real Actions deploy does not set this.
const pagesFallback = process.env.VITE_PAGES_FALLBACK === '1'

export default defineConfig({
  base,
  publicDir: pagesFallback ? false : 'public',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: pagesFallback
    ? {
        outDir: 'page-fallback',
        emptyOutDir: true,
        cssCodeSplit: false,
        rollupOptions: {
          output: {
            entryFileNames: 'assets/app.js',
            chunkFileNames: 'assets/[name].js',
            assetFileNames: 'assets/app[extname]',
          },
        },
      }
    : undefined,
})
