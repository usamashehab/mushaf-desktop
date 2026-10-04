import { isPage, pageOfAyah, pageOfJuz } from './navigation.ts'
import { foldArabic, foldLatin, toLatinDigits } from './text.ts'
import type { QuranMeta } from './types.ts'

export type GoTo =
  | { kind: 'page'; page: number }
  | { kind: 'ayah'; surah: number; ayah: number; page: number }
  | { kind: 'surah'; surah: number; page: number }
  | { kind: 'juz'; juz: number; page: number }

export type GoToError = 'empty' | 'no-such-page' | 'no-such-ayah' | 'no-such-juz' | 'not-understood'

export type GoToResult = { ok: true; to: GoTo } | { ok: false; error: GoToError }

const fail = (error: GoToError): GoToResult => ({ ok: false, error })

/**
 * Reads what someone typed into "Go to":
 *   "50" a page · "2:255", "2.255" or "2 255" a surah and ayah · "juz 3", "جزء ٣" a juz ·
 *   "البقرة", "baqara" a surah · "البقرة 255", "baqara 255" an ayah of it.
 * Arabic-Indic digits work wherever digits do.
 */
export function parseGoTo(input: string, meta: QuranMeta): GoToResult {
  const text = toLatinDigits(input).trim().replace(/\s+/g, ' ')
  if (text === '') {
    return fail('empty')
  }

  if (/^\d+$/.test(text)) {
    const page = Number(text)

    return isPage(page) ? { ok: true, to: { kind: 'page', page } } : fail('no-such-page')
  }

  const juz = text.match(/^(?:juz|j|جزء|الجزء)\s*(\d+)$/i)
  if (juz) {
    const number = Number(juz[1])
    const page = pageOfJuz(meta, number)

    return page ? { ok: true, to: { kind: 'juz', juz: number, page } } : fail('no-such-juz')
  }

  const verse = text.match(/^(\d+)\s*[:.\s]\s*(\d+)$/)
  if (verse) {
    return ayah(meta, Number(verse[1]), Number(verse[2]))
  }

  const named = text.match(/^(.+?)(?:\s*[:.\s]\s*(\d+))?$/)
  const surah = named?.[1] ? findSurah(meta, named[1]) : undefined
  if (surah === undefined) {
    return fail('not-understood')
  }
  if (named?.[2]) {
    return ayah(meta, surah, Number(named[2]))
  }
  const page = pageOfAyah(meta, { surah, ayah: 1 })

  return page ? { ok: true, to: { kind: 'surah', surah, page } } : fail('not-understood')
}

function ayah(meta: QuranMeta, surah: number, ayah: number): GoToResult {
  const page = pageOfAyah(meta, { surah, ayah })

  return page ? { ok: true, to: { kind: 'ayah', surah, ayah, page } } : fail('no-such-ayah')
}

const ARABIC_PREFIX = /^(?:سوره\s*)/
const LATIN_PREFIX = /^(?:surah|surat|sura)/
// "al", "an", "ash", "adh" … the article a transliterated name starts with.
const LATIN_ARTICLE = /^a(?:sh|dh|th|l|n|r|s|d|t|z)(?=[a-z]{3})/

const arabicKeys = (name: string) => {
  const folded = foldArabic(name).replace(ARABIC_PREFIX, '')

  return [folded, folded.replace(/^ال/, '')]
}
const latinKeys = (name: string) => {
  const folded = foldLatin(name).replace(LATIN_PREFIX, '')

  return [folded, folded.replace(LATIN_ARTICLE, '')]
}

/**
 * The surah a name means, Arabic or transliterated, with or without "سورة"/"Surah"
 * and the article. An exact name wins, then the first surah the name begins, then
 * the first one that contains it ("imran" for "Ali 'Imran").
 */
export function findSurah(meta: QuranMeta, name: string): number | undefined {
  const isArabic = /[\u0600-\u06FF]/.test(name)
  const wanted = (isArabic ? arabicKeys(name) : latinKeys(name)).filter(key => key.length >= 2)
  if (wanted.length === 0) {
    return undefined
  }
  const keys = meta.surahs.map(surah =>
    isArabic ? arabicKeys(surah.nameArabic) : [...latinKeys(surah.nameSimple), foldLatin(surah.nameEnglish)],
  )
  const tests: ((key: string, want: string) => boolean)[] = [
    (key, want) => key === want,
    (key, want) => key.startsWith(want),
    (key, want) => want.length >= 3 && key.includes(want),
  ]
  for (const test of tests) {
    const found = keys.findIndex(names => names.some(key => wanted.some(want => test(key, want))))
    if (found !== -1) {
      return found + 1
    }
  }

  return undefined
}
