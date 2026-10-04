import { PAGE_COUNT, type AyahRef, type PageInfo, type QuranMeta, type Surah } from '@mushaf/core'

import type { Source } from './source.ts'

const quarterOfRub = (rub: number) => ({ hizb: Math.floor((rub - 1) / 4) + 1, quarter: (rub - 1) % 4 })

/** quran-meta.json from the source: surahs, the page of every ayah, and the Mushaf's divisions. */
export function buildMeta({ chapters, ayahs, words }: Source): QuranMeta {
  const ayahPages: number[][] = chapters.map(chapter => new Array<number>(chapter.verses_count).fill(0))
  const lastPage = new Map<number, number>()
  for (const word of words) {
    const pages = ayahPages[word.surah - 1]
    if (pages && pages[word.ayah - 1] === 0) {
      pages[word.ayah - 1] = word.page
    }
    lastPage.set(word.surah, word.page)
  }

  const surahs: Surah[] = chapters.map(chapter => ({
    number: chapter.id,
    nameArabic: chapter.name_arabic,
    nameSimple: chapter.name_simple,
    nameEnglish: chapter.translated_name.name,
    ayahCount: chapter.verses_count,
    revelation: chapter.revelation_place,
    pages: [ayahPages[chapter.id - 1]?.[0] ?? 0, lastPage.get(chapter.id) ?? 0],
  }))

  const juzStarts: AyahRef[] = []
  const quarterStarts: AyahRef[] = []
  const sajdahs: AyahRef[] = []
  let juz = 0
  let rub = 0
  for (const { surah, ayah, juz: j, rub: r, isSajdah } of ayahs) {
    if (j !== juz) {
      juzStarts.push({ surah, ayah })
      juz = j
    }
    if (r !== rub) {
      quarterStarts.push({ surah, ayah })
      rub = r
    }
    if (isSajdah) {
      sajdahs.push({ surah, ayah })
    }
  }

  // Each page's divisions where it begins (mid-ayah, when an ayah runs over), and a
  // quarter that starts on it, as the margin marks it.
  const ayahByKey = new Map(ayahs.map(one => [`${one.surah}:${one.ayah}`, one]))
  const opening = new Map<number, (typeof ayahs)[number]>()
  for (const word of words) {
    if (!opening.has(word.page)) {
      const one = ayahByKey.get(`${word.surah}:${word.ayah}`)
      if (one) {
        opening.set(word.page, one)
      }
    }
  }
  const pageOf = ({ surah, ayah }: AyahRef) => ayahPages[surah - 1]?.[ayah - 1] ?? 0
  const pages: PageInfo[] = []
  for (let page = 1; page <= PAGE_COUNT; page++) {
    const first = opening.get(page)
    if (!first) {
      throw new Error(`no ayah on page ${page}`)
    }
    const info: PageInfo = { juz: first.juz, ...quarterOfRub(first.rub) }
    const starting = quarterStarts.findIndex(start => pageOf(start) === page)
    if (starting !== -1) {
      info.quarterStart = quarterOfRub(starting + 1)
    }
    pages.push(info)
  }

  return { v: 1, surahs, ayahPages, pages, juzStarts, quarterStarts, sajdahs }
}
