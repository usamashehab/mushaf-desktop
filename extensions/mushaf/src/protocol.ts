// The messages between an extension and the app it runs in (extension API v1).
// The app shows the extension in a sandboxed frame with no network and no
// storage of its own: everything it needs and keeps goes through these
// messages. A copy of the app's definition; the two must stay the same.

export const API = 1

/** The app's language and look, given at the start. */
export interface Init {
  type: 'init'
  v: typeof API
  /** What the extension last asked the app to keep (`state`), or null the first time. */
  state: unknown
  language: 'ar' | 'en'
  theme: 'light' | 'dark'
}

/** App → extension. `init` comes first, by `postMessage` with the port; the rest over the port. */
export type HostMessage =
  | Init
  /** Go to a place the user asked for, in the extension's own words (for the Mushaf: "50", "2:255"). */
  | { type: 'open'; place: string }
  /** The answer to `needAsset`: the file's bytes, or null when the app doesn't have it. */
  | { type: 'asset'; id: number; bytes: ArrayBuffer | null }

/** Extension → app, over the port. */
export type ExtensionMessage =
  /** Drawn and ready to read. */
  | { type: 'ready' }
  /**
   * The reader is on `page` (the last page in view). `turn`: by the next or
   * previous page; `jump`: straight there (search, an index, a bookmark).
   */
  | { type: 'page'; page: number; kind: 'turn' | 'jump' }
  /** Keep this and give it back in the next `init` (at most `MAX_STATE` bytes as JSON). */
  | { type: 'state'; data: unknown }
  /** One of the files listed in the extension's `assets`, by its path. */
  | { type: 'needAsset'; id: number; path: string }

export const MAX_STATE = 64 * 1024

/** Whether a message from the app is one this version understands. */
export function isHostMessage(data: unknown): data is HostMessage {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const message = data as Record<string, unknown>
  switch (message['type']) {
    case 'init':
      return (
        message['v'] === API &&
        (message['language'] === 'ar' || message['language'] === 'en') &&
        (message['theme'] === 'light' || message['theme'] === 'dark')
      )
    case 'open':
      return typeof message['place'] === 'string'
    case 'asset':
      return Number.isInteger(message['id']) && (message['bytes'] === null || message['bytes'] instanceof ArrayBuffer)
    default:
      return false
  }
}
