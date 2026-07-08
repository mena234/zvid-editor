import {
  PROJECT_DEFAULTS,
  RESOLUTION_PRESETS,
  MAX_DESIGN_ELEMENT_DURATION,
  type ResolutionPreset,
  type Anchor,
  type PositionPreset,
} from './constants'
import type { ProjectDoc, VisualDoc, AudioDoc } from './types'
import { canonicalVisualType } from './types'

/**
 * Defaults engine — replicates package/src/lib/initialization/applyItemDefaults.ts
 * and utils/project.ts extractProjectDefaults, WITHOUT mutating the source
 * document. Used by the stage/timeline to know effective values.
 */

export interface ResolvedDimensions {
  width: number
  height: number
}

/** Port of utils/resolutionResolver.ts semantics. */
export function resolveProjectDimensions(p: {
  resolution?: string
  width?: number
  height?: number
}): ResolvedDimensions {
  const preset =
    p.resolution && p.resolution !== 'custom'
      ? RESOLUTION_PRESETS[p.resolution as ResolutionPreset]
      : null
  if (preset) return { width: preset.width, height: preset.height }
  return {
    width: asNum(p.width, 1920),
    height: asNum(p.height, 1080),
  }
}

/** Numeric-or-fallback: "{{placeholder}}" strings fall back to the default
 *  (the variables preview substitutes real numbers before layout math). */
function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback
}

export function resolveProjectDefaults(p: ProjectDoc) {
  const dims = resolveProjectDimensions(p)
  return {
    name: p.name ?? PROJECT_DEFAULTS.name,
    duration: asNum(p.duration, PROJECT_DEFAULTS.duration),
    frameRate: asNum(p.frameRate, PROJECT_DEFAULTS.frameRate),
    backgroundColor: p.backgroundColor ?? PROJECT_DEFAULTS.backgroundColor,
    outputFormat: p.outputFormat ?? PROJECT_DEFAULTS.outputFormat,
    width: dims.width,
    height: dims.height,
  }
}

export interface ResolvedTiming {
  enterBegin: number
  enterEnd: number
  exitBegin: number
  exitEnd: number
}

/**
 * applyVisualDefaults timing rules:
 *   enterBegin ?? 0, enterEnd ?? 0 (i.e. == enterBegin when 0),
 *   exitEnd ?? projectDuration, exitBegin ?? projectDuration.
 * Note the package literally defaults enterEnd to 0 — an item with
 * enterBegin 2 and no enterEnd has no enter-animation window.
 */
export function resolveVisualTiming(
  item: VisualDoc,
  contextDuration: number
): ResolvedTiming {
  // asNum: "{{placeholder}}" timing falls back to the default here (raw
  // views); the variables preview substitutes real numbers before this runs.
  const enterBegin = asNum(item.enterBegin, 0)
  const enterEnd = Math.max(asNum(item.enterEnd, 0), enterBegin)
  const exitEnd = asNum(item.exitEnd, contextDuration)
  const exitBegin = Math.min(asNum(item.exitBegin, contextDuration), exitEnd)
  return { enterBegin, enterEnd, exitBegin, exitEnd }
}

/**
 * Design Studio elements (visuals carrying a `designer` doc) animate through
 * customCode, whose loop the renderer caps at 15s — so their on-screen window
 * is capped to MAX_DESIGN_ELEMENT_DURATION too. Mutates the item; `prefer`
 * picks which edge gives way when the window is too long ('start' when the
 * caller just moved enterBegin, 'end' otherwise).
 *
 * Design elements always end up with an explicit exitEnd: an open-ended
 * window ("empty = end of timeline") silently grows whenever the timeline
 * does and would outrun the animation ceiling, so it is pinned to today's
 * timeline end (capped at the ceiling). Contexts with no usable duration
 * (auto "-1" scenes) pin straight to the ceiling.
 *
 * Template-placeholder timing ("{{var}}") is left alone — it resolves at
 * render, not here. Returns true when the item was changed.
 */
