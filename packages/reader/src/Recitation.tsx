import { useCallback, useEffect, useRef, useState } from 'react'

import type { AyahRef, ReciterId } from '@mushaf/core'
import { Pause, Play, Square } from 'lucide-react'

import { useReader } from './context.tsx'
import type { Library, Recitation } from './platform.ts'

/** The ayah being recited, and the word in it, by its position, when one is. */
export interface Heard {
  surah: number
  ayah: number
  word: number | undefined
}

const LAST_SURAH = 114

/** Where `ms` falls in a recitation: its ayah, and the word in it. */
export function heardAt(recitation: Recitation, surah: number, ms: number): Heard | undefined {
  const ayah = recitation.ayahs.find(one => ms >= one.from && ms < one.to)
  if (!ayah) {
    return undefined
  }

  return { surah, ayah: ayah.ayah, word: ayah.words.find(word => ms >= word.from && ms < word.to)?.position }
}

/**
 * Recites from an ayah on, surah after surah, and says which word is heard as it is.
 * `onFail` hears of a recitation that would not load or play.
 */
export function useRecitation(library: Library | undefined, reciter: ReciterId, onFail: () => void) {
  const audio = useRef<HTMLAudioElement>(null)
  const loaded = useRef<{ surah: number; recitation: Recitation }>(undefined)
  // Where to start, in s, until the audio knows its length: WebKit drops a seek made before.
  const seeking = useRef<number>(undefined)
  const [heard, setHeard] = useState<Heard>()
  const [isOn, setIsOn] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const failed = useRef(onFail)
  failed.current = onFail

  const stop = useCallback(() => {
    audio.current?.pause()
    loaded.current = undefined
    setIsOn(false)
    setIsPlaying(false)
    setHeard(undefined)
  }, [])

  const start = useCallback(
    async ({ surah, ayah }: AyahRef) => {
      if (!library) {
        return
      }
      const player = (audio.current ??= new Audio())
      player.pause()
      setIsOn(true)
      try {
        const recitation = loaded.current?.surah === surah ? loaded.current.recitation : await library.recitation(reciter, surah)
        loaded.current = { surah, recitation }
        if (player.src !== recitation.audio) {
          player.src = recitation.audio
        }
        const at = (recitation.ayahs.find(one => one.ayah === ayah)?.from ?? 0) / 1000
        seeking.current = player.readyState >= HTMLMediaElement.HAVE_METADATA ? undefined : at
        player.currentTime = at
        setHeard({ surah, ayah, word: undefined })
        await player.play()
      } catch {
        stop()
        failed.current()
      }
    },
    [library, reciter, stop],
  )

  // Follow the audio: the word heard, and on to the next surah at the end of one.
  useEffect(() => {
    const player = audio.current
    if (!isOn || !player) {
      return
    }
    let frame = 0
    const follow = () => {
      const now = loaded.current
      if (now && seeking.current === undefined) {
        const at = heardAt(now.recitation, now.surah, player.currentTime * 1000)
        if (at) {
          setHeard(before => (before?.ayah === at.ayah && before.word === at.word && before.surah === at.surah ? before : at))
        }
      }
    }
    const tick = () => {
      follow()
      frame = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      setIsPlaying(true)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    }
    const onPause = () => {
      setIsPlaying(false)
      cancelAnimationFrame(frame)
    }
    const onEnded = () => {
      const surah = loaded.current?.surah ?? LAST_SURAH
      if (surah < LAST_SURAH) {
        void start({ surah: surah + 1, ayah: 1 })
      } else {
        stop()
      }
    }
    const onMetadata = () => {
      if (seeking.current !== undefined) {
        player.currentTime = seeking.current
        seeking.current = undefined
      }
    }
    const onError = () => {
      stop()
      failed.current()
    }
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)
    player.addEventListener('timeupdate', follow)
    player.addEventListener('ended', onEnded)
    player.addEventListener('loadedmetadata', onMetadata)
    player.addEventListener('error', onError)

    return () => {
      cancelAnimationFrame(frame)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onPause)
      player.removeEventListener('timeupdate', follow)
      player.removeEventListener('ended', onEnded)
      player.removeEventListener('loadedmetadata', onMetadata)
      player.removeEventListener('error', onError)
    }
  }, [isOn, start, stop])

  // Another reciter starts afresh; leaving the reader leaves no sound behind.
  useEffect(() => stop, [reciter, stop])

  return {
    heard,
    isOn,
    isPlaying,
    start,
    stop,
    pause: () => audio.current?.pause(),
    resume: () => void audio.current?.play().catch(() => failed.current()),
  }
}

/** While a recitation is on: who recites, where, and pause, go on and stop. */
export function RecitationBar({ recitation }: { recitation: ReturnType<typeof useRecitation> }) {
  const { settings, t, n, surahName } = useReader()
  const { heard, isOn, isPlaying } = recitation
  if (!isOn) {
    return null
  }

  return (
    <div className="recitation-bar" role="region" aria-label={t.recitation}>
      {isPlaying ? (
        <button type="button" className="icon-button" onClick={recitation.pause} title={`${t.pauseRecitation} (P)`} aria-label={t.pauseRecitation}>
          <Pause size={18} />
        </button>
      ) : (
        <button type="button" className="icon-button" onClick={recitation.resume} title={`${t.play} (P)`} aria-label={t.play}>
          <Play size={18} />
        </button>
      )}
      <span className="recitation-place">
        <strong>{heard ? t.ayahOf(surahName(heard.surah), n(heard.ayah)) : t.loading}</strong>
        <span>{t.reciters[settings.reciter]}</span>
      </span>
      <button type="button" className="icon-button" onClick={recitation.stop} title={t.stopRecitation} aria-label={t.stopRecitation}>
        <Square size={16} />
      </button>
    </div>
  )
}
