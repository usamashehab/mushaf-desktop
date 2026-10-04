import type { AyahRef, SearchText } from './types.ts'

export interface SearchEntry extends AyahRef {
  page: number
  /** The ayah in the standard spelling, for showing. */
  text: string
  /** Folded for matching: no marks, one alef, no spaces. */
  folded: string
}

/** The search index, from search-text.json. */
export const buildSearchIndex = (source: SearchText): SearchEntry[] =>
  source.ayahs.map(([surah, ayah, page, text]) => ({ surah, ayah, page, text, folded: foldForSearch(text) }))

// Harakat, Quranic annotation marks, superscript alef, tatweel, and the pause and
// sajdah signs the Mushaf writes inside words.
const DROPPED = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u06DE\u06E9ءۛۚۖۗۙۘ\s]/u
const SAME: Record<string, string> = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي' }

/** One character folded for search: '' when it doesn't count. */
const foldChar = (char: string) => (DROPPED.test(char) ? '' : (SAME[char] ?? char))

/**
 * Text folded for search: no marks, one alef, ؤ as و, ئ as ي, and no spaces, since
 * the Mushaf joins or splits some words differently from how people type them
 * ("يَٰٓأَيُّهَا" for "يا أيها").
 */
export const foldForSearch = (text: string) => Array.from(text, foldChar).join('')

/**
 * Where `query` sits in `text`, as [start, end) in `text`'s own characters, so the
 * match can be marked in the ayah as written; undefined when it isn't there.
 */
export function findMatch(text: string, query: string): [number, number] | undefined {
  const wanted = foldForSearch(query)
  if (wanted.length === 0) {
    return undefined
  }
  let folded = ''
  const origin: number[] = []
  let at = 0
  for (const char of text) {
    for (const piece of foldChar(char)) {
      folded += piece
      origin.push(at)
    }
    at += char.length
  }
  const found = folded.indexOf(wanted)
  if (found === -1) {
    return undefined
  }
  const start = origin[found] ?? 0
  const last = origin[found + wanted.length - 1] ?? start
  // Carry the marks that sit on the match's last letter along with it.
  let end = last + 1
  while (end < text.length && foldChar(text[end] ?? '') === '' && !/\s/.test(text[end] ?? '')) {
    end++
  }

  return [start, end]
}

/**
 * Ayahs whose text holds `query`, in Mushaf order, at most `limit`.
 * Fewer than two letters finds nothing.
 */
export function searchAyahs(index: SearchEntry[], query: string, limit = 100): { results: SearchEntry[]; total: number } {
  const wanted = foldForSearch(query)
  if (wanted.length < 2) {
    return { results: [], total: 0 }
  }
  const matches = index.filter(entry => entry.folded.includes(wanted))

  return { results: matches.slice(0, limit), total: matches.length }
}
