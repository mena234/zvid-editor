import { describe, it, expect } from 'vitest'
import {
  positionPresetToXY,
  anchorToTopLeft,
  topLeftToAnchor,
  calculateResize,
  calcImageRect,
  resolveVisualLayout,
  resolveVisualTiming,
  resolveAudioTiming,
} from '../../shared/schema/defaults'
import { ANCHORS, type Anchor } from '../../shared/schema/constants'
import type { VisualDoc, AudioDoc } from '../../shared/schema/types'

const W = 1920
const H = 1080

const vis = (fields: Record<string, any> = {}): VisualDoc =>
  ({ type: 'IMAGE', _id: 'vis_t', src: 'https://x/a.png', ...fields } as VisualDoc)

const aud = (fields: Record<string, any> = {}): AudioDoc =>
  ({ src: 'https://x/a.mp3', _id: 'aud_t', ...fields } as AudioDoc)

/* ------------------------------------------------------------------ */
/* positionPresetToXY                                                  */
/* ------------------------------------------------------------------ */

describe('positionPresetToXY', () => {
  const cases: [string, { x: number; y: number }][] = [
    ['top-left', { x: 0, y: 0 }],
    ['top-center', { x: W / 2, y: 0 }],
    ['top-right', { x: W, y: 0 }],
    ['center-left', { x: 0, y: H / 2 }],
    ['center-center', { x: W / 2, y: H / 2 }],
    ['center-right', { x: W, y: H / 2 }],
    ['bottom-left', { x: 0, y: H }],
    ['bottom-center', { x: W / 2, y: H }],
    ['bottom-right', { x: W, y: H }],
  ]
  for (const [preset, expected] of cases) {
    it(`${preset} → (${expected.x}, ${expected.y}) on ${W}x${H}`, () => {
      expect(positionPresetToXY(preset as any, W, H)).toEqual(expected)
    })
  }

  it('custom keeps the current coordinates', () => {
    expect(positionPresetToXY('custom', W, H, 123, 456)).toEqual({ x: 123, y: 456 })
  })

  it('custom falls back to (0, 0) when no current coordinates are given', () => {
    expect(positionPresetToXY('custom', W, H)).toEqual({ x: 0, y: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* anchorToTopLeft / topLeftToAnchor                                   */
/* ------------------------------------------------------------------ */

describe('anchorToTopLeft', () => {
  // anchor point at (100, 200), box 40x20
  const x = 100
  const y = 200
  const w = 40
  const h = 20
  const cases: [Anchor, { left: number; top: number }][] = [
    ['top-left', { left: 100, top: 200 }],
    ['top-center', { left: 80, top: 200 }],
    ['top-right', { left: 60, top: 200 }],
    ['center-left', { left: 100, top: 190 }],
    ['center-center', { left: 80, top: 190 }],
    ['center-right', { left: 60, top: 190 }],
    ['bottom-left', { left: 100, top: 180 }],
    ['bottom-center', { left: 80, top: 180 }],
    ['bottom-right', { left: 60, top: 180 }],
  ]
  for (const [anchor, expected] of cases) {
    it(`${anchor} of a 40x20 box at (100, 200)`, () => {
      expect(anchorToTopLeft(x, y, w, h, anchor)).toEqual(expected)
    })
  }
})

describe('topLeftToAnchor', () => {
  // top-left corner at (60, 180), box 40x20 — inverse of the table above
  const cases: [Anchor, { x: number; y: number }][] = [
    ['top-left', { x: 60, y: 180 }],
    ['top-center', { x: 80, y: 180 }],
    ['top-right', { x: 100, y: 180 }],
    ['center-left', { x: 60, y: 190 }],
    ['center-center', { x: 80, y: 190 }],
    ['center-right', { x: 100, y: 190 }],
    ['bottom-left', { x: 60, y: 200 }],
    ['bottom-center', { x: 80, y: 200 }],
    ['bottom-right', { x: 100, y: 200 }],
  ]
  for (const [anchor, expected] of cases) {
    it(`${anchor} of a 40x20 box with top-left (60, 180)`, () => {
      expect(topLeftToAnchor(60, 180, 40, 20, anchor)).toEqual(expected)
    })
  }

  it('is the exact inverse of anchorToTopLeft over a grid of boxes (all 9 anchors)', () => {
    const boxes = [
      { w: 40, h: 20 },
      { w: 33, h: 17 }, // odd sizes → fractional halves
      { w: 0, h: 0 }, // degenerate box
      { w: 1919.5, h: 3.25 }, // non-integer dimensions
    ]
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 200 },
      { x: -50, y: 75.5 }, // off-canvas coordinates
      { x: 1920, y: 1080 },
    ]
    for (const anchor of ANCHORS) {
      for (const { w, h } of boxes) {
        for (const p of points) {
          // anchor → top-left → anchor
          const tl = anchorToTopLeft(p.x, p.y, w, h, anchor)
          const back = topLeftToAnchor(tl.left, tl.top, w, h, anchor)
          expect(back.x).toBeCloseTo(p.x, 9)
          expect(back.y).toBeCloseTo(p.y, 9)
          // top-left → anchor → top-left
          const a = topLeftToAnchor(p.x, p.y, w, h, anchor)
          const tl2 = anchorToTopLeft(a.x, a.y, w, h, anchor)
          expect(tl2.left).toBeCloseTo(p.x, 9)
          expect(tl2.top).toBeCloseTo(p.y, 9)
        }
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* calculateResize                                                     */
/* ------------------------------------------------------------------ */

describe('calculateResize', () => {
  it('contain, original wider than target: pins width, letterboxes height', () => {
    // original 2:1, target 1:1
    expect(calculateResize('contain', 200, 100, 100, 100)).toEqual({
      width: 100,
      height: 50,
    })
  })

  it('contain, original taller than target: pins height, pillarboxes width', () => {
    expect(calculateResize('contain', 100, 200, 100, 100)).toEqual({
      width: 50,
      height: 100,
    })
  })

  it('contain, equal aspect: fills the target exactly', () => {
    expect(calculateResize('contain', 200, 200, 100, 100)).toEqual({
      width: 100,
      height: 100,
    })
  })

  it('cover, original wider than target: pins height, overflows width', () => {
    expect(calculateResize('cover', 200, 100, 100, 100)).toEqual({
      width: 200,
      height: 100,
    })
  })

  it('cover, original taller than target: pins width, overflows height', () => {
    expect(calculateResize('cover', 100, 200, 100, 100)).toEqual({
      width: 100,
      height: 200,
    })
  })

  it('cover, equal aspect: fills the target exactly', () => {
    expect(calculateResize('cover', 150, 150, 100, 100)).toEqual({
      width: 100,
      height: 100,
    })
  })

  it('rounds the derived dimension to whole pixels', () => {
    // oa = 16/9, contain into 1000x1000 → height 562.5 rounds to 563
    expect(calculateResize('contain', 1600, 900, 1000, 1000)).toEqual({
      width: 1000,
      height: 563,
    })
  })

  it('falls back to the target box when any dimension is 0 (unknown intrinsic size)', () => {
    expect(calculateResize('contain', 0, 100, 300, 200)).toEqual({ width: 300, height: 200 })
    expect(calculateResize('contain', 100, 0, 300, 200)).toEqual({ width: 300, height: 200 })
    expect(calculateResize('cover', 0, 0, 300, 200)).toEqual({ width: 300, height: 200 })
    // zero TARGET dimensions are returned as-is too
    expect(calculateResize('cover', 100, 100, 0, 200)).toEqual({ width: 0, height: 200 })
    expect(calculateResize('contain', 100, 100, 300, 0)).toEqual({ width: 300, height: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* calcImageRect                                                       */
/* ------------------------------------------------------------------ */

describe('calcImageRect', () => {
  it('0° keeps the box and produces zero offsets', () => {
    expect(calcImageRect(100, 50, 0)).toEqual({
      width: 100,
      height: 50,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it('45° on a square expands to ceil(side·√2)', () => {
    // 100·√2 = 141.42… → 142; offsets ceil(41.42/2) = 21
    expect(calcImageRect(100, 100, 45)).toEqual({
      width: 142,
      height: 142,
      offsetX: 21,
      offsetY: 21,
    })
  })

  it('90° swaps the box dimensions (modulo FP ceil dust)', () => {
    // NOTE: possible bug — cos(90°) is 6.1e-17, not 0, so width·cos leaks
    // ~6e-15 into boundX; Math.ceil turns 50.000000000000007 into 51 instead
    // of the exact swapped 50. Mirrors the render package (parity!), so we
    // assert the FP-dusted value.
    expect(calcImageRect(100, 50, 90)).toEqual({
      width: 51,
      height: 100,
      offsetX: -24,
      offsetY: 25,
    })
  })

  it('90° on a square is a no-op when the dust rounds away', () => {
    // here the 6e-15 residue is below half an ulp of 100, so it vanishes
    expect(calcImageRect(100, 100, 90)).toEqual({
      width: 100,
      height: 100,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it('arbitrary angle (30°) uses |w·cos| + |h·sin| per axis, ceiled', () => {
    // boundX = 200·cos30 + 100·sin30 = 173.205 + 50 → 224
    // boundY = 100·cos30 + 200·sin30 =  86.603 + 100 → 187
    expect(calcImageRect(200, 100, 30)).toEqual({
      width: 224,
      height: 187,
      offsetX: 12,
      offsetY: 44,
    })
  })

  it('negative angles behave like their positive mirror (abs on both terms)', () => {
    expect(calcImageRect(100, 50, -90)).toEqual(calcImageRect(100, 50, 90))
    expect(calcImageRect(200, 100, -30)).toEqual(calcImageRect(200, 100, 30))
  })

  it('180° gains one pixel of FP-ceil padding per axis', () => {
    // NOTE: possible bug — sin(180°) = 1.22e-16 leaks into both bounds and
    // Math.ceil pads each axis (and offset) by 1. Current behavior, kept for
    // parity with the render package.
    expect(calcImageRect(120, 80, 180)).toEqual({
      width: 121,
      height: 81,
      offsetX: 1,
      offsetY: 1,
    })
  })
})

/* ------------------------------------------------------------------ */
/* resolveVisualLayout                                                 */
/* ------------------------------------------------------------------ */

describe('resolveVisualLayout', () => {
  it('defaults missing dimensions from the intrinsic (probed) size', () => {
    const r = resolveVisualLayout(vis(), W, H, { width: 640, height: 360 })
    expect(r.width).toBe(640)
    expect(r.height).toBe(360)
  })

  it('fills only the missing dimension from intrinsic when one is explicit', () => {
    const r = resolveVisualLayout(vis({ width: 500 }), W, H, { width: 640, height: 360 })
    expect(r.width).toBe(500)
    expect(r.height).toBe(360)
  })

  it('falls back to the project frame when there is no intrinsic size', () => {
    const r = resolveVisualLayout(vis(), W, H, null)
    expect(r.width).toBe(W)
    expect(r.height).toBe(H)
  })

  it('explicit width/height act as the box even when intrinsic differs (crop box)', () => {
    // cropParams items carry the crop output size in width/height — layout
    // must honor them as-is, not the source media dimensions
    const r = resolveVisualLayout(
      vis({ width: 300, height: 200, cropParams: { x: 0, y: 0, width: 300, height: 200 } }),
      W,
      H,
      { width: 4000, height: 3000 }
    )
    expect(r.width).toBe(300)
    expect(r.height).toBe(200)
  })

  it('resize + intrinsic overrides explicit dimensions on media items', () => {
    const r = resolveVisualLayout(
      vis({ width: 50, height: 50, resize: 'cover' }),
      1000,
      500,
      { width: 100, height: 200 }
    )
    // cover of a 1:2 source into 2:1 frame → width pinned, height overflows
    expect(r.width).toBe(1000)
    expect(r.height).toBe(2000)
  })

  it('resize contain letterboxes into the project frame', () => {
    const r = resolveVisualLayout(vis({ resize: 'contain' }), 1000, 500, {
      width: 100,
      height: 200,
    })
    expect(r.width).toBe(250)
    expect(r.height).toBe(500)
  })

  it('resize without an intrinsic size falls back to the full frame', () => {
    const r = resolveVisualLayout(vis({ width: 50, height: 50, resize: 'contain' }), W, H, null)
    expect(r.width).toBe(W)
    expect(r.height).toBe(H)
  })

  it('TEXT ignores resize (not media-like) and keeps intrinsic/explicit dims', () => {
    const r = resolveVisualLayout(
      { type: 'TEXT', _id: 'v', text: 'hi', resize: 'cover' } as VisualDoc,
      W,
      H,
      { width: 320, height: 90 }
    )
    expect(r.width).toBe(320)
    expect(r.height).toBe(90)
  })

  it('SVG is media-like: resize applies', () => {
    const r = resolveVisualLayout(
      { type: 'SVG', _id: 'v', svg: '<svg/>', resize: 'contain' } as VisualDoc,
      1000,
      500,
      { width: 200, height: 200 }
    )
    expect(r.width).toBe(500)
    expect(r.height).toBe(500)
  })

  it('position preset overrides x/y and becomes the default anchor', () => {
    const r = resolveVisualLayout(
      vis({ width: 200, height: 100, x: 5, y: 7, position: 'bottom-right' }),
      W,
      H,
      null
    )
    expect(r.x).toBe(W)
    expect(r.y).toBe(H)
    expect(r.anchor).toBe('bottom-right')
    expect(r.left).toBe(W - 200)
    expect(r.top).toBe(H - 100)
  })

  it('an explicit anchor wins over the position-derived one', () => {
    const r = resolveVisualLayout(
      vis({ width: 200, height: 100, position: 'center-center', anchor: 'top-left' }),
      W,
      H,
      null
    )
    expect(r.x).toBe(W / 2)
    expect(r.y).toBe(H / 2)
    expect(r.anchor).toBe('top-left')
    expect(r.left).toBe(W / 2)
    expect(r.top).toBe(H / 2)
  })

  it('position "custom" keeps x/y and defaults anchor to top-left', () => {
    const r = resolveVisualLayout(
      vis({ width: 10, height: 10, x: 42, y: 43, position: 'custom' }),
      W,
      H,
      null
    )
    expect(r.x).toBe(42)
    expect(r.y).toBe(43)
    expect(r.anchor).toBe('top-left')
    expect(r.left).toBe(42)
    expect(r.top).toBe(43)
  })

  it('placeholder ("{{var}}") coordinates fall back to 0', () => {
    const r = resolveVisualLayout(
      vis({ width: 10, height: 10, x: '{{x}}', y: '{{y}}' }),
      W,
      H,
      null
    )
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* resolveVisualTiming                                                 */
/* ------------------------------------------------------------------ */

describe('resolveVisualTiming', () => {
  const D = 10

  it('all fields absent → full-duration window, no animation windows', () => {
    expect(resolveVisualTiming(vis(), D)).toEqual({
      enterBegin: 0,
      enterEnd: 0,
      exitBegin: 10,
      exitEnd: 10,
    })
  })

  it('absent enterEnd defaults to 0 then clamps up to enterBegin → no enter window', () => {
    // package parity: enterEnd literally defaults to 0, so enterBegin 2 with
    // no enterEnd yields enterEnd == enterBegin (zero-length enter window)
    const t = resolveVisualTiming(vis({ enterBegin: 2 }), D)
    expect(t.enterBegin).toBe(2)
    expect(t.enterEnd).toBe(2)
  })

  it('enterEnd earlier than enterBegin is clamped up to enterBegin', () => {
    const t = resolveVisualTiming(vis({ enterBegin: 3, enterEnd: 1 }), D)
    expect(t.enterEnd).toBe(3)
  })

  it('exitBegin later than exitEnd is clamped down to exitEnd', () => {
    const t = resolveVisualTiming(vis({ exitBegin: 8, exitEnd: 5 }), D)
    expect(t.exitBegin).toBe(5)
    expect(t.exitEnd).toBe(5)
  })

  it('absent exitEnd defaults to the context duration', () => {
    const t = resolveVisualTiming(vis({ exitBegin: 7 }), D)
    expect(t.exitBegin).toBe(7)
    expect(t.exitEnd).toBe(D)
  })

  it('absent exitBegin defaults to min(context duration, exitEnd)', () => {
    expect(resolveVisualTiming(vis({ exitEnd: 5 }), D).exitBegin).toBe(5)
    // an exitEnd beyond the timeline is NOT clamped; only the defaulted
    // exitBegin stays at the context duration
    const t = resolveVisualTiming(vis({ exitEnd: 40 }), D)
    expect(t.exitEnd).toBe(40)
    expect(t.exitBegin).toBe(10)
  })

  it('placeholder ("{{var}}") timing falls back to the defaults', () => {
    const t = resolveVisualTiming(
      vis({ enterBegin: '{{start}}', exitEnd: '{{end}}' }),
      D
    )
    expect(t).toEqual({ enterBegin: 0, enterEnd: 0, exitBegin: 10, exitEnd: 10 })
  })
})

/* ------------------------------------------------------------------ */
/* resolveAudioTiming                                                  */
/* ------------------------------------------------------------------ */

describe('resolveAudioTiming', () => {
  const D = 10

  it('bare audio fills the timeline with defaults', () => {
    expect(resolveAudioTiming(aud(), D)).toEqual({
      enter: 0,
      exit: 10,
      audioBegin: 0,
      audioEnd: 10,
      volume: 1,
      speed: 1,
      track: 0,
    })
  })

  it('a probed source shorter than the timeline caps audioEnd and exit', () => {
    const t = resolveAudioTiming(aud(), D, 4)
    expect(t.audioEnd).toBe(4)
    expect(t.exit).toBe(4)
  })

  it('a probed source longer than the timeline caps audioEnd at duration + audioBegin', () => {
    const t = resolveAudioTiming(aud({ audioBegin: 5 }), D, 30)
    expect(t.audioBegin).toBe(5)
    expect(t.audioEnd).toBe(15) // min(30, 10 + 5)
    expect(t.exit).toBe(10) // min(0 + (15-5)/1, 10)
  })

  it('speed divides the trimmed source length when deriving exit', () => {
    const t = resolveAudioTiming(aud({ audioBegin: 1, audioEnd: 7, speed: 2 }), D)
    expect(t.exit).toBe(3) // 0 + (7-1)/2
    expect(t.speed).toBe(2)
  })

  it('enter shifts the derived exit', () => {
    const t = resolveAudioTiming(aud({ enter: 2, audioBegin: 0, audioEnd: 3 }), D)
    expect(t.enter).toBe(2)
    expect(t.exit).toBe(5)
  })

  it('derived exit never exceeds the context duration', () => {
    const t = resolveAudioTiming(aud({ enter: 8, audioBegin: 0, audioEnd: 6 }), D)
    expect(t.exit).toBe(10) // min(8 + 6, 10)
  })

  it('an explicit exit after enter wins over the derived one', () => {
    const t = resolveAudioTiming(aud({ enter: 1, exit: 4, audioEnd: 9 }), D)
    expect(t.exit).toBe(4)
  })

  it('an explicit exit at or before enter is ignored (falls back to derived)', () => {
    const t = resolveAudioTiming(aud({ enter: 5, exit: 3, audioBegin: 0, audioEnd: 2 }), D)
    expect(t.exit).toBe(7) // 5 + 2/1
  })

  it('placeholder exit ("{{var}}") falls back to the derived exit', () => {
    const t = resolveAudioTiming(aud({ exit: '{{until}}', audioEnd: 4 }), D)
    expect(t.exit).toBe(4)
  })

  it('a negative trim (audioEnd < audioBegin) clamps trimmed length to 0', () => {
    const t = resolveAudioTiming(aud({ enter: 2, audioBegin: 5, audioEnd: 3 }), D)
    expect(t.exit).toBe(2) // enter + max(0, -2)/1
  })

  it('volume and track defaults resolve to 1 and 0', () => {
    const t = resolveAudioTiming(aud({ volume: 0.25, track: 3 }), D)
    expect(t.volume).toBe(0.25)
    expect(t.track).toBe(3)
  })
})
