import { describe, it, expect } from 'vitest'
import { eqByte, gpuFilterSettings, roundEven } from '../../utils/gpuFilterMath'

describe('GPU filter parameters', () => {
  it('uses ties-to-even for tint/hue and preserves neutral values', () => {
    expect([0.5, 1.5, 2.5, -1.5, -2.5].map(roundEven)).toEqual([0, 2, 2, -2, -2])
    const settings = gpuFilterSettings({}, 1920, 1080)
    expect(settings.yuv).toBe(false)
    expect(settings.radius).toBe(0)
    for (let i = 0; i < 256; i++) {
      expect(Array.from(settings.eq.slice(i * 4, i * 4 + 3))).toEqual([i, i, i])
      expect(Array.from(settings.rgb.slice(i * 4, i * 4 + 3))).toEqual([i, i, i])
    }
  })
  it('shares slider mappings and the safe blur boundary with FFmpeg', () => {
    expect(gpuFilterSettings({ blur: 100 }, 1920, 1080).radius).toBe(539)
    expect(gpuFilterSettings({ blur: 100 }, 2, 2).radius).toBe(0)
    expect(gpuFilterSettings({ blur: 20 }, 1920, 1080).radius).toBe(108)
    expect(eqByte(128, 0, 0)).toBe(127)
    expect(eqByte(20, 1, 1)).toBe(255)
    expect(eqByte(128, 1000, 0)).toBe(255)
  })
  it('keeps full and partial inversion on one continuous RGB curve', () => {
    const full = gpuFilterSettings({ brightness: 10, invert: true }, 64, 48)
    const partial = gpuFilterSettings({ brightness: 10, invert: 0.25 }, 64, 48)
    expect(full.rgb[40 * 4]).toBe(215)
    expect(partial.rgb[40 * 4]).toBe(83)
  })
  it('supports short tint colors and rejects invalid values', () => {
    expect(gpuFilterSettings({ colorTint: '#f60' }, 64, 48).rgb).toEqual(
      gpuFilterSettings({ colorTint: '#ff6600' }, 64, 48).rgb
    )
    expect(() => gpuFilterSettings({ colorTint: 'bad' }, 64, 48)).toThrow()
  })
})
