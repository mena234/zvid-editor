import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mediaFilterGraph, mapFilterGain } from '../../utils/ffmpegFilterGraph'
import { eqByte, gpuFilterSettings } from '../../utils/gpuFilterMath'
import { filterToCss } from '../../utils/cssFilter'

const require = createRequire(import.meta.url)
const { getStyleFilters, toGraph } = require('../helpers/nativeStyle.cjs')
const dimensions = { width: 1920, height: 1080 }

function assertGraph(filter: Record<string, any>) {
  const native = getStyleFilters(filter, '0:v', 0, dimensions)
  expect(mediaFilterGraph(filter, 1920, 1080)).toEqual({
    graph: toGraph(native.filters),
    output: native.output,
  })
}

describe('gradual filter controls, synchronized with the native package', () => {
  it('makes +1 a small contrast adjustment, with useful intermediate stops', () => {
    expect([0, 1, 2, 5, 10, 25, 50, 75, 100].map(mapFilterGain)).toEqual([
      1, 1.02, 1.04, 1.1, 1.2, 1.5, 2, 2.5, 3,
    ])
    expect([-100, -50, -1, 0].map(mapFilterGain)).toEqual([0, 0.5, 0.99, 1])
    expect(mapFilterGain(200)).toBe(3)
    expect(mapFilterGain(-200)).toBe(0)
  })

  for (const key of ['brightness', 'contrast', 'saturate'] as const) {
    it(`checks every integer ${key} position across native, WASM and GPU parameters`, () => {
      for (let value = -100; value <= 100; value++) {
        const filter = { [key]: value, blur: 1 }
        assertGraph(filter)
        const gain = value < 0 ? 1 + value / 100 : 1 + value / 50
        const c = Math.fround(key === 'brightness' ? 1 : +gain.toFixed(4))
        const b = Math.fround(key === 'brightness' ? value / 100 : 0)
        const channel = key === 'saturate' ? 1 : 0
        const expected = Uint8Array.from({ length: 256 }, (_, i) => eqByte(i, c, b))
        const actual = gpuFilterSettings(filter, 1920, 1080).eq.filter(
          (_, i) => i % 4 === channel
        )
        expect(actual, `${key}=${value}`).toEqual(expected)
        if (key !== 'brightness' && value !== 0)
          expect(filterToCss({ [key]: value }, 1920, 1080)).toBe(
            `${key}(${+gain.toFixed(4)})`
          )
      }
    })
  }

  it('keeps every blur step bounded and monotonic, without changing its documented scale', () => {
    let last = 0
    for (let value = 0; value <= 100; value++) {
      assertGraph({ blur: value })
      const radius = gpuFilterSettings({ blur: value }, 1920, 1080).radius
      expect(radius).toBe(Math.min(539, Math.floor(+(value * 5.4).toFixed(4))))
      expect(radius).toBeGreaterThanOrEqual(last)
      expect(radius - last).toBeLessThanOrEqual(6)
      last = radius
    }
  })

  it('keeps hue in degrees and all inversion strengths on the same RGB curve', () => {
    for (let degrees = -180; degrees <= 180; degrees++)
      assertGraph({ 'hue-rotate': `${degrees}deg` })
    let previous: Uint8Array | undefined
    for (let value = 0; value <= 100; value++) {
      const filter = { brightness: 20, saturate: 50, invert: value / 100 }
      assertGraph(filter)
      const rgb = gpuFilterSettings(filter, 1920, 1080).rgb
      if (previous)
        expect(
          Math.max(...rgb.map((n, i) => Math.abs(n - previous![i]!)))
        ).toBeLessThanOrEqual(3)
      previous = rgb
    }
    expect(gpuFilterSettings({ invert: true }, 1920, 1080).rgb).toEqual(
      gpuFilterSettings({ invert: 1 }, 1920, 1080).rgb
    )
  })

  it('treats numeric-string neutral values as neutral even with another active filter', () => {
    for (const key of ['brightness', 'contrast', 'saturate']) {
      assertGraph({ [key]: '0', blur: 20 })
      expect(mediaFilterGraph({ [key]: '0', blur: 20 }, 1920, 1080)).toEqual(
        mediaFilterGraph({ blur: 20 }, 1920, 1080)
      )
    }
  })
})
