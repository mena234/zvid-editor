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
  minSize = 8
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
    if (horizontal) width = Math.max(minSize, width)
    if (vertical) height = Math.max(minSize, height)
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

/** Freeze a cover image's currently visible source pixels before stretching.
 * Existing cropParams are retained by the caller. A contain image uses the
 * whole source when switching from a fitted box to manual side resizing.
 * The renderer already stretches cropParams into an explicit width/height,
 * so this needs no new render field or preview-only object-fit override. */
export function mediaResizeSourceRect(
  source: { width: number; height: number },
  box: { width: number; height: number },
  fit: 'cover' | 'contain' | undefined
) {
  if (fit !== 'cover')
    return { x: 0, y: 0, width: source.width, height: source.height }
  const scale = Math.max(box.width / source.width, box.height / source.height)
  const width = box.width / scale
  const height = box.height / scale
  return {
    x: Math.max(0, (source.width - width) / 2),
    y: Math.max(0, (source.height - height) / 2),
    width,
    height,
  }
}
