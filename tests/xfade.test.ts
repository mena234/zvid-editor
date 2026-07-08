/**
 * Exactness checks for the vf_xfade.c port (utils/xfade.ts).
 * Expected values are hand-derived from the FFmpeg n6.1.2 C source
 * (P = 1 − t is FFmpeg's progress) and were cross-checked against real
 * ffmpeg renders (see the pixel probes in the implementation session):
 *   wipeleft t=0.25  → B occupies x > 150 (W=200)
 *   fadeblack t=0.5  → red→blue lands on rgb(0,0,87) ⇒ b coeff 0.342
 *   slideleft t=0.25 → A shifted −50px, B +150px
 *   circleopen t=0.5 → B fully visible at the exact center
 */
import { describe, it, expect } from 'vitest'
import { xfadeFrame, smoothstep, frand } from '~/utils/xfade'

const W = 200
const H = 100
const tr = (effect: string, t: number) =>
  xfadeFrame(effect, t, { mode: 'transition', canvasW: W, canvasH: H })
const enter = (effect: string, t: number) =>
  xfadeFrame(effect, t, {
    mode: 'enter',
    canvasW: W,
    canvasH: H,
    contentOpaque: true,
  })
const exit = (effect: string, t: number) =>
  xfadeFrame(effect, t, {
    mode: 'exit',
    canvasW: W,
    canvasH: H,
    contentOpaque: true,
  })

/** evaluate a generated linear/radial gradient mask's alpha at a stop px */
function gradientAlphaAt(mask: string, px: number): number {
  const stops = [...mask.matchAll(/rgba\(0,0,0,([\d.]+)\) ([\d.]+)px/g)].map(
    (m) => ({ a: parseFloat(m[1]), p: parseFloat(m[2]) })
  )
  expect(stops.length).toBeGreaterThan(1)
  if (px <= stops[0].p) return stops[0].a
  for (let i = 1; i < stops.length; i++) {
    if (px <= stops[i].p) {
      const f =
        stops[i].p === stops[i - 1].p
          ? 1
          : (px - stops[i - 1].p) / (stops[i].p - stops[i - 1].p)
      return stops[i - 1].a + (stops[i].a - stops[i - 1].a) * f
    }
  }
  return stops[stops.length - 1].a
}

describe('fades', () => {
  it('fade transition: b opacity = t over unstyled a', () => {
    const f = tr('fade', 0.3)
    expect(f.b.opacity).toBeCloseTo(0.3, 5)
    expect(f.a.opacity).toBeUndefined()
  })
  it('fade enter follows the straight-alpha t² law (opacity t × brightness t)', () => {
    const f = enter('fade', 0.5)
    expect(f.b.opacity).toBeCloseTo(0.5, 5)
    expect(f.b.filter).toContain('brightness(0.5)')
  })
  it('fade exit mirrors with P', () => {
    const f = exit('fade', 0.25)
    expect(f.a.opacity).toBeCloseTo(0.75, 5)
    expect(f.a.filter).toContain('brightness(0.75)')
  })
  it('fadeblack transition at t=0.5 matches the probed render (b=0.342, black plate)', () => {
    const f = tr('fadeblack', 0.5)
    // P=0.5: s1=ss(.8,1,.5)=0, s2=ss(.2,1,.5)=0.31640625
    expect(f.b.opacity).toBeCloseTo(0.5 * (1 - 0.31640625), 4)
    expect(f.a.opacity).toBeCloseTo(0, 4)
    expect(f.plate).toMatchObject({ color: '#000', opacity: 1 })
  })
  it('fadegrays applies per-stream grayscale with the 0.2 phase', () => {
    const f = tr('fadegrays', 0.5)
    // P=0.5: a grayscale(1−s1)=1, b grayscale(s2)=0.316…
    expect(f.a.filter).toContain('grayscale(1)')
    expect(f.b.filter).toContain('grayscale(0.316)')
    expect(f.b.opacity).toBeCloseTo(0.5, 5)
  })
})

