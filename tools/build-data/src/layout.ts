import { PAGE_COUNT, type LayoutLine, type LayoutWord, type PageLayout } from '@mushaf/core'

import type { SourceWord } from './source.ts'

/** Pages 1 and 2 are framed and hold 8 lines; every other page 15. */
export const linesOn = (page: number) => (page <= 2 ? 8 : 15)

export interface LinePatch {
  key: string
  line: number
}

const keyOf = (word: Pick<SourceWord, 'surah' | 'ayah' | 'position'>) => `${word.surah}:${word.ayah}:${word.position}`

/** The source words with known mistakes put right; throws if a patch no longer applies. */
export function applyPatches(words: SourceWord[], patches: LinePatch[]): SourceWord[] {
  const byKey = new Map(patches.map(patch => [patch.key, patch]))
  const used = new Set<string>()
  const out = words.map(word => {
    const patch = byKey.get(keyOf(word))
    if (!patch) {
      return word
    }
    used.add(patch.key)

    return { ...word, line: patch.line }
  })
  const unused = patches.filter(patch => !used.has(patch.key))
  if (unused.length > 0) {
    throw new Error(`patches match no word: ${unused.map(patch => patch.key).join(', ')}`)
  }

  return out
}

/**
 * The pages, line by line. Ayah lines come straight from the words; surah headers
 * and basmalas fill the empty lines just above each surah's first word, running
 * back onto the page before when a surah starts at the top of a page, as the
 * printed Mushaf has it. Surahs 1 and 9 have no basmala line (Al-Fatihah's is its
 * first ayah; At-Tawbah has none).
 */
export function buildPages(words: SourceWord[]): PageLayout[] {
  const slots: (LayoutLine | undefined)[][] = Array.from({ length: PAGE_COUNT }, (_, i) =>
    new Array<LayoutLine | undefined>(linesOn(i + 1)).fill(undefined),
  )
  const firstWord = new Map<number, SourceWord>()

  for (const word of words) {
    const page = slots[word.page - 1]
    if (!page || word.line < 1 || word.line > page.length) {
      throw new Error(`${keyOf(word)} is on page ${word.page} line ${word.line}, outside the Mushaf`)
    }
    let line = page[word.line - 1]
    if (line === undefined) {
      line = page[word.line - 1] = { t: 'ayah', w: [] }
    }
    if (line.t !== 'ayah') {
      throw new Error(`${keyOf(word)} lands on a ${line.t} line`)
    }
    const out: LayoutWord = [word.surah, word.ayah, word.position, word.code, word.text, word.isEnd ? 1 : 0]
    line.w.push(out)
    if (word.ayah === 1 && word.position === 1) {
      firstWord.set(word.surah, word)
    }
  }

  for (const [surah, word] of firstWord) {
    const above: LayoutLine[] = surah === 1 || surah === 9 ? [{ t: 'surah', s: surah }] : [{ t: 'surah', s: surah }, { t: 'basmala', s: surah }]
    let page = word.page
    let line = word.line
    for (const item of above.reverse()) {
      line -= 1
      if (line < 1) {
        page -= 1
        line = linesOn(page)
      }
      const row = slots[page - 1]
      if (!row || row[line - 1] !== undefined) {
        throw new Error(`no empty line above surah ${surah} for its ${item.t} (page ${page} line ${line})`)
      }
      row[line - 1] = item
    }
  }

  return slots.map((row, i) => {
    const empty = row.findIndex(line => line === undefined)
    if (empty !== -1) {
      throw new Error(`page ${i + 1} line ${empty + 1} is empty and no surah header explains it`)
    }

    return { lines: row as LayoutLine[] }
  })
}
