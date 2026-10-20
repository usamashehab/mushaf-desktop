import { Fragment, useEffect, useState, type ReactNode } from 'react'

import { TAFSIRS, stepAyah, tafsirOf, type AyahRef, type TafsirId } from '@mushaf/core'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'

import { useReader } from './context.tsx'
import type { TafsirPassage } from './platform.ts'

const HEADINGS: Record<string, 'h3' | 'h4'> = { H1: 'h3', H2: 'h3', H3: 'h4', H4: 'h4', H5: 'h4', H6: 'h4' }
const BLOCKS: Record<string, 'p' | 'div' | 'blockquote' | 'ul' | 'ol' | 'li'> = {
  P: 'p',
  DIV: 'div',
  BLOCKQUOTE: 'blockquote',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
}
const INLINE: Record<string, 'b' | 'i'> = { B: 'b', STRONG: 'b', I: 'i', EM: 'i' }

/**
 * A source's HTML as React elements, its plain structure only: headings, paragraphs,
 * lists, bold and italic. No attribute, link or script comes through; footnote marks go.
 * Each block finds its own direction, for the Arabic quoted in an English tafsir.
 */
function plain(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent
  }
  if (!(node instanceof Element) || node.tagName === 'SUP' || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
    return null
  }
  const children = [...node.childNodes].map(plain)
  const tag = node.tagName
  const heading = HEADINGS[tag]
  if (heading) {
    const Heading = heading

    return (
      <Heading key={key} dir="auto">
        {children}
      </Heading>
    )
  }
  const block = BLOCKS[tag]
  if (block) {
    const Block = block

    return (
      <Block key={key} dir="auto">
        {children}
      </Block>
    )
  }
  const inline = INLINE[tag]
  if (inline) {
    const Inline = inline

    return <Inline key={key}>{children}</Inline>
  }
  if (tag === 'BR') {
    return <br key={key} />
  }
  // Al-Muyassar marks the words it explains.
  if (tag === 'SPAN' && node.classList.length > 0) {
    return (
      <span key={key} className="tafsir-term">
        {children}
      </span>
    )
  }

  return <Fragment key={key}>{children}</Fragment>
}

export const plainHtml = (html: string): ReactNode =>
  [...new DOMParser().parseFromString(html, 'text/html').body.childNodes].map(plain)

interface Loaded {
  key: string
  passage?: TafsirPassage
  translations?: (string | undefined)[] | undefined
  failed?: boolean
}

/** The tafsir of an ayah, with the ayahs before and after a step away. */
export function TafsirPanel({ ayah, onAyah }: { ayah: AyahRef | undefined; onAyah: (ayah: AyahRef) => void }) {
  const { data, platform, settings, update, t, n, surahName } = useReader()
  const library = platform.library
  const source = tafsirOf(settings)
  const language = TAFSIRS.find(tafsir => tafsir.id === source)?.language ?? 'ar'
  const key = ayah ? `${source}/${ayah.surah}:${ayah.ayah}` : ''
  const [loaded, setLoaded] = useState<Loaded>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!library || !ayah) {
      return
    }
    let live = true
    const here = `${source}/${ayah.surah}:${ayah.ayah}`
    void library
      .tafsir(source, ayah)
      .then(async passage => {
        // In English, the meaning of each ayah explained comes first.
        const translations =
          language === 'en' ? await Promise.all(passage.ayahs.map(one => library.translation(one).catch(() => undefined))) : undefined
        if (live) {
          setLoaded({ key: here, passage, translations })
        }
      })
      .catch(() => live && setLoaded({ key: here, failed: true }))

    return () => {
      live = false
    }
    // The ayah by value: a new object for the same ayah is no new ayah.
  }, [library, source, language, ayah?.surah, ayah?.ayah, attempt])

  if (!ayah) {
    return (
      <div className="panel-empty">
        <span>{t.tafsirHint}</span>
      </div>
    )
  }
  const current = loaded?.key === key ? loaded : undefined
  const covered = current?.passage?.ayahs ?? [ayah]
  const first = covered[0] ?? ayah
  const last = covered.at(-1) ?? ayah
  const previous = stepAyah(data.meta, first, -1)
  const next = stepAyah(data.meta, last, 1)
  const isRtl = settings.language === 'ar'
  const Previous = isRtl ? ChevronRight : ChevronLeft
  const Next = isRtl ? ChevronLeft : ChevronRight

  return (
    <div className="panel-list tafsir">
      <div className="tafsir-head">
        <button type="button" className="icon-button" disabled={!previous} onClick={() => previous && onAyah(previous)} title={t.previousAyah} aria-label={t.previousAyah}>
          <Previous size={18} />
        </button>
        <div className="tafsir-place">
          <strong>{t.ayahOf(surahName(ayah.surah), n(ayah.ayah))}</strong>
          {covered.length > 1 ? <span>{t.tafsirCovers(n(first.ayah), n(last.ayah))}</span> : null}
        </div>
        <button type="button" className="icon-button" disabled={!next} onClick={() => next && onAyah(next)} title={t.nextAyah} aria-label={t.nextAyah}>
          <Next size={18} />
        </button>
      </div>
      <label className="setting-select">
        <span>{t.tafsirSource}</span>
        <select value={source} onChange={event => update(current => ({ ...current, tafsir: event.target.value as TafsirId }))}>
          {TAFSIRS.map(tafsir => (
            <option key={tafsir.id} value={tafsir.id}>
              {t.tafsirs[tafsir.id]}
            </option>
          ))}
        </select>
      </label>
      {current?.failed ? (
        <div className="panel-empty">
          <span>{t.tafsirFailed}</span>
          <button type="button" className="panel-action" onClick={() => setAttempt(count => count + 1)}>
            <RotateCcw size={16} aria-hidden="true" />
            {t.retry}
          </button>
        </div>
      ) : current?.passage ? (
        <article className="tafsir-body" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'}>
          {current.translations?.some(Boolean) ? (
            <section className="tafsir-translation">
              <h4>{t.translation}</h4>
              {covered.map((one, i) =>
                current.translations?.[i] ? (
                  <p key={one.ayah}>
                    {covered.length > 1 ? <span className="tafsir-number">{one.ayah}. </span> : null}
                    {plainHtml(current.translations[i] ?? '')}
                  </p>
                ) : null,
              )}
            </section>
          ) : null}
          <div className="tafsir-text">{plainHtml(current.passage.html)}</div>
          <p className="tafsir-credit">
            {t.tafsirs[source]} · {t.tafsirCredit}
          </p>
        </article>
      ) : (
        <div className="panel-empty" aria-busy="true">
          <span>{t.loading}</span>
        </div>
      )}
    </div>
  )
}
