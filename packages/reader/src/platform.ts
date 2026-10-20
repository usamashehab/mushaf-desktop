import type { AyahRef, PackLayout, QuranMeta, ReciterId, SearchText, Settings, TafsirId } from '@mushaf/core'
import type { PackManifest } from '@mushaf/packs'

/**
 * What the reader needs from wherever it runs: the desktop app, a browser, later a
 * phone. The reader itself touches no file system, network or native API.
 */
export interface Platform {
  /** Where the page's font comes from: a local file in the app, a dev server path in a browser. */
  pageFont(pack: PackManifest, page: number): FontSource
  /** The same for the surah-name and basmala fonts. */
  extraFont(pack: PackManifest, which: keyof PackManifest['extras']): FontSource
  /** Settings as last saved, in any shape; the reader migrates them. */
  loadSettings(): Promise<unknown>
  saveSettings(settings: Settings): Promise<void>
  /** The coding agents, where the platform has them. */
  agents?: AgentsBridge
  /** Tafsir, translation and recitation, where the platform can reach them. */
  library?: Library
}

/** A tafsir's passage on an ayah. Some explain several ayahs together. */
export interface TafsirPassage {
  /** The ayahs it explains, in order; the one asked for among them. */
  ayahs: AyahRef[]
  /** As the source gives it: HTML, shown with only its plain structure kept. */
  html: string
}

/** A surah recited, with when each ayah and each of its words is heard. */
export interface Recitation {
  audio: string
  /** In order. ms from the audio's start. */
  ayahs: { ayah: number; from: number; to: number; words: { position: number; from: number; to: number }[] }[]
}

/** Books and recitations from outside the app, fetched when asked for. */
export interface Library {
  tafsir(tafsir: TafsirId, ayah: AyahRef): Promise<TafsirPassage>
  /** An ayah's meaning in English (Saheeh International), as HTML. */
  translation(ayah: AyahRef): Promise<string>
  recitation(reciter: ReciterId, surah: number): Promise<Recitation>
}

/**
 * A font: the URL it loads from, or, where the reader can't fetch (a sandboxed
 * frame), a function giving its bytes. The function runs only when the font isn't loaded yet.
 */
export type FontSource = string | (() => Promise<ArrayBuffer>)

/** How the reader got to a page: turning to the next or previous one, or going straight there. */
export type MoveKind = 'turn' | 'jump'

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
