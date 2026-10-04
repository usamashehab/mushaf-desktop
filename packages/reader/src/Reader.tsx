import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  bookmarksOn,
  clampPage,
  findBookmark,
  migrateSettings,
  spreadOf,
  toggleBookmark,
  turn,
  type AyahRef,
  type Settings,
  type Theme,
} from '@mushaf/core'
import { BookMarked, Bookmark, BookOpen, ChevronLeft, ChevronRight, Columns2, Minus, Moon, Plus, RectangleVertical, Sun, SunMoon } from 'lucide-react'

import { AyahMenu, PageSlider, Toasts, type Picked, type ToastMessage } from './Chrome.tsx'
import { ReaderContext, digitsFor, type ReaderState } from './context.tsx'
import { loadFont } from './fonts.ts'
import { fitFontSize, prefersSpread } from './geometry.ts'
import { stringsFor } from './i18n.ts'
import { MushafPage, SURAH_NAMES_FAMILY } from './MushafPage.tsx'
import type { Platform, ReaderData } from './platform.ts'
import { SearchBox } from './SearchBox.tsx'
import { SidePanel, type PanelTab } from './SidePanel.tsx'

const THEMES: Theme[] = ['day', 'sepia', 'night']
const ZOOM_STEP = 0.1

/** Watches an element's size. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}

export interface ReaderProps {
  data: ReaderData
  platform: Platform
  /** Settings as stored; migrated on the way in. */
  settings: unknown
  /** A page or ayah to open at, overriding the saved page (from `mushaf open 2:255`). */
  openAt?: { page: number; ayah?: AyahRef } | undefined
  /** Shown above the pages: an agent's "finished" banner, for one. */
  banner?: ReactNode
}

