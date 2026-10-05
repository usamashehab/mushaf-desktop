import { clampPage, isPage } from './navigation.ts'

export type Theme = 'day' | 'night' | 'sepia'
export type Spread = 'auto' | 'single' | 'double'
export type Language = 'ar' | 'en'

export const BOOKMARK_COLORS = ['gold', 'green', 'blue', 'rose', 'violet'] as const
export type BookmarkColor = (typeof BOOKMARK_COLORS)[number]

export interface Bookmark {
  id: string
  page: number
  surah?: number
  ayah?: number
  label?: string
  color: BookmarkColor
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
    /** How the Mushaf opens for an agent at work: in front, behind the window in use, or only a notification. */
    openStyle: OpenStyle
    /** Open only once the user has left the keyboard and mouse for a while, not while they work in another agent. */
    onlyWhenIdle: boolean
    /** A system notification as well as the banner, when the Mushaf isn't in front. */
    notify: boolean
    /** Notify when an agent finishes even though the Mushaf is closed. */
    notifyWhenClosed: boolean
    /** A soft chime with each alert. */
    sound: boolean
  }
}

export type OpenStyle = 'front' | 'behind' | 'notify'

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
  alerts: { openStyle: 'front', onlyWhenIdle: true, notify: false, notifyWhenClosed: false, sound: false },
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
  const createdAt = number(value['createdAt'], 0, 0, Number.MAX_SAFE_INTEGER)
  const out: Bookmark = {
    id: typeof value['id'] === 'string' && value['id'] !== '' ? value['id'] : `b${createdAt}-${value['page']}`,
    page: value['page'],
    color: pick(value['color'], BOOKMARK_COLORS, 'gold'),
    createdAt,
  }
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
      ? raw['bookmarks']
          .map(bookmark)
          .filter((b, i, all): b is Bookmark => b !== undefined && all.findIndex(other => other?.id === b.id) === i)
      : [],
    theme: pick(raw['theme'], ['day', 'night', 'sepia'] as const, d.theme),
    zoom: number(raw['zoom'], d.zoom, 0.5, 3),
    spread: pick(raw['spread'], ['auto', 'single', 'double'] as const, d.spread),
    language: pick(raw['language'], ['ar', 'en'] as const, d.language),
    pack: typeof raw['pack'] === 'string' && raw['pack'] !== '' ? raw['pack'] : d.pack,
    agents,
    agentDefaults: defaults,
    alerts: {
      // Before there was a choice, "bring to the front" was on or off.
      openStyle: pick(alerts['openStyle'], ['front', 'behind', 'notify'] as const, alerts['focusOnOpen'] === false ? 'behind' : d.alerts.openStyle),
      onlyWhenIdle: boolean(alerts['onlyWhenIdle'], d.alerts.onlyWhenIdle),
      notify: boolean(alerts['notify'], d.alerts.notify),
      notifyWhenClosed: boolean(alerts['notifyWhenClosed'], d.alerts.notifyWhenClosed),
      sound: boolean(alerts['sound'], d.alerts.sound),
    },
  }
}
