/**
 * utils/groupTransitions.ts — linked video↔video xfade resolution for the
 * stage preview. Item A carries `transition` + `transitionId` → item B's
 * public `id`; the window is [B.enterBegin, B.enterBegin + A.transitionDuration].
 *
 * Runs in plain node: the media probe is SSR-guarded (no window → no
 * intrinsic dims), so unsized items resolve to the full project frame.
 */
import { describe, it, expect } from 'vitest'
import { activeGroupFx } from '../../utils/groupTransitions'
import type { VisualDoc } from '../../shared/schema/types'

const W = 200
const H = 100
const CTX = 30

const v = (o: Record<string, any>) => o as unknown as VisualDoc

/** default linked pair: A slides out to B, window 4..5 */
const pair = (aOver: Record<string, any> = {}, bOver: Record<string, any> = {}) => [
  v({
    _id: 'A',
    type: 'VIDEO',
    transition: 'slideleft',
    transitionId: 'v2',
    transitionDuration: 1,
    ...aOver,
  }),
  v({ _id: 'B', id: 'v2', type: 'VIDEO', enterBegin: 4, ...bOver }),
]

const run = (items: VisualDoc[], time: number) =>
  activeGroupFx(items, time, CTX, W, H)

describe('active window detection', () => {
  it('mid-window returns styles for both streams', () => {
    const fx = run(pair(), 4.5)
    expect(fx).not.toBeNull()
    expect(fx!.styleById.get('A')!.transform).toBe('translateX(-100px)')
    expect(fx!.styleById.get('B')!.transform).toBe('translateX(100px)')
    expect(fx!.plates).toEqual([])
  })
  it('t=0 and t=1 boundaries are inclusive', () => {
    const at4 = run(pair(), 4)
    expect(at4!.styleById.get('A')!.transform).toBe('translateX(0px)')
    expect(at4!.styleById.get('B')!.transform).toBe('translateX(200px)')
    const at5 = run(pair(), 5)
    expect(at5!.styleById.get('A')!.transform).toBe('translateX(-200px)')
    expect(at5!.styleById.get('B')!.transform).toBe('translateX(0px)')
  })
  it('outside the window returns null', () => {
    expect(run(pair(), 3.999)).toBeNull()
    expect(run(pair(), 5.001)).toBeNull()
    expect(run(pair(), 0)).toBeNull()
  })
  it('transitionDuration defaults to 0.5s', () => {
    const items = pair({ transitionDuration: undefined })
    expect(run(items, 4.25)!.styleById.get('A')!.transform).toBe(
      'translateX(-100px)' // t = 0.5
    )
    expect(run(items, 4.6)).toBeNull()
  })
})

describe('link resolution / broken links', () => {
  it('no transition or transitionId → no-op', () => {
    expect(run(pair({ transition: null }), 4.5)).toBeNull()
    expect(run(pair({ transitionId: null }), 4.5)).toBeNull()
    expect(run(pair({ transitionId: 'none' }), 4.5)).toBeNull()
  })
  it('transitionId pointing at a missing public id → no-op', () => {
    expect(run(pair({ transitionId: 'ghost' }), 4.5)).toBeNull()
  })
  it('B must be a different item than A (self-link is ignored)', () => {
    const self = [
      v({
        _id: 'A',
        id: 'v2',
        type: 'VIDEO',
        transition: 'fade',
        transitionId: 'v2',
        transitionDuration: 1,
        enterBegin: 4,
      }),
    ]
    expect(run(self, 4.5)).toBeNull()
  })
  it('non-positive transitionDuration → no-op', () => {
    expect(run(pair({ transitionDuration: 0 }), 4)).toBeNull()
    expect(run(pair({ transitionDuration: -1 }), 4)).toBeNull()
  })
})

describe('styles during overlap', () => {
  it('fade: incoming opacity = t, outgoing unstyled', () => {
    const fx = run(pair({ transition: 'fade' }), 4.3)
    expect(fx!.styleById.get('B')!.opacity).toBeCloseTo(0.3, 5)
    expect(fx!.styleById.get('A')!.opacity).toBeUndefined()
  })
  it('fadeblack collects a black plate', () => {
    const fx = run(pair({ transition: 'fadeblack' }), 4.5)
    expect(fx!.plates).toHaveLength(1)
    expect(fx!.plates[0]).toMatchObject({ color: '#000', opacity: 1 })
  })
  it('wipe boundaries map from canvas space into the item-local rect', () => {
    // B has an explicit 100×50 box at (40,10); wipeleft t=0.25 → canvas
    // boundary at x = W·P = 150 → local 110px (mirrors tests/xfade.test.ts)
    const fx = run(
      pair(
        { transition: 'wipeleft' },
        { width: 100, height: 50, x: 40, y: 10 }
      ),
      4.25
    )
    expect(fx!.styleById.get('B')!.clipPath).toBe('inset(0 0 0 110px)')
  })
})

describe('multiple simultaneous pairs', () => {
  it('resolves every active linked pair independently', () => {
    const items = [
      ...pair(),
      v({
        _id: 'C',
        type: 'VIDEO',
        transition: 'fade',
        transitionId: 'v4',
        transitionDuration: 2,
      }),
      v({ _id: 'D', id: 'v4', type: 'VIDEO', enterBegin: 4 }),
    ]
    const fx = run(items, 4.5)
    expect([...fx!.styleById.keys()].sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(fx!.styleById.get('D')!.opacity).toBeCloseTo(0.25, 5) // t=0.5/2
  })
  it('an inactive second pair does not block the active one', () => {
    const items = [
      ...pair(),
      v({
        _id: 'C',
        type: 'VIDEO',
        transition: 'fade',
        transitionId: 'v4',
        transitionDuration: 0.5,
      }),
      v({ _id: 'D', id: 'v4', type: 'VIDEO', enterBegin: 20 }),
    ]
    const fx = run(items, 4.5)
    expect([...fx!.styleById.keys()].sort()).toEqual(['A', 'B'])
  })
})
