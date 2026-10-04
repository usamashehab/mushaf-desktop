import type { Settings } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'
import type { Platform } from '@mushaf/reader'

const KEY = 'mushaf.settings'

/** The reader in a plain browser: fonts from the dev server, settings in localStorage. */
export const webPlatform: Platform = {
  pageFontUrl: (pack: PackManifest, page: number) => `/fonts/${pack.id}/p${page}.${pack.fonts.format}`,
  extraFontUrl: (pack: PackManifest, which) => {
    const name = pack.extras[which].url.split('/').at(-1) ?? ''

    return `/fonts/extras/${name}`
  },
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
