import type { Reading, Settings } from './settings.ts'
import { PAGE_COUNT, type QuranMeta } from './types.ts'

/** The local day a date falls on, as "2026-10-20". */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The day before a "2026-10-20" day. */
function dayBefore(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)

  return localDay(new Date(year, month - 1, date - 1))
}

/** What reading a page completed: today's goal, any juz, the whole Mushaf. */
export interface ReadingDone {
  goal: boolean
  juz: number[]
  khatma: boolean
}

const juzRead = (meta: QuranMeta, khatma: Set<number>) => {
  const left = new Set<number>()
  meta.pages.forEach((info, i) => !khatma.has(i + 1) && left.add(info.juz))

  return (juz: number) => !left.has(juz)
}

/** A page read on `day`: it counts toward the day's goal and the khatma. */
export function countPage(settings: Settings, page: number, day: string, meta: QuranMeta): { settings: Settings; done: ReadingDone } {
  const before = settings.reading
  const today = before.day === day ? before.today : []
  const done: ReadingDone = { goal: false, juz: [], khatma: false }
  if (today.includes(page) && before.khatma.includes(page)) {
    return { settings, done }
  }
  const reading: Reading = { ...before, day, today: today.includes(page) ? today : [...today, page].sort((a, b) => a - b) }

  if (before.goal > 0 && today.length < before.goal && reading.today.length >= before.goal) {
    done.goal = true
    reading.streak = before.streakDay === dayBefore(day) ? before.streak + 1 : before.streakDay === day ? before.streak : 1
    reading.streakDay = day
  }

  if (!before.khatma.includes(page)) {
    const khatma = new Set([...before.khatma, page])
    const wasRead = juzRead(meta, new Set(before.khatma))
    const isRead = juzRead(meta, khatma)
    done.juz = [...new Set(meta.pages.map(info => info.juz))].filter(juz => isRead(juz) && !wasRead(juz))
    if (khatma.size >= PAGE_COUNT) {
      done.khatma = true
      reading.khatma = []
      reading.khatmas = before.khatmas + 1
    } else {
      reading.khatma = [...khatma].sort((a, b) => a - b)
    }
  }

  return { settings: { ...settings, reading }, done }
}

/** Days in a row the goal was met, if the run reaches today or yesterday; else 0. */
export const currentStreak = (reading: Reading, day: string) =>
  reading.streakDay === day || reading.streakDay === dayBefore(day) ? reading.streak : 0

/** Pages read so far today. */
export const pagesToday = (reading: Reading, day: string) => (reading.day === day ? reading.today.length : 0)
