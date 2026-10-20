import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { PackLayout, QuranMeta, SearchText, Settings } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'

import { fitFontSize, prefersSpread } from '../src/geometry.ts'
import { surahNameGlyphs } from '../src/MushafPage.tsx'
import {
  Reader,
  type AgentAlert,
  type AgentSession,
  type AgentsBridge,
  type Integration,
  type Library,
  type Platform,
  type ReaderData,
  type Recitation,
} from '../src/index.ts'

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
    pageFont: (_, page) => `/fonts/p${page}.woff2`,
    extraFont: (_, which) => `/fonts/${which}`,
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

  test('says where it is: the last page in view, and whether it turned or went straight there', async () => {
    const moves: [number, string][] = []
    render(<Reader data={data} platform={platform()} settings={{ page: 50 }} onNavigate={(page, kind) => moves.push([page, kind])} />)
    await waitFor(() => expect(shownPages()).toEqual([49, 50]))
    await waitFor(() => expect(moves.at(-1)).toEqual([50, 'jump']))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await waitFor(() => expect(moves.at(-1)).toEqual([52, 'turn']))
    fireEvent.keyDown(window, { key: 'End' })
    await waitFor(() => expect(moves.at(-1)).toEqual([604, 'jump']))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(moves.at(-1)).toEqual([602, 'turn']))
    const input = await search('٥٠')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(moves.at(-1)).toEqual([50, 'jump']))
  })

  test('fonts can come as bytes, asked for only when not loaded yet', async () => {
    const asked: number[] = []
    const bytes: Platform = {
      ...platform(),
      pageFont: (_, page) => async () => {
        asked.push(page)

        return new ArrayBuffer(8)
      },
    }
    render(<Reader data={data} platform={bytes} settings={{ page: 300, spread: 'single' }} />)
    await waitFor(() => expect(shownPages()).toEqual([300]))
    await waitFor(() => expect(asked).toContain(300))
    expect(asked.filter(page => page === 300)).toHaveLength(1)
    expect(asked).toEqual(expect.arrayContaining([301, 299, 302]))
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

  const activeAyahs = () => new Set([...document.querySelectorAll<HTMLElement>('.mushaf-word.is-active')].map(word => word.dataset['ayah']))
  const wordOf = (ayah: string) =>
    waitFor(() => {
      const word = document.querySelector<HTMLElement>(`.mushaf-word[data-ayah="${ayah}"]`)
      if (!word) {
        throw new Error(`no word of ${ayah}`)
      }

      return word
    })

  test('a click picks an ayah; a second click, or one off the book, lets it go', async () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50, spread: 'single' }} />)
    const word = await wordOf('3:5')
    fireEvent.click(word)
    expect(activeAyahs()).toEqual(new Set(['3:5']))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(word)
    expect(activeAyahs()).toEqual(new Set())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(word)
    fireEvent.click(document.querySelector('.view')!)
    expect(activeAyahs()).toEqual(new Set())
  })

  test('copying the ayah lets it go', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<Reader data={data} platform={platform()} settings={{ page: 50, spread: 'single' }} />)
    fireEvent.click(await wordOf('3:5'))
    fireEvent.click(screen.getByRole('menuitem', { name: /انسخ الآية/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(activeAyahs()).toEqual(new Set())
  })

  test('a sideways drag turns the page, rightward to the next, and picks no ayah', async () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50, spread: 'single' }} />)
    const drag = (target: HTMLElement, dx: number, dy = 0) => {
      fireEvent.pointerDown(target, { button: 0, clientX: 500, clientY: 400 })
      fireEvent.pointerMove(window, { clientX: 500 + dx, clientY: 400 + dy })
      fireEvent.pointerUp(window, { clientX: 500 + dx, clientY: 400 + dy })
      fireEvent.click(target)
    }
    drag(await wordOf('3:5'), 120)
    expect(shownPages()).toEqual([51])
    expect(activeAyahs()).toEqual(new Set())
    drag(document.querySelector<HTMLElement>('.mushaf-word')!, -120)
    expect(shownPages()).toEqual([50])
    drag(await wordOf('3:5'), 10, 120)
    expect(shownPages()).toEqual([50])
    expect(activeAyahs()).toEqual(new Set())
  })

  test('a two-finger swipe turns one page a gesture, fingers rightward to the next', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<Reader data={data} platform={platform()} settings={{ page: 50, spread: 'single' }} />)
      await waitFor(() => expect(shownPages()).toEqual([50]))
      const view = document.querySelector('.view')!
      fireEvent.wheel(view, { deltaX: -40 })
      fireEvent.wheel(view, { deltaX: -40 })
      fireEvent.wheel(view, { deltaX: -40 })
      expect(shownPages()).toEqual([51])
      act(() => vi.advanceTimersByTime(300))
      fireEvent.wheel(view, { deltaX: 80 })
      expect(shownPages()).toEqual([50])
      fireEvent.wheel(view, { deltaY: 80, deltaX: 20 })
      expect(shownPages()).toEqual([50])
    } finally {
      vi.useRealTimers()
    }
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

  test('F turns on focus mode: once the mouse rests the bars fade, and a move brings them back', async () => {
    vi.useFakeTimers()
    render(<Reader data={data} platform={platform()} settings={{ page: 77, spread: 'single' }} />)
    const reader = document.querySelector('.reader')
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(reader).not.toHaveClass('is-calm')
    fireEvent.keyDown(window, { key: 'f' })
    await act(() => vi.advanceTimersByTimeAsync(3100))
    vi.useRealTimers()
    expect(reader).toHaveClass('is-calm')
    fireEvent.pointerMove(window)
    expect(reader).not.toHaveClass('is-calm')
  })

  test('the auto theme follows the system into the night', () => {
    const matchMedia = window.matchMedia
    window.matchMedia = (query => ({ ...matchMedia(query), matches: query.includes('dark') || query.includes('reduce') })) as typeof window.matchMedia
    try {
      render(<Reader data={data} platform={platform()} settings={{ theme: 'auto' }} />)
      expect(document.querySelector('.reader')?.getAttribute('data-theme')).toBe('night')
    } finally {
      window.matchMedia = matchMedia
    }
  })

  test('a page in view twenty seconds counts toward the daily goal', async () => {
    vi.useFakeTimers()
    const where = platform()
    render(<Reader data={data} platform={where} settings={{ page: 77, spread: 'single', language: 'en', reading: { goal: 2 } }} />)
    await act(() => vi.advanceTimersByTimeAsync(19_000))
    expect(screen.getByRole('button', { name: 'Pages today: 0 of 2' })).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    expect(screen.getByRole('button', { name: 'Pages today: 1 of 2' })).toBeInTheDocument()
    // Saved a moment after.
    await act(() => vi.advanceTimersByTimeAsync(500))
    vi.useRealTimers()
    expect(where.saved.at(-1)?.reading).toMatchObject({ today: [77], khatma: [77] })
  })

  test('the paper warms from the settings', () => {
    render(<Reader data={data} platform={platform()} settings={{ language: 'en' }} />)
    fireEvent.click(screen.getByTitle('Settings'))
    fireEvent.change(screen.getByLabelText('Paper warmth'), { target: { value: '0.5' } })
    expect(document.querySelector<HTMLElement>('.reader')?.style.getPropertyValue('--warmth')).toBe('0.5')
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
    expect(screen.queryByRole('combobox', { name: /Open the Mushaf after/ })).toBeNull()
    fireEvent.click(connect)
    // Just connected, it opens to show its minutes; a click on its name folds it back.
    await screen.findByText('Connected — opens after 2 minutes')
    fireEvent.change(screen.getByRole('combobox', { name: /Open the Mushaf after/ }), { target: { value: '5' } })
    const name = screen.getByRole('button', { expanded: true })
    fireEvent.click(name)
    expect(screen.queryByRole('combobox', { name: /Open the Mushaf after/ })).toBeNull()
    expect(name.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('switch', { name: 'A soft chime with each alert' }))
    expect(screen.getByRole('button', { name: 'Open in front' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Notify only' }))
    fireEvent.click(screen.getByRole('switch', { name: "Only when I'm away from the keyboard" }))
    fireEvent.click(screen.getByText('Pause until tomorrow'))
    expect(calls).toEqual(['install claude', 'pause on'])
    await waitFor(() => {
      const last = shown.saved.at(-1)
      expect(last?.agents['claude']?.openAfterMinutes).toBe(5)
      expect(last?.alerts).toMatchObject({ sound: true, openStyle: 'notify', onlyWhenIdle: false })
    })
  })

  test('without a bridge there is no agents section', () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50, language: 'en' }} />)
    fireEvent.click(screen.getByTitle('Settings'))
    expect(screen.queryByText('Coding agents')).toBeNull()
    expect(screen.getByText('Language')).toBeTruthy()
  })
})

