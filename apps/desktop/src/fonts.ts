import type { PackManifest } from '@mushaf/packs'

/** A font of the pack, named by where it lives under the fonts folder. */
export interface FontFile {
  name: string
  url: string
  size: number
  sha256: string
}

const baseName = (url: string) => url.split('/').at(-1) ?? url

/** Every font a pack needs: its 604 page fonts, then the surah-name and basmala fonts. */
export const fontFiles = (pack: PackManifest): FontFile[] => [
  ...pack.fonts.files.map(file => ({
    name: `${pack.id}/p${file.page}.${pack.fonts.format}`,
    url: file.url,
    size: file.size,
    sha256: file.sha256,
  })),
  ...Object.values(pack.extras).map(file => ({ name: `extras/${baseName(file.url)}`, ...file })),
]

/** Where a font file of `pack` is served from, under a fonts base URL. */
export const pageFontPath = (pack: PackManifest, page: number) => `${pack.id}/p${page}.${pack.fonts.format}`
export const extraFontPath = (pack: PackManifest, which: keyof PackManifest['extras']) =>
  `extras/${baseName(pack.extras[which].url)}`
