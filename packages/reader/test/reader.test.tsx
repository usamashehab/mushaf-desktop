import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { PackLayout, QuranMeta, SearchText, Settings } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'

import { fitFontSize, prefersSpread } from '../src/geometry.ts'
import { surahNameGlyphs } from '../src/MushafPage.tsx'
import { Reader, type AgentAlert, type AgentSession, type AgentsBridge, type Integration, type Platform, type ReaderData } from '../src/index.ts'

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
    // The page, its margins and the cover either side, beside the page edges' 12px.
    expect(tall).toBeCloseTo((600 - 24) / (lineEm * 1.07 + 3.2 + 1.5), 1)
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

describe('agents', () => {
  /** A bridge the test drives by hand. */
  function bridge(sessions: AgentSession[] = []) {
    const listeners: { alert?: (alert: AgentAlert) => void; sessions?: (sessions: AgentSession[]) => void; open?: (place: string) => void } = {}
    let integrations: Integration[] = [
      { id: 'claude', name: 'Claude Code', status: 'off', note: null, configPath: '', error: null },
      { id: 'codex', name: 'Codex', status: 'missing', note: null, configPath: '', error: null },
    ]
    const calls: string[] = []
    const agents: AgentsBridge = {
      state: async () => ({ sessions, pausedUntil: null }),
      onSessions: listener => ((listeners.sessions = listener), () => {}),
      onAlert: listener => ((listeners.alert = listener), () => {}),
      onPause: () => () => {},
      onOpenPlace: listener => ((listeners.open = listener), () => {}),
      takeOpenPlace: async () => null,
      pause: async until => void calls.push(`pause ${until === null ? 'off' : 'on'}`),
      integrations: async () => integrations,
      setIntegration: async (id, on) => {
        calls.push(`${on ? 'install' : 'uninstall'} ${id}`)
        integrations = integrations.map(one => (one.id === id ? { ...one, status: on ? 'on' : 'off' } : one))

        return integrations.find(one => one.id === id) as Integration
      },
    }

    return { agents, listeners, calls }
  }

  test('a working agent shows in the top bar, and its finish as a banner', async () => {
    const { agents, listeners } = bridge([{ agent: 'claude', session: 's', project: 'shop', started_at: Date.now() - 3 * 60_000, opened: true }])
    render(<Reader data={data} platform={{ ...platform(), agents }} settings={{ page: 50 }} />)
    expect(await screen.findByText(/Claude يعمل — ٣ د/)).toBeTruthy()
    act(() => {
      listeners.sessions?.([])
      listeners.alert?.({ agent: 'claude', project: 'shop', kind: 'finished', at: 1, workedMs: 4 * 60_000, sound: false })
    })
    expect(screen.queryByText(/Claude يعمل/)).toBeNull()
    expect(screen.getByText('أنهى Claude عمله')).toBeTruthy()
    expect(screen.getByText('shop — بعد ٤ د')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'إخفاء' }))
    expect(screen.queryByText('أنهى Claude عمله')).toBeNull()
  })

  test('mushaf open goes to the place it was given', async () => {
    const { agents, listeners } = bridge()
    render(<Reader data={data} platform={{ ...platform(), agents }} settings={{ page: 50, spread: 'single' }} />)
    await waitFor(() => expect(listeners.open).toBeDefined())
    act(() => listeners.open?.('2:255'))
    expect(document.querySelector('.mushaf-page')?.getAttribute('data-page')).toBe('42')
  })

  test('the settings tab connects an agent and sets its minutes', async () => {
    const { agents, calls } = bridge()
    const shown = platform()
    render(<Reader data={data} platform={{ ...shown, agents }} settings={{ page: 50, language: 'en' }} />)
    fireEvent.click(screen.getByTitle('Settings'))
    const connect = await screen.findByRole('switch', { name: 'Connect Claude Code' })
    expect(screen.getByRole('switch', { name: 'Connect Codex' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(connect)
    await screen.findByText('Connected')
    fireEvent.change(screen.getByRole('combobox', { name: /Open the Mushaf after/ }), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('switch', { name: 'A soft chime with each alert' }))
    fireEvent.click(screen.getByText('Pause until tomorrow'))
    expect(calls).toEqual(['install claude', 'pause on'])
    await waitFor(() => {
      const last = shown.saved.at(-1)
      expect(last?.agents['claude']?.openAfterMinutes).toBe(5)
      expect(last?.alerts.sound).toBe(true)
    })
  })

  test('without a bridge there is no agents section', () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50, language: 'en' }} />)
    fireEvent.click(screen.getByTitle('Settings'))
    expect(screen.queryByText('Coding agents')).toBeNull()
    expect(screen.getByText('Language')).toBeTruthy()
  })
})
