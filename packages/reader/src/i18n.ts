import type { GoToError, Language } from '@mushaf/core'

const STRINGS = {
  ar: {
    goTo: 'اذهب إلى',
    goToHint: 'صفحة، ٢:٢٥٥، البقرة، جزء ٣',
    next: 'الصفحة التالية',
    previous: 'الصفحة السابقة',
    bookmark: 'علامة',
    bookmarks: 'العلامات',
    noBookmarks: 'لا علامات بعد',
    theme: 'المظهر',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
    surah: 'السورة',
    juz: 'الجزء',
    page: 'صفحة',
    loading: 'جارٍ التحميل…',
    errors: {
      empty: 'اكتب صفحة أو آية أو سورة',
      'no-such-page': 'لا توجد صفحة بهذا الرقم',
      'no-such-ayah': 'لا توجد آية بهذا الرقم',
      'no-such-juz': 'لا يوجد جزء بهذا الرقم',
      'not-understood': 'لم أفهم، جرّب: ٥٠ أو ٢:٢٥٥ أو البقرة',
    } satisfies Record<GoToError, string>,
  },
  en: {
    goTo: 'Go to',
    goToHint: 'page, 2:255, Al-Baqarah, juz 3',
    next: 'Next page',
    previous: 'Previous page',
    bookmark: 'Bookmark',
    bookmarks: 'Bookmarks',
    noBookmarks: 'No bookmarks yet',
    theme: 'Theme',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    surah: 'Surah',
    juz: 'Juz',
    page: 'Page',
    loading: 'Loading…',
    errors: {
      empty: 'Type a page, an ayah or a surah',
      'no-such-page': 'There is no page with that number',
      'no-such-ayah': 'There is no ayah with that number',
      'no-such-juz': 'There is no juz with that number',
      'not-understood': 'Try 50, 2:255 or Al-Baqarah',
    } satisfies Record<GoToError, string>,
  },
}

export type Strings = (typeof STRINGS)['ar']

export const stringsFor = (language: Language): Strings => STRINGS[language]
