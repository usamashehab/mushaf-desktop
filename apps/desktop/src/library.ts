import type { AyahRef, ReciterId, TafsirId } from '@mushaf/core'
import type { Library, Recitation, TafsirPassage } from '@mushaf/reader'

// Quran.com's API: tafsir and translation from api.quran.com, each word's timing in a
// recitation from its CDN's API, the audio from quranicaudio.com. All allow any origin.
const API = 'https://api.quran.com/api/v4'
const QDC = 'https://api.qurancdn.com/api/qdc'

/** Quran.com's resource ids. */
const TAFSIR_RESOURCES: Record<TafsirId, number> = {
  muyassar: 16,
  saadi: 91,
  'ibn-kathir-ar': 14,
  'ibn-kathir-en': 169,
}
const SAHEEH_INTERNATIONAL = 20
const RECITER_RESOURCES: Record<ReciterId, number> = {
  alafasy: 7,
  husary: 6,
  minshawi: 9,
  abdulbaset: 2,
  sudais: 3,
  shuraim: 10,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const key = ({ surah, ayah }: AyahRef) => `${surah}:${ayah}`

function ayahOf(verseKey: string): AyahRef | undefined {
  const [surah, ayah] = verseKey.split(':').map(Number)

  return surah && ayah ? { surah, ayah } : undefined
}

/** Fetches each URL once; a failure is forgotten, so asking again tries again. */
function cachedJson(fetcher: typeof fetch) {
  const cache = new Map<string, Promise<unknown>>()

  return (url: string) => {
    let response = cache.get(url)
    if (!response) {
      response = fetcher(url).then(reply => {
        if (!reply.ok) {
          throw new Error(`${url}: ${reply.status}`)
        }

        return reply.json() as Promise<unknown>
      })
      response.catch(() => cache.delete(url))
      cache.set(url, response)
    }

    return response
  }
}

export function parseTafsir(body: unknown, asked: AyahRef): TafsirPassage {
  const tafsir = isRecord(body) && isRecord(body['tafsir']) ? body['tafsir'] : undefined
  if (!tafsir || typeof tafsir['text'] !== 'string') {
    throw new Error('No tafsir in the reply')
  }
  const ayahs = (isRecord(tafsir['verses']) ? Object.keys(tafsir['verses']) : [])
    .map(ayahOf)
    .filter((ayah): ayah is AyahRef => ayah !== undefined)
    .sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)

  return { ayahs: ayahs.length > 0 ? ayahs : [asked], html: tafsir['text'] }
}

export function parseRecitation(body: unknown): Recitation {
  const file = isRecord(body) && Array.isArray(body['audio_files']) ? (body['audio_files'][0] as unknown) : undefined
  if (!isRecord(file) || typeof file['audio_url'] !== 'string' || !Array.isArray(file['verse_timings'])) {
    throw new Error('No recitation in the reply')
  }
  const ayahs = file['verse_timings'].filter(isRecord).flatMap(timing => {
    const ayah = typeof timing['verse_key'] === 'string' ? ayahOf(timing['verse_key']) : undefined
    const from = timing['timestamp_from']
    const to = timing['timestamp_to']
    if (!ayah || typeof from !== 'number' || typeof to !== 'number') {
      return []
    }
    const words = (Array.isArray(timing['segments']) ? timing['segments'] : [])
      .filter((segment): segment is number[] => Array.isArray(segment) && segment.length >= 3 && segment.every(n => typeof n === 'number'))
      .map(([position = 0, start = 0, end = 0]) => ({ position, from: start, to: end }))

    return [{ ayah: ayah.ayah, from, to, words }]
  })

  return { audio: file['audio_url'], ayahs }
}

/** The library, from quran.com. */
export function quranComLibrary(fetcher: typeof fetch = (...args) => fetch(...args)): Library {
  const json = cachedJson(fetcher)

  return {
    tafsir: async (tafsir, ayah) => parseTafsir(await json(`${API}/tafsirs/${TAFSIR_RESOURCES[tafsir]}/by_ayah/${key(ayah)}`), ayah),
    translation: async ayah => {
      const body = await json(`${API}/quran/translations/${SAHEEH_INTERNATIONAL}?verse_key=${key(ayah)}`)
      const first = isRecord(body) && Array.isArray(body['translations']) ? (body['translations'][0] as unknown) : undefined
      if (!isRecord(first) || typeof first['text'] !== 'string') {
        throw new Error('No translation in the reply')
      }

      return first['text']
    },
    recitation: async (reciter, surah) =>
      parseRecitation(await json(`${QDC}/audio/reciters/${RECITER_RESOURCES[reciter]}/audio_files?chapter=${surah}&segments=true`)),
  }
}
