import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { foldArabic, type PackLayout, type QuranMeta } from '@mushaf/core'

import { applyPatches } from '../src/layout.ts'
import type { SourceWord } from '../src/source.ts'
import { validate } from '../src/validate.ts'

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(`../../../data/${path}`, import.meta.url), 'utf8')) as T
const meta = read<QuranMeta>('quran-meta.json')
const layout = read<PackLayout>('packs/qcf-v2/layout.json')
const page = (n: number) => layout.pages[n - 1]?.lines ?? []

describe('the built data', () => {
  test('passes every check the build makes', () => {
    expect(validate(layout.pages, meta)).toEqual([])
  })

  test('pages 1 and 2 are 8 centred lines under their surah header', () => {
    expect(page(1).map(line => line.t)).toEqual(['surah', 'ayah', 'ayah', 'ayah', 'ayah', 'ayah', 'ayah', 'ayah'])
    expect(page(2).slice(0, 3).map(line => line.t)).toEqual(['surah', 'basmala', 'ayah'])
    expect([...page(1), ...page(2)].every(line => line.t !== 'ayah' || line.c)).toBe(true)
  })

  test('a surah that starts at the top of a page has its header on the page before', () => {
    expect(page(76).at(-1)).toEqual({ t: 'surah', s: 4 })
    expect(page(77)[0]).toEqual({ t: 'basmala', s: 4 })
  })

  test('page 604 holds the last three surahs, short lines centred', () => {
    const kinds = page(604).map(line => (line.t === 'ayah' ? (line.c ? 'centred' : 'ayah') : `${line.t} ${line.s}`))
    expect(kinds).toEqual([
      'surah 112', 'basmala 112', 'ayah', 'centred',
      'surah 113', 'basmala 113', 'ayah', 'ayah', 'centred',
      'surah 114', 'basmala 114', 'ayah', 'ayah', 'centred', 'centred',
    ])
  })

  test('Ayat al-Kursi starts on page 42', () => {
    const first = page(42).flatMap(line => (line.t === 'ayah' ? line.w : [])).find(([s, a, w]) => s === 2 && a === 255 && w === 1)
    expect(foldArabic(first?.[4] ?? '')).toBe('الله')
  })

  test('every word carries its readable text beside the glyph code', () => {
    const words = layout.pages.flatMap(p => p.lines.flatMap(line => (line.t === 'ayah' ? line.w : [])))
    expect(words).toHaveLength(83_665)
    expect(words.every(([, , , code, text]) => /^[-ﬀ-﻿ ]+$/u.test(code) && /[؀-ۿ]/.test(text))).toBe(true)
  })
})

describe('patches', () => {
  const word = (line: number): SourceWord => ({ surah: 1, ayah: 1, position: 1, isEnd: false, code: 'x', text: 'y', page: 1, line })

  test('move a word to its line', () => {
    expect(applyPatches([word(2)], [{ key: '1:1:1', line: 3 }])[0]?.line).toBe(3)
  })

  test('that match nothing fail the build, so stale ones are noticed', () => {
    expect(() => applyPatches([word(2)], [{ key: '9:9:9', line: 3 }])).toThrow('9:9:9')
  })
})
