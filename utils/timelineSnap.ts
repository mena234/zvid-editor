import { round3 } from './time'

interface TimelineSnapOptions {
  enabled: boolean
  targets: readonly number[]
  pxPerSec: number
  frameRate: number
}

/** Prefer authored edges, then nearby half seconds, then individual frames. */
export function snapTimelineTime(time: number, options: TimelineSnapOptions): number {
  const { enabled, targets, pxPerSec, frameRate } = options
  if (!enabled) return round3(Math.max(0, time))

  const threshold = 7 / pxPerSec
  let best: number | undefined
  let distance = threshold
  for (const target of targets) {
    const delta = Math.abs(target - time)
    if (delta <= distance) {
      distance = delta
      best = target
    }
  }
  if (best !== undefined) return round3(Math.max(0, best))

  const halfSecond = Math.round(time * 2) / 2
  // Keep space for precise edits even when half-second marks are close together.
  if (Math.abs(halfSecond - time) <= Math.min(threshold, 0.1)) {
    return Math.max(0, halfSecond)
  }
  return round3(Math.max(0, Math.round(time * frameRate) / frameRate))
}
