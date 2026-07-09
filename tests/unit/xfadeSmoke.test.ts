/**
 * Smoke coverage: xfadeFrame must return finite, well-formed CSS for EVERY
 * schema effect (shared/schema/constants XFADE_EFFECTS) across the progress
 * grid, in all three modes.
 *
 * Node has no `document`, so the raster-mask paths degrade by design:
 * dissolve + the diag* family fall back to flat opacity envelopes, and
 * pixelize/hblur skip their in-document SVG filter refs. Those fallbacks are
 * exercised here; the DOM mask variants are covered visually in the app.
 */
import { describe, it, expect } from 'vitest'
import { XFADE_EFFECTS } from '../../shared/schema/constants'
import { xfadeFrame, type XfadeLayerCss } from '../../utils/xfade'

const GRID = [0, 0.25, 0.5, 0.75, 1]
const MODES = ['transition', 'enter', 'exit'] as const

function checkLayer(l: XfadeLayerCss, label: string) {
  if (l.opacity !== undefined) {
    expect(l.opacity, `${label} opacity`).toBeGreaterThanOrEqual(0)
    expect(l.opacity, `${label} opacity`).toBeLessThanOrEqual(1)
  }
  for (const key of ['clipPath', 'transform', 'transformOrigin', 'filter', 'maskImage'] as const) {
    const v = l[key]
    if (v !== undefined) {
      expect(typeof v, `${label} ${key}`).toBe('string')
      expect(v.length, `${label} ${key}`).toBeGreaterThan(0)
    }
  }
}

describe('xfadeFrame smoke — every schema effect, every mode, t ∈ grid', () => {
  for (const effect of XFADE_EFFECTS) {
    it(effect, () => {
      for (const mode of MODES) {
        for (const t of GRID) {
          const f = xfadeFrame(effect, t, {
            mode,
            canvasW: 640,
            canvasH: 360,
            contentOpaque: true,
          })
          const label = `${effect}/${mode}/t=${t}`
          expect(f.a, label).toBeTypeOf('object')
          expect(f.b, label).toBeTypeOf('object')
          checkLayer(f.a, `${label} a`)
          checkLayer(f.b, `${label} b`)
          if (f.plate) {
            expect(f.plate.opacity, `${label} plate`).toBeGreaterThanOrEqual(0)
            expect(f.plate.opacity, `${label} plate`).toBeLessThanOrEqual(1)
            expect(f.plate.color, `${label} plate color`).toMatch(/^#/)
          }
          // no NaN/Infinity may leak into any generated CSS value
          const s = JSON.stringify(f)
          expect(s, label).not.toMatch(/NaN|Infinity/)
        }
      }
    })
  }

  it('rect-based variants stay finite too (offset item boxes)', () => {
    for (const effect of XFADE_EFFECTS) {
      const f = xfadeFrame(effect, 0.5, {
        mode: 'transition',
        canvasW: 640,
        canvasH: 360,
        rectA: { x: 40, y: 20, w: 300, h: 200 },
        rectB: { x: 100, y: 60, w: 400, h: 240 },
      })
      expect(JSON.stringify(f), effect).not.toMatch(/NaN|Infinity/)
    }
  })
})
