// The pieces around the page: the ayah menu, the page slider, the wird ring, and toasts.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { addBookmark, currentStreak, findBookmark, localDay, pagesToday, removeBookmark, type AyahRef } from '@mushaf/core'
import { BookOpenText, Bookmark, BookmarkMinus, Copy, Headphones } from 'lucide-react'

import { useReader } from './context.tsx'

export interface Picked {
  ayah: AyahRef
  page: number
  /** Where it was clicked, in window px. */
  x: number
  y: number
}

/** The ayah's text as the Mushaf writes it, with its reference, for the clipboard. */
function ayahText(words: string[], surahName: string, ayah: string) {
  return `${words.join(' ')} ﴿${ayah}﴾ [${surahName}]`
}

interface AyahMenuProps {
  picked: Picked
  onClose: () => void
  onCopied: () => void
  /** Where the platform has a library: read the ayah's tafsir, hear it recited. */
  onTafsir?: (() => void) | undefined
  onListen?: (() => void) | undefined
}

/** What can be done with a clicked ayah: bookmark it, copy it, read its tafsir, hear it. */
export function AyahMenu({ picked, onClose, onCopied, onTafsir, onListen }: AyahMenuProps) {
  const { data, settings, update, t, n, surahName, toast } = useReader()
  const menu = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: picked.x, top: picked.y + 14 })
  const mark = findBookmark(settings, picked.page, picked.ayah)

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    if (!box) {
      return
    }
    const left = Math.min(Math.max(8, picked.x - box.width / 2), window.innerWidth - box.width - 8)
    const below = picked.y + 14
    const top = below + box.height > window.innerHeight - 8 ? picked.y - box.height - 14 : below
    setPlace({ left, top })
  }, [picked])

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node) && !(event.target as Element).closest?.('.mushaf-word')) {
        onClose()
      }
    }
    window.addEventListener('pointerdown', away)

    return () => window.removeEventListener('pointerdown', away)
  }, [onClose])

  const copy = async () => {
    const words = data.layout.pages
      .flatMap(page => page.lines)
      .flatMap(line => (line.t === 'ayah' ? line.w : []))
      .filter(([s, a, , , , kind]) => s === picked.ayah.surah && a === picked.ayah.ayah && kind === 0)
      .map(word => word[4])
    try {
      await navigator.clipboard.writeText(ayahText(words, surahName(picked.ayah.surah), n(picked.ayah.ayah)))
      toast(t.copied)
    } catch {
      // No clipboard access; nothing to undo.
    }
    onCopied()
  }

  return (
    <div className="ayah-menu" ref={menu} style={{ left: place.left, top: place.top }} role="menu">
      <div className="ayah-menu-title">{t.ayahOf(surahName(picked.ayah.surah), n(picked.ayah.ayah))}</div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (mark) {
            update(current => removeBookmark(current, mark.id))
            toast(t.bookmarkRemoved)
          } else {
            update(current => addBookmark(current, { page: picked.page, ayah: picked.ayah }))
            toast(t.bookmarkAdded)
          }
          onClose()
        }}
      >
        {mark ? <BookmarkMinus size={16} /> : <Bookmark size={16} />}
        {mark ? t.removeBookmark : t.addBookmark}
      </button>
      <button type="button" role="menuitem" onClick={() => void copy()}>
        <Copy size={16} />
        {t.copyAyah}
      </button>
      {onTafsir ? (
        <button type="button" role="menuitem" onClick={onTafsir}>
          <BookOpenText size={16} />
          {t.tafsir}
          <kbd>T</kbd>
        </button>
      ) : null}
      {onListen ? (
        <button type="button" role="menuitem" onClick={onListen}>
          <Headphones size={16} />
          {t.listen}
          <kbd>P</kbd>
        </button>
      ) : null}
    </div>
  )
}

/** A slider across the whole Mushaf, page 1 on the right, with the juz marked. */
export function PageSlider({ page, onPage }: { page: number; onPage: (page: number) => void }) {
  const { data, t, n, surahName } = useReader()
  const [dragging, setDragging] = useState<number>()
  const shown = dragging ?? page
  const firstWord = data.layout.pages[shown - 1]?.lines.flatMap(line => (line.t === 'ayah' ? line.w : [])).at(0)
  const juz = data.meta.pages[shown - 1]?.juz ?? 1

  return (
    <div className="page-slider">
      <span className="page-slider-label">
        {t.page} {n(shown)}
        <span>
          {firstWord ? surahName(firstWord[0]) : ''} · {t.juz} {n(juz)}
        </span>
      </span>
      <div className="page-slider-track">
        <input
          type="range"
          min={1}
          max={604}
          value={shown}
          dir="rtl"
          aria-label={t.page}
          onChange={event => setDragging(Number(event.target.value))}
          onPointerUp={() => {
            if (dragging !== undefined) {
              onPage(dragging)
              setDragging(undefined)
            }
          }}
          onKeyUp={() => {
            if (dragging !== undefined) {
              onPage(dragging)
              setDragging(undefined)
            }
          }}
        />
        <div className="page-slider-ticks" aria-hidden="true">
          {data.meta.juzStarts.map((start, i) => {
            const at = data.meta.ayahPages[start.surah - 1]?.[start.ayah - 1] ?? 1

            return <span key={i} style={{ insetInlineStart: `${((at - 1) / 603) * 100}%` }} />
          })}
        </div>
      </div>
    </div>
  )
}

/** Today's pages toward the daily goal, as a ring that fills; shown only with a goal set. */
export function WirdRing({ onClick }: { onClick: () => void }) {
  const { settings, t, n } = useReader()
  const { reading } = settings
  if (reading.goal === 0) {
    return null
  }
  const day = localDay(new Date())
  const read = pagesToday(reading, day)
  const streak = currentStreak(reading, day)
  const share = Math.min(1, read / reading.goal)
  const title = [t.todayOf(n(read), n(reading.goal)), ...(streak > 0 ? [t.streak(streak, n(streak))] : [])].join(' · ')

  return (
    <button type="button" className={`wird${share >= 1 ? ' is-met' : ''}`} onClick={onClick} title={title} aria-label={title}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="wird-track" cx="18" cy="18" r="15" />
        <circle className="wird-fill" cx="18" cy="18" r="15" pathLength={1} strokeDasharray={`${share} 1`} />
      </svg>
      <span>{n(read)}</span>
    </button>
  )
}

export interface ToastMessage {
  id: number
  message: string
  action?: { label: string; run: () => void } | undefined
}

export function Toasts({ toasts, onDone }: { toasts: ToastMessage[]; onDone: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(toast => (
        <div key={toast.id} className="toast">
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.run()
                onDone(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
