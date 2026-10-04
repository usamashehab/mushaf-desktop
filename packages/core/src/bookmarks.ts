import { BOOKMARK_COLORS, type Bookmark, type BookmarkColor, type Settings } from './settings.ts'
import type { AyahRef } from './types.ts'

/** The bookmark on exactly this place: the ayah when one is given, else the page itself. */
export const findBookmark = (settings: Settings, page: number, ayah?: AyahRef) =>
  settings.bookmarks.find(mark =>
    ayah ? mark.surah === ayah.surah && mark.ayah === ayah.ayah : mark.page === page && mark.ayah === undefined,
  )

/** Bookmarks that sit on any of `pages`, for the ribbon a page shows. */
export const bookmarksOn = (settings: Settings, pages: number[]) =>
  settings.bookmarks.filter(mark => pages.includes(mark.page))

/** A new bookmark, newest first; the colour follows on from the last one added. */
export function addBookmark(settings: Settings, place: { page: number; ayah?: AyahRef | undefined }, now = Date.now()): Settings {
  const last = settings.bookmarks[0]?.color
  const color: BookmarkColor = BOOKMARK_COLORS[(BOOKMARK_COLORS.indexOf(last ?? 'violet') + 1) % BOOKMARK_COLORS.length] ?? 'gold'
  const mark: Bookmark = {
    id: `b${now}-${place.page}-${Math.random().toString(36).slice(2, 7)}`,
    page: place.page,
    color,
    createdAt: now,
    ...(place.ayah ? { surah: place.ayah.surah, ayah: place.ayah.ayah } : {}),
  }

  return { ...settings, bookmarks: [mark, ...settings.bookmarks] }
}

export const removeBookmark = (settings: Settings, id: string): Settings => ({
  ...settings,
  bookmarks: settings.bookmarks.filter(mark => mark.id !== id),
})

/** Puts a removed bookmark back where it was (for "undo"). */
export function restoreBookmark(settings: Settings, mark: Bookmark, at: number): Settings {
  if (settings.bookmarks.some(other => other.id === mark.id)) {
    return settings
  }
  const bookmarks = [...settings.bookmarks]
  bookmarks.splice(Math.min(at, bookmarks.length), 0, mark)

  return { ...settings, bookmarks }
}

export function updateBookmark(settings: Settings, id: string, change: { label?: string; color?: BookmarkColor }): Settings {
  return {
    ...settings,
    bookmarks: settings.bookmarks.map(mark => {
      if (mark.id !== id) {
        return mark
      }
      const next: Bookmark = { ...mark, ...(change.color ? { color: change.color } : {}) }
      if (change.label !== undefined) {
        const label = change.label.trim()
        if (label === '') {
          delete next.label
        } else {
          next.label = label
        }
      }

      return next
    }),
  }
}

/** Adds the bookmark for this place, or removes it when it is already there. */
export function toggleBookmark(settings: Settings, place: { page: number; ayah?: AyahRef | undefined }): Settings {
  const existing = findBookmark(settings, place.page, place.ayah)

  return existing ? removeBookmark(settings, existing.id) : addBookmark(settings, place)
}
