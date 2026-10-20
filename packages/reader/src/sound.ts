let context: AudioContext | undefined

/** A soft rustle of paper, as a page turns: a short burst of filtered noise. */
export function rustle() {
  if (typeof AudioContext === 'undefined') {
    return
  }
  try {
    context ??= new AudioContext()
    const length = Math.round(context.sampleRate * 0.32)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      samples[i] = Math.random() * 2 - 1
    }
    const noise = context.createBufferSource()
    noise.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 2400
    filter.Q.value = 0.7
    const gain = context.createGain()
    const now = context.currentTime
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.05, now + 0.06)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    noise.connect(filter).connect(gain).connect(context.destination)
    noise.start(now)
  } catch {
    // No sound: the page turns all the same.
  }
}
