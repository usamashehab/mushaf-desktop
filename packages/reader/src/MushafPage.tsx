import { useEffect, useState, type ClipboardEvent } from 'react'

import { juzLabel, pageInfo, quarterLabel, toArabicDigits, type AyahRef, type LayoutLine, type LayoutWord } from '@mushaf/core'

import { isFontReady, loadFont } from './fonts.ts'
import { LINE_PITCH, PAGE_BOX, textWidthEm } from './geometry.ts'
import type { Platform, ReaderData } from './platform.ts'

export const SURAH_NAMES_FAMILY = 'mushaf-surah-names'

const ayahKey = ({ surah, ayah }: AyahRef) => `${surah}:${ayah}`

/**
 * The surah-name font draws "سورة" at U+E000 and the name of surah N at U+E000 plus
 * N's three digits read as hex (surah 114 at U+E114). Written left to right, name
 * then "سورة", the pair reads right to left as "سورة <name>".
 */
export const surahNameGlyphs = (surah: number) =>
  String.fromCodePoint(0xe000 + Number.parseInt(String(surah).padStart(3, '0'), 16), 0xe000)

/** The CSS font family of a page of the pack. */
export const pageFamily = (data: ReaderData, page: number) => `${data.manifest.fonts.familyPrefix}${page}`

/** Loads the page's font, resolving to whether it is ready to draw. */
export function usePageFont(data: ReaderData, platform: Platform, page: number): boolean {
  const family = pageFamily(data, page)
  const [ready, setReady] = useState(() => isFontReady(family))
  useEffect(() => {
    let isCurrent = true
    setReady(isFontReady(family))
    loadFont(family, platform.pageFontUrl(data.manifest, page))
      .then(() => isCurrent && setReady(true))
      .catch(() => isCurrent && setReady(false))

    return () => {
      isCurrent = false
    }
  }, [family, data.manifest, platform, page])

  return ready
}

interface PageProps {
  data: ReaderData
  platform: Platform
  page: number
  /** px. */
  fontSize: number
  /** The ayah picked by a click, kept highlighted. */
  active: AyahRef | undefined
  onPickAyah: (ayah: AyahRef | undefined) => void
  loadingText: string
}

/** One Mushaf page, drawn with its own font so every line matches the print. */
export function MushafPage({ data, platform, page, fontSize, active, onPickAyah, loadingText }: PageProps) {
  const ready = usePageFont(data, platform, page)
  const [hover, setHover] = useState<string>()
  const lines = data.layout.pages[page - 1]?.lines ?? []
  const info = pageInfo(data.meta, page)
  const firstAyah = lines.flatMap(line => (line.t === 'ayah' ? line.w : [])).at(0)
  const surah = firstAyah ? data.meta.surahs[firstAyah[0] - 1] : undefined
  const activeKey = active ? ayahKey(active) : undefined
  const family = pageFamily(data, page)
  const isOpening = page <= 2

  // Copy gives the Quran's text, not the glyph codes the page font draws.
  const copy = (event: ClipboardEvent<HTMLElement>) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      return
    }
    const words = [...event.currentTarget.querySelectorAll<HTMLElement>('.mushaf-word')]
      .filter(word => selection.containsNode(word, true))
      .map(word => word.dataset['text'] ?? '')
    if (words.length > 0) {
      event.clipboardData.setData('text/plain', words.join(' '))
      event.preventDefault()
    }
  }

  const word = (w: LayoutWord, index: number) => {
    const [s, a, , code, text, kind] = w
    const key = `${s}:${a}`
    const classes = ['mushaf-word', kind === 1 ? 'mushaf-end' : '', key === hover ? 'is-hover' : '', key === activeKey ? 'is-active' : '']

    return (
      <span
        key={index}
        className={classes.filter(Boolean).join(' ')}
        data-ayah={key}
        data-text={text}
        aria-label={text}
        onMouseEnter={() => setHover(key)}
        onMouseLeave={() => setHover(undefined)}
        onClick={() => onPickAyah(key === activeKey ? undefined : { surah: s, ayah: a })}
      >
        {code}
      </span>
    )
  }

  const line = (l: LayoutLine, index: number) => {
    if (l.t === 'surah') {
      return (
        <div key={index} className="mushaf-line mushaf-surah-header" role="heading" aria-level={2}>
          <SurahFrame />
          <span className="mushaf-surah-name" aria-label={`سورة ${data.meta.surahs[l.s - 1]?.nameArabic ?? ''}`}>
            {surahNameGlyphs(l.s)}
          </span>
        </div>
      )
    }
    if (l.t === 'basmala') {
      return (
        <div key={index} className="mushaf-line mushaf-basmala" aria-label="بسم الله الرحمن الرحيم">
          <Basmala data={data} platform={platform} />
        </div>
      )
    }

    return (
      <div key={index} className={`mushaf-line${l.c ? ' is-centred' : ''}`}>
        {l.w.map(word)}
      </div>
    )
  }

  return (
    <article
      className={`mushaf-page${isOpening ? ' is-opening' : ''}${page % 2 === 0 ? ' is-left' : ''}`}
      data-page={page}
      onCopy={copy}
      style={{
        fontSize: `${fontSize}px`,
        padding: `${PAGE_BOX.padY}em ${PAGE_BOX.padX}em`,
      }}
    >
      <header className="mushaf-page-head" style={{ height: `${PAGE_BOX.head}em` }}>
        <span className="mushaf-chrome">{surah ? `سورة ${surah.nameArabic}` : ''}</span>
        <span className="mushaf-chrome">{info ? juzLabel(info.juz) : ''}</span>
      </header>
      <div
        className={`mushaf-lines${ready ? '' : ' is-loading'}`}
        style={{
          fontFamily: `"${family}"`,
          width: `${textWidthEm(data.layout.lineEm)}em`,
          height: `${15 * LINE_PITCH}em`,
          ['--pitch' as string]: `${LINE_PITCH}em`,
        }}
        aria-busy={!ready}
      >
        {ready ? lines.map(line) : <span className="mushaf-loading">{loadingText}</span>}
      </div>
      <footer className="mushaf-page-foot" style={{ height: `${PAGE_BOX.foot}em` }}>
        <span className="mushaf-chrome">{toArabicDigits(page)}</span>
      </footer>
      {info?.quarterStart ? <aside className="mushaf-quarter">۞ {quarterLabel(info.quarterStart)}</aside> : null}
    </article>
  )
}

/**
 * The basmala line, drawn with page 1's own glyphs for 1:1 — the same calligraphy
 * the Mushaf uses above every surah.
 */
function Basmala({ data, platform }: { data: ReaderData; platform: Platform }) {
  const ready = usePageFont(data, platform, 1)
  const words = (data.layout.pages[0]?.lines ?? [])
    .flatMap(line => (line.t === 'ayah' ? line.w : []))
    .filter(([s, a, , , , kind]) => s === 1 && a === 1 && kind === 0)

  return (
    <span className="mushaf-basmala-text" style={{ fontFamily: `"${pageFamily(data, 1)}"` }}>
      {ready ? words.map(([, , , code], i) => <span key={i}>{code}</span>) : null}
    </span>
  )
}

/** The frame a surah's name sits in. */
function SurahFrame() {
  return (
    <svg className="mushaf-surah-frame" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">
      <rect x="1" y="3" width="398" height="34" rx="17" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="6" y="7" width="388" height="26" rx="13" fill="none" stroke="currentColor" strokeWidth="0.6" />
      <circle cx="22" cy="20" r="4" fill="none" stroke="currentColor" strokeWidth="0.8" />
      <circle cx="378" cy="20" r="4" fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  )
}
