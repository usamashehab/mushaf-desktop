import type { Language } from './settings.ts'
import type { AyahRef, QuranMeta } from './types.ts'

/**
 * The tafsirs the reader offers: those the scholars of Ahl al-Sunnah rely on.
 * Al-Muyassar is the King Fahd Complex's; al-Sa'di's and Ibn Kathir's are classics
 * of the tafsir by narration; in English, Ibn Kathir's as abridged by Darussalam.
 */
export const TAFSIRS = [
  { id: 'muyassar', language: 'ar' },
  { id: 'saadi', language: 'ar' },
  { id: 'ibn-kathir-ar', language: 'ar' },
  { id: 'ibn-kathir-en', language: 'en' },
] as const satisfies readonly { id: string; language: Language }[]

export type TafsirId = (typeof TAFSIRS)[number]['id']

export const TAFSIR_IDS: readonly TafsirId[] = TAFSIRS.map(tafsir => tafsir.id)

/** Reciters whose recitation comes with each word's timing, so the word heard is shown. */
export const RECITERS = ['alafasy', 'husary', 'minshawi', 'abdulbaset', 'sudais', 'shuraim'] as const

export type ReciterId = (typeof RECITERS)[number]

/** The tafsir chosen, or the one in the interface's language. */
export const tafsirOf = (settings: { tafsir: TafsirId | null; language: Language }): TafsirId =>
  settings.tafsir ?? (settings.language === 'en' ? 'ibn-kathir-en' : 'muyassar')

/** The ayah `by` ayahs on, across surahs; undefined past the first or last ayah. */
export function stepAyah(meta: QuranMeta, { surah, ayah }: AyahRef, by: 1 | -1): AyahRef | undefined {
  const count = meta.surahs[surah - 1]?.ayahCount ?? 0
  if (by === 1) {
    return ayah < count ? { surah, ayah: ayah + 1 } : surah < meta.surahs.length ? { surah: surah + 1, ayah: 1 } : undefined
  }
  if (ayah > 1) {
    return { surah, ayah: ayah - 1 }
  }
  const before = meta.surahs[surah - 2]

  return before ? { surah: surah - 1, ayah: before.ayahCount } : undefined
}
