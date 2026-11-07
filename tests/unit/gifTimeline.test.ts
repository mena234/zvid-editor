import { describe, expect, it, vi, afterEach } from 'vitest'
import { gifFrameIndexAt, openTimelineGif } from '../../utils/gifTimeline'

const frames = [{ start: 0, duration: 0.06 }, { start: 0.06, duration: 0.03 },
  { start: 0.09, duration: 0.03 }, { start: 0.12, duration: 0.18 }]

describe('GIF timing on the renderer frame clock', () => {
  it('uses variable delays rounded to output frames', () => {
    expect([0, 1, 2, 3, 4, 8].map(n => gifFrameIndexAt(frames, n / 30, 30))).toEqual([0, 0, 1, 2, 3, 3])
  })
  it('loops at the full duration, including a long final delay', () => {
    expect(gifFrameIndexAt(frames, 9 / 30, 30)).toBe(0)
    expect(gifFrameIndexAt(frames, 11 / 30, 30)).toBe(1)
    expect(gifFrameIndexAt(frames, 29 / 30, 30)).toBe(1)
  })
  it('holds the last frame after finite repetitions', () => {
    expect(gifFrameIndexAt(frames, 9 / 30, 30, 0)).toBe(3)
    expect(gifFrameIndexAt(frames, 9 / 30, 30, 1)).toBe(0)
    expect(gifFrameIndexAt(frames, 18 / 30, 30, 1)).toBe(3)
  })
  it('gives the same answer after backward seeks', () => {
    expect([8, 2, 11, 2].map(n => gifFrameIndexAt(frames, n / 30, 30))).toEqual([3, 1, 1, 1])
  })
  it('does not round an untransitioned GIF to a future source frame', () => {
    expect(gifFrameIndexAt(frames, 0.05, 30, Infinity, false)).toBe(0)
    expect(gifFrameIndexAt(frames, 0.06, 30, Infinity, false)).toBe(1)
  })
})

afterEach(() => vi.unstubAllGlobals())

it('releases metadata frames and closes the decoder on cancellation', async () => {
  const closedFrames: number[] = []
  const close = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })))
  vi.stubGlobal('ImageDecoder', class {
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2, repetitionCount: Infinity } }
    close = close
    async decode({ frameIndex }: { frameIndex: number }) {
      return { image: { timestamp: frameIndex * 100_000, duration: 100_000, close: () => closedFrames.push(frameIndex) } }
    }
  })
  const controller = new AbortController()
  const gif = await openTimelineGif('/fixture.gif', controller.signal)
  expect(gif.frames).toEqual([{ start: 0, duration: 0.1 }, { start: 0.1, duration: 0.1 }])
  expect(closedFrames).toEqual([0, 1])
  controller.abort()
  gif.close()
  expect(close).toHaveBeenCalledTimes(1)
})

it('reports unsupported decoding before fetching an asset', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('ImageDecoder', undefined)
  await expect(openTimelineGif('/fixture.gif', new AbortController().signal)).rejects.toThrow('unavailable')
  expect(fetch).not.toHaveBeenCalled()
})
