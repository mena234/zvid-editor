interface DecodedImage {
  image: VideoFrame
}
interface GifDecoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; repetitionCount: number } | null }
  decode(options: { frameIndex: number }): Promise<DecodedImage>
  close(): void
}
interface GifDecoderConstructor {
  new(options: { data: ArrayBuffer; type: string; preferAnimation: boolean }): GifDecoder
}
export interface GifFrameTiming { start: number; duration: number }

/** FFmpeg's fps filter rounds source timestamps to the nearest output frame.
 * Select the last GIF frame whose rounded timestamp has reached this frame. */
export function gifFrameIndexAt(
  frames: GifFrameTiming[], time: number, fps: number, repetitions = Infinity, roundToFrame = true
): number {
  if (!frames.length) return 0
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30
  const frame = Math.max(0, Math.floor(time * rate + 1e-7))
  // Without an animation/zoom fps filter the overlay consumes the last source
  // timestamp at or before its clock; it must not round to a future GIF frame.
  const sample = roundToFrame ? (frame + 0.5 - 1e-7) / rate : Math.max(0, time) + 1e-7
  const last = frames[frames.length - 1]!
  const duration = last.start + last.duration
  if (!(duration > 0)) return 0
  const cycle = Math.floor(sample / duration)
  if (Number.isFinite(repetitions) && cycle > repetitions) return frames.length - 1
  const local = sample - cycle * duration
  let index = 0
  for (let i = 1; i < frames.length && frames[i]!.start <= local; i++) index = i
  return index
}

export interface TimelineGif {
  frames: GifFrameTiming[]
  repetitions: number
  decode(index: number): Promise<DecodedImage>
  close(): void
}

/** Native GIF decoding preserves disposal/compositing rules and variable frame
 * delays. Keep only timing metadata; close each temporary VideoFrame promptly. */
export async function openTimelineGif(src: string, signal: AbortSignal): Promise<TimelineGif> {
  const Decoder = (globalThis as typeof globalThis & { ImageDecoder?: GifDecoderConstructor }).ImageDecoder
  if (!Decoder) throw new Error('Timeline GIF decoding is unavailable')
  const request = (url: string) => fetch(url, { signal, credentials: 'omit' }).then(response => {
    if (!response.ok) throw new Error('GIF download failed')
    return response.arrayBuffer()
  })
  let data: ArrayBuffer
  try {
    data = await request(src)
  } catch (error) {
    if (signal.aborted || !/^https?:\/\//i.test(src)) throw error
    data = await request(`/api/filter-media?src=${encodeURIComponent(src)}`)
  }
  signal.throwIfAborted()
  const decoder = new Decoder({ data, type: 'image/gif', preferAnimation: true })
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', close)
    decoder.close()
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack
    if (!track?.frameCount) throw new Error('GIF has no frames')
    const frames: GifFrameTiming[] = []
    for (let index = 0; index < track.frameCount; index++) {
      signal.throwIfAborted()
      const { image } = await decoder.decode({ frameIndex: index })
      try {
        frames.push({ start: image.timestamp / 1_000_000, duration: (image.duration ?? 100_000) / 1_000_000 })
      } finally {
        image.close()
      }
    }
    signal.throwIfAborted()
    return { frames, repetitions: track.repetitionCount, decode: index => decoder.decode({ frameIndex: index }), close }
  } catch (error) {
    close()
    throw error
  }
}
