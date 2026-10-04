import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import {
  DEFAULT_SETTINGS,
  addBookmark,
  buildSearchIndex,
  findBookmark,
  findMatch,
  matchSurahs,
  migrateSettings,
  removeBookmark,
  restoreBookmark,
  searchAyahs,
  toggleBookmark,
  updateBookmark,
  type SearchText,
  type QuranMeta,
} from '../src/index.ts'

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(`../../../data/${path}`, import.meta.url), 'utf8')) as T
const meta = read<QuranMeta>('quran-meta.json')
const index = buildSearchIndex(read<SearchText>('search-text.json'))

describe('search', () => {
  test('the index holds every ayah once, with its page', () => {
    expect(index).toHaveLength(6236)
    expect(index.find(entry => entry.surah === 2 && entry.ayah === 255)?.page).toBe(42)
  })

  test('finds ayahs whatever the marks and alef forms typed', () => {
    const kursi = searchAyahs(index, 'الله لا اله الا هو الحي القيوم')
    expect(kursi.results.map(r => `${r.surah}:${r.ayah}`)).toEqual(['2:255', '3:2'])
    expect(searchAyahs(index, 'اللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلۡحَيُّ').total).toBe(2)
  })

  test('words the Mushaf joins are found as people type them', () => {
    expect(searchAyahs(index, 'يا أيها الذين آمنوا').total).toBeGreaterThan(80)
  })

  test('hamza seats fold so مومن finds مؤمن', () => {
    expect(searchAyahs(index, 'المومنون').total).toBe(searchAyahs(index, 'المؤمنون').total)
  })

  test('one letter finds nothing, and the limit caps the list but not the count', () => {
    expect(searchAyahs(index, 'ا').total).toBe(0)
    const many = searchAyahs(index, 'الله', 10)
    expect(many.results).toHaveLength(10)
    expect(many.total).toBeGreaterThan(1500)
  })

  test('a match is marked in the ayah as written, marks included', () => {
    const text = 'ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ'
    const [start, end] = findMatch(text, 'لا اله') ?? [0, 0]
    expect(text.slice(start, end)).toBe('لَآ إِلَٰهَ')
    expect(findMatch(text, 'رحمن')).toBeUndefined()
  })

  test('surah suggestions rank exact names, then prefixes, then the rest', () => {
    expect(matchSurahs(meta, 'الناس')[0]).toBe(114)
    expect(matchSurahs(meta, 'ال').length).toBe(5)
    expect(matchSurahs(meta, 'baq')).toEqual([2])
    expect(matchSurahs(meta, 'نس')).toContain(4)
  })
})

describe('bookmarks', () => {
  const kursi = { surah: 2, ayah: 255 }

  test('many bookmarks, newest first, each with an id and its own colour', () => {
    let settings = addBookmark(DEFAULT_SETTINGS, { page: 42, ayah: kursi }, 1)
    settings = addBookmark(settings, { page: 50 }, 2)
    expect(settings.bookmarks.map(mark => mark.page)).toEqual([50, 42])
    expect(new Set(settings.bookmarks.map(mark => mark.id)).size).toBe(2)
    expect(settings.bookmarks[0]?.color).not.toBe(settings.bookmarks[1]?.color)
  })

  test('an ayah bookmark and its page bookmark are different places', () => {
    const settings = addBookmark(DEFAULT_SETTINGS, { page: 42, ayah: kursi })
    expect(findBookmark(settings, 42, kursi)).toBeDefined()
    expect(findBookmark(settings, 42)).toBeUndefined()
  })

  test('toggling adds, then removes', () => {
    const once = toggleBookmark(DEFAULT_SETTINGS, { page: 7 })
    expect(once.bookmarks).toHaveLength(1)
    expect(toggleBookmark(once, { page: 7 }).bookmarks).toHaveLength(0)
  })

  test('remove, undo, rename and recolour', () => {
    let settings = addBookmark(addBookmark(DEFAULT_SETTINGS, { page: 1 }, 1), { page: 2 }, 2)
    const [second, first] = settings.bookmarks
    if (!first || !second) {
      throw new Error('two bookmarks expected')
    }
    settings = removeBookmark(settings, second.id)
    expect(settings.bookmarks.map(mark => mark.page)).toEqual([1])
    settings = restoreBookmark(settings, second, 0)
    expect(settings.bookmarks.map(mark => mark.page)).toEqual([2, 1])
    settings = updateBookmark(settings, first.id, { label: '  حفظ اليوم ', color: 'rose' })
    expect(settings.bookmarks[1]).toMatchObject({ label: 'حفظ اليوم', color: 'rose' })
    settings = updateBookmark(settings, first.id, { label: '' })
    expect(settings.bookmarks[1]?.label).toBeUndefined()
  })

  test('old bookmarks without an id or colour get them; duplicates go', () => {
    const settings = migrateSettings({ bookmarks: [{ page: 5, createdAt: 9 }, { id: 'x', page: 6 }, { id: 'x', page: 7 }] })
    expect(settings.bookmarks).toEqual([
      { id: 'b9-5', page: 5, color: 'gold', createdAt: 9 },
      { id: 'x', page: 6, color: 'gold', createdAt: 0 },
    ])
  })
})
