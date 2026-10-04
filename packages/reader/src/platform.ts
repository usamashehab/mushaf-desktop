import type { PackLayout, QuranMeta, Settings } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'

/**
 * What the reader needs from wherever it runs: the desktop app, a browser, later a
 * phone. The reader itself touches no file system, network or native API.
 */
export interface Platform {
  /** A URL the page's font loads from: a local file in the app, a dev server path in a browser. */
  pageFontUrl(pack: PackManifest, page: number): string
  /** The same for the surah-name and basmala fonts. */
  extraFontUrl(pack: PackManifest, which: keyof PackManifest['extras']): string
  /** Settings as last saved, in any shape; the reader migrates them. */
  loadSettings(): Promise<unknown>
  saveSettings(settings: Settings): Promise<void>
}

/** The data a reader draws from. */
export interface ReaderData {
  meta: QuranMeta
  manifest: PackManifest
  layout: PackLayout
}
