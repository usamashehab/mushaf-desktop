// The Quran.com API v4, the source of the words, their QCF V2 glyph codes and the
// line each word sits on in the Madinah Mushaf (1421H print).

import { join } from 'node:path'

import { PAGE_COUNT } from '@mushaf/core'

import { cachedJson, pool } from './fetch.ts'

const API = 'https://api.quran.com/api/v4'

const pageUrl = (page: number) =>
  `${API}/verses/by_page/${page}?words=true&mushaf=1&per_page=300` +
  '&word_fields=code_v2,line_number,text_qpc_hafs' +
  '&fields=juz_number,hizb_number,rub_el_hizb_number,sajdah_number'

interface ApiWord {
  id: number
  position: number
  char_type_name: 'word' | 'end'
  code_v2: string
  line_number: number
  page_number: number
  text_qpc_hafs: string
}

interface ApiVerse {
  verse_key: string
  juz_number: number
  hizb_number: number
  rub_el_hizb_number: number
  sajdah_number: number | null
  words: ApiWord[]
}

interface ApiChapter {
  id: number
  name_arabic: string
  name_simple: string
  translated_name: { name: string }
  verses_count: number
  revelation_place: 'makkah' | 'madinah'
}

export interface SourceWord {
  surah: number
  ayah: number
  position: number
  isEnd: boolean
  code: string
  text: string
  page: number
  line: number
}

export interface SourceAyah {
  surah: number
  ayah: number
  juz: number
  /** 1–240. */
  rub: number
  isSajdah: boolean
}

export interface Source {
  chapters: ApiChapter[]
  /** Every ayah in the standard spelling, by "surah:ayah". */
  imlaei: Map<string, string>
  /** Every ayah, in order. */
  ayahs: SourceAyah[]
  /** Every word, in reading order. */
  words: SourceWord[]
}

const keyOf = (verse: ApiVerse) => verse.verse_key.split(':').map(Number) as [number, number]

/**
 * Downloads (or reads from `cache`) all 604 pages and the chapter list.
 *
 * by_page groups whole verses by their page in the older 1405H print, so a verse
 * can come back with a neighbouring page. Each word carries its own page and line
 * in the 1421H print; those are what count, so words are pooled and sorted here
 * rather than taken page by page.
 */
export async function loadSource(cache: string): Promise<Source> {
  const pages = Array.from({ length: PAGE_COUNT }, (_, i) => i + 1)
  const responses = await pool(pages, 6, page =>
    cachedJson<{ verses: ApiVerse[] }>(pageUrl(page), join(cache, 'pages', `${String(page).padStart(3, '0')}.json`)),
  )
  const { chapters } = await cachedJson<{ chapters: ApiChapter[] }>(
    `${API}/chapters?language=en`,
    join(cache, 'chapters.json'),
  )

  const { verses: plain } = await cachedJson<{ verses: { verse_key: string; text_imlaei: string }[] }>(
    `${API}/quran/verses/imlaei`,
    join(cache, 'imlaei.json'),
  )
  const imlaei = new Map(plain.map(verse => [verse.verse_key, verse.text_imlaei]))

  const verses = new Map<string, ApiVerse>()
  for (const { verses: list } of responses) {
    for (const verse of list) {
      verses.set(verse.verse_key, verse)
    }
  }
  const ordered = [...verses.values()].sort((a, b) => {
    const [as, aa] = keyOf(a)
    const [bs, ba] = keyOf(b)

    return as - bs || aa - ba
  })

  const ayahs: SourceAyah[] = []
  const words: SourceWord[] = []
  for (const verse of ordered) {
    const [surah, ayah] = keyOf(verse)
    // The Mushaf marks 15 sajdahs with ۩; the API's sajdah_number leaves out 22:77.
    const isSajdah = verse.sajdah_number !== null || verse.words.some(word => word.text_qpc_hafs.includes('۩'))
    ayahs.push({ surah, ayah, juz: verse.juz_number, rub: verse.rub_el_hizb_number, isSajdah })
    for (const word of [...verse.words].sort((a, b) => a.position - b.position)) {
      words.push({
        surah,
        ayah,
        position: word.position,
        isEnd: word.char_type_name === 'end',
        code: word.code_v2,
        text: word.text_qpc_hafs,
        page: word.page_number,
        line: word.line_number,
      })
    }
  }

  return { chapters: chapters.sort((a, b) => a.id - b.id), imlaei, ayahs, words }
}
