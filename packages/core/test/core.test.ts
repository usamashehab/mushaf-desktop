import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import {
  DEFAULT_SETTINGS,
  agentSettings,
  findSurah,
  foldArabic,
  migrateSettings,
  pageInfo,
  pageOfAyah,
  pageOfJuz,
  parseGoTo,
  quarterLabel,
  spreadOf,
  toArabicDigits,
  toLatinDigits,
  turn,
  type QuranMeta,
} from '../src/index.ts'

const meta = JSON.parse(
  readFileSync(new URL('../../../data/quran-meta.json', import.meta.url), 'utf8'),
) as QuranMeta

describe('go to', () => {
  const to = (input: string) => {
    const result = parseGoTo(input, meta)

    return result.ok ? result.to : result.error
  }

  test('a number is a page', () => {
    expect(to('50')).toEqual({ kind: 'page', page: 50 })
    expect(to(' 604 ')).toEqual({ kind: 'page', page: 604 })
    expect(to('٥٠')).toEqual({ kind: 'page', page: 50 })
    expect(to('0')).toBe('no-such-page')
    expect(to('605')).toBe('no-such-page')
  })

  test('surah:ayah, however it is written, goes to the page the ayah starts on', () => {
    const kursi = { kind: 'ayah', surah: 2, ayah: 255, page: 42 }
    expect(to('2:255')).toEqual(kursi)
    expect(to('2.255')).toEqual(kursi)
    expect(to('2 255')).toEqual(kursi)
    expect(to('٢:٢٥٥')).toEqual(kursi)
    expect(to('114:6')).toEqual({ kind: 'ayah', surah: 114, ayah: 6, page: 604 })
    expect(to('2:287')).toBe('no-such-ayah')
    expect(to('115:1')).toBe('no-such-ayah')
  })

  test('a juz goes to its first page', () => {
    expect(to('juz 2')).toEqual({ kind: 'juz', juz: 2, page: 22 })
    expect(to('جزء ٣٠')).toEqual({ kind: 'juz', juz: 30, page: 582 })
    expect(to('juz 31')).toBe('no-such-juz')
  })

  test('a surah by name, Arabic or transliterated, with or without an ayah', () => {
    expect(to('البقرة')).toEqual({ kind: 'surah', surah: 2, page: 2 })
    expect(to('سورة البقرة')).toEqual({ kind: 'surah', surah: 2, page: 2 })
    expect(to('baqara')).toEqual({ kind: 'surah', surah: 2, page: 2 })
    expect(to('Al-Baqarah 255')).toEqual({ kind: 'ayah', surah: 2, ayah: 255, page: 42 })
    expect(to('البقرة ٢٥٥')).toEqual({ kind: 'ayah', surah: 2, ayah: 255, page: 42 })
    expect(to('yasin')).toEqual({ kind: 'surah', surah: 36, page: 440 })
    expect(to('xyzzy')).toBe('not-understood')
    expect(to('')).toBe('empty')
  })

  test('names match without the article, and exact names win over prefixes', () => {
    expect(findSurah(meta, 'nas')).toBe(114)
    expect(findSurah(meta, 'An-Nas')).toBe(114)
    expect(findSurah(meta, 'nasr')).toBe(110)
    expect(findSurah(meta, 'shams')).toBe(91)
    expect(findSurah(meta, 'imran')).toBe(3)
    expect(findSurah(meta, 'الناس')).toBe(114)
    expect(findSurah(meta, 'ناس')).toBe(114)
    expect(findSurah(meta, 'the cow')).toBe(2)
  })
})

