// Builds data/ from the Quran.com API and the QCF V2 fonts:
//   data/quran-meta.json             surahs, the page of every ayah, juz/hizb/sajdah
//   data/packs/qcf-v2/layout.json    every page, line by line, as glyph codes + text
//   data/packs/qcf-v2/manifest.json  the pack's fonts, with sizes and sha256
//
//   pnpm build-data            (downloads land in .cache/, so a rebuild is offline)
//
// It fails, writing nothing, when the data doesn't add up; see validate.ts.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PackLayout } from '@mushaf/core'
import { checkManifest, type PackFile, type PackManifest } from '@mushaf/packs'

import { cached, sha256 } from './fetch.ts'
import { CDN, eachPageFont, widthOf } from './fonts.ts'
import { applyPatches, buildPages } from './layout.ts'
import { buildMeta } from './meta.ts'
import patches from './patches.json' with { type: 'json' }
import { loadSource } from './source.ts'
import { validate } from './validate.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CACHE = join(ROOT, '.cache')
const OUT = join(ROOT, 'data')

/** A line narrower than this share of a full line is centred, as the Mushaf prints short lines. */
const CENTRE_BELOW = 0.92
/** Wider than this, a line probably holds a word that belongs on the next one. */
const TOO_WIDE = 1.06

const SURAH_NAMES_URL = `${CDN}/surah-names/v1/sura_names.woff2`
const BASMALA_URL =
  'https://raw.githubusercontent.com/nuqayah/qpc-fonts/8a4f39d563ea69c994416a1692827e38156c548d/mushaf-v2/QCF2BSML.ttf'

async function extra(url: string, name: string): Promise<PackFile> {
  const body = await cached(url, join(CACHE, 'fonts', 'extras', name))

  return { url, size: body.length, sha256: sha256(body) }
}

const json = (value: unknown) => `${JSON.stringify(value)}\n`

async function main() {
  const source = await loadSource(CACHE)
  const pages = buildPages(applyPatches(source.words, patches.line))
  const meta = buildMeta(source)

  // Measure every ayah line in its page font, which also proves the font has every code.
  const widths: { page: number; line: number; width: number }[] = []
  const fonts = await eachPageFont(CACHE, (page, font) => {
    pages[page - 1]?.lines.forEach((line, i) => {
      if (line.t === 'ayah') {
        widths.push({ page, line: i + 1, width: line.w.reduce((sum, word) => sum + widthOf(font, word[3]), 0) })
      }
    })
  })
  const sorted = widths.map(one => one.width).sort((a, b) => a - b)
  const full = sorted[Math.floor(sorted.length / 2)] ?? 1
  const wide: string[] = []
  for (const { page, line, width } of widths) {
    const layoutLine = pages[page - 1]?.lines[line - 1]
    if (layoutLine?.t === 'ayah' && (page <= 2 || width / full < CENTRE_BELOW)) {
      layoutLine.c = true
    }
    if (width / full > TOO_WIDE) {
      wide.push(`page ${page} line ${line} (${(width / full).toFixed(2)})`)
    }
  }

  const problems = validate(pages, meta)
  if (wide.length > 0) {
    problems.push(`lines wider than a full line, likely a word on the wrong line: ${wide.join(', ')}`)
  }

  const manifest: PackManifest = {
    v: 1,
    id: 'qcf-v2',
    name: { ar: 'مصحف المدينة (مجمع الملك فهد)', en: 'Madinah Mushaf (King Fahd Complex)' },
    riwayah: 'hafs',
    edition: 'Madinah 1421H',
    pages: pages.length,
    delivery: 'download',
    fonts: {
      familyPrefix: 'qcf-v2-p',
      format: 'woff2',
      files: fonts,
      totalSize: fonts.reduce((sum, file) => sum + file.size, 0),
    },
    extras: {
      surahNames: await extra(SURAH_NAMES_URL, 'sura_names.woff2'),
      basmala: await extra(BASMALA_URL, 'QCF2BSML.ttf'),
    },
    layout: 'layout.json',
    license:
      'Fonts and text © King Fahd Glorious Quran Printing Complex (KFGQPC): free to use and distribute, not to modify or sell.',
    credit: 'Text, glyph codes and line layout: Quran.com API (Quran Foundation). Fonts: KFGQPC, served by Quran Foundation.',
  }
  problems.push(...checkManifest(manifest))

  if (problems.length > 0) {
    console.error(`data/ not written, ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }

  const layout: PackLayout = { v: 1, pack: manifest.id, lineEm: Math.round(full * 1000) / 1000, pages }
  const packDir = join(OUT, 'packs', manifest.id)
  await mkdir(packDir, { recursive: true })
  const written = [
    [join(OUT, 'quran-meta.json'), json(meta)],
    [join(packDir, 'layout.json'), json(layout)],
    [join(packDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`],
  ] as const
  for (const [path, body] of written) {
    await writeFile(path, body)
    console.log(`wrote ${relative(ROOT, path)} (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`)
  }
  const centred = pages.flatMap(page => page.lines).filter(line => line.t === 'ayah' && line.c).length
  console.log(`${pages.length} pages, ${widths.length} ayah lines (${centred} centred), fonts ${(manifest.fonts.totalSize / 1048576).toFixed(1)} MB`)
}

await main()
