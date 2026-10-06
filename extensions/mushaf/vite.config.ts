import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// One self-contained index.html: the app shows it in a frame that may fetch
// nothing, so its script, styles, data and interface fonts are all inside.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false, target: 'es2022' },
  clearScreen: false,
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
})
