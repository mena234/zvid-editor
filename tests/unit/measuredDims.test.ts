import { describe, it, expect } from 'vitest'
import { useMeasuredDims } from '../../composables/useMeasuredDims'

/**
 * The cache is a module-level reactive Map (app-wide singleton), so each test
 * uses its own ids to stay independent.
 */

describe('useMeasuredDims', () => {
  it('stores and returns measured dimensions; unknown ids return null', () => {
    const { setMeasured, getMeasured } = useMeasuredDims()
    expect(getMeasured('md_unknown')).toBeNull()
    setMeasured('md_a', 120, 40)
    expect(getMeasured('md_a')).toEqual({ width: 120, height: 40 })
  })

  it('is a shared singleton across composable instances', () => {
    const a = useMeasuredDims()
    const b = useMeasuredDims()
    a.setMeasured('md_shared', 10, 20)
    expect(b.getMeasured('md_shared')).toEqual({ width: 10, height: 20 })
    expect(a.measured).toBe(b.measured)
  })

  it('skips updates when both deltas are under 0.5px (keeps the same entry object)', () => {
    const { setMeasured, getMeasured } = useMeasuredDims()
    setMeasured('md_dedupe', 100, 50)
    const first = getMeasured('md_dedupe')
    setMeasured('md_dedupe', 100.49, 50.49)
    expect(getMeasured('md_dedupe')).toBe(first) // untouched, not replaced
    expect(getMeasured('md_dedupe')).toEqual({ width: 100, height: 50 })
  })

  it('a delta of exactly 0.5px updates (threshold is strict <)', () => {
    const { setMeasured, getMeasured } = useMeasuredDims()
    setMeasured('md_edge', 100, 50)
    setMeasured('md_edge', 100.5, 50)
    expect(getMeasured('md_edge')).toEqual({ width: 100.5, height: 50 })
  })

  it('updates when only one dimension crosses the threshold', () => {
    const { setMeasured, getMeasured } = useMeasuredDims()
    setMeasured('md_mixed', 100, 50)
    setMeasured('md_mixed', 100.1, 50.7) // width within, height beyond
    expect(getMeasured('md_mixed')).toEqual({ width: 100.1, height: 50.7 })
  })

  it('an update replaces the entry object', () => {
    const { setMeasured, getMeasured } = useMeasuredDims()
    setMeasured('md_replace', 10, 10)
    const first = getMeasured('md_replace')
    setMeasured('md_replace', 20, 20)
    expect(getMeasured('md_replace')).not.toBe(first)
    expect(getMeasured('md_replace')).toEqual({ width: 20, height: 20 })
  })

  it('the first measurement always stores, even tiny values', () => {
    const { setMeasured, getMeasured } = useMeasuredDims()
    setMeasured('md_first', 0.2, 0.3)
    expect(getMeasured('md_first')).toEqual({ width: 0.2, height: 0.3 })
  })

  it('dropMeasured removes the entry', () => {
    const { setMeasured, getMeasured, dropMeasured } = useMeasuredDims()
    setMeasured('md_drop', 5, 5)
    dropMeasured('md_drop')
    expect(getMeasured('md_drop')).toBeNull()
    dropMeasured('md_never_set') // no-op, must not throw
  })
})
