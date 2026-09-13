export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface ResizeBox {
  left: number
  top: number
  width: number
  height: number
  angle?: number
}

/** Media corners scale the current aspect ratio; sides move only their axis.
 * Deltas are in stage coordinates. Rotating them into the element's local
 * axes keeps the opposite visible corner/edge stationary, even after rotation. */
export function resizeMediaBox(
  start: ResizeBox,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  minSize = 8,
  maxSize = Infinity
): ResizeBox {
  const radians = ((start.angle ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const localX = dx * cos + dy * sin
  const localY = -dx * sin + dy * cos
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  let width = start.width + horizontal * localX
  let height = start.height + vertical * localY

  if (horizontal && vertical) {
    const changeX = (horizontal * localX) / start.width
    const changeY = (vertical * localY) / start.height
    const factor = Math.max(
      1 + (Math.abs(changeX) >= Math.abs(changeY) ? changeX : changeY),
      minSize / start.width,
      minSize / start.height
    )
    width = start.width * factor
    height = start.height * factor
  } else {
    if (horizontal) width = Math.min(maxSize, Math.max(minSize, width))
    if (vertical) height = Math.min(maxSize, Math.max(minSize, height))
  }

  const shiftX = (horizontal * (width - start.width)) / 2
  const shiftY = (vertical * (height - start.height)) / 2
  const centerX = start.left + start.width / 2 + shiftX * cos - shiftY * sin
  const centerY = start.top + start.height / 2 + shiftX * sin + shiftY * cos
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    angle: start.angle,
  }
}

export interface MediaSourceRect {
  x: number
  y: number
  width: number
  height: number
}

/** The API requires at least one source pixel; native video/GIF cropping
 * needs two to survive chroma rounding. A growing frame can also reduce the
 * perpendicular source dimension, so bound both ends of a side gesture. */
export function mediaCropSizeLimits(
  source: { width: number; height: number },
  box: { width: number; height: number },
  crop: MediaSourceRect,
  handle: ResizeHandle,
  minSourceSize: number
) {
  const horizontal = handle === 'e' || handle === 'w'
  const scale = Math.max(box.width / crop.width, box.height / crop.height)
  return {
    minSize: Math.ceil(Math.max(8, scale * minSourceSize) * 1000) / 1000,
    maxSize: Math.floor((horizontal
      ? box.height * source.width / minSourceSize
      : box.width * source.height / minSourceSize) * 1000) / 1000,
  }
}

/** Start a crop gesture with a proportional, filled viewport. Existing crops
 * supply the visible source area; a legacy stretched box is fitted within it.
 * cropParams are in source pixels, shared by preview and export. */
export function mediaResizeSourceRect(
  source: { width: number; height: number },
  box: { width: number; height: number },
  crop?: MediaSourceRect
): MediaSourceRect {
  const x = Math.max(0, Math.min(crop?.x ?? 0, source.width - 1))
  const y = Math.max(0, Math.min(crop?.y ?? 0, source.height - 1))
  const availableWidth = Math.max(Number.EPSILON, Math.min(crop?.width ?? source.width, source.width - x))
  const availableHeight = Math.max(Number.EPSILON, Math.min(crop?.height ?? source.height, source.height - y))
  const scale = Math.max(box.width / availableWidth, box.height / availableHeight)
  const width = box.width / scale
  const height = box.height / scale
  return {
    x: x + (availableWidth - width) / 2,
    y: y + (availableHeight - height) / 2,
    width,
    height,
  }
}

/** Middle handles crop at the current image scale on inward drags. Outward
 * drags reveal the surrounding source, clamped at its edges, then enlarge it
 * uniformly once the whole source can no longer fill the frame. Calculate
 * from the pointer-down snapshot so dragging back never compounds a zoom. */
export function resizeMediaCrop(
  source: { width: number; height: number },
  start: { width: number; height: number },
  crop: MediaSourceRect,
  next: { width: number; height: number },
  handle: ResizeHandle,
  flipH = false,
  flipV = false
): MediaSourceRect {
  const horizontal = handle === 'e' || handle === 'w'
  const shrinking = horizontal ? next.width <= start.width : next.height <= start.height
  const initialScale = Math.max(start.width / crop.width, start.height / crop.height)
  const scale = shrinking
    ? initialScale
    : Math.max(initialScale, next.width / source.width, next.height / source.height)
  const width = next.width / scale
  const height = next.height / scale

  if (shrinking) {
    const fromLeft = horizontal && ((handle === 'w') !== flipH)
    const fromTop = !horizontal && ((handle === 'n') !== flipV)
    return {
      x: crop.x + (fromLeft ? crop.width - width : 0),
      y: crop.y + (fromTop ? crop.height - height : 0),
      width,
      height,
    }
  }

  return {
    x: Math.max(0, Math.min(source.width - width, crop.x + (crop.width - width) / 2)),
    y: Math.max(0, Math.min(source.height - height, crop.y + (crop.height - height) / 2)),
    width,
    height,
  }
}
