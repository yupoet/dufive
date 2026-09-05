/**
 * A tiny synthesized stone click. No audio asset is shipped; the sound is
 * generated with a short frequency sweep, which keeps the offline payload
 * unchanged and avoids any licensing question.
 */
let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  try {
    if (!context) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      context = new Ctor()
    }
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

export function playStoneSound(): void {
  const ctx = audioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(640, now)
    oscillator.frequency.exponentialRampToValueAtTime(170, now + 0.07)

    gain.gain.setValueAtTime(0.14, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.1)
  } catch {
    // Audio can be unavailable in constrained WebViews; the move still lands.
  }
}
