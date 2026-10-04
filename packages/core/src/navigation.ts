import { toArabicDigits } from './text.ts'
import { PAGE_COUNT, type AyahRef, type PageInfo, type QuranMeta, type Surah } from './types.ts'

export const clampPage = (page: number) =>
  Math.min(PAGE_COUNT, Math.max(1, Math.round(page)))

export const isPage = (page: number) =>
  Number.isInteger(page) && page >= 1 && page <= PAGE_COUNT

export const surahOf = (meta: QuranMeta, surah: number): Surah | undefined =>
  meta.surahs[surah - 1]

/** The page an ayah starts on, or undefined when there's no such ayah. */
export const pageOfAyah = (meta: QuranMeta, { surah, ayah }: AyahRef): number | undefined =>
  meta.ayahPages[surah - 1]?.[ayah - 1]

export const pageInfo = (meta: QuranMeta, page: number): PageInfo | undefined =>
  meta.pages[page - 1]

/** The page juz 1–30 starts on. */
export function pageOfJuz(meta: QuranMeta, juz: number): number | undefined {
  const start = meta.juzStarts[juz - 1]

  return start && pageOfAyah(meta, start)
}

/**
 * The two pages that face each other, [right, left]. As in the printed Mushaf,
 * odd pages sit on the right: 1 faces 2, 3 faces 4, … 603 faces 604.
 */
export function spreadOf(page: number): [number, number] {
  const right = clampPage(page) % 2 === 1 ? clampPage(page) : clampPage(page) - 1

  return [right, right + 1]
}

/** The page reached by turning `by` pages (or spreads) forward; negative goes back. */
export function turn(page: number, by: number, isSpread = false): number {
  if (!isSpread) {
    return clampPage(page + by)
  }

  return spreadOf(clampPage(spreadOf(page)[0] + 2 * by))[0]
}

const QUARTERS = ['', 'ربع ', 'نصف ', 'ثلاثة أرباع ']

/** The margin label of a hizb quarter: "الحزب ٣", "ربع الحزب ٣", … */
export const quarterLabel = ({ hizb, quarter }: { hizb: number; quarter: number }) =>
  `${QUARTERS[quarter] ?? ''}الحزب ${toArabicDigits(hizb)}`

/** The header of a page: its juz and the surah of its first ayah. */
export const juzLabel = (juz: number) => `الجزء ${toArabicDigits(juz)}`
