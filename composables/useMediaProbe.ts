import { reactive } from 'vue'

export interface ProbeResult {
  status: 'loading' | 'ok' | 'error'
  kind: 'video' | 'image' | 'audio'
  width?: number
  height?: number
  duration?: number
  error?: string
}

/**
 * Global reactive cache of probed media metadata, keyed by `kind:src`.
 * Mirrors what the package learns through ffprobe (intrinsic dimensions,
 * durations) so the stage/timeline can resolve defaults the same way.
 */
const cache = reactive(new Map<string, ProbeResult>())

function keyOf(kind: string, src: string) {
  return `${kind}:${src}`
}

function probeImage(src: string, entry: ProbeResult) {
  const img = new Image()
  img.onload = () => {
    entry.width = img.naturalWidth
    entry.height = img.naturalHeight
    entry.status = 'ok'
  }
  img.onerror = () => {
    entry.status = 'error'
    entry.error = 'Failed to load image'
  }
  img.src = src
}

function probeVideo(src: string, entry: ProbeResult) {
  const vid = document.createElement('video')
  vid.preload = 'metadata'
  vid.muted = true
  vid.onloadedmetadata = () => {
    entry.width = vid.videoWidth
    entry.height = vid.videoHeight
    entry.duration = isFinite(vid.duration) ? vid.duration : undefined
    entry.status = 'ok'
    vid.src = ''
  }
  vid.onerror = () => {
    entry.status = 'error'
    entry.error = 'Failed to load video metadata'
  }
  vid.src = src
}

function probeAudio(src: string, entry: ProbeResult) {
  const audio = document.createElement('audio')
  audio.preload = 'metadata'
  audio.onloadedmetadata = () => {
    entry.duration = isFinite(audio.duration) ? audio.duration : undefined
    entry.status = 'ok'
    audio.src = ''
  }
  audio.onerror = () => {
    entry.status = 'error'
    entry.error = 'Failed to load audio metadata'
  }
  audio.src = src
}

/** last resort: ask the dev server's ffprobe for CORS-blocked media */
async function probeViaServer(src: string, entry: ProbeResult) {
  try {
    const meta = await $fetch<{
      width?: number
      height?: number
      duration?: number
    }>('/api/probe', { query: { src } })
    if (meta.width) entry.width = meta.width
    if (meta.height) entry.height = meta.height
    if (meta.duration) entry.duration = meta.duration
    if (meta.width || meta.duration) {
      entry.status = 'ok'
      entry.error = undefined
    }
  } catch {
    /* keep the browser error state */
  }
}

export function useMediaProbe() {
  function probe(kind: 'video' | 'image' | 'audio', src: string): ProbeResult {
    if (!src) return { status: 'error', kind, error: 'empty src' }
    const key = keyOf(kind, src)
    let entry = cache.get(key)
    if (entry) return entry
    entry = reactive({ status: 'loading', kind }) as ProbeResult
    cache.set(key, entry)
    if (typeof window !== 'undefined') {
      if (kind === 'image') probeImage(src, entry)
      else if (kind === 'video') probeVideo(src, entry)
      else probeAudio(src, entry)
      // when the browser can't read it (CORS/codec), fall back to server ffprobe
      if (/^https?:\/\//i.test(src)) {
        const watchError = () => {
          if (entry!.status === 'error') probeViaServer(src, entry!)
        }
        setTimeout(watchError, 4000)
        setTimeout(watchError, 12000)
      }
    }
    return entry
  }

  /** duration lookup used by the scene-plan math; probes lazily */
  function probeDuration(src: string): number | undefined {
    // try both media kinds — audio first (cheap), then video
    const a = probe('audio', src)
    if (a.status === 'ok' && a.duration) return a.duration
    const v = probe('video', src)
    if (v.status === 'ok' && v.duration) return v.duration
    return undefined
  }

  /** intrinsic dimensions for a visual item (video/image/gif) */
  function intrinsicOf(
    kind: 'video' | 'image',
    src: string
  ): { width: number; height: number } | null {
    const p = probe(kind, src)
    if (p.status === 'ok' && p.width && p.height)
      return { width: p.width, height: p.height }
    return null
  }

  return { probe, probeDuration, intrinsicOf, cache }
}
