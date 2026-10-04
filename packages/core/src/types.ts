// The data formats every part of the app shares. tools/build-data writes them;
// the reader, the desktop shell and later the web and mobile apps read them.

export const PAGE_COUNT = 604
export const AYAH_COUNT = 6236
export const SURAH_COUNT = 114

/** A place in the Quran: surah 1–114, ayah from 1. */
export interface AyahRef {
  surah: number
  ayah: number
}

export interface Surah {
  number: number
  /** As printed in the Mushaf, with tashkeel: "البَقَرَةِ". */
  nameArabic: string
  /** Transliterated: "Al-Baqarah". */
  nameSimple: string
  /** Translated: "The Cow". */
  nameEnglish: string
  ayahCount: number
  revelation: 'makkah' | 'madinah'
  /** First and last page the surah's ayahs sit on. */
  pages: [number, number]
}

/** Where a page sits in the Mushaf's divisions, at its first ayah. */
export interface PageInfo {
  juz: number
  /** 1–60. */
  hizb: number
  /** 0 = the hizb's start, then 1, 2, 3 for its ¼, ½ and ¾. */
  quarter: number
  /** A hizb quarter that begins on this page, as the margin marks it. */
  quarterStart?: { hizb: number; quarter: number }
}

/** quran-meta.json: everything navigation needs, without any page layout. */
export interface QuranMeta {
  v: 1
  surahs: Surah[]
  /** ayahPages[surah - 1][ayah - 1] is the page the ayah starts on. */
  ayahPages: number[][]
  /** pages[page - 1]. */
  pages: PageInfo[]
  /** The 30 juz starts, in order. */
  juzStarts: AyahRef[]
  /** The 240 hizb-quarter starts, in order. */
  quarterStarts: AyahRef[]
  sajdahs: AyahRef[]
}

/** 0 = a word, 1 = an ayah-end marker. */
export type WordKind = 0 | 1

/**
 * One word as the page font draws it.
 * [surah, ayah, position in the ayah, glyph code(s) in the page font, Unicode text (QPC Hafs), kind]
 * The glyph code isn't readable text; the Unicode text serves copy, search and screen readers.
 */
export type LayoutWord = [number, number, number, string, string, WordKind]

export type LayoutLine =
  | { t: 'surah'; s: number }
  | { t: 'basmala'; s: number }
  /** c: the line is centred rather than justified (short lines, pages 1–2). */
  | { t: 'ayah'; w: LayoutWord[]; c?: true }

export interface PageLayout {
  /** 15 lines, except 8 on pages 1 and 2. */
  lines: LayoutLine[]
}

/** layout.json of a Mushaf pack. */
export interface PackLayout {
  v: 1
  pack: string
  /**
   * How wide a full line draws in its page font, in em (the median over all lines).
   * The reader sizes the font so a full line fills the page's width.
   */
  lineEm: number
  /** pages[page - 1]. */
  pages: PageLayout[]
}

/**
 * search-text.json: every ayah in the standard (imla'i) spelling, which is how
 * people type, for search and for showing results. [surah, ayah, page, text]
 */
export interface SearchText {
  v: 1
  ayahs: [number, number, number, string][]
}
