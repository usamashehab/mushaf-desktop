import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { buildSearchIndex, findMatch, matchSurahs, parseGoTo, pageOfAyah, searchAyahs, type GoTo, type SearchEntry } from '@mushaf/core'
import { BookOpen, CornerDownLeft, FileText, Search, X } from 'lucide-react'

import { useReader } from './context.tsx'

const SHOWN = 60

type Item =
  | { kind: 'goto'; to: GoTo }
  | { kind: 'surah'; surah: number }
  | { kind: 'ayah'; entry: SearchEntry }

/** Pause and recitation marks (U+06D6–U+06ED): in a one-line snippet they float loose. */
const bare = (text: string) => text.replace(/\s*[\u06D6-\u06ED]+/g, '')

/** The ayah's text around the match, with the words it falls in marked. */
function Snippet({ text: full, query }: { text: string; query: string }) {
  const text = bare(full)
  const match = findMatch(text, query)
  if (!match) {
    return <>{text}</>
  }
  // Whole words: a mark inside a word cuts the joined Arabic letters apart.
  const [at, until] = match
  const start = text.lastIndexOf(' ', at - 1) + 1
  const space = text.indexOf(' ', until)
  const end = space === -1 ? text.length : space
  const from = start > 70 ? text.lastIndexOf(' ', start - 50) + 1 : 0
  const to = end + 90 < text.length ? text.indexOf(' ', end + 70) : text.length

  return (
    <>
      {from > 0 ? '… ' : ''}
      {text.slice(from, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end, to === -1 ? text.length : to)}
      {to !== -1 && to < text.length ? ' …' : ''}
    </>
  )
}

/** One box for both: "50", "2:255", "البقرة" go somewhere; any other words search the ayahs. */
export function SearchBox({ focusKey }: { focusKey: number }) {
  const { data, t, n, surahName, open } = useReader()
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const deferred = useDeferredValue(query)
  const index = useMemo(() => (data.searchText ? buildSearchIndex(data.searchText) : []), [data.searchText])

  useEffect(() => {
    if (focusKey > 0) {
      input.current?.focus()
      input.current?.select()
    }
  }, [focusKey])

  const { items, total } = useMemo(() => {
    const text = deferred.trim()
    if (text === '') {
      return { items: [] as Item[], total: 0 }
    }
    const out: Item[] = []
    const goTo = parseGoTo(text, data.meta)
    if (goTo.ok && goTo.to.kind !== 'surah') {
      out.push({ kind: 'goto', to: goTo.to })
    }
    for (const surah of matchSurahs(data.meta, text.replace(/\s*[:.]?\s*\d+$/, ''), 4)) {
      out.push({ kind: 'surah', surah })
    }
    const found = /^\d+([:.\s]\d+)?$/.test(text) ? { results: [], total: 0 } : searchAyahs(index, text, SHOWN)
    for (const entry of found.results) {
      out.push({ kind: 'ayah', entry })
    }

    return { items: out, total: found.total }
  }, [deferred, data.meta, index])

  useEffect(() => {
    setSelected(0)
  }, [items])
  useEffect(() => {
    void list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const choose = (item: Item | undefined) => {
    if (!item) {
      return
    }
    if (item.kind === 'goto') {
      open(item.to.page, item.to.kind === 'ayah' ? { surah: item.to.surah, ayah: item.to.ayah } : undefined)
    } else if (item.kind === 'surah') {
      open(pageOfAyah(data.meta, { surah: item.surah, ayah: 1 }) ?? 1)
    } else {
      open(item.entry.page, item.entry)
    }
    setIsOpen(false)
    input.current?.blur()
  }

  const describe = (to: GoTo) =>
    to.kind === 'page'
      ? t.goToPage(n(to.page))
      : to.kind === 'juz'
        ? t.goToJuz(n(to.juz))
        : to.kind === 'ayah'
          ? t.goToAyah(surahName(to.surah), n(to.ayah))
          : t.goToSurah(surahName(to.surah))

  let at = -1
  const row = (item: Item, content: ReactNode, key: string) => {
    at += 1
    const mine = at

    return (
      <button
        key={key}
        type="button"
        role="option"
        aria-selected={mine === selected}
        className={`search-item search-item-${item.kind}`}
        onMouseEnter={() => setSelected(mine)}
        onMouseDown={event => event.preventDefault()}
        onClick={() => choose(item)}
      >
        {content}
      </button>
    )
  }

  const goTos = items.filter(item => item.kind === 'goto')
  const surahs = items.filter(item => item.kind === 'surah')
  const ayahs = items.filter(item => item.kind === 'ayah')
  const text = deferred.trim()

  return (
    <div className={`search${isOpen && text !== '' ? ' is-open' : ''}`}>
      <label className="search-field">
        <Search size={17} aria-hidden="true" />
        <input
          ref={input}
          value={query}
          placeholder={t.search}
          aria-label={t.searchShort}
          role="combobox"
          aria-expanded={isOpen}
          dir="auto"
          onChange={event => {
            setQuery(event.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected(current => Math.min(items.length - 1, current + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected(current => Math.max(0, current - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(items[selected])
            } else if (event.key === 'Escape') {
              setIsOpen(false)
              input.current?.blur()
            }
          }}
        />
        {query !== '' ? (
          <button type="button" className="icon-button is-small" aria-label={t.close} onMouseDown={event => event.preventDefault()} onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </label>
      {isOpen && text !== '' ? (
        <div className="search-results" role="listbox" ref={list}>
          {goTos.map((item, i) =>
            item.kind === 'goto'
              ? row(
                  item,
                  <>
                    <CornerDownLeft size={16} aria-hidden="true" />
                    <span className="search-item-title">
                      {t.goTo}: {describe(item.to)}
                    </span>
                  </>,
                  `goto-${i}`,
                )
              : null,
          )}
          {surahs.length > 0 ? <div className="search-section">{t.surahs}</div> : null}
          {surahs.map(item =>
            item.kind === 'surah'
              ? row(
                  item,
                  <>
                    <BookOpen size={16} aria-hidden="true" />
                    <span className="search-item-title">{t.goToSurah(surahName(item.surah))}</span>
                    <span className="search-item-meta">
                      {t.page} {n(pageOfAyah(data.meta, { surah: item.surah, ayah: 1 }) ?? 1)}
                    </span>
                  </>,
                  `surah-${item.surah}`,
                )
              : null,
          )}
          {ayahs.length > 0 ? (
            <div className="search-section">
              {t.ayahs} <span>{t.results(n(ayahs.length), n(total))}</span>
            </div>
          ) : null}
          {ayahs.map(item =>
            item.kind === 'ayah'
              ? row(
                  item,
                  <>
                    <FileText size={16} aria-hidden="true" />
                    <span className="search-item-body">
                      <span className="search-item-head">
                        {t.ayahOf(surahName(item.entry.surah), n(item.entry.ayah))}
                        <span className="search-item-meta">
                          {t.page} {n(item.entry.page)}
                        </span>
                      </span>
                      <span className="search-item-text" dir="rtl">
                        <Snippet text={item.entry.text} query={text} />
                      </span>
                    </span>
                  </>,
                  `ayah-${item.entry.surah}-${item.entry.ayah}`,
                )
              : null,
          )}
          {items.length === 0 ? (
            <div className="search-empty">{text.replace(/\s/g, '').length < 2 ? t.typeMore : t.noResults}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
