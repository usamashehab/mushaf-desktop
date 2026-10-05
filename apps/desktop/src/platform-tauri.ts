import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { Settings } from '@mushaf/core'
import type { AgentAlert, AgentSession, AgentsBridge, Integration, Platform } from '@mushaf/reader'

import { extraFontPath, pageFontPath, type FontFile } from './fonts.ts'

export const isTauri = () => '__TAURI_INTERNALS__' in window

// The app serves its fonts on its own scheme; WebView2 on Windows reaches custom
// schemes as http://<scheme>.localhost.
const FONTS = navigator.userAgent.includes('Windows') ? 'http://mushaf.localhost/fonts' : 'mushaf://localhost/fonts'

/** Subscribes now, unsubscribes whenever asked, even before the subscription lands. */
function on<T>(event: string, listener: (payload: T) => void): () => void {
  let stopped = false
  let stop: (() => void) | undefined
  void listen<T>(event, message => listener(message.payload)).then(unlisten => {
    if (stopped) {
      unlisten()
    } else {
      stop = unlisten
    }
  })

  return () => {
    stopped = true
    stop?.()
  }
}

const agents: AgentsBridge = {
  state: () => invoke<{ sessions: AgentSession[]; pausedUntil: number | null }>('agent_state'),
  onSessions: listener => on<AgentSession[]>('agent-sessions', listener),
  onAlert: listener => on<AgentAlert>('agent-alert', listener),
  onPause: listener => on<number | null>('agent-pause', listener),
  onOpenPlace: listener => on<string>('open-place', listener),
  takeOpenPlace: () => invoke<string | null>('take_open_place'),
  pause: until => invoke('pause_alerts', { until }),
  integrations: () => invoke<Integration[]>('integrations_status'),
  setIntegration: (id, on) => invoke<Integration>('integrations_set', { id, on }),
}

/** The reader in the desktop app: fonts from the app's data folder, settings in its config folder. */
export const tauriPlatform: Platform = {
  pageFontUrl: (pack, page) => `${FONTS}/${pageFontPath(pack, page)}`,
  extraFontUrl: (pack, which) => `${FONTS}/${extraFontPath(pack, which)}`,
  loadSettings: () => invoke<unknown>('load_settings'),
  saveSettings: (settings: Settings) => invoke('save_settings', { settings }),
  agents,
}

export interface DownloadProgress {
  done: number
  total: number
  bytes: number
  total_bytes: number
}

/** The names of the fonts not yet downloaded. */
export const missingFonts = (files: FontFile[]) => invoke<string[]>('fonts_missing', { files })

/** Downloads the missing fonts, reporting progress as it goes. */
export async function downloadFonts(files: FontFile[], onProgress: (progress: DownloadProgress) => void) {
  const stop = await listen<DownloadProgress>('fonts-progress', event => onProgress(event.payload))
  try {
    await invoke('download_fonts', { files })
  } finally {
    stop()
  }
}
