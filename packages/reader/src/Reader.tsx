import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import {
  clampPage,
  migrateSettings,
  pageOfAyah,
  parseGoTo,
  spreadOf,
  toArabicDigits,
  turn,
  type AyahRef,
  type Settings,
  type Theme,
} from '@mushaf/core'

import { loadFont } from './fonts.ts'
import { fitFontSize, prefersSpread } from './geometry.ts'
import { stringsFor } from './i18n.ts'
import { MushafPage, SURAH_NAMES_FAMILY } from './MushafPage.tsx'
import type { Platform, ReaderData } from './platform.ts'

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

/** The whole reader: pages, turning, go to, bookmarks, themes and zoom. */
export function Reader({ data, platform, settings: stored, openAt, banner }: ReaderProps) {
  const [settings, setSettings] = useState<Settings>(() => migrateSettings(stored))
  const [active, setActive] = useState<AyahRef>()
  const [goTo, setGoTo] = useState('')
  const [message, setMessage] = useState<string>()
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [viewRef, view] = useSize<HTMLDivElement>()
  const goToRef = useRef<HTMLInputElement>(null)
  const t = stringsFor(settings.language)
  const lineEm = data.layout.lineEm

  const update = useCallback((change: (current: Settings) => Settings) => setSettings(current => change(current)), [])
  const setPage = useCallback((page: number) => update(current => ({ ...current, page: clampPage(page) })), [update])

  // Save a moment after the last change, not on every page turned.
  useEffect(() => {
    const timer = setTimeout(() => void platform.saveSettings(settings), 400)

    return () => clearTimeout(timer)
  }, [platform, settings])

  useEffect(() => {
    void loadFont(SURAH_NAMES_FAMILY, platform.extraFontUrl(data.manifest, 'surahNames'), true)
  }, [platform, data.manifest])

  useEffect(() => {
    if (openAt) {
      setPage(openAt.page)
      setActive(openAt.ayah)
    }
  }, [openAt, setPage])

  const isSpread =
    settings.spread === 'double' || (settings.spread === 'auto' && prefersSpread(view.width, view.height, lineEm))
  const pages = isSpread ? spreadOf(settings.page) : [settings.page]
  const fontSize = fitFontSize({ width: view.width, height: view.height, lineEm, pages: isSpread ? 2 : 1, zoom: settings.zoom })

  // Fetch the fonts of the pages either side, so turning shows a drawn page at once.
  useEffect(() => {
    for (const near of [1, 2, -1, -2, 3, -3]) {
      const page = clampPage(settings.page + near)
      void loadFont(`${data.manifest.fonts.familyPrefix}${page}`, platform.pageFontUrl(data.manifest, page)).catch(() => {})
    }
  }, [settings.page, data.manifest, platform])

  const go = (by: number) => {
    setActive(undefined)
    update(current => ({ ...current, page: turn(current.page, by, isSpread) }))
  }

  const submitGoTo = () => {
    const result = parseGoTo(goTo, data.meta)
    if (!result.ok) {
      setMessage(t.errors[result.error])

      return
    }
    setMessage(undefined)
    setGoTo('')
    setPage(result.to.page)
    setActive(result.to.kind === 'ayah' ? { surah: result.to.surah, ayah: result.to.ayah } : undefined)
    goToRef.current?.blur()
  }

  const bookmarked = settings.bookmarks.find(mark => pages.includes(mark.page))
  const toggleBookmark = () =>
    update(current => ({
      ...current,
      bookmarks: bookmarked
        ? current.bookmarks.filter(mark => mark !== bookmarked)
        : [
            ...current.bookmarks,
            { page: current.page, ...(active ? { surah: active.surah, ayah: active.ayah } : {}), createdAt: Date.now() },
          ],
    }))
  const cycleTheme = () =>
    update(current => ({ ...current, theme: THEMES[(THEMES.indexOf(current.theme) + 1) % THEMES.length] ?? 'day' }))
  const zoom = (by: number) =>
    update(current => ({ ...current, zoom: Math.min(3, Math.max(0.5, Math.round((current.zoom + by) * 10) / 10)) }))

  // A Mushaf turns leftward: ← is the next page, → the one before.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        goToRef.current?.focus()

        return
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }
      const actions: Record<string, () => void> = {
        ArrowLeft: () => go(1),
        PageDown: () => go(1),
        ArrowRight: () => go(-1),
        PageUp: () => go(-1),
        Home: () => setPage(1),
        End: () => setPage(604),
        '/': () => goToRef.current?.focus(),
        '+': () => zoom(ZOOM_STEP),
        '=': () => zoom(ZOOM_STEP),
        '-': () => zoom(-ZOOM_STEP),
        '0': () => update(current => ({ ...current, zoom: 1 })),
        d: cycleTheme,
        b: toggleBookmark,
        Escape: () => setActive(undefined),
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

  const surahOnPage = data.layout.pages[settings.page - 1]?.lines.flatMap(line => (line.t === 'ayah' ? line.w : [])).at(0)?.[0] ?? 1
  const juzOnPage = data.meta.pages[settings.page - 1]?.juz ?? 1

  return (
    <div className="mushaf-reader" data-theme={settings.theme} dir={settings.language === 'ar' ? 'rtl' : 'ltr'}>
      <nav className="mushaf-toolbar">
        <form
          className="mushaf-goto"
          onSubmit={event => {
            event.preventDefault()
            submitGoTo()
          }}
        >
          <input
            ref={goToRef}
            value={goTo}
            onChange={event => setGoTo(event.target.value)}
            placeholder={`${t.goTo}: ${t.goToHint}`}
            aria-label={t.goTo}
            dir="auto"
          />
        </form>
        <select
          aria-label={t.surah}
          value={surahOnPage}
          onChange={event => setPage(pageOfAyah(data.meta, { surah: Number(event.target.value), ayah: 1 }) ?? 1)}
        >
          {data.meta.surahs.map(surah => (
            <option key={surah.number} value={surah.number}>
              {settings.language === 'ar' ? `${toArabicDigits(surah.number)}. ${surah.nameArabic}` : `${surah.number}. ${surah.nameSimple}`}
            </option>
          ))}
        </select>
        <select
          aria-label={t.juz}
          value={juzOnPage}
          onChange={event => {
            const start = data.meta.juzStarts[Number(event.target.value) - 1]
            setPage((start && pageOfAyah(data.meta, start)) ?? 1)
          }}
        >
          {data.meta.juzStarts.map((_, i) => (
            <option key={i} value={i + 1}>
              {`${t.juz} ${settings.language === 'ar' ? toArabicDigits(i + 1) : i + 1}`}
            </option>
          ))}
        </select>
        <span className="mushaf-toolbar-gap" />
        <button type="button" onClick={() => go(-1)} title={`${t.previous} (→)`} aria-label={t.previous}>
          ‹
        </button>
        <span className="mushaf-page-number">{settings.language === 'ar' ? toArabicDigits(settings.page) : settings.page}</span>
        <button type="button" onClick={() => go(1)} title={`${t.next} (←)`} aria-label={t.next}>
          ›
        </button>
        <button type="button" className={bookmarked ? 'is-on' : ''} onClick={toggleBookmark} title={`${t.bookmark} (B)`} aria-pressed={!!bookmarked}>
          🔖
        </button>
        <button type="button" onClick={() => setShowBookmarks(shown => !shown)} title={t.bookmarks} aria-expanded={showBookmarks}>
          ☰
        </button>
        <button type="button" onClick={() => zoom(-ZOOM_STEP)} title={`${t.zoomOut} (-)`}>
          −
        </button>
        <button type="button" onClick={() => zoom(ZOOM_STEP)} title={`${t.zoomIn} (+)`}>
          +
        </button>
        <button type="button" onClick={cycleTheme} title={`${t.theme} (D)`}>
          ◐
        </button>
      </nav>
      {message ? (
        <p className="mushaf-message" role="status" onClick={() => setMessage(undefined)}>
          {message}
        </p>
      ) : null}
      {showBookmarks ? (
        <ul className="mushaf-bookmarks">
          {settings.bookmarks.length === 0 ? <li>{t.noBookmarks}</li> : null}
          {settings.bookmarks.map(mark => (
            <li key={mark.createdAt}>
              <button
                type="button"
                onClick={() => {
                  setPage(mark.page)
                  setActive(mark.surah && mark.ayah ? { surah: mark.surah, ayah: mark.ayah } : undefined)
                  setShowBookmarks(false)
                }}
              >
                {`${t.page} ${toArabicDigits(mark.page)}`}
                {mark.surah && mark.ayah ? ` — ${data.meta.surahs[mark.surah - 1]?.nameArabic ?? ''} ${toArabicDigits(mark.ayah)}` : ''}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {banner}
      <div className="mushaf-view" ref={viewRef}>
        {view.width > 0 ? (
          // Facing pages read right to left, whatever the interface language.
          <div className="mushaf-spread" dir="rtl">
            {pages.map(page => (
              <MushafPage
                key={page}
                data={data}
                platform={platform}
                page={page}
                fontSize={fontSize}
                active={active}
                onPickAyah={setActive}
                loadingText={t.loading}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
