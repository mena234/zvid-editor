import { describe, expect, it } from 'vitest'
import { videoSeekTime } from '../../utils/videoTimeline'

describe('browser video seek precision', () => {
  it('rounds fractional boundaries upward by less than a microsecond', () => {
    for (const fps of [24, 25, 30, 60, 30000 / 1001]) {
      for (let frame = 0; frame < 100; frame++) {
        const time = frame / fps
        expect(videoSeekTime(time)).toBeGreaterThanOrEqual(time)
        expect(videoSeekTime(time) - time).toBeLessThan(0.00000101)
      }
    }
    expect(videoSeekTime(14 / 30)).toBe(0.466667)
  })
  it('preserves exact timestamps and clamps negative seeks', () => {
    expect(videoSeekTime(0.5)).toBe(0.5)
    expect(videoSeekTime(1.25)).toBe(1.25)
    expect(videoSeekTime(-1)).toBe(0)
  })
})
