import { createContext, useContext } from 'react'

import { toArabicDigits, type AyahRef, type Settings } from '@mushaf/core'

import type { Strings } from './i18n.ts'
import type { Platform, ReaderData } from './platform.ts'

export interface ReaderState {
  data: ReaderData
  platform: Platform
  settings: Settings
  update: (change: (current: Settings) => Settings) => void
  t: Strings
  /** A number in the interface's digits. */
  n: (value: number) => string
  /** A surah's name in the interface language. */
  surahName: (surah: number) => string
  /** Opens a page, picking out an ayah on it when one is given. */
  open: (page: number, ayah?: AyahRef) => void
  toast: (message: string, action?: { label: string; run: () => void }) => void
}

export const ReaderContext = createContext<ReaderState | null>(null)

export function useReader(): ReaderState {
  const state = useContext(ReaderContext)
  if (!state) {
    throw new Error('useReader outside <Reader>')
  }

  return state
}

export const digitsFor = (language: Settings['language']) => (value: number) =>
  language === 'ar' ? toArabicDigits(value) : String(value)
