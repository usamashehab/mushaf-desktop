// Page fonts load on demand through the FontFace API. A page font is ~150 KB, so
// only the pages around the one in view stay loaded; older ones are dropped.

import type { FontSource } from './platform.ts'

const KEEP = 24

const loading = new Map<string, Promise<FontFace>>()
const ready = new Set<string>()
const recent: string[] = []

function touch(family: string) {
  const at = recent.indexOf(family)
  if (at !== -1) {
    recent.splice(at, 1)
  }
  recent.push(family)
  while (recent.length > KEEP) {
    const old = recent.shift()
    const face = old === undefined ? undefined : loading.get(old)
    if (old !== undefined && face) {
      loading.delete(old)
      ready.delete(old)
      void face.then(loaded => document.fonts.delete(loaded)).catch(() => {})
    }
  }
}

/** Loads `source` as the font `family`, once; resolves when text can be drawn with it. */
export function loadFont(family: string, source: FontSource, keep = false): Promise<FontFace> {
  let face = loading.get(family)
  if (!face) {
    const made =
      typeof source === 'string'
        ? Promise.resolve(new FontFace(family, `url("${source}")`, { display: 'block' }))
        : source().then(bytes => new FontFace(family, bytes, { display: 'block' }))
    face = made.then(font => font.load()).then(loaded => {
      document.fonts.add(loaded)
      ready.add(family)

      return loaded
    })
    face.catch(() => loading.delete(family))
    loading.set(family, face)
  }
  if (!keep) {
    touch(family)
  }

  return face
}

/** Whether `family` can be drawn with right now, so a page shows without a blank frame. */
export const isFontReady = (family: string) => ready.has(family)
