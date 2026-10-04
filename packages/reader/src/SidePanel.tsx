import { useEffect, useMemo, useRef, useState } from 'react'

import {
  BOOKMARK_COLORS,
  addBookmark,
  findBookmark,
  foldArabic,
  foldLatin,
  pageOfAyah,
  quarterLabel,
  removeBookmark,
  restoreBookmark,
  updateBookmark,
  type AyahRef,
  type Bookmark,
} from '@mushaf/core'
import { BookmarkPlus, Check, Pencil, Search, Trash2, X } from 'lucide-react'

import { useReader } from './context.tsx'

export type PanelTab = 'surahs' | 'juz' | 'bookmarks'

/** The eight-pointed star the Mushaf marks numbers with. */
export function StarNumber({ value }: { value: string }) {
  return (
    <span className="star-number">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M20 2l5.3 7.2 8.9-1.4-1.4 8.9L40 20l-7.2 5.3 1.4 8.9-8.9-1.4L20 40l-5.3-7.2-8.9 1.4 1.4-8.9L0 20l7.2-5.3-1.4-8.9 8.9 1.4z" />
      </svg>
      <span>{value}</span>
    </span>
  )
}

function SurahIndex({ currentSurah }: { currentSurah: number }) {
  const { data, t, n, open, settings } = useReader()
  const [filter, setFilter] = useState('')
  const current = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    void current.current?.scrollIntoView({ block: 'center' })
  }, [])

  const shown = useMemo(() => {
    const wanted = filter.trim()
    if (wanted === '') {
      return data.meta.surahs
    }
    const arabic = foldArabic(wanted)
    const latin = foldLatin(wanted)

    return data.meta.surahs.filter(
      surah =>
        String(surah.number) === wanted ||
        foldArabic(surah.nameArabic).includes(arabic) ||
        (latin !== '' && (foldLatin(surah.nameSimple).includes(latin) || foldLatin(surah.nameEnglish).includes(latin))),
    )
  }, [filter, data.meta.surahs])

  return (
    <>
      <label className="panel-filter">
        <Search size={15} aria-hidden="true" />
        <input value={filter} onChange={event => setFilter(event.target.value)} placeholder={t.filterSurahs} dir="auto" />
      </label>
      <div className="panel-list">
        {shown.map(surah => (
          <button
            key={surah.number}
            ref={surah.number === currentSurah ? current : undefined}
            type="button"
            className={`surah-row${surah.number === currentSurah ? ' is-current' : ''}`}
            onClick={() => open(pageOfAyah(data.meta, { surah: surah.number, ayah: 1 }) ?? 1)}
          >
            <StarNumber value={n(surah.number)} />
            <span className="surah-row-names">
              <span className="surah-row-name">{settings.language === 'ar' ? surah.nameArabic : surah.nameSimple}</span>
              <span className="surah-row-sub">
                {settings.language === 'ar' ? surah.nameSimple : surah.nameEnglish} · {surah.revelation === 'makkah' ? t.makkah : t.madinah} ·{' '}
                {t.ayahCount(n(surah.ayahCount))}
              </span>
            </span>
            <span className="surah-row-page">{n(surah.pages[0])}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function JuzIndex({ currentJuz }: { currentJuz: number }) {
  const { data, t, n, open, surahName } = useReader()

  return (
    <div className="panel-list juz-grid">
      {data.meta.juzStarts.map((start, i) => {
        const page = pageOfAyah(data.meta, start) ?? 1
        const hizb = i * 2 + 2
        const half = data.meta.quarterStarts[(hizb - 1) * 4]

        return (
          <div key={i} className={`juz-card${i + 1 === currentJuz ? ' is-current' : ''}`}>
            <button type="button" className="juz-card-main" onClick={() => open(page, start)}>
              <span className="juz-card-title">
                {t.juz} {n(i + 1)}
              </span>
              <span className="juz-card-sub">
                {surahName(start.surah)} {n(start.ayah)} · {t.page} {n(page)}
              </span>
            </button>
            {half ? (
              <button type="button" className="juz-card-hizb" onClick={() => open(pageOfAyah(data.meta, half) ?? page, half)}>
                {quarterLabel({ hizb, quarter: 0 })}
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function useRelativeTime() {
  const { settings } = useReader()
  const format = useMemo(() => new Intl.RelativeTimeFormat(settings.language, { numeric: 'auto' }), [settings.language])

  return (at: number) => {
    const seconds = (at - Date.now()) / 1000
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31_536_000],
      ['month', 2_592_000],
      ['week', 604_800],
      ['day', 86_400],
      ['hour', 3_600],
      ['minute', 60],
    ]
    for (const [unit, size] of steps) {
      if (Math.abs(seconds) >= size) {
        return format.format(Math.round(seconds / size), unit)
      }
    }

    return format.format(0, 'minute')
  }
}

function BookmarkRow({ mark, index }: { mark: Bookmark; index: number }) {
  const { t, n, open, update, surahName, toast, data } = useReader()
  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState(mark.label ?? '')
  const ago = useRelativeTime()
  const place =
    mark.surah && mark.ayah ? t.ayahOf(surahName(mark.surah), n(mark.ayah)) : `${t.page} ${n(mark.page)}`
  const juz = data.meta.pages[mark.page - 1]?.juz ?? 1

  const save = () => {
    update(settings => updateBookmark(settings, mark.id, { label }))
    setIsEditing(false)
  }
  const remove = () => {
    update(settings => removeBookmark(settings, mark.id))
    toast(t.bookmarkRemoved, { label: t.undo, run: () => update(settings => restoreBookmark(settings, mark, index)) })
  }
  const recolour = () => {
    const next = BOOKMARK_COLORS[(BOOKMARK_COLORS.indexOf(mark.color) + 1) % BOOKMARK_COLORS.length] ?? 'gold'
    update(settings => updateBookmark(settings, mark.id, { color: next }))
  }

  return (
    <li className="bookmark-row" data-color={mark.color}>
      <button type="button" className="bookmark-color" onClick={recolour} title={t.changeColor} aria-label={t.changeColor} />
      {isEditing ? (
        <form
          className="bookmark-edit"
          onSubmit={event => {
            event.preventDefault()
            save()
          }}
        >
          <input
            autoFocus
            value={label}
            placeholder={t.renamePlaceholder}
            onChange={event => setLabel(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setLabel(mark.label ?? '')
                setIsEditing(false)
              }
            }}
            dir="auto"
          />
          <button type="submit" className="icon-button is-small" aria-label={t.rename}>
            <Check size={15} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="bookmark-main"
          onClick={() => open(mark.page, mark.surah && mark.ayah ? { surah: mark.surah, ayah: mark.ayah } : undefined)}
        >
          <span className="bookmark-title">{mark.label ?? place}</span>
          <span className="bookmark-sub">
            {mark.label ? `${place} · ` : ''}
            {t.page} {n(mark.page)} · {t.juz} {n(juz)} · {ago(mark.createdAt)}
          </span>
        </button>
      )}
      {isEditing ? null : (
        <span className="bookmark-actions">
          <button type="button" className="icon-button is-small" onClick={() => setIsEditing(true)} title={t.rename} aria-label={t.rename}>
            <Pencil size={14} />
          </button>
          <button type="button" className="icon-button is-small is-danger" onClick={remove} title={t.removeBookmark} aria-label={t.removeBookmark}>
            <Trash2 size={14} />
          </button>
        </span>
      )}
    </li>
  )
}

function BookmarkList({ page, active }: { page: number; active: AyahRef | undefined }) {
  const { settings, update, t, toast } = useReader()
  const isHere = findBookmark(settings, page, active) !== undefined

  return (
    <div className="panel-list">
      <button
        type="button"
        className="panel-action"
        disabled={isHere}
        onClick={() => {
          update(current => addBookmark(current, { page, ayah: active }))
          toast(t.bookmarkAdded)
        }}
      >
        <BookmarkPlus size={16} aria-hidden="true" />
        {t.addBookmarkHere}
      </button>
      {settings.bookmarks.length === 0 ? (
        <div className="panel-empty">
          <strong>{t.noBookmarks}</strong>
          <span>{t.noBookmarksHint}</span>
        </div>
      ) : (
        <ul className="bookmark-list">
          {settings.bookmarks.map((mark, index) => (
            <BookmarkRow key={mark.id} mark={mark} index={index} />
          ))}
        </ul>
      )}
    </div>
  )
}

interface PanelProps {
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onClose: () => void
  page: number
  active: AyahRef | undefined
  currentSurah: number
  currentJuz: number
}

/** The side panel: the surahs, the juz, and the bookmarks. */
export function SidePanel({ tab, onTab, onClose, page, active, currentSurah, currentJuz }: PanelProps) {
  const { t, settings, n } = useReader()
  const tabs: [PanelTab, string][] = [
    ['surahs', t.surahs],
    ['juz', t.juzTab],
    ['bookmarks', `${t.bookmarks}${settings.bookmarks.length > 0 ? ` (${n(settings.bookmarks.length)})` : ''}`],
  ]

  return (
    <aside className="side-panel" aria-label={t.index}>
      <div className="panel-head">
        <div className="panel-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t.close} title={t.close}>
          <X size={18} />
        </button>
      </div>
      {tab === 'surahs' ? <SurahIndex currentSurah={currentSurah} /> : null}
      {tab === 'juz' ? <JuzIndex currentJuz={currentJuz} /> : null}
      {tab === 'bookmarks' ? <BookmarkList page={page} active={active} /> : null}
    </aside>
  )
}
