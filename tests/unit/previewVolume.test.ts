import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { releasePreviewVolume, setPreviewVolume } from '../../utils/previewVolume'

describe('preview audio gain', () => {
  let contexts: any[]
  let media: HTMLMediaElement

  beforeEach(() => {
    contexts = []
    media = { volume: 1, muted: false } as HTMLMediaElement
    vi.stubGlobal('AudioContext', class {
      destination = {}
      state = 'suspended'
      source = { connect: vi.fn(), disconnect: vi.fn() }
      gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
      createMediaElementSource = vi.fn(() => this.source)
      createGain = vi.fn(() => this.gain)
      resume = vi.fn(async () => { this.state = 'running' })
      close = vi.fn(async () => {})
      constructor() { contexts.push(this) }
    })
  })

  afterEach(() => {
    releasePreviewVolume(media)
    vi.unstubAllGlobals()
  })

  it('uses native volume below 100%, then amplifies instead of clipping at 100%', () => {
    setPreviewVolume(media, 0.5, false, false)
    expect(media.volume).toBe(0.5)
    expect(contexts).toHaveLength(0)

    setPreviewVolume(media, 2, false, true)
    expect(media.volume).toBe(1)
    expect(media.muted).toBe(false)
    expect(contexts).toHaveLength(1)
    const context = contexts[0]
    expect(context.source.connect).toHaveBeenCalledWith(context.gain)
    expect(context.gain.connect).toHaveBeenCalledWith(context.destination)
    expect(context.gain.gain.value).toBe(2)
    expect(context.resume).toHaveBeenCalledOnce()

    setPreviewVolume(media, 0.25, false, true)
    expect(context.createMediaElementSource).toHaveBeenCalledOnce()
    expect(context.gain.gain.value).toBe(0.25)
    expect(media.volume).toBe(1)
  })

  it('honors mute and disconnects the removed source', () => {
    setPreviewVolume(media, 1.5, true, true)
    expect(media.muted).toBe(true)
    setPreviewVolume(media, 0, false, true)
    expect(media.muted).toBe(true)
    releasePreviewVolume(media)
    expect(contexts[0].source.disconnect).toHaveBeenCalledOnce()
    expect(contexts[0].gain.disconnect).toHaveBeenCalledOnce()
    expect(contexts[0].close).toHaveBeenCalledOnce()
  })
})
