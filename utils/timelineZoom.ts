export const TIMELINE_HEADER_WIDTH = 148
export const TIMELINE_DEFAULT_MIN_PX_PER_SEC = 8
export const TIMELINE_MAX_PX_PER_SEC = 600
export const TIMELINE_ABSOLUTE_MIN_PX_PER_SEC = 0.01

/** Keep the project/content endpoint just inside the visible timeline. The
 * trailing drag space can still overflow horizontally. */
const ENDPOINT_GUTTER = 8

export function timelineZoomFloor(viewportWidth: number, contentEnd: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentEnd) || contentEnd <= 0) {
    return TIMELINE_DEFAULT_MIN_PX_PER_SEC
  }

  const laneWidth = viewportWidth - TIMELINE_HEADER_WIDTH - ENDPOINT_GUTTER
  if (laneWidth <= 0) return TIMELINE_ABSOLUTE_MIN_PX_PER_SEC

  return Math.min(
    TIMELINE_DEFAULT_MIN_PX_PER_SEC,
    Math.max(TIMELINE_ABSOLUTE_MIN_PX_PER_SEC, laneWidth / contentEnd)
  )
}
