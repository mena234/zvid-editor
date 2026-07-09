/**
 * utils/time.ts — timeline formatting + ruler tick math.
 * Expected values derived directly from the source (floor-based framing,
 * first-candidate-≥70px tick selection).
 */
import { describe, it, expect } from 'vitest'
import {
  formatTime,
  formatTimeShort,
  trimNum,
  round3,
  clamp,
  pickTickStep,
} from '../../utils/time'

describe('formatTime (centiseconds path)', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('0:00.00')
  })
  it('formats minutes/seconds/centiseconds with padding', () => {
    expect(formatTime(65.25)).toBe('1:05.25')
    expect(formatTime(5.999)).toBe('0:05.99')
    expect(formatTime(600)).toBe('10:00.00')
  })
  it('non-finite input collapses to 0:00.00', () => {
    expect(formatTime(NaN)).toBe('0:00.00')
    expect(formatTime(Infinity)).toBe('0:00.00')
    expect(formatTime(-Infinity)).toBe('0:00.00')
  })
  it('negative times keep the sign in front', () => {
    expect(formatTime(-3.5)).toBe('-0:03.50')
  })
  it('fps=0 is falsy and falls back to centiseconds', () => {
    expect(formatTime(1.5, 0)).toBe('0:01.50')
  })
})

describe('formatTime (frames path)', () => {
  it('shows floor(frac × fps) frames', () => {
    expect(formatTime(0.5, 24)).toBe('0:00.12')
    expect(formatTime(10.25, 24)).toBe('0:10.06')
    expect(formatTime(61, 30)).toBe('1:01.00')
  })
  it('frame counter is zero-padded', () => {
    expect(formatTime(2.1, 30)).toBe('0:02.03') // floor(0.1×30)=3
  })
})

describe('formatTimeShort', () => {
  it('sub-minute values render as trimmed seconds', () => {
    expect(formatTimeShort(0)).toBe('0s')
    expect(formatTimeShort(5.25)).toBe('5.25s')
    expect(formatTimeShort(59.5)).toBe('59.5s')
  })
  it('minute values render m:ss with floored seconds', () => {
    expect(formatTimeShort(60)).toBe('1:00')
    expect(formatTimeShort(90.7)).toBe('1:30')
    expect(formatTimeShort(125)).toBe('2:05')
  })
})

describe('trimNum', () => {
  it('rounds to 2 decimals by default and drops trailing zeros', () => {
    expect(trimNum(1.23456)).toBe('1.23')
    expect(trimNum(1.999)).toBe('2')
    expect(trimNum(5)).toBe('5')
  })
  it('honours the decimals parameter', () => {
    expect(trimNum(1.23456, 3)).toBe('1.235')
    expect(trimNum(2.5, 0)).toBe('3')
  })
  it('is float-noise safe (0.1+0.2 → 0.3)', () => {
    expect(trimNum(0.1 + 0.2)).toBe('0.3')
  })
})

describe('round3', () => {
  it('rounds to 3 decimals', () => {
    expect(round3(1.23456)).toBe(1.235)
    expect(round3(2)).toBe(2)
    expect(round3(0.0004)).toBe(0)
  })
})

describe('clamp', () => {
  it('passes through in-range values and clips out-of-range ones', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe('pickTickStep (adaptive ruler steps)', () => {
  // rule: first candidate c in [0.1,0.25,0.5,1,2,5,10,15,30,60,120,300]
  // with c·pxPerSec ≥ 70; minor is always major/5
  const cases: [number, number][] = [
    [700, 0.1], // deep zoom → 100ms ticks
    [300, 0.25],
    [150, 0.5],
    [100, 1],
    [70, 1], // exactly 70px at 1s
    [50, 2],
    [30, 5],
    [10, 10],
    [5, 15],
    [4, 30],
    [2, 60],
    [1, 120],
    [0.25, 300],
  ]
  for (const [px, major] of cases) {
    it(`pxPerSec=${px} → major ${major}s`, () => {
      const step = pickTickStep(px)
      expect(step.major).toBe(major)
      expect(step.minor).toBeCloseTo(major / 5, 10)
    })
  }
  it('falls back to 600/120 when even 300s ticks are under 70px', () => {
    expect(pickTickStep(0.1)).toEqual({ major: 600, minor: 120 })
    expect(pickTickStep(0)).toEqual({ major: 600, minor: 120 })
  })
  it('major step shrinks monotonically as zoom increases', () => {
    const zooms = [0.1, 1, 5, 20, 100, 400, 800]
    const majors = zooms.map((z) => pickTickStep(z).major)
    for (let i = 1; i < majors.length; i++) {
      expect(majors[i]).toBeLessThanOrEqual(majors[i - 1])
    }
  })
})
