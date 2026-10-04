import type { Settings } from '@mushaf/core'
import type { Platform } from '@mushaf/reader'

import { extraFontPath, pageFontPath } from './fonts.ts'

const KEY = 'mushaf.settings'

/** The reader in a plain browser: fonts from the dev server, settings in localStorage. */
export const webPlatform: Platform = {
  pageFontUrl: (pack, page) => `/fonts/${pageFontPath(pack, page)}`,
  extraFontUrl: (pack, which) => `/fonts/${extraFontPath(pack, which)}`,
  loadSettings: async () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown
    } catch {
      return null
    }
  },
  saveSettings: async (settings: Settings) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // Private windows may refuse storage; the reader keeps working without it.
    }
  },
}
