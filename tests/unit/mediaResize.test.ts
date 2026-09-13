import { describe, expect, it } from 'vitest'
import { mediaResizeSourceRect, resizeMediaBox, type ResizeHandle } from '../../utils/mediaResize'

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

  it('uses the current stretched aspect on the next corner drag', () => {
    const stretched = resizeMediaBox(start, 'e', 200, 0)
    const scaled = resizeMediaBox(stretched, 'se', 120, 10)
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

describe('source pixels retained for manual resizing', () => {
  it('retains the full source when its aspect already matches the box', () => {
    expect(mediaResizeSourceRect({ width: 320, height: 240 }, { width: 400, height: 300 }, 'cover'))
      .toEqual({ x: 0, y: 0, width: 320, height: 240 })
  })

  it('retains the currently visible central cover crop', () => {
    expect(mediaResizeSourceRect({ width: 800, height: 400 }, { width: 200, height: 200 }, 'cover'))
      .toEqual({ x: 200, y: 0, width: 400, height: 400 })
    expect(mediaResizeSourceRect({ width: 400, height: 800 }, { width: 200, height: 200 }, 'cover'))
      .toEqual({ x: 0, y: 200, width: 400, height: 400 })
  })

  it('uses the entire source for contain or already stretched media', () => {
    for (const fit of ['contain', undefined] as const) {
      expect(mediaResizeSourceRect({ width: 320, height: 240 }, { width: 400, height: 400 }, fit))
        .toEqual({ x: 0, y: 0, width: 320, height: 240 })
    }
  })
})
