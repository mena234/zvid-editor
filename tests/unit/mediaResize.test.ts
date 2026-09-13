import { describe, expect, it } from 'vitest'
import { mediaCropSizeLimits, mediaResizeSourceRect, resizeMediaBox, resizeMediaCrop, type ResizeHandle } from '../../utils/mediaResize'

const start = { left: 100, top: 200, width: 400, height: 200 }

describe('media resize handles', () => {
  it.each([
    ['se', 100, 10, 100, 200],
    ['ne', 100, -10, 100, 150],
    ['sw', -100, 10, 0, 200],
    ['nw', -100, -10, 0, 150],
  ] as const)('%s preserves aspect and fixes the opposite corner', (handle, dx, dy, left, top) => {
    const box = resizeMediaBox(start, handle, dx, dy)
    expect(box).toMatchObject({ left, top, width: 500, height: 250 })
  })

  it.each([
    ['e', 100, 60, 100, 200, 500, 200],
    ['w', -100, 60, 0, 200, 500, 200],
    ['s', 60, 100, 100, 200, 400, 300],
    ['n', 60, -100, 100, 100, 400, 300],
  ] as const)('%s changes just the dragged axis and fixes the opposite edge', (handle, dx, dy, left, top, width, height) => {
    expect(resizeMediaBox(start, handle, dx, dy)).toMatchObject({ left, top, width, height })
  })

  it('uses the current cropped frame aspect on the next corner drag', () => {
    const cropped = resizeMediaBox(start, 'e', 200, 0)
    const scaled = resizeMediaBox(cropped, 'se', 120, 10)
    expect(scaled.width / scaled.height).toBeCloseTo(3)
    expect(scaled.width).toBe(720)
    expect(scaled.height).toBe(240)
  })

  it('preserves ratio and fixed edges when a corner crosses the opposite corner', () => {
    const box = resizeMediaBox(start, 'nw', 1000, 1000)
    expect(box.width).toBe(16)
    expect(box.height).toBe(8)
    expect(box.left + box.width).toBe(start.left + start.width)
    expect(box.top + box.height).toBe(start.top + start.height)
  })

  it('does not alter the other dimension when a side reaches the minimum', () => {
    expect(resizeMediaBox(start, 'w', 1000, 0)).toMatchObject({
      width: 8, height: 200, left: 492, top: 200,
    })
  })

  function oppositePoint(box: typeof start & { angle?: number }, handle: ResizeHandle) {
    const a = ((box.angle ?? 0) * Math.PI) / 180
    const x = handle.includes('w') ? box.width / 2 : handle.includes('e') ? -box.width / 2 : 0
    const y = handle.includes('n') ? box.height / 2 : handle.includes('s') ? -box.height / 2 : 0
    return {
      x: box.left + box.width / 2 + x * Math.cos(a) - y * Math.sin(a),
      y: box.top + box.height / 2 + x * Math.sin(a) + y * Math.cos(a),
    }
  }

  it.each(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)(
    'keeps the opposite visible %s anchor fixed on rotated media',
    (handle) => {
      const rotated = { ...start, angle: 37 }
      const before = oppositePoint(rotated, handle)
      const after = oppositePoint(resizeMediaBox(rotated, handle, 65, 90), handle)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
    }
  )

  it('projects a rotated edge drag onto the local axis', () => {
    const box = resizeMediaBox({ ...start, angle: 90 }, 'e', 80, 100)
    expect(box.width).toBeCloseTo(500)
    expect(box.height).toBe(200)
    expect(box.left).toBeCloseTo(50)
    expect(box.top).toBeCloseTo(250)
  })
})

describe('source pixels at the start of a crop gesture', () => {
  it('retains the full source when its aspect already matches the box', () => {
    expect(mediaResizeSourceRect({ width: 320, height: 240 }, { width: 400, height: 300 }))
      .toEqual({ x: 0, y: 0, width: 320, height: 240 })
  })

  it('retains the currently visible central cover crop', () => {
    expect(mediaResizeSourceRect({ width: 800, height: 400 }, { width: 200, height: 200 }))
      .toEqual({ x: 200, y: 0, width: 400, height: 400 })
    expect(mediaResizeSourceRect({ width: 400, height: 800 }, { width: 200, height: 200 }))
      .toEqual({ x: 0, y: 200, width: 400, height: 400 })
  })

  it('keeps an existing proportional crop, including its offset', () => {
    const crop = { x: 30, y: 20, width: 240, height: 160 }
    expect(mediaResizeSourceRect({ width: 320, height: 240 }, { width: 600, height: 400 }, crop))
      .toEqual(crop)
  })

  it('fits a previously stretched crop proportionally before manual cropping', () => {
    expect(mediaResizeSourceRect(
      { width: 320, height: 240 }, { width: 400, height: 400 },
      { x: 30, y: 20, width: 240, height: 160 }
    )).toEqual({ x: 70, y: 20, width: 160, height: 160 })
  })
})

