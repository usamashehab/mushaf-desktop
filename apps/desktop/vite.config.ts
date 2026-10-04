import { createReadStream, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const ROOT = join(import.meta.dirname, '..', '..')
const FONTS = join(ROOT, '.cache', 'fonts')

/**
 * In development, serves the fonts `pnpm build-data` downloaded into .cache/fonts at
 * /fonts/…, the way the app will serve the pack it downloaded on first launch.
 */
const devFonts = (): Plugin => ({
  name: 'mushaf-dev-fonts',
  configureServer(server) {
    server.middlewares.use('/fonts', (request, response, next) => {
      const path = normalize(join(FONTS, decodeURIComponent((request.url ?? '').split('?')[0] ?? '')))
      if (!path.startsWith(FONTS) || !existsSync(path)) {
        next()

        return
      }
      response.setHeader('Content-Type', path.endsWith('.ttf') ? 'font/ttf' : 'font/woff2')
      response.setHeader('Cache-Control', 'max-age=31536000, immutable')
      createReadStream(path).pipe(response)
    })
  },
})

export default defineConfig({
  plugins: [react(), devFonts()],
  // data/ (quran-meta.json, packs/) is served as is and copied into the build.
  publicDir: join(ROOT, 'data'),
  clearScreen: false,
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
