import { AYAH_COUNT, PAGE_COUNT, SURAH_COUNT, type PageLayout, type QuranMeta } from '@mushaf/core'

import { linesOn } from './layout.ts'

/** Everything wrong with the built data, or an empty list. */
export function validate(pages: PageLayout[], meta: QuranMeta): string[] {
  const problems: string[] = []
  const expect = (isOk: boolean, problem: string) => {
    if (!isOk) {
      problems.push(problem)
    }
  }

  expect(pages.length === PAGE_COUNT, `${pages.length} pages, not ${PAGE_COUNT}`)
  expect(meta.surahs.length === SURAH_COUNT, `${meta.surahs.length} surahs, not ${SURAH_COUNT}`)
  expect(meta.juzStarts.length === 30, `${meta.juzStarts.length} juz starts, not 30`)
  expect(meta.quarterStarts.length === 240, `${meta.quarterStarts.length} hizb quarters, not 240`)
  expect(meta.sajdahs.length === 15, `${meta.sajdahs.length} sajdahs, not 15`)

  let headers = 0
  let basmalas = 0
  let previous: { surah: number; ayah: number; position: number; isEnd: boolean } | undefined
  let ayahs = 0
  pages.forEach((page, i) => {
    const number = i + 1
    expect(page.lines.length === linesOn(number), `page ${number} has ${page.lines.length} lines`)
    page.lines.forEach((line, l) => {
      if (line.t === 'surah') {
        headers++

        return
      }
      if (line.t === 'basmala') {
        basmalas++

        return
      }
      expect(line.w.length > 0, `page ${number} line ${l + 1} has no words`)
      for (const [surah, ayah, position, code, text, kind] of line.w) {
        const where = `${surah}:${ayah}:${position} (page ${number} line ${l + 1})`
        expect(code.length > 0 && text.length > 0, `${where} has no code or text`)
        // Reading order: the next word of the ayah, or word 1 of the next ayah.
        const isNext = previous
          ? (surah === previous.surah && ayah === previous.ayah && position === previous.position + 1 && !previous.isEnd) ||
            (previous.isEnd && position === 1 &&
              ((surah === previous.surah && ayah === previous.ayah + 1) || (surah === previous.surah + 1 && ayah === 1)))
          : surah === 1 && ayah === 1 && position === 1
        expect(isNext, `${where} is out of reading order`)
        if (kind === 1) {
          ayahs++
          expect(ayah <= (meta.surahs[surah - 1]?.ayahCount ?? 0), `${where} is past the surah's last ayah`)
        }
        previous = { surah, ayah, position, isEnd: kind === 1 }
      }
    })
  })
  expect(previous?.surah === 114 && previous.ayah === 6 && previous.isEnd, 'the last word is not the end of 114:6')
  expect(ayahs === AYAH_COUNT, `${ayahs} ayah ends, not ${AYAH_COUNT}`)
  expect(headers === SURAH_COUNT, `${headers} surah headers, not ${SURAH_COUNT}`)
  expect(basmalas === SURAH_COUNT - 2, `${basmalas} basmala lines, not ${SURAH_COUNT - 2}`)

  meta.surahs.forEach((surah, i) => {
    const pagesOf = meta.ayahPages[i] ?? []
    expect(surah.number === i + 1, `surah ${i + 1} is numbered ${surah.number}`)
    expect(pagesOf.length === surah.ayahCount, `surah ${i + 1}: ${pagesOf.length} ayah pages for ${surah.ayahCount} ayahs`)
    expect(pagesOf.every((page, a) => page >= 1 && page <= PAGE_COUNT && page >= (pagesOf[a - 1] ?? 1)), `surah ${i + 1}: ayah pages out of order`)
  })
  expect(meta.pages.length === PAGE_COUNT, `${meta.pages.length} page infos`)

  return problems
}