describe('directional media cropping', () => {
  const source = { width: 800, height: 400 }
  const box = { width: 400, height: 200 }
  const full = { x: 0, y: 0, ...source }

  it.each([1, 2])('keeps at least %s source pixels during extreme inward and outward drags', (minimum) => {
    const large = { left: 0, top: 0, width: 2000, height: 1000 }
    for (const handle of ['e', 'w', 'n', 's'] as const) {
      const limits = mediaCropSizeLimits(source, large, full, handle, minimum)
      const horizontal = handle === 'e' || handle === 'w'
      for (const delta of [-1e8, 1e8]) {
        const next = resizeMediaBox(large, handle, horizontal ? delta : 0, horizontal ? 0 : delta, limits.minSize, limits.maxSize)
        const crop = resizeMediaCrop(source, large, full, next, handle)
        expect(crop.width).toBeGreaterThanOrEqual(minimum - 1e-9)
        expect(crop.height).toBeGreaterThanOrEqual(minimum - 1e-9)
        expect(next.width / crop.width).toBeCloseTo(next.height / crop.height)
      }
    }
  })

  it.each([
    ['e', 200, 200, 0, 0, 400, 400],
    ['w', 200, 200, 400, 0, 400, 400],
    ['s', 400, 100, 0, 0, 800, 200],
    ['n', 400, 100, 0, 200, 800, 200],
  ] as const)('%s inward removes only that source edge at the original scale', (handle, width, height, x, y, cropWidth, cropHeight) => {
    const crop = resizeMediaCrop(source, box, full, { width, height }, handle)
    expect(crop).toEqual({ x, y, width: cropWidth, height: cropHeight })
    expect(width / crop.width).toBe(0.5)
    expect(height / crop.height).toBe(0.5)
  })

  it.each([
    ['e', true, false, 400, 0],
    ['w', true, false, 0, 0],
    ['s', false, true, 0, 200],
    ['n', false, true, 0, 0],
  ] as const)('%s crops the visible edge of flipped media', (handle, flipH, flipV, x, y) => {
    const horizontal = handle === 'e' || handle === 'w'
    const next = { width: horizontal ? 200 : 400, height: horizontal ? 200 : 100 }
    expect(resizeMediaCrop(source, box, full, next, handle, flipH, flipV))
      .toMatchObject({ x, y })
  })

  it('reveals a previously removed right edge without changing the image scale', () => {
    const narrow = { width: 200, height: 200 }
    const cropped = resizeMediaCrop(source, box, full, narrow, 'e')
    expect(resizeMediaCrop(source, narrow, cropped, box, 'e')).toEqual(full)
  })

  it('reveals a previously removed left edge with the right source edge fixed', () => {
    const narrow = { width: 200, height: 200 }
    const cropped = resizeMediaCrop(source, box, full, narrow, 'w')
    expect(resizeMediaCrop(source, narrow, cropped, box, 'w')).toEqual(full)
  })

  it('expanding a covered frame reveals the centered crop before zooming', () => {
    const wide = { width: 600, height: 200 }
    const cropped = resizeMediaCrop(source, box, full, wide, 'e')
    expect(cropped.x).toBe(0)
    expect(cropped.width).toBe(800)
    expect(cropped.y).toBeCloseTo(200 / 3)
    const taller = resizeMediaCrop(source, wide, cropped, { width: 600, height: 250 }, 's')
    expect(taller.width).toBe(800)
    expect(taller.height).toBeCloseTo(1000 / 3)
    expect(taller.y).toBeCloseTo(100 / 3)
    expect(600 / taller.width).toBeCloseTo(250 / taller.height)
  })

  it('expands uniformly beyond all available source pixels and stays filled', () => {
    const next = { width: 400, height: 600 }
    const crop = resizeMediaCrop(source, box, full, next, 's')
    expect(crop.y).toBe(0)
    expect(crop.height).toBe(400)
    expect(crop.x).toBeCloseTo(800 / 3)
    expect(next.width / crop.width).toBeCloseTo(1.5)
    expect(next.height / crop.height).toBe(1.5)
  })

  it('keeps the same source offset when cropping an existing off-center viewport', () => {
    const crop = { x: 80, y: 40, width: 400, height: 200 }
    expect(resizeMediaCrop(source, box, crop, { width: 300, height: 200 }, 'e'))
      .toEqual({ x: 80, y: 40, width: 300, height: 200 })
  })

  it('returns to the original crop when the pointer returns within the same gesture', () => {
    resizeMediaCrop(source, box, full, { width: 1000, height: 200 }, 'e')
    expect(resizeMediaCrop(source, box, full, box, 'e')).toEqual(full)
  })

  it.each(['e', 'w', 'n', 's'] as const)('maintains uniform scale and valid source bounds across repeated %s gestures', (handle) => {
    let currentBox = box
    let crop = full
    for (const factor of [0.1, 2, 8, 0.5, 10, 0.25]) {
      const horizontal = handle === 'e' || handle === 'w'
      const next = {
        width: horizontal ? currentBox.width * factor : currentBox.width,
        height: horizontal ? currentBox.height : currentBox.height * factor,
      }
      crop = resizeMediaCrop(source, currentBox, crop, next, handle)
      expect(next.width / crop.width).toBeCloseTo(next.height / crop.height, 8)
      expect(crop.x).toBeGreaterThanOrEqual(-1e-9)
      expect(crop.y).toBeGreaterThanOrEqual(-1e-9)
      expect(crop.x + crop.width).toBeLessThanOrEqual(source.width + 1e-9)
      expect(crop.y + crop.height).toBeLessThanOrEqual(source.height + 1e-9)
      currentBox = next
    }
  })
})
