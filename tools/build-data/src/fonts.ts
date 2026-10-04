import { join } from 'node:path'

import { create, type Font } from 'fontkit'

import { PAGE_COUNT } from '@mushaf/core'

import { cached, pool, sha256 } from './fetch.ts'

export const CDN = 'https://verses.quran.foundation/fonts/quran'

/** QCF V2: one font per page, each glyph a whole word as the 1421H print draws it. */
export const qcfV2Url = (page: number) => `${CDN}/hafs/v2/woff2/p${page}.woff2`

export interface FontFile {
  page: number
  url: string
  size: number
  sha256: string
}

/**
 * Downloads (or reads from `cache`) the 604 QCF V2 page fonts and hands each one,
 * decoded, to `use`. Fonts are decoded one page at a time; holding all 604 runs
 * out of memory.
 */
export async function eachPageFont(cache: string, use: (page: number, font: Font) => void): Promise<FontFile[]> {
  const pages = Array.from({ length: PAGE_COUNT }, (_, i) => i + 1)
  const bodies = await pool(pages, 8, async page => {
    const url = qcfV2Url(page)
    const body = await cached(url, join(cache, 'fonts', 'qcf-v2', `p${page}.woff2`))

    return { page, url, size: body.length, sha256: sha256(body) }
  })
  for (const file of bodies) {
    const body = await cached(file.url, join(cache, 'fonts', 'qcf-v2', `p${file.page}.woff2`))
    const font = create(body)
    if ('fonts' in font) {
      throw new Error(`${file.url} is a font collection`)
    }
    use(file.page, font)
  }

  return bodies
}

/**
 * How wide `codes` draw in `font`, in em; throws on a code the font lacks.
 * Spaces are left out: a few words come as the word, a space and its pause mark,
 * and some page fonts have no space glyph.
 */
export function widthOf(font: Font, codes: string): number {
  let width = 0
  for (const char of codes.replace(/ /g, '')) {
    const point = char.codePointAt(0) ?? 0
    if (!font.hasGlyphForCodePoint(point)) {
      throw new Error(`no glyph for U+${point.toString(16).toUpperCase()}`)
    }
    width += font.glyphForCodePoint(point).advanceWidth
  }

  return width / font.unitsPerEm
}
