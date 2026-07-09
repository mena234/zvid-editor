/**
 * utils/cssFilter.ts — Zvid filter → CSS filter() preview mapping.
 * The curves intentionally diverge from FFmpeg (see the header comment in the
 * source): contrast/saturate map ±100 to 0..3 in CSS, blur previews at a
 * quarter of the true boxblur radius. These tests lock in the editor's
 * current mapping — they do not assert FFmpeg equivalence.
 */
import { describe, it, expect } from 'vitest'
import { filterToCss, tintOverlayColor, type ZvidFilter } from '../../utils/cssFilter'

const css = (f: ZvidFilter | undefined, w = 400, h = 300) => filterToCss(f, w, h)

describe('filterToCss basics', () => {
  it('undefined / empty filters produce an empty string', () => {
    expect(css(undefined)).toBe('')
    expect(css({})).toBe('')
  })
  it('zero values are omitted entirely', () => {
    expect(
      css({ brightness: 0, contrast: 0, saturate: 0, 'hue-rotate': 0, blur: 0 })
    ).toBe('')
  })
})

describe('brightness (additive FFmpeg → multiplicative CSS)', () => {
  it('maps ±100 to 0..2 linearly', () => {
    expect(css({ brightness: 50 })).toBe('brightness(1.5)')
    expect(css({ brightness: 100 })).toBe('brightness(2)')
    expect(css({ brightness: -50 })).toBe('brightness(0.5)')
    expect(css({ brightness: -100 })).toBe('brightness(0)')
  })
})

describe('contrast (asymmetric curve)', () => {
  it('negative side is linear to 0, positive side doubles', () => {
    expect(css({ contrast: -100 })).toBe('contrast(0)')
    expect(css({ contrast: -50 })).toBe('contrast(0.5)')
    expect(css({ contrast: 50 })).toBe('contrast(2)')
    expect(css({ contrast: 100 })).toBe('contrast(3)')
  })
})

describe('saturate (same asymmetric curve as contrast)', () => {
  it('negative side linear to 0, positive side up to 3', () => {
    expect(css({ saturate: -100 })).toBe('saturate(0)')
    expect(css({ saturate: -25 })).toBe('saturate(0.75)')
    expect(css({ saturate: 50 })).toBe('saturate(2)')
    expect(css({ saturate: 100 })).toBe('saturate(3)')
  })
})

describe('hue-rotate', () => {
  it('accepts numbers and numeric strings, normalizes to deg', () => {
    expect(css({ 'hue-rotate': 90 })).toBe('hue-rotate(90deg)')
    expect(css({ 'hue-rotate': -90 })).toBe('hue-rotate(-90deg)')
    expect(css({ 'hue-rotate': '45deg' })).toBe('hue-rotate(45deg)')
  })
  it('drops 0, "0", "0deg" and non-numeric strings', () => {
    expect(css({ 'hue-rotate': 0 })).toBe('')
    expect(css({ 'hue-rotate': '0' })).toBe('')
    expect(css({ 'hue-rotate': '0deg' })).toBe('')
    expect(css({ 'hue-rotate': 'abc' })).toBe('')
  })
})

describe('blur (percent of shortest half-dimension, previewed at 1/4)', () => {
  it('radius = pct% × (shortest/2) / 4', () => {
    // shortest = 300 → half 150; 40% → 60; /4 → 15px
    expect(css({ blur: 40 }, 400, 300)).toBe('blur(15px)')
    // string input goes through Number()
    expect(css({ blur: '40' }, 400, 300)).toBe('blur(15px)')
  })
  it('caps the preview radius at 60px', () => {
    expect(css({ blur: 100 }, 2000, 2000)).toBe('blur(60px)')
  })
  it('falls back to 100px dims when the item size is 0', () => {
    // shortest = min(100,100)/2 = 50 → 100% → 50/4 = 12.5px
    expect(css({ blur: 100 }, 0, 0)).toBe('blur(12.5px)')
  })
  it('ignores non-numeric blur strings', () => {
    expect(css({ blur: 'x' as any })).toBe('')
  })
})

describe('invert', () => {
  it('true maps to invert(1), numbers are clamped to [0,1]', () => {
    expect(css({ invert: true })).toBe('invert(1)')
    expect(css({ invert: 0.5 })).toBe('invert(0.5)')
    expect(css({ invert: 2 })).toBe('invert(1)')
    expect(css({ invert: -0.5 })).toBe('invert(0)')
  })
  it('false and 0 are omitted', () => {
    expect(css({ invert: false })).toBe('')
    expect(css({ invert: 0 })).toBe('')
  })
})

describe('combined filters', () => {
  it('joins parts in source order: brightness contrast saturate hue blur invert', () => {
    const out = css(
      {
        brightness: 20,
        contrast: -25,
        saturate: 50,
        'hue-rotate': 180,
        blur: 40,
        invert: 0.25,
      },
      400,
      300
    )
    expect(out).toBe(
      'brightness(1.2) contrast(0.75) saturate(2) hue-rotate(180deg) blur(15px) invert(0.25)'
    )
  })
})

describe('tintOverlayColor', () => {
  it('returns the tint color when set, null otherwise', () => {
    expect(tintOverlayColor(undefined)).toBeNull()
    expect(tintOverlayColor({})).toBeNull()
    expect(tintOverlayColor({ colorTint: '' })).toBeNull()
    expect(tintOverlayColor({ colorTint: '#ff8800' })).toBe('#ff8800')
  })
})
