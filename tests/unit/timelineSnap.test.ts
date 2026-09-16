import { describe, expect, it } from 'vitest'
import { snapTimelineTime } from '../../utils/timelineSnap'

const options = { enabled: true, targets: [0], pxPerSec: 60, frameRate: 30 }

describe('timeline snap points', () => {
  it.each([7.98, 8.02])('lands exactly on a nearby whole second from %s', (time) => {
    expect(snapTimelineTime(time, options)).toBe(8)
  })

  it.each([9.47, 9.53])('lands exactly on a nearby half second from %s', (time) => {
    expect(snapTimelineTime(time, options)).toBe(9.5)
  })

  it('keeps deliberate off-grid alignment with another clip or the playhead', () => {
    const precise = { ...options, targets: [5.55] }
    expect(snapTimelineTime(5.5, precise)).toBe(5.55)
    expect(snapTimelineTime(5.55, precise)).toBe(5.55)
  })

  it('uses frame precision away from half-second marks', () => {
    expect(snapTimelineTime(8.22, options)).toBe(8.233)
  })

  it('keeps the magnet within seven pixels when zoomed in', () => {
    expect(snapTimelineTime(8.01, { ...options, pxPerSec: 600 })).toBe(8)
    expect(snapTimelineTime(8.04, { ...options, pxPerSec: 600 })).toBe(8.033)
  })

  it('does not force every edit to half seconds when zoomed out', () => {
    expect(snapTimelineTime(8.22, { ...options, pxPerSec: 8 })).toBe(8.233)
  })

  it('allows fine timing with snapping disabled and clamps to the timeline start', () => {
    expect(snapTimelineTime(8.02, { ...options, enabled: false })).toBe(8.02)
    expect(snapTimelineTime(9.47, { ...options, enabled: false })).toBe(9.47)
    expect(snapTimelineTime(-0.1, options)).toBe(0)
  })
})
