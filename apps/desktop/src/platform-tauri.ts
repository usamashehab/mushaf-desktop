import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { Settings } from '@mushaf/core'
import type { Platform } from '@mushaf/reader'

import { extraFontPath, pageFontPath, type FontFile } from './fonts.ts'

export const isTauri = () => '__TAURI_INTERNALS__' in window

// The app serves its fonts on its own scheme; WebView2 on Windows reaches custom
// schemes as http://<scheme>.localhost.
const FONTS = navigator.userAgent.includes('Windows') ? 'http://mushaf.localhost/fonts' : 'mushaf://localhost/fonts'

/** The reader in the desktop app: fonts from the app's data folder, settings in its config folder. */
export const tauriPlatform: Platform = {
  pageFontUrl: (pack, page) => `${FONTS}/${pageFontPath(pack, page)}`,
  extraFontUrl: (pack, which) => `${FONTS}/${extraFontPath(pack, which)}`,
  loadSettings: () => invoke<unknown>('load_settings'),
  saveSettings: (settings: Settings) => invoke('save_settings', { settings }),
}

export interface DownloadProgress {
  done: number
  total: number
  bytes: number
  total_bytes: number
}

/** The names of the fonts not yet downloaded. */
export const missingFonts = (files: FontFile[]) => invoke<string[]>('fonts_missing', { files })

/** Downloads the missing fonts, reporting progress as it goes. */
export async function downloadFonts(files: FontFile[], onProgress: (progress: DownloadProgress) => void) {
  const stop = await listen<DownloadProgress>('fonts-progress', event => onProgress(event.payload))
  try {
    await invoke('download_fonts', { files })
  } finally {
    stop()
  }
}
