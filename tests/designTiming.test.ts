import { describe, it, expect } from 'vitest'
import { clampDesignTiming, resolveVisualTiming } from '../shared/schema/defaults'
import { MAX_DESIGN_ELEMENT_DURATION } from '../shared/schema/constants'
import type { VisualDoc } from '../shared/schema/types'

/** Only the presence of `designer` matters for the cap. */
function designEl(extra: Record<string, any> = {}): VisualDoc {
  return {
    type: 'TEXT',
    _id: 'vis_test',
    html: '<span>hi</span>',
    designer: { version: 1, layers: [] },
    ...extra,
  } as VisualDoc
}

describe('clampDesignTiming', () => {
  it('ignores visuals without a designer doc', () => {
    const v = { type: 'TEXT', _id: 'v', enterBegin: 0, exitEnd: 40 } as VisualDoc
    expect(clampDesignTiming(v, 60)).toBe(false)
    expect(v.exitEnd).toBe(40)
  })

  it('leaves design elements within the cap untouched', () => {
    const v = designEl({ enterBegin: 2, exitEnd: 17 })
    expect(clampDesignTiming(v, 60)).toBe(false)
    expect(v.enterBegin).toBe(2)
    expect(v.exitEnd).toBe(17)
  })

  it('shrinks an over-long explicit window from the end by default', () => {
    const v = designEl({ enterBegin: 3, exitEnd: 30, exitBegin: 29 })
    expect(clampDesignTiming(v, 60)).toBe(true)
    expect(v.enterBegin).toBe(3)
    expect(v.exitEnd).toBe(3 + MAX_DESIGN_ELEMENT_DURATION)
    // exit-animation start is pulled inside the shrunk window
    expect(v.exitBegin).toBe(3 + MAX_DESIGN_ELEMENT_DURATION)
  })

  it('pulls the start forward when prefer=start', () => {
    const v = designEl({ enterBegin: 0, enterEnd: 1, exitEnd: 40 })
    expect(clampDesignTiming(v, 60, 'start')).toBe(true)
    expect(v.exitEnd).toBe(40)
    expect(v.enterBegin).toBe(40 - MAX_DESIGN_ELEMENT_DURATION)
    // enter-animation end can't sit before the new start
    expect(v.enterEnd).toBe(40 - MAX_DESIGN_ELEMENT_DURATION)
  })

  it('bounds an open-ended window ("empty = end of timeline") in long projects', () => {
    const v = designEl({ enterBegin: 5 })
    expect(clampDesignTiming(v, 60)).toBe(true)
    expect(v.exitEnd).toBe(5 + MAX_DESIGN_ELEMENT_DURATION)
  })

  it('pins an open-ended window to the timeline end when it is short', () => {
    // an open window would silently stretch whenever the timeline grows,
    // so it becomes explicit at today's end
    const v = designEl({ enterBegin: 0 })
    expect(clampDesignTiming(v, 10)).toBe(true)
    expect(v.exitEnd).toBe(10)
  })

  it('pins straight to the ceiling when the context has no usable duration', () => {
    // auto ("-1") scene durations resolve from media probes the schema layer
    // cannot see
    const v = designEl({ enterBegin: 2 })
    expect(clampDesignTiming(v, -1)).toBe(true)
    expect(v.exitEnd).toBe(2 + MAX_DESIGN_ELEMENT_DURATION)
  })

  it('leaves template-placeholder timing alone', () => {
    const v = designEl({ enterBegin: '{{start}}', exitEnd: 40 })
    expect(clampDesignTiming(v, 60)).toBe(false)
    expect(v.enterBegin).toBe('{{start}}')
    expect(v.exitEnd).toBe(40)

    const w = designEl({ enterBegin: 0, exitEnd: '{{end}}' })
    expect(clampDesignTiming(w, 60)).toBe(false)
    expect(w.exitEnd).toBe('{{end}}')
  })

  it('always resolves to a window within the cap after clamping', () => {
    for (const el of [
      designEl({ enterBegin: 0, exitEnd: 120 }),
      designEl({ enterBegin: 50, exitEnd: 90.5, enterEnd: 51, exitBegin: 88 }),
      designEl({}),
      designEl({ exitEnd: 200 }),
    ]) {
      clampDesignTiming(el, 300)
      const t = resolveVisualTiming(el, 300)
      expect(t.exitEnd - t.enterBegin).toBeLessThanOrEqual(MAX_DESIGN_ELEMENT_DURATION)
      expect(t.enterBegin).toBeLessThanOrEqual(t.enterEnd)
      expect(t.enterEnd).toBeLessThanOrEqual(t.exitBegin + 1e-9)
      expect(t.exitBegin).toBeLessThanOrEqual(t.exitEnd)
    }
  })
})
