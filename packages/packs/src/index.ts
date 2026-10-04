// A Mushaf pack is one way of drawing the 604 pages: a layout (which glyph codes
// sit on which line) plus the fonts that draw those codes. New styles — Warsh,
// tajweed colours, Indopak — are new packs, not new code.

import { PAGE_COUNT } from '@mushaf/core'

export interface PackFile {
  url: string
  size: number
  sha256: string
}

export interface PageFontFile extends PackFile {
  page: number
}

/** manifest.json of a pack. */
export interface PackManifest {
  v: 1
  /** Stable id, kept in settings: "qcf-v2". */
  id: string
  name: { ar: string; en: string }
  riwayah: 'hafs' | 'warsh'
  /** The print the pack follows: "Madinah 1421H". */
  edition: string
  pages: number
  /**
   * How the fonts reach the app:
   *   download — fetched from `url`s on first use, checked against sha256, then kept offline;
   *   import   — read from a folder the user already has (fonts we may not redistribute).
   */
  delivery: 'download' | 'import'
  /** One font per page; the CSS family of page N is `${familyPrefix}${N}`. */
  fonts: { familyPrefix: string; format: 'woff2' | 'ttf'; files: PageFontFile[]; totalSize: number }
  /** Fonts for the surah header names and the basmala line. */
  extras: { surahNames: PackFile; basmala: PackFile }
  /** layout.json, next to the manifest. */
  layout: string
  license: string
  credit: string
}

const isHex64 = (text: string) => /^[0-9a-f]{64}$/.test(text)

/** What is wrong with a manifest, or an empty list. */
export function checkManifest(manifest: PackManifest): string[] {
  const problems: string[] = []
  if (manifest.v !== 1) {
    problems.push(`unknown manifest version ${String(manifest.v)}`)
  }
  if (!/^[a-z0-9-]+$/.test(manifest.id)) {
    problems.push(`bad id "${manifest.id}"`)
  }
  if (manifest.pages !== PAGE_COUNT) {
    problems.push(`${manifest.pages} pages, not ${PAGE_COUNT}`)
  }
  const { files } = manifest.fonts
  if (files.length !== PAGE_COUNT) {
    problems.push(`${files.length} page fonts, not ${PAGE_COUNT}`)
  }
  files.forEach((file, i) => {
    if (file.page !== i + 1) {
      problems.push(`font ${i + 1} is for page ${file.page}`)
    }
  })
  const all = [...files, manifest.extras.surahNames, manifest.extras.basmala]
  for (const file of all) {
    if (manifest.delivery === 'download' && !file.url.startsWith('https://')) {
      problems.push(`not an https url: ${file.url}`)
    }
    if (!isHex64(file.sha256) || file.size <= 0) {
      problems.push(`no size or sha256 for ${file.url}`)
    }
  }
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total !== manifest.fonts.totalSize) {
    problems.push(`totalSize ${manifest.fonts.totalSize} but the fonts add up to ${total}`)
  }

  return problems
}