describe('wipes (direction-exact)', () => {
  it('wipeleft: B appears from the RIGHT (x > W·P)', () => {
    const f = tr('wipeleft', 0.25)
    expect(f.b.clipPath).toBe('inset(0 0 0 150px)')
  })
  it('wiperight: B appears from the LEFT (x < W·t)', () => {
    const f = tr('wiperight', 0.25)
    expect(f.b.clipPath).toBe('inset(0 150px 0 0)')
  })
  it('wipeup: B appears from the BOTTOM', () => {
    const f = tr('wipeup', 0.25)
    expect(f.b.clipPath).toBe('inset(75px 0 0 0)')
  })
  it('wipedown: B appears from the TOP', () => {
    const f = tr('wipedown', 0.25)
    expect(f.b.clipPath).toBe('inset(0 0 75px 0)')
  })
  it('wipeleft exit clips the item to the A region (x ≤ W·P)', () => {
    const f = exit('wipeleft', 0.25)
    expect(f.a.clipPath).toBe('inset(0 50px 0 0)')
  })
  it('wipetl: A keeps the top-left P·W × P·H rectangle', () => {
    const f = tr('wipetl', 0.3) // P=0.7 → zw=140, zh=70
    expect(f.b.clipPath).toContain('polygon(140px 0px, 200px 0px')
    const x = exit('wipetl', 0.3)
    expect(x.a.clipPath).toBe('polygon(0px 0px, 140px 0px, 140px 70px, 0px 70px)')
  })
})

describe('slides (both streams move)', () => {
  it('slideleft: A exits left by t·W while B enters from the right by P·W', () => {
    const f = tr('slideleft', 0.25)
    expect(f.a.transform).toBe('translateX(-50px)')
    expect(f.b.transform).toBe('translateX(150px)')
    expect(f.clip).toBe(true)
  })
  it('slidedown: A moves down, B comes from the top', () => {
    const f = tr('slidedown', 0.25)
    expect(f.a.transform).toBe('translateY(25px)')
    expect(f.b.transform).toBe('translateY(-75px)')
  })
})

describe('smooth / doors / circles (ramp-exact)', () => {
  it('smoothleft: ramp spans u∈[2P−1, 2P]', () => {
    const f = tr('smoothleft', 0.5) // P=0.5 → alpha(0)=0, alpha(W)=1
    const m = f.b.maskImage!
    expect(gradientAlphaAt(m, 0)).toBeCloseTo(0, 2)
    expect(gradientAlphaAt(m, W)).toBeCloseTo(1, 2)
    expect(gradientAlphaAt(m, W / 2)).toBeCloseTo(smoothstep(0, 1, 0.5), 2)
  })
  it('horzopen opens a band around the center; horzclose closes from the edges', () => {
    const open = tr('horzopen', 0.6) // P=0.4: alpha(center)=ss(0,1,2−0−0.8)=1
    const mo = open.b.maskImage!
    expect(gradientAlphaAt(mo, H / 2)).toBeCloseTo(1, 2)
    expect(gradientAlphaAt(mo, 0)).toBeCloseTo(smoothstep(0, 1, 2 - 1 - 0.8), 2)
    const close = tr('horzclose', 0.6) // alpha(edge)=ss(0,1,1+1−0.8)=1, center=ss(0,1,0.2)
    const mc = close.b.maskImage!
    expect(gradientAlphaAt(mc, 0)).toBeCloseTo(1, 2)
    expect(gradientAlphaAt(mc, H / 2)).toBeCloseTo(smoothstep(0, 1, 0.2), 2)
  })
  it('circleopen: B fully visible at the exact center at t=0.5 (probed)', () => {
    const f = tr('circleopen', 0.5)
    const m = f.b.maskImage!
    expect(m).toContain('radial-gradient(circle at 100px 50px')
    expect(gradientAlphaAt(m, 0)).toBeCloseTo(1, 2)
    // at dist = z (the corner), alpha = 1 − ss(0,1, 1+0) = 0
    expect(gradientAlphaAt(m, Math.hypot(100, 50))).toBeCloseTo(0, 2)
  })
  it('circleclose is the inverse geometry (B from the edges)', () => {
    const f = tr('circleclose', 0.5)
    const m = f.b.maskImage!
    expect(gradientAlphaAt(m, 0)).toBeCloseTo(0, 2)
    expect(gradientAlphaAt(m, Math.hypot(100, 50))).toBeCloseTo(1, 2)
  })
})

