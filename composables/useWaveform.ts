import { reactive } from 'vue'

export interface WaveformData {
  status: 'loading' | 'ok' | 'error'
  /** normalized 0..1 peaks */
  peaks: number[]
  duration?: number
}

const cache = reactive(new Map<string, WaveformData>())
const BUCKETS = 400

/**
 * Decode an audio file and downsample to peak buckets for clip waveforms.
 * CORS-blocked sources fail gracefully (clips fall back to a flat pattern).
 */
export function useWaveform() {
  function waveformFor(src: string): WaveformData {
    let entry = cache.get(src)
    if (entry) return entry
    entry = reactive({ status: 'loading', peaks: [] }) as WaveformData
    cache.set(src, entry)
    if (typeof window === 'undefined') return entry

    ;(async () => {
      try {
        const res = await fetch(src, { mode: 'cors' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = await res.arrayBuffer()
        const ctx = new OfflineAudioContext(1, 8000, 8000)
        const audio = await ctx.decodeAudioData(buf)
        const data = audio.getChannelData(0)
        const bucketSize = Math.max(1, Math.floor(data.length / BUCKETS))
        const peaks: number[] = []
        for (let i = 0; i < BUCKETS; i++) {
          let max = 0
          const start = i * bucketSize
          for (let j = start; j < Math.min(start + bucketSize, data.length); j += 16) {
            const v = Math.abs(data[j])
            if (v > max) max = v
          }
          peaks.push(max)
        }
        const top = Math.max(0.001, ...peaks)
        entry!.peaks = peaks.map((p) => p / top)
        entry!.duration = audio.duration
        entry!.status = 'ok'
      } catch {
        entry!.status = 'error'
      }
    })()

    return entry
  }

  return { waveformFor }
}
