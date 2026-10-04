import { clampPage, isPage } from './navigation.ts'

export type Theme = 'day' | 'night' | 'sepia'
export type Spread = 'auto' | 'single' | 'double'
export type Language = 'ar' | 'en'

export interface Bookmark {
  page: number
  surah?: number
  ayah?: number
  label?: string
  /** ms since the epoch. */
  createdAt: number
}

export interface AgentSettings {
  enabled: boolean
  /** Opens the Mushaf when the agent has worked this long on one task. 0 never opens it. */
  openAfterMinutes: number
}

export interface Settings {
  v: 1
  page: number
  bookmarks: Bookmark[]
  theme: Theme
  /** 1 fits the page to the window. */
  zoom: number
  spread: Spread
  language: Language
  /** The Mushaf pack the pages are drawn with. */
  pack: string
  /** By agent id ("claude", "codex", …); a missing agent uses `agentDefaults`. */
  agents: Record<string, AgentSettings>
  agentDefaults: AgentSettings
  alerts: {
    /** Bring the window to the front when it opens for an agent, or open it behind. */
    focusOnOpen: boolean
    /** Notify when an agent finishes even though the Mushaf never opened for it. */
    notifyWhenClosed: boolean
    sound: boolean
  }
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  page: 1,
  bookmarks: [],
  theme: 'day',
  zoom: 1,
  spread: 'auto',
  language: 'ar',
  pack: 'qcf-v2',
  agents: {},
  agentDefaults: { enabled: true, openAfterMinutes: 2 },
  alerts: { focusOnOpen: false, notifyWhenClosed: false, sound: true },
}

export const agentSettings = (settings: Settings, agent: string): AgentSettings =>
  settings.agents[agent] ?? settings.agentDefaults

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const boolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

function agent(value: unknown, fallback: AgentSettings): AgentSettings {
  const raw = isRecord(value) ? value : {}

  return {
    enabled: boolean(raw['enabled'], fallback.enabled),
    openAfterMinutes: number(raw['openAfterMinutes'], fallback.openAfterMinutes, 0, 24 * 60),
  }
}

function bookmark(value: unknown): Bookmark | undefined {
  if (!isRecord(value) || typeof value['page'] !== 'number' || !isPage(value['page'])) {
    return undefined
  }
  const out: Bookmark = { page: value['page'], createdAt: number(value['createdAt'], 0, 0, Number.MAX_SAFE_INTEGER) }
  if (typeof value['surah'] === 'number' && typeof value['ayah'] === 'number') {
    out.surah = value['surah']
    out.ayah = value['ayah']
  }
  if (typeof value['label'] === 'string') {
    out.label = value['label']
  }

  return out
}

/**
 * Settings as stored, from any earlier version or a hand-edited file, made whole:
 * unknown keys dropped, bad values replaced by defaults. Never throws.
 * A future v2 adds a step here that turns v1 into v2.
 */
export function migrateSettings(stored: unknown): Settings {
  const raw = isRecord(stored) ? stored : {}
  const d = DEFAULT_SETTINGS
  const defaults = agent(raw['agentDefaults'], d.agentDefaults)
  const agents: Record<string, AgentSettings> = {}
  if (isRecord(raw['agents'])) {
    for (const [id, value] of Object.entries(raw['agents'])) {
      agents[id] = agent(value, defaults)
    }
  }
  const alerts = isRecord(raw['alerts']) ? raw['alerts'] : {}

  return {
    v: 1,
    page: typeof raw['page'] === 'number' ? clampPage(raw['page']) : d.page,
    bookmarks: Array.isArray(raw['bookmarks'])
      ? raw['bookmarks'].map(bookmark).filter((b): b is Bookmark => b !== undefined)
      : [],
    theme: pick(raw['theme'], ['day', 'night', 'sepia'] as const, d.theme),
    zoom: number(raw['zoom'], d.zoom, 0.5, 3),
    spread: pick(raw['spread'], ['auto', 'single', 'double'] as const, d.spread),
    language: pick(raw['language'], ['ar', 'en'] as const, d.language),
    pack: typeof raw['pack'] === 'string' && raw['pack'] !== '' ? raw['pack'] : d.pack,
    agents,
    agentDefaults: defaults,
    alerts: {
      focusOnOpen: boolean(alerts['focusOnOpen'], d.alerts.focusOnOpen),
      notifyWhenClosed: boolean(alerts['notifyWhenClosed'], d.alerts.notifyWhenClosed),
      sound: boolean(alerts['sound'], d.alerts.sound),
    },
  }
}
