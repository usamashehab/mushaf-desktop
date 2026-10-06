import { migrateSettings, type Settings } from '@mushaf/core'

import type { Init } from './protocol.ts'

/** The settings to start from: the ones kept, in the app's language; at the very first start, its look too. */
export function startingSettings({ init }: { init: Pick<Init, 'state' | 'language' | 'theme'> }): Settings {
  const settings = migrateSettings(init.state)

  return { ...settings, language: init.language, ...(init.state === null && init.theme === 'dark' ? { theme: 'night' as const } : {}) }
}
