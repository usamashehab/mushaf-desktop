import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { PackLayout, QuranMeta, SearchText, Settings } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'

import { fitFontSize, prefersSpread } from '../src/geometry.ts'
import { surahNameGlyphs } from '../src/MushafPage.tsx'
import { Reader, type Platform, type ReaderData } from '../src/index.ts'

import layout from '../../../data/packs/qcf-v2/layout.json' with { type: 'json' }
import manifest from '../../../data/packs/qcf-v2/manifest.json' with { type: 'json' }
import meta from '../../../data/quran-meta.json' with { type: 'json' }
import searchText from '../../../data/search-text.json' with { type: 'json' }

const data: ReaderData = {
  meta: meta as QuranMeta,
  manifest: manifest as PackManifest,
  layout: layout as PackLayout,
  searchText: searchText as SearchText,
}
const lineEm = data.layout.lineEm

const platform = (): Platform & { saved: Settings[] } => {
  const saved: Settings[] = []

  return {
    saved,
    pageFontUrl: (_, page) => `/fonts/p${page}.woff2`,
    extraFontUrl: (_, which) => `/fonts/${which}`,
    loadSettings: async () => null,
    saveSettings: async settings => {
      saved.push(settings)
    },
  }
}

afterEach(cleanup)

describe('page geometry', () => {
  test('the font size fits the page to the tighter of width and height', () => {
    const tall = fitFontSize({ width: 600, height: 4000, lineEm, pages: 1, zoom: 1 })
    const wide = fitFontSize({ width: 4000, height: 800, lineEm, pages: 1, zoom: 1 })
    expect(tall).toBeCloseTo(600 / (lineEm * 1.07 + 3.2), 1)
    expect(wide).toBeLessThan(800 / 30)
    expect(fitFontSize({ width: 600, height: 4000, lineEm, pages: 1, zoom: 1.5 })).toBeCloseTo(tall * 1.5, 0)
  })

  test('two pages face each other only when the window is wide', () => {
    expect(prefersSpread(1600, 1000, lineEm)).toBe(true)
    expect(prefersSpread(1000, 1100, lineEm)).toBe(false)
  })

  test('surah names are drawn as the name glyph then "سورة"', () => {
    expect(surahNameGlyphs(1)).toBe('')
    expect(surahNameGlyphs(99)).toBe('')
    expect(surahNameGlyphs(114)).toBe('')
  })
})

describe('the reader', () => {
  const shownPages = () => [...document.querySelectorAll<HTMLElement>('.mushaf-page')].map(page => Number(page.dataset['page']))

  test('opens on the saved page and turns leftward, a spread at a time in a wide window', async () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50 }} />)
    await waitFor(() => expect(shownPages()).toEqual([49, 50]))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(shownPages()).toEqual([51, 52])
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(shownPages()).toEqual([47, 48])
  })

  test('single pages turn one at a time', async () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50, spread: 'single' }} />)
    await waitFor(() => expect(shownPages()).toEqual([50]))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(shownPages()).toEqual([51])
    fireEvent.keyDown(window, { key: 'End' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(shownPages()).toEqual([604])
  })

  const search = async (text: string) => {
    const input = await screen.findByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: text } })

    return input
  }

  test('go to an ayah shows its page with the ayah picked out', async () => {
    render(<Reader data={data} platform={platform()} settings={{ spread: 'single' }} />)
    const input = await search('٢:٢٥٥')
    await screen.findByRole('option', { name: /البقرة، الآية ٢٥٥/ })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(shownPages()).toEqual([42]))
    const picked = [...document.querySelectorAll<HTMLElement>('.mushaf-word.is-active')]
    expect(new Set(picked.map(word => word.dataset['ayah']))).toEqual(new Set(['2:255']))
    expect(picked.at(-1)?.dataset['text']).toBe('٢٥٥')
  })

  test('words search the ayahs, and a result opens its page', async () => {
    render(<Reader data={data} platform={platform()} settings={{ spread: 'single' }} />)
    await search('لا تأخذه سنة ولا نوم')
    const result = await screen.findByRole('option', { name: /البقرة · ٢٥٥/ })
    expect(result.querySelector('mark')?.textContent).toBe('لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ')
    fireEvent.click(result)
    await waitFor(() => expect(shownPages()).toEqual([42]))
  })

  test('a search that finds nothing says so, in the interface language', async () => {
    render(<Reader data={data} platform={platform()} settings={{ language: 'en' }} />)
    await search('xyzzy')
    expect(await screen.findByText(/Nothing found/)).toBeInTheDocument()
  })

  test('B bookmarks the page, D changes the theme, and settings are saved', async () => {
    vi.useFakeTimers()
    const where = platform()
    render(<Reader data={data} platform={where} settings={{ page: 77, spread: 'single' }} />)
    fireEvent.keyDown(window, { key: 'b' })
    fireEvent.keyDown(window, { key: 'd' })
    await act(() => vi.advanceTimersByTimeAsync(500))
    vi.useRealTimers()
    const last = where.saved.at(-1)
    expect(last?.bookmarks.map(mark => mark.page)).toEqual([77])
    expect(last?.theme).toBe('sepia')
    expect(document.querySelector('.reader')?.getAttribute('data-theme')).toBe('sepia')
    expect(document.querySelector('.mushaf-ribbon')).not.toBeNull()
  })

  test('bookmarks are listed, and one removed comes back with undo', async () => {
    const settings = {
      spread: 'single',
      bookmarks: [
        { id: 'a', page: 42, surah: 2, ayah: 255, color: 'green', createdAt: 2 },
        { id: 'b', page: 7, color: 'gold', createdAt: 1, label: 'حفظ' },
      ],
    }
    render(<Reader data={data} platform={platform()} settings={settings} />)
    fireEvent.keyDown(window, { key: 'm' })
    const rows = () => [...document.querySelectorAll('.bookmark-title')].map(title => title.textContent)
    expect(rows()).toEqual(['البقرة · ٢٥٥', 'حفظ'])
    fireEvent.click(screen.getAllByRole('button', { name: 'احذف العلامة' })[0] as HTMLElement)
    expect(rows()).toEqual(['حفظ'])
    fireEvent.click(await screen.findByRole('button', { name: 'تراجع' }))
    expect(rows()).toEqual(['البقرة · ٢٥٥', 'حفظ'])
    fireEvent.click(screen.getByRole('button', { name: /حفظ/ }))
    expect(shownPages()).toEqual([7])
  })
})
