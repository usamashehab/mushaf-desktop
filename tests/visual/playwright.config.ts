import { defineConfig, devices } from '@playwright/test'

// Real pages in real engines: Chromium (Windows' WebView2) and WebKit (the webview
// Tauri uses on macOS and Linux). Run `pnpm build-data` first so .cache/fonts exists.
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  fullyParallel: true,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 900, height: 1100 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: 'pnpm --dir ../../apps/desktop exec vite --port 5174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env['CI'],
  },
})
