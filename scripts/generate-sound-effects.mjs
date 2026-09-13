/** Generate the original Zvid sound-effect library. No sampled recordings or
 * third-party source material. Run with `node scripts/generate-sound-effects.mjs`.
 * Keep released version directories immutable because project JSON uses them. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const rate = 44100
const tau = Math.PI * 2
const target = fileURLToPath(new URL('../public/audio/sound-effects/v1/', import.meta.url))
mkdirSync(target, { recursive: true })
let seed = 7192
const noise = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0xffffffff * 2 - 1
}
const tone = (hz, t) => Math.sin(tau * hz * t)
const bell = (hz, t) => (tone(hz, t) + tone(hz * 2.76, t) * 0.22) * Math.exp(-t * 5)
const note = (hz, t, start, decay = 9) => t < start ? 0 : tone(hz, t - start) * Math.exp(-(t - start) * decay)
const effects = [
  ['click', 0.12, (t) => (noise() * 0.3 + tone(1450, t) * 0.4) * Math.exp(-t * 65)],
  ['pop', 0.24, (t) => Math.sin(tau * (900 * t - 1600 * t * t)) * Math.exp(-t * 23)],
  ['chime', 1.2, (t) => bell(1046.5, t) * 0.7 + bell(1568, t) * 0.2],
  ['success', 0.95, (t) => note(523.25, t, 0) + note(659.25, t, 0.12) + note(783.99, t, 0.24, 7)],
  ['notification', 0.65, (t) => note(880, t, 0) + note(1174.66, t, 0.13)],
  ['whoosh', 0.75, (t, duration) => noise() * Math.sin(Math.PI * t / duration) ** 2],
  ['riser', 1.1, (t, duration) => (Math.sin(tau * (180 * t + 500 * t * t)) * 0.45 + noise() * 0.25) * (t / duration) ** 1.5],
  ['impact', 0.6, (t) => (Math.sin(tau * (90 * t - 40 * t * t)) + noise() * 0.2 * Math.exp(-t * 40)) * Math.exp(-t * 12)],
]

for (const [id, duration, synth] of effects) {
  const count = Math.round(duration * rate)
  const samples = new Float64Array(count)
  let peak = 0
  for (let i = 0; i < count; i++) {
    const t = i / rate
    // Short fade at both ends avoids clicks without dulling transients.
    const fade = Math.min(1, i / (rate * 0.003), (count - 1 - i) / (rate * 0.025))
    samples[i] = synth(t, duration) * fade
    peak = Math.max(peak, Math.abs(samples[i]))
  }
  const wav = Buffer.alloc(44 + count * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24)
  wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(samples[i] / peak * 0.6 * 32767), 44 + i * 2)
  writeFileSync(`${target}/${id}.wav`, wav)
}