describe('tafsir and recitation', () => {
  const shownPages = () => [...document.querySelectorAll<HTMLElement>('.mushaf-page')].map(page => Number(page.dataset['page']))
  const wordOf = (ayah: string) =>
    waitFor(() => {
      const word = document.querySelector<HTMLElement>(`.mushaf-word[data-ayah="${ayah}"]`)
      if (!word) {
        throw new Error(`no word of ${ayah}`)
      }

      return word
    })

  // Ayahs 3:8 and 3:9 on page 50, 3:10 on page 51, a word heard in each.
  const recitation: Recitation = {
    audio: 'https://audio.test/3.mp3',
    ayahs: [
      { ayah: 8, from: 0, to: 500, words: [{ position: 1, from: 0, to: 300 }] },
      { ayah: 9, from: 500, to: 1000, words: [{ position: 1, from: 500, to: 800 }] },
      { ayah: 10, from: 1000, to: 2000, words: [{ position: 1, from: 1000, to: 1500 }] },
    ],
  }

  const withLibrary = (library: Partial<Library> = {}) => {
    const base = platform()
    const full: Library = {
      tafsir: vi.fn(async (_, ayah) => ({ ayahs: [ayah], html: `<p>Tafsir of ${ayah.surah}:${ayah.ayah}</p>` })),
      translation: vi.fn(async ayah => `Meaning of ${ayah.surah}:${ayah.ayah}<sup foot_note=1>1</sup>`),
      recitation: vi.fn(async () => recitation),
      ...library,
    }

    return { ...base, library: full }
  }

  test('without a library there is no tafsir or recitation to offer', async () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50, spread: 'single' }} />)
    fireEvent.click(await wordOf('3:5'))
    expect(screen.queryByRole('menuitem', { name: /التفسير/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /استمع/ })).not.toBeInTheDocument()
  })

  test("an ayah's tafsir opens from its menu, in English with each ayah's meaning first", async () => {
    const where = withLibrary({
      tafsir: vi.fn(async () => ({
        ayahs: [
          { surah: 3, ayah: 5 },
          { surah: 3, ayah: 6 },
        ],
        html: '<h2>Allah knows all</h2><p>He knows <b>all</b>.</p><p>هُوَ ٱلَّذِى</p>',
      })),
    })
    render(<Reader data={data} platform={where} settings={{ page: 50, spread: 'single', language: 'en' }} />)
    fireEvent.click(await wordOf('3:5'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Tafsir/ }))
    expect(await screen.findByRole('heading', { name: 'Allah knows all' })).toBeInTheDocument()
    expect(where.library.tafsir).toHaveBeenCalledWith('ibn-kathir-en', { surah: 3, ayah: 5 })
    expect(screen.getByText('Ayahs 5–6, explained together')).toBeInTheDocument()
    expect(screen.getByText('Meaning of 3:6')).toBeInTheDocument()
    // The footnote mark goes; the Arabic quoted finds its own direction.
    expect(document.querySelector('.tafsir sup')).toBeNull()
    expect(screen.getByText('هُوَ ٱلَّذِى')).toHaveAttribute('dir', 'auto')

    // The next ayah is the one after those explained together.
    fireEvent.click(screen.getByRole('button', { name: 'Next ayah' }))
    await waitFor(() => expect(where.library.tafsir).toHaveBeenLastCalledWith('ibn-kathir-en', { surah: 3, ayah: 7 }))
  })

  test('a tafsir that fails to load can be tried again', async () => {
    let fail = true
    const where = withLibrary({
      tafsir: vi.fn(async (_, ayah) => {
        if (fail) {
          fail = false
          throw new Error('offline')
        }

        return { ayahs: [ayah], html: '<p>الله لا إله إلا هو</p>' }
      }),
    })
    render(<Reader data={data} platform={where} settings={{ page: 50, spread: 'single' }} />)
    fireEvent.click(await wordOf('3:2'))
    fireEvent.keyDown(window, { key: 't' })
    fireEvent.click(await screen.findByRole('button', { name: /أعد المحاولة/ }))
    expect(await screen.findByText('الله لا إله إلا هو')).toBeInTheDocument()
    expect(where.library.tafsir).toHaveBeenCalledWith('muyassar', { surah: 3, ayah: 2 })
  })

  test('nothing but plain structure comes through from a source', async () => {
    const where = withLibrary({
      tafsir: vi.fn(async ayah => ({
        ayahs: [{ surah: 3, ayah: 5 }],
        html: `<p onclick="alert(1)">Plain<script>alert(1)</script><img src=x onerror="alert(1)"><a href="https://x.test">link</a></p>${String(ayah)}`,
      })),
    })
    render(<Reader data={data} platform={where} settings={{ page: 50, spread: 'single' }} />)
    fireEvent.click(await wordOf('3:5'))
    fireEvent.keyDown(window, { key: 't' })
    const text = await waitFor(() => {
      const body = document.querySelector('.tafsir-text')
      if (!body) {
        throw new Error('no tafsir yet')
      }

      return body
    })
    expect(text.querySelector('script, img, a, [onclick]')).toBeNull()
    expect(text.textContent).toContain('Plainlink')
  })

  test('a recitation lights the word heard, and turns the page when it reaches the next', async () => {
    // The audio as WebKit plays it: a seek before the length is known is dropped.
    const time = { now: 0, ready: 0 }
    let player: HTMLMediaElement | undefined
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
      player = this
      this.dispatchEvent(new Event('play'))
    })
    const readyState = vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockImplementation(() => time.ready)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'))
    })
    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get: () => time.now,
      set: (value: number) => {
        time.now = value
      },
    })
    try {
      const where = withLibrary()
      render(<Reader data={data} platform={where} settings={{ page: 50, spread: 'single', reciter: 'husary' }} />)
      fireEvent.click(await wordOf('3:9'))
      fireEvent.click(screen.getByRole('menuitem', { name: /استمع/ }))
      await waitFor(() => expect(play).toHaveBeenCalled())
      expect(where.library.recitation).toHaveBeenCalledWith('husary', 3)
      expect(screen.getByRole('region', { name: 'التلاوة' })).toHaveTextContent('محمود خليل الحصري')

      // Dropped, the seek is made again once the length is known; 3:8 is never lit on the way.
      time.now = 0
      await act(() => new Promise(resolve => setTimeout(resolve, 50)))
      expect(document.querySelector('.mushaf-word.is-heard')).toBeNull()
      time.ready = 1
      act(() => {
        player?.dispatchEvent(new Event('loadedmetadata'))
      })

      const audio = await waitFor(() => {
        const heard = document.querySelector('.mushaf-word.is-heard')
        if (!heard) {
          throw new Error('no word heard yet')
        }

        return heard
      })
      expect(audio).toHaveAttribute('data-ayah', '3:9')

      // A second on: 3:10, on the next page.
      time.now = 1.2
      act(() => {
        player?.dispatchEvent(new Event('timeupdate'))
      })
      await waitFor(() => expect(shownPages()).toEqual([51]))
      await waitFor(() => expect(document.querySelector('.mushaf-word.is-heard')).toHaveAttribute('data-ayah', '3:10'))

      fireEvent.click(screen.getByRole('button', { name: 'أنهِ التلاوة' }))
      expect(screen.queryByRole('region', { name: 'التلاوة' })).not.toBeInTheDocument()
      expect(document.querySelector('.mushaf-word.is-heard')).toBeNull()
    } finally {
      // Unmounted while the stand-ins still play the part.
      cleanup()
      play.mockRestore()
      pause.mockRestore()
      readyState.mockRestore()
      if (currentTime) {
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', currentTime)
      }
    }
  })

  test('opened again, the reader shows the ayah it stopped at', async () => {
    render(<Reader data={data} platform={platform()} settings={{ page: 50, spread: 'single', lastAyah: { surah: 3, ayah: 7 } }} />)
    await wordOf('3:7')
    expect(new Set([...document.querySelectorAll<HTMLElement>('.mushaf-word.is-active')].map(word => word.dataset['ayah']))).toEqual(new Set(['3:7']))
    expect(screen.getByText(/توقفت عند/)).toBeInTheDocument()
  })
})