export function clampDesignTiming(
  item: VisualDoc,
  contextDuration: number,
  prefer: 'start' | 'end' = 'end'
): boolean {
  if (!(item as any).designer) return false
  if (typeof item.enterBegin === 'string' || typeof item.exitEnd === 'string')
    return false
  // NaN timing (corrupted or unresolvable) — nothing sane to clamp against,
  // and "fixing" it would overwrite fields the user can still repair
  if (
    (typeof item.enterBegin === 'number' && Number.isNaN(item.enterBegin)) ||
    (typeof item.exitEnd === 'number' && Number.isNaN(item.exitEnd))
  )
    return false
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  let changed = false

  if (item.exitEnd === undefined) {
    const eb =
      typeof item.enterBegin === 'number' && !Number.isNaN(item.enterBegin)
        ? item.enterBegin
        : 0
    const ctxEnd =
      contextDuration > 0 ? contextDuration : eb + MAX_DESIGN_ELEMENT_DURATION
    item.exitEnd = r3(
      Math.min(Math.max(ctxEnd, eb), eb + MAX_DESIGN_ELEMENT_DURATION)
    )
    changed = true
  }

  const t = resolveVisualTiming(item, contextDuration)
  if (t.exitEnd - t.enterBegin > MAX_DESIGN_ELEMENT_DURATION + 1e-6) {
    if (prefer === 'start') {
      item.enterBegin = r3(t.exitEnd - MAX_DESIGN_ELEMENT_DURATION)
    } else {
      item.exitEnd = r3(t.enterBegin + MAX_DESIGN_ELEMENT_DURATION)
    }
    changed = true
  }
  if (!changed) return false

  // pull explicit animation edges back inside the (possibly shrunk) window
  const begin = typeof item.enterBegin === 'number' ? item.enterBegin : 0
  const end = item.exitEnd as number
  if (typeof item.enterEnd === 'number')
    item.enterEnd = Math.min(Math.max(item.enterEnd, begin), end)
  if (typeof item.exitBegin === 'number')
    item.exitBegin = Math.min(Math.max(item.exitBegin, begin), end)
  return true
}

export interface ResolvedAudioTiming {
  enter: number
  exit: number
  audioBegin: number
  audioEnd: number
  volume: number
  speed: number
  track: number
}

/**
 * applyAudioDefaults + registerAudioInputs semantics.
 * `sourceDuration` = probed media duration (used when audioEnd is omitted).
 */
export function resolveAudioTiming(
  audio: AudioDoc,
  contextDuration: number,
  sourceDuration?: number
): ResolvedAudioTiming {
  const audioBegin = asNum(audio.audioBegin, 0)
  const audioEnd = asNum(
    audio.audioEnd,
    sourceDuration !== undefined
      ? Math.min(sourceDuration, contextDuration + audioBegin)
      : contextDuration
  )
  const speed = asNum(audio.speed, 1)
  const enter = asNum(audio.enter, 0)
  const trimmed = Math.max(0, audioEnd - audioBegin)
  const rawExit = asNum(audio.exit, NaN)
  const exit =
    !Number.isNaN(rawExit) && rawExit > enter
      ? rawExit
      : Math.min(enter + trimmed / speed, contextDuration)
  return {
    enter,
    exit,
    audioBegin,
    audioEnd,
    volume: asNum(audio.volume, 1),
    speed,
    track: asNum(audio.track, 0),
  }
}

/** Port of utils/calculatePosition.ts — position preset → anchor coordinates. */
export function positionPresetToXY(
  position: PositionPreset,
  projectWidth: number,
  projectHeight: number,
  currentX = 0,
  currentY = 0
): { x: number; y: number } {
  switch (position) {
    case 'top-left':
      return { x: 0, y: 0 }
    case 'top-center':
      return { x: projectWidth / 2, y: 0 }
    case 'top-right':
      return { x: projectWidth, y: 0 }
    case 'center-left':
      return { x: 0, y: projectHeight / 2 }
    case 'center-center':
      return { x: projectWidth / 2, y: projectHeight / 2 }
    case 'center-right':
      return { x: projectWidth, y: projectHeight / 2 }
    case 'bottom-left':
      return { x: 0, y: projectHeight }
    case 'bottom-center':
      return { x: projectWidth / 2, y: projectHeight }
    case 'bottom-right':
      return { x: projectWidth, y: projectHeight }
    default:
      return { x: currentX, y: currentY }
  }
}

/** Port of utils/calculateResize.ts. */
export function calculateResize(
  resizeMode: 'contain' | 'cover',
  originalWidth: number,
  originalHeight: number,
  targetWidth: number,
  targetHeight: number
): ResolvedDimensions {
  if (!originalWidth || !originalHeight || !targetWidth || !targetHeight) {
    return { width: targetWidth, height: targetHeight }
  }
  const oa = originalWidth / originalHeight
  const ta = targetWidth / targetHeight
  if (resizeMode === 'contain') {
    return oa > ta
      ? { width: targetWidth, height: Math.round(targetWidth / oa) }
      : { width: Math.round(targetHeight * oa), height: targetHeight }
  }
  // cover
  return oa > ta
    ? { width: Math.round(targetHeight * oa), height: targetHeight }
    : { width: targetWidth, height: Math.round(targetWidth / oa) }
}