/** The whole reader: pages, turning, search and go to, the index, bookmarks, themes and zoom. */
export function Reader({ data, platform, settings: stored, openAt, banner }: ReaderProps) {
  const [settings, setSettings] = useState<Settings>(() => migrateSettings(stored))
  const [active, setActive] = useState<AyahRef>()
  const [picked, setPicked] = useState<Picked>()
  const [panel, setPanel] = useState<PanelTab>()
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [searchFocus, setSearchFocus] = useState(0)
  const [viewRef, view] = useSize<HTMLDivElement>()
  const t = stringsFor(settings.language)
  const n = useMemo(() => digitsFor(settings.language), [settings.language])
  const lineEm = data.layout.lineEm

  const update = useCallback((change: (current: Settings) => Settings) => setSettings(current => change(current)), [])
  const setPage = useCallback((page: number) => update(current => ({ ...current, page: clampPage(page) })), [update])

  const toast = useCallback((message: string, action?: { label: string; run: () => void }) => {
    const id = Date.now() + Math.random()
    setToasts(current => [...current.slice(-2), { id, message, action }])
    setTimeout(() => setToasts(current => current.filter(one => one.id !== id)), action ? 6000 : 2600)
  }, [])

  const open = useCallback(
    (page: number, ayah?: AyahRef) => {
      setPage(page)
      setActive(ayah ? { surah: ayah.surah, ayah: ayah.ayah } : undefined)
      setPicked(undefined)
    },
    [setPage],
  )

  const surahName = useCallback(
    (surah: number) => {
      const one = data.meta.surahs[surah - 1]

      return settings.language === 'ar' ? (one?.nameArabic ?? '') : (one?.nameSimple ?? '')
    },
    [data.meta.surahs, settings.language],
  )

  // Save a moment after the last change, not on every page turned.
  useEffect(() => {
    const timer = setTimeout(() => void platform.saveSettings(settings), 400)

    return () => clearTimeout(timer)
  }, [platform, settings])

  useEffect(() => {
    void loadFont(SURAH_NAMES_FAMILY, platform.extraFontUrl(data.manifest, 'surahNames'), true).catch(() => {})
  }, [platform, data.manifest])

  useEffect(() => {
    if (openAt) {
      open(openAt.page, openAt.ayah)
    }
  }, [openAt, open])

  const isSpread =
    settings.spread === 'double' || (settings.spread === 'auto' && prefersSpread(view.width, view.height, lineEm))
  const pages = isSpread ? spreadOf(settings.page) : [settings.page]
  const fontSize = fitFontSize({ width: view.width - 96, height: view.height - 8, lineEm, pages: isSpread ? 2 : 1, zoom: settings.zoom })

  // Fetch the fonts of the pages either side, so turning shows a drawn page at once.
  useEffect(() => {
    for (const near of [1, 2, -1, -2, 3, -3]) {
      const page = clampPage(settings.page + near)
      void loadFont(`${data.manifest.fonts.familyPrefix}${page}`, platform.pageFontUrl(data.manifest, page)).catch(() => {})
    }
  }, [settings.page, data.manifest, platform])

  const go = (by: number) => {
    setActive(undefined)
    setPicked(undefined)
    update(current => ({ ...current, page: turn(current.page, by, isSpread) }))
  }

  const here = { page: active ? (data.meta.ayahPages[active.surah - 1]?.[active.ayah - 1] ?? settings.page) : settings.page, ayah: active }
  const isBookmarked = findBookmark(settings, here.page, here.ayah) !== undefined
  const toggleHere = () => {
    update(current => toggleBookmark(current, here))
    toast(isBookmarked ? t.bookmarkRemoved : t.bookmarkAdded)
  }
  const cycleTheme = () =>
    update(current => ({ ...current, theme: THEMES[(THEMES.indexOf(current.theme) + 1) % THEMES.length] ?? 'day' }))
  const cycleLayout = () =>
    update(current => ({ ...current, spread: current.spread === 'auto' ? (isSpread ? 'single' : 'double') : current.spread === 'double' ? 'single' : 'double' }))
  const zoom = (by: number) =>
    update(current => ({ ...current, zoom: Math.min(3, Math.max(0.5, Math.round((current.zoom + by) * 10) / 10)) }))
  const togglePanel = (tab: PanelTab) => setPanel(current => (current === tab ? undefined : tab))

  // A Mushaf turns leftward: ← is the next page, → the one before.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && (key === 'k' || key === 'f' || key === 'g')) {
        event.preventDefault()
        setSearchFocus(count => count + 1)

        return
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }
      const actions: Record<string, () => void> = {
        ArrowLeft: () => go(1),
        PageDown: () => go(1),
        ' ': () => go(1),
        ArrowRight: () => go(-1),
        PageUp: () => go(-1),
        Home: () => open(1),
        End: () => open(604),
        '/': () => setSearchFocus(count => count + 1),
        '+': () => zoom(ZOOM_STEP),
        '=': () => zoom(ZOOM_STEP),
        '-': () => zoom(-ZOOM_STEP),
        '0': () => update(current => ({ ...current, zoom: 1 })),
        d: cycleTheme,
        b: toggleHere,
        i: () => togglePanel('surahs'),
        m: () => togglePanel('bookmarks'),
        Escape: () => {
          setPicked(undefined)
          setActive(undefined)
          setPanel(undefined)
        },
      }
      const action = actions[event.key]
      if (action) {
        event.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  })

  const firstWord = data.layout.pages[settings.page - 1]?.lines.flatMap(line => (line.t === 'ayah' ? line.w : [])).at(0)
  const surahOnPage = firstWord?.[0] ?? 1
  const juzOnPage = data.meta.pages[settings.page - 1]?.juz ?? 1
  const onPage = bookmarksOn(settings, pages)

  const state: ReaderState = { data, platform, settings, update, t, n, surahName, open, toast }
  const ThemeIcon = settings.theme === 'night' ? Moon : settings.theme === 'sepia' ? SunMoon : Sun

  return (
    <ReaderContext.Provider value={state}>
      <div className="reader" data-theme={settings.theme} dir={settings.language === 'ar' ? 'rtl' : 'ltr'} lang={settings.language}>
        <header className="top-bar">
          <div className="top-bar-start">
            <span className="brand" aria-label={t.appName}>
              <svg viewBox="0 0 40 40" aria-hidden="true">
                <path d="M20 2l5.3 7.2 8.9-1.4-1.4 8.9L40 20l-7.2 5.3 1.4 8.9-8.9-1.4L20 40l-5.3-7.2-8.9 1.4 1.4-8.9L0 20l7.2-5.3-1.4-8.9 8.9 1.4z" />
                <circle cx="20" cy="20" r="6" />
              </svg>
            </span>
            <button type="button" className="location" onClick={() => togglePanel('surahs')} title={t.index}>
              <span className="location-surah">{surahName(surahOnPage)}</span>
              <span className="location-sub">
                {t.juz} {n(juzOnPage)} · {t.page} {n(settings.page)}
              </span>
            </button>
          </div>
          <SearchBox focusKey={searchFocus} />
          <div className="top-bar-end">
            <button type="button" className={`icon-button${isBookmarked ? ' is-on' : ''}`} onClick={toggleHere} title={`${isBookmarked ? t.removeBookmark : t.addBookmark} (B)`} aria-pressed={isBookmarked}>
              <Bookmark size={19} fill={isBookmarked ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className={`icon-button${panel === 'bookmarks' ? ' is-on' : ''}`} onClick={() => togglePanel('bookmarks')} title={`${t.bookmarks} (M)`}>
              <BookMarked size={19} />
              {settings.bookmarks.length > 0 ? <span className="badge">{n(settings.bookmarks.length)}</span> : null}
            </button>
            <button type="button" className={`icon-button${panel === 'surahs' || panel === 'juz' ? ' is-on' : ''}`} onClick={() => togglePanel('surahs')} title={`${t.index} (I)`}>
              <BookOpen size={19} />
            </button>
            <span className="top-bar-divider" />
            <button type="button" className="icon-button" onClick={cycleLayout} title={isSpread ? t.layoutSingle : t.layoutDouble}>
              {isSpread ? <RectangleVertical size={19} /> : <Columns2 size={19} />}
            </button>
            <button type="button" className="icon-button" onClick={cycleTheme} title={`${t.theme}: ${t.themes[settings.theme]} (D)`}>
              <ThemeIcon size={19} />
            </button>
            <span className="zoom">
              <button type="button" className="icon-button" onClick={() => zoom(-ZOOM_STEP)} title={`${t.zoomOut} (−)`}>
                <Minus size={17} />
              </button>
              <button type="button" className="zoom-value" onClick={() => update(current => ({ ...current, zoom: 1 }))} title="0">
                {n(Math.round(settings.zoom * 100))}
                {settings.language === 'ar' ? '٪' : '%'}
              </button>
              <button type="button" className="icon-button" onClick={() => zoom(ZOOM_STEP)} title={`${t.zoomIn} (+)`}>
                <Plus size={17} />
              </button>
            </span>
          </div>
        </header>
        {banner}
        <div className="body">
          {panel ? (
            <SidePanel
              tab={panel}
              onTab={setPanel}
              onClose={() => setPanel(undefined)}
              page={here.page}
              active={active}
              currentSurah={surahOnPage}
              currentJuz={juzOnPage}
            />
          ) : null}
          <main className="view" ref={viewRef}>
            <button type="button" className="turn turn-next" onClick={() => go(1)} aria-label={t.next} title={`${t.next} (←)`}>
              <ChevronLeft size={28} />
            </button>
            <button type="button" className="turn turn-previous" onClick={() => go(-1)} aria-label={t.previous} title={`${t.previous} (→)`}>
              <ChevronRight size={28} />
            </button>
            {view.width > 0 ? (
              // Facing pages read right to left, whatever the interface language.
              <div className="spread" dir="rtl" key={pages.join('-')}>
                {pages.map(page => (
                  <MushafPage
                    key={page}
                    data={data}
                    platform={platform}
                    page={page}
                    fontSize={fontSize}
                    active={active}
                    bookmarks={onPage}
                    onPickAyah={(ayah, x, y) => {
                      setActive(ayah)
                      setPicked({ ayah, page, x, y })
                    }}
                    loadingText={t.loading}
                  />
                ))}
              </div>
            ) : null}
          </main>
        </div>
        <PageSlider page={settings.page} onPage={page => open(page)} />
        {picked ? <AyahMenu picked={picked} onClose={() => setPicked(undefined)} /> : null}
        <Toasts toasts={toasts} onDone={id => setToasts(current => current.filter(one => one.id !== id))} />
      </div>
    </ReaderContext.Provider>
  )
}
