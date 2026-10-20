import { describe, expect, test } from 'vitest'

import { parseRecitation, parseTafsir, quranComLibrary } from '../src/library.ts'

// Replies as quran.com gives them, cut down.

describe('the library', () => {
  test('a tafsir passage lists the ayahs it explains together, in order', () => {
    const reply = { tafsir: { verses: { '2:33': { id: 40 }, '2:31': { id: 38 }, '2:32': { id: 39 } }, text: '<h2>The Virtue of Adam</h2><p>…</p>' } }
    expect(parseTafsir(reply, { surah: 2, ayah: 32 })).toEqual({
      ayahs: [
        { surah: 2, ayah: 31 },
        { surah: 2, ayah: 32 },
        { surah: 2, ayah: 33 },
      ],
      html: '<h2>The Virtue of Adam</h2><p>…</p>',
    })
    expect(() => parseTafsir({ tafsir: {} }, { surah: 1, ayah: 1 })).toThrow()
  })

  test('a recitation gives each ayah and each word its time, skipping what is malformed', () => {
    const reply = {
      audio_files: [
        {
          audio_url: 'https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/1.mp3',
          verse_timings: [
            { verse_key: '1:1', timestamp_from: 0, timestamp_to: 6090, segments: [[1, 0, 580], [2, 580, 1409], [3]] },
            { verse_key: 'x', timestamp_from: 0, timestamp_to: 1 },
          ],
        },
      ],
    }
    expect(parseRecitation(reply)).toEqual({
      audio: 'https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/1.mp3',
      ayahs: [{ ayah: 1, from: 0, to: 6090, words: [{ position: 1, from: 0, to: 580 }, { position: 2, from: 580, to: 1409 }] }],
    })
  })

  test('each address is fetched once, and a failure is tried again', async () => {
    const asked: string[] = []
    let fail = true
    const library = quranComLibrary(async url => {
      asked.push(String(url))
      if (fail) {
        fail = false

        return new Response('', { status: 503 })
      }

      return Response.json({ translations: [{ text: 'Allah - there is no deity except Him' }] })
    })
    await expect(library.translation({ surah: 2, ayah: 255 })).rejects.toThrow()
    expect(await library.translation({ surah: 2, ayah: 255 })).toBe('Allah - there is no deity except Him')
    expect(await library.translation({ surah: 2, ayah: 255 })).toBe('Allah - there is no deity except Him')
    expect(asked).toEqual([
      'https://api.quran.com/api/v4/quran/translations/20?verse_key=2:255',
      'https://api.quran.com/api/v4/quran/translations/20?verse_key=2:255',
    ])
  })
})
