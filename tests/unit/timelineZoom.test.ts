import { describe, expect, it } from 'vitest'
import {
  TIMELINE_ABSOLUTE_MIN_PX_PER_SEC,
  TIMELINE_DEFAULT_MIN_PX_PER_SEC,
  TIMELINE_HEADER_WIDTH,
  timelineZoomFloor,
} from '~/utils/timelineZoom'

describe('timelineZoomFloor', () => {
  it('keeps the familiar 8px/s floor when the whole duration already fits', () => {
    expect(timelineZoomFloor(1200, 10)).toBe(TIMELINE_DEFAULT_MIN_PX_PER_SEC)
  })

  it('fits a long project endpoint after the fixed track header', () => {
    const viewport = 800
    const duration = 346.8
    const floor = timelineZoomFloor(viewport, duration)

    expect(floor).toBeLessThan(TIMELINE_DEFAULT_MIN_PX_PER_SEC)
    expect(TIMELINE_HEADER_WIDTH + duration * floor).toBeLessThan(viewport)
  })

  it('responds to viewport width and stays positive for degenerate widths', () => {
    expect(timelineZoomFloor(1200, 346.8)).toBeGreaterThan(
      timelineZoomFloor(800, 346.8)
    )
    expect(timelineZoomFloor(100, 346.8)).toBe(TIMELINE_ABSOLUTE_MIN_PX_PER_SEC)
  })
})
