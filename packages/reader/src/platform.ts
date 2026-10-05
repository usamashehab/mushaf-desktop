import type { PackLayout, QuranMeta, SearchText, Settings } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'

/**
 * What the reader needs from wherever it runs: the desktop app, a browser, later a
 * phone. The reader itself touches no file system, network or native API.
 */
export interface Platform {
  /** A URL the page's font loads from: a local file in the app, a dev server path in a browser. */
  pageFontUrl(pack: PackManifest, page: number): string
  /** The same for the surah-name and basmala fonts. */
  extraFontUrl(pack: PackManifest, which: keyof PackManifest['extras']): string
  /** Settings as last saved, in any shape; the reader migrates them. */
  loadSettings(): Promise<unknown>
  saveSettings(settings: Settings): Promise<void>
  /** The coding agents, where the platform has them. */
  agents?: AgentsBridge
}

/** The data a reader draws from. */
export interface ReaderData {
  meta: QuranMeta
  manifest: PackManifest
  layout: PackLayout
  /** For search; without it the search box only goes to places. */
  searchText?: SearchText
}

/** A task an agent is working on, as the app tracks it. */
export interface AgentSession {
  agent: string
  session: string
  project?: string
  /** ms since the epoch. */
  started_at: number
  /** When the Mushaf opens for it, if it will and hasn't yet. */
  opens_at?: number
  opened: boolean
}

/** An agent finished, or stopped to wait for the user. */
export interface AgentAlert {
  agent: string
  project: string | null
  kind: 'finished' | 'attention'
  at: number
  workedMs: number | null
  sound: boolean
}

/** Whether an agent's hooks lead to this app. */
export interface Integration {
  id: string
  name: string
  status: 'missing' | 'off' | 'on' | 'stale' | 'error'
  /** What the user has to do once, if anything (Codex: trust the hooks). */
  note: string | null
  configPath: string
  error: string | null
}

type Unlisten = () => void

/**
 * Where the coding agents reach the reader: only the desktop app has this. Each
 * `on…` returns its unsubscribe.
 */
export interface AgentsBridge {
  state(): Promise<{ sessions: AgentSession[]; pausedUntil: number | null }>
  onSessions(listener: (sessions: AgentSession[]) => void): Unlisten
  onAlert(listener: (alert: AgentAlert) => void): Unlisten
  onPause(listener: (until: number | null) => void): Unlisten
  /** `mushaf open <place>`: a page, an ayah or a surah, as typed. */
  onOpenPlace(listener: (place: string) => void): Unlisten
  /** A place asked for before the reader was listening, once. */
  takeOpenPlace(): Promise<string | null>
  pause(until: number | null): Promise<void>
  integrations(): Promise<Integration[]>
  setIntegration(id: string, on: boolean): Promise<Integration>
}