/** Port of utils/calcImageRect.ts — rotated bounding box + centering offsets. */
export function calcImageRect(width: number, height: number, theta: number) {
  const rad = (theta * Math.PI) / 180
  const boundX =
    Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad))
  const boundY =
    Math.abs(height * Math.cos(rad)) + Math.abs(width * Math.sin(rad))
  return {
    width: Math.ceil(boundX),
    height: Math.ceil(boundY),
    offsetX: Math.ceil((boundX - width) / 2),
    offsetY: Math.ceil((boundY - height) / 2),
  }
}

export interface ResolvedLayout {
  /** anchor-point coordinates in project space */
  x: number
  y: number
  width: number
  height: number
  anchor: Anchor
  /** top-left corner derived from anchor math */
  left: number
  top: number
}

/**
 * Resolve an item's effective geometry, mirroring applyVisualDefaults order:
 * intrinsic size → resize mode override → position preset override →
 * anchor default from position. `intrinsic` comes from the probe cache
 * (media dimensions / measured text).
 */
export function resolveVisualLayout(
  item: VisualDoc,
  projectWidth: number,
  projectHeight: number,
  intrinsic?: { width: number; height: number } | null
): ResolvedLayout {
  // "{{placeholder}}" geometry falls back to defaults in raw views; the
  // variables preview resolves real numbers before layout runs.
  let width = typeof item.width === 'number' ? item.width : undefined
  let height = typeof item.height === 'number' ? item.height : undefined

  const type = canonicalVisualType(item.type)
  const mediaLike = type === 'VIDEO' || type === 'IMAGE' || type === 'GIF' || type === 'SVG'

  if (width === undefined || height === undefined) {
    if (intrinsic) {
      width = width ?? intrinsic.width
      height = height ?? intrinsic.height
    } else {
      width = width ?? projectWidth
      height = height ?? projectHeight
    }
  }

  if (mediaLike && item.resize && intrinsic) {
    const r = calculateResize(
      item.resize as 'contain' | 'cover',
      intrinsic.width,
      intrinsic.height,
      projectWidth,
      projectHeight
    )
    width = r.width
    height = r.height
  } else if (mediaLike && item.resize && !intrinsic) {
    width = projectWidth
    height = projectHeight
  }

  let x = asNum(item.x, 0)
  let y = asNum(item.y, 0)
  if (item.position && item.position !== 'custom') {
    const p = positionPresetToXY(
      item.position as PositionPreset,
      projectWidth,
      projectHeight,
      x,
      y
    )
    x = p.x
    y = p.y
  }

  let anchor = (item.anchor as Anchor | undefined) ?? undefined
  if (!anchor && item.position && item.position !== 'custom') {
    anchor = item.position as Anchor
  }
  if (!anchor) anchor = 'top-left'

  const { left, top } = anchorToTopLeft(x, y, width!, height!, anchor)
  return { x, y, width: width!, height: height!, anchor, left, top }
}

/** Port of utils/anchorPosition.ts — anchor point → top-left corner. */
export function anchorToTopLeft(
  x: number,
  y: number,
  width: number,
  height: number,
  anchor: Anchor
): { left: number; top: number } {
  let left = x
  let top = y
  if (anchor.includes('center') && !anchor.startsWith('center-')) {
    // top-center / bottom-center
    left = x - width / 2
  }
  if (anchor === 'center-center') left = x - width / 2
  if (anchor.endsWith('-right')) left = x - width
  if (anchor.startsWith('center-')) top = y - height / 2
  if (anchor.startsWith('bottom-')) top = y - height
  return { left, top }
}

/** Inverse of anchorToTopLeft: top-left corner → anchor point. */
export function topLeftToAnchor(
  left: number,
  top: number,
  width: number,
  height: number,
  anchor: Anchor
): { x: number; y: number } {
  let x = left
  let y = top
  if (anchor === 'top-center' || anchor === 'bottom-center' || anchor === 'center-center')
    x = left + width / 2
  if (anchor.endsWith('-right')) x = left + width
  if (anchor.startsWith('center-')) y = top + height / 2
  if (anchor.startsWith('bottom-')) y = top + height
  return { x, y }
}