describe('crops (black plate, probed)', () => {
  it('circlecrop t=0.25: A inside r=(2·|P−.5|)³·hypot shrinking circle, black outside', () => {
    const f = tr('circlecrop', 0.25) // P=0.75 → z = 0.125·111.803 = 13.98
    expect(f.a.clipPath).toMatch(/^circle\(13\.9[78]px at 100px 50px\)$/)
    expect(f.b.visibility).toBe('hidden')
    expect(f.plate?.color).toBe('#000')
  })
  it('rectcrop t=0.25: A inside the |P−0.5|-sized centered rect', () => {
    const f = tr('rectcrop', 0.25) // zw=50, zh=25 → inset(25 50 25 50)
    expect(f.a.clipPath).toBe('inset(25px 50px 25px 50px)')
    expect(f.plate?.clipPath).toContain('polygon')
  })
  it('rectcrop second half switches to B', () => {
    const f = tr('rectcrop', 0.75)
    expect(f.b.clipPath).toBe('inset(25px 50px 25px 50px)')
    expect(f.a.visibility).toBe('hidden')
  })
})

describe('slices / zoom / dissolve internals', () => {
  it('hlslice t=0.5: slice at u=0.5 is half-filled (probed: x=104 B, x=116 A)', () => {
    const f = tr('hlslice', 0.5)
    const m = f.b.maskImage!
    expect(gradientAlphaAt(m, 104)).toBe(1)
    expect(gradientAlphaAt(m, 116)).toBe(0)
  })
  it('zoomin: A magnifies by 1/ss(0.5,1,P) around the canvas center', () => {
    const f = tr('zoomin', 0.25) // P=0.75 → zf=0.5 → scale 2
    expect(f.a.transform).toBe('scale(2)')
    expect(f.a.transformOrigin).toBe('100px 50px')
    // B still hidden-ish: coeff 1−ss(0,0.5,0.75)=0
    expect(f.b.opacity).toBeCloseTo(0, 4)
  })
  it('zoomin enter follows the probed (1−m)² law (t=0.75 → opacity/brightness 0.5)', () => {
    const f = enter('zoomin', 0.75) // P=0.25 → m=ss(0,0.5,0.25)=0.5
    expect(f.b.opacity).toBeCloseTo(0.5, 4)
    expect(f.b.filter).toContain('brightness(0.5)')
  })
  it('pixelize enter follows the probed t² envelope (t=0.5 → 0x80 over gray)', () => {
    const f = enter('pixelize', 0.5)
    expect(f.b.opacity).toBeCloseTo(0.5, 4)
    expect(f.b.filter).toContain('brightness(0.5)')
  })
  it('hblur exit mirrors with P²', () => {
    const f = exit('hblur', 0.25) // P=0.75 → opacity 0.75, brightness 0.75
    expect(f.a.opacity).toBeCloseTo(0.75, 4)
    expect(f.a.filter).toContain('brightness(0.75)')
  })
  it('frand matches the C reference used by dissolve/wind', () => {
    // reference values computed from the exact formula
    const r = Math.sin(3 * 12.9898 + 7 * 78.233) * 43758.545
    expect(frand(3, 7)).toBeCloseTo(r - Math.floor(r), 9)
    expect(frand(0, 0)).toBe(0)
  })
})

describe('rect mapping (video↔video full-frame canvas)', () => {
  it('maps canvas-space boundaries into the item-local coordinate space', () => {
    const f = xfadeFrame('wipeleft', 0.25, {
      mode: 'transition',
      canvasW: W,
      canvasH: H,
      rectB: { x: 40, y: 10, w: 100, h: 50 },
    })
    // boundary at canvas x=150 → local 110px
    expect(f.b.clipPath).toBe('inset(0 0 0 110px)')
  })
  it('slides translate by canvas-sized offsets regardless of the rect', () => {
    const f = xfadeFrame('slideleft', 0.5, {
      mode: 'transition',
      canvasW: W,
      canvasH: H,
      rectA: { x: 40, y: 10, w: 100, h: 50 },
      rectB: { x: 0, y: 0, w: W, h: H },
    })
    expect(f.a.transform).toBe('translateX(-100px)')
    expect(f.b.transform).toBe('translateX(100px)')
  })
})