describe('navigation', () => {
  test('ayahs and juz map to the pages of the Madinah Mushaf', () => {
    expect(pageOfAyah(meta, { surah: 1, ayah: 1 })).toBe(1)
    expect(pageOfAyah(meta, { surah: 2, ayah: 1 })).toBe(2)
    expect(pageOfAyah(meta, { surah: 18, ayah: 1 })).toBe(293)
    expect(pageOfAyah(meta, { surah: 3, ayah: 0 })).toBeUndefined()
    expect(pageOfJuz(meta, 1)).toBe(1)
    expect(pageOfJuz(meta, 30)).toBe(582)
  })

  test('facing pages put the odd page on the right', () => {
    expect(spreadOf(1)).toEqual([1, 2])
    expect(spreadOf(2)).toEqual([1, 2])
    expect(spreadOf(603)).toEqual([603, 604])
  })

  test('turning stops at the first and last page, by page or by spread', () => {
    expect(turn(1, -1)).toBe(1)
    expect(turn(604, 1)).toBe(604)
    expect(turn(50, 1)).toBe(51)
    expect(turn(50, 1, true)).toBe(51)
    expect(turn(51, 1, true)).toBe(53)
    expect(turn(604, 1, true)).toBe(603)
  })

  test('margin labels name the hizb quarter in Arabic', () => {
    expect(quarterLabel({ hizb: 1, quarter: 0 })).toBe('الحزب ١')
    expect(quarterLabel({ hizb: 3, quarter: 1 })).toBe('ربع الحزب ٣')
    expect(quarterLabel({ hizb: 60, quarter: 3 })).toBe('ثلاثة أرباع الحزب ٦٠')
    expect(pageInfo(meta, 1)).toEqual({ juz: 1, hizb: 1, quarter: 0, quarterStart: { hizb: 1, quarter: 0 } })
    expect(pageInfo(meta, 604)?.juz).toBe(30)
  })
})

describe('text', () => {
  test('digits go both ways', () => {
    expect(toArabicDigits(255)).toBe('٢٥٥')
    expect(toLatinDigits('٢:٢٥٥ ۱۲')).toBe('2:255 12')
  })

  test('folding drops tashkeel and evens out alef, ya and ta marbuta', () => {
    expect(foldArabic('البَقَرَةِ')).toBe('البقره')
    expect(foldArabic('ٱلرَّحۡمَٰنِ')).toBe('الرحمن')
    expect(foldArabic('إِبۡرَٰهِيمَ')).toBe('ابرهيم')
  })
})

describe('settings', () => {
  test('nothing stored gives the defaults', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings('garbage')).toEqual(DEFAULT_SETTINGS)
  })

  test('bad values fall back, out-of-range ones are clamped, unknown keys go', () => {
    const settings = migrateSettings({
      page: 900,
      theme: 'purple',
      zoom: 10,
      extra: true,
      bookmarks: [{ page: 42, surah: 2, ayah: 255, createdAt: 5 }, { page: 0 }, 'x'],
      agents: { codex: { openAfterMinutes: -3 }, claude: { enabled: false } },
    })
    expect(settings.page).toBe(604)
    expect(settings.theme).toBe('day')
    expect(settings.zoom).toBe(3)
    expect('extra' in settings).toBe(false)
    expect(settings.bookmarks).toEqual([{ id: 'b5-42', page: 42, surah: 2, ayah: 255, color: 'gold', createdAt: 5 }])
    expect(settings.agents['codex']).toEqual({ enabled: true, openAfterMinutes: 0 })
    expect(settings.agents['claude']).toEqual({ enabled: false, openAfterMinutes: 2 })
  })

  test('an agent without its own settings uses the defaults', () => {
    const settings = migrateSettings({ agentDefaults: { openAfterMinutes: 5 } })
    expect(agentSettings(settings, 'gemini')).toEqual({ enabled: true, openAfterMinutes: 5 })
  })

  test('alerts default to a banner only, with the Mushaf brought to the front once the user is idle', () => {
    expect(DEFAULT_SETTINGS.alerts).toEqual({ openStyle: 'front', onlyWhenIdle: true, notify: false, notifyWhenClosed: false, sound: false })
    const settings = migrateSettings({ alerts: { notify: true, sound: 'loud', pausedUntil: 5, openStyle: 'sideways' } })
    expect(settings.alerts).toEqual({ openStyle: 'front', onlyWhenIdle: true, notify: true, notifyWhenClosed: false, sound: false })
    // "Bring to the front" off, from before there was a choice.
    expect(migrateSettings({ alerts: { focusOnOpen: false } }).alerts.openStyle).toBe('behind')
    expect(migrateSettings({ alerts: { openStyle: 'notify', onlyWhenIdle: false } }).alerts).toMatchObject({ openStyle: 'notify', onlyWhenIdle: false })
  })
})
