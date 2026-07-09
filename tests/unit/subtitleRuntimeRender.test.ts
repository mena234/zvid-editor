/**
 * utils/subtitleRuntime.ts — RUNTIME half (rendering/lookup helpers).
 * The parsers are covered by tests/subtitleImport.test.ts; this file covers
 * activeCaptionAt / activeWordIndex / renderCaptionWords (all modes) /
 * scale keyframes (via pop+bounce) / container+text+stroke styles.
 */
import { describe, it, expect } from 'vitest'
import {
  activeCaptionAt,
  activeWordIndex,
  renderCaptionWords,
  subtitleContainerStyle,
  subtitleTextStyle,
  subtitleStrokeStyle,
} from '../../utils/subtitleRuntime'

const cap = {
  start: 0,
  end: 3,
  text: 'Hello brave world',
  words: [
    { start: 0, end: 0.5, text: 'Hello' },
    { start: 1, end: 1.5, text: 'brave' }, // note: 0.5–1 is a silence gap
    { start: 2, end: 3, text: 'world' },
  ],
} as any

describe('activeCaptionAt', () => {
  const sub = {
    captions: [cap, { start: 5, end: 6, text: 'later', words: [] }],
  } as any
  it('finds the caption covering t (start inclusive, end exclusive)', () => {
    expect(activeCaptionAt(sub, 0)!.index).toBe(0)
    expect(activeCaptionAt(sub, 2.999)!.index).toBe(0)
    expect(activeCaptionAt(sub, 3)).toBeNull() // end is exclusive
    expect(activeCaptionAt(sub, 5.5)!.index).toBe(1)
  })
  it('returns null outside all captions or without a subtitle', () => {
    expect(activeCaptionAt(sub, 10)).toBeNull()
    expect(activeCaptionAt(undefined, 1)).toBeNull()
    expect(activeCaptionAt({} as any, 1)).toBeNull()
  })
})

describe('activeWordIndex (incl. gap behavior)', () => {
  it('is -1 before the first word starts', () => {
    expect(activeWordIndex(cap, -0.1)).toBe(-1)
  })
  it('returns the started word while it is spoken', () => {
    expect(activeWordIndex(cap, 0)).toBe(0)
    expect(activeWordIndex(cap, 1.2)).toBe(1)
  })
  it('keeps the previous word during a silence gap (start-based, not end-based)', () => {
    // 0.7 is after "Hello" ends (0.5) but before "brave" starts (1)
    expect(activeWordIndex(cap, 0.7)).toBe(0)
  })
  it('sticks to the last word after all words started', () => {
    expect(activeWordIndex(cap, 99)).toBe(2)
  })
  it('is -1 for captions without words', () => {
    expect(activeWordIndex({ start: 0, end: 1, text: 'x', words: [] } as any, 0.5)).toBe(-1)
  })
})

describe('renderCaptionWords — visibility modes', () => {
  it('normal/none/unknown: all visible, none active', () => {
    for (const mode of ['normal', 'none', 'someUnknownMode']) {
      const out = renderCaptionWords(cap, 1.2, mode)
      expect(out.map((w) => w.visible)).toEqual([true, true, true])
      expect(out.map((w) => w.active)).toEqual([false, false, false])
      expect(out.map((w) => w.text)).toEqual(['Hello', 'brave', 'world'])
    }
  })
  it('one-word: only the spoken word is visible and active', () => {
    const out = renderCaptionWords(cap, 1.2, 'one-word')
    expect(out.map((w) => w.visible)).toEqual([false, true, false])
    expect(out.map((w) => w.active)).toEqual([false, true, false])
  })
  it('one-word: the previous word stays through a gap', () => {
    const out = renderCaptionWords(cap, 0.7, 'one-word')
    expect(out.map((w) => w.visible)).toEqual([true, false, false])
  })
  it('progressive: spoken words accumulate', () => {
    expect(
      renderCaptionWords(cap, 1.2, 'progressive').map((w) => w.visible)
    ).toEqual([true, true, false])
    expect(
      renderCaptionWords(cap, 2.5, 'progressive').map((w) => w.visible)
    ).toEqual([true, true, true])
  })
  it('karaoke/highlight: full text with the active word flagged', () => {
    for (const mode of ['karaoke', 'highlight']) {
      const out = renderCaptionWords(cap, 1.2, mode)
      expect(out.map((w) => w.visible)).toEqual([true, true, true])
      expect(out.map((w) => w.active)).toEqual([false, true, false])
    }
  })
})

describe('renderCaptionWords — pop/bounce scale keyframes', () => {
  it('pop: 1 → 1.3 @0.12s → settles 1.18 @0.24s (linear between)', () => {
    const at = (t: number) => renderCaptionWords(cap, t, 'pop')[1].scale!
    expect(at(1)).toBeCloseTo(1, 5) // elapsed 0
    expect(at(1.06)).toBeCloseTo(1.15, 5) // halfway up
    expect(at(1.12)).toBeCloseTo(1.3, 5) // peak
    expect(at(1.18)).toBeCloseTo(1.24, 5) // halfway back down
    expect(at(1.4)).toBeCloseTo(1.18, 5) // past the chain: hold last
  })
  it('bounce: overshoot spring 1.35 → 0.92 → 1.08 → 1', () => {
    const at = (t: number) => renderCaptionWords(cap, t, 'bounce')[1].scale!
    expect(at(1.09)).toBeCloseTo(1.35, 5)
    expect(at(1.135)).toBeCloseTo(1.135, 5) // midway 1.35→0.92
    expect(at(1.18)).toBeCloseTo(0.92, 5)
    expect(at(1.27)).toBeCloseTo(1.08, 5)
    expect(at(1.5)).toBeCloseTo(1, 5)
  })
  it('only the active word carries a scale', () => {
    const out = renderCaptionWords(cap, 1.06, 'pop')
    expect(out[0].scale).toBeUndefined()
    expect(out[2].scale).toBeUndefined()
    expect(out.map((w) => w.active)).toEqual([false, true, false])
  })
})

describe('renderCaptionWords — fill sweep', () => {
  it('sweeps the active word until the NEXT word starts (continuous)', () => {
    // word 0 sweeps over [0, 1) (next start), not just its own 0.5s
    const out = renderCaptionWords(cap, 0.25, 'fill')
    expect(out[0].fillProgress).toBeCloseTo(0.25, 5)
    expect(out[1].fillProgress).toBe(0)
    expect(out[2].fillProgress).toBe(0)
  })
  it('past words are 1, current interpolates', () => {
    const out = renderCaptionWords(cap, 1.25, 'fill')
    expect(out[0].fillProgress).toBe(1)
    expect(out[1].fillProgress).toBeCloseTo(0.25, 5) // (1.25−1)/(2−1)
  })
  it('the last word sweeps to the group end', () => {
    const out = renderCaptionWords(cap, 2.5, 'fill')
    expect(out[2].fillProgress).toBeCloseTo(0.5, 5) // (2.5−2)/(3−2)
  })
  it('fill never marks words active', () => {
    expect(
      renderCaptionWords(cap, 1.25, 'fill').every((w) => !w.active)
    ).toBe(true)
  })
})

describe('renderCaptionWords — fade', () => {
  it('150ms fade-in on the active word; future words hold space at opacity 0', () => {
    const out = renderCaptionWords(cap, 1.075, 'fade')
    expect(out[0].opacity).toBe(1)
    expect(out[1].opacity).toBeCloseTo(0.5, 5)
    expect(out[2].opacity).toBe(0)
    expect(out.map((w) => w.visible)).toEqual([true, true, true])
  })
})

describe('renderCaptionWords — typewriter', () => {
  it('types characters across the window until the next word starts', () => {
    // "Hello" (5 chars) over [0,1): at t=0.5 → floor(0.5·5)+1 = 3 chars
    const out = renderCaptionWords(cap, 0.5, 'typewriter')
    expect(out[0].revealedChars).toBe(3)
    expect(out[1].revealedChars).toBe(0)
    expect(out[2].revealedChars).toBe(0)
  })
  it('a word starts with its first char and past words are complete', () => {
    const out = renderCaptionWords(cap, 1.0, 'typewriter')
    expect(out[0].revealedChars).toBe(5)
    expect(out[1].revealedChars).toBe(1) // progress 0 → floor(0)+1
  })
})

describe('renderCaptionWords — slide', () => {
  it('300ms move + 150ms fade towards "up" by default (distance ≥ 48)', () => {
    const out = renderCaptionWords(cap, 1.15, 'slide')
    // active word: halfway through the move, fade complete
    expect(out[1].opacity).toBeCloseTo(1, 5)
    expect(out[1].translate![0]).toBeCloseTo(0, 5)
    expect(out[1].translate![1]).toBeCloseTo(25, 5) // up: enters from below, dist 50
    // settled word: no translate left
    expect(out[0].translate).toBeUndefined()
    expect(out[0].opacity).toBeCloseTo(1, 5)
    // future word: parked at full offset, transparent, but keeps its space
    expect(out[2].opacity).toBe(0)
    expect(out[2].visible).toBe(true)
    expect(out[2].translate![1]).toBeCloseTo(50, 5)
  })
  it('slideDirection + fontSize drive the entrance vector', () => {
    const out = renderCaptionWords(cap, 1.15, 'slide', {
      slideDirection: 'left',
      fontSize: 80,
    })
    expect(out[1].translate![0]).toBeCloseTo(40, 5) // −(−1)·80·0.5
    expect(out[1].translate![1]).toBeCloseTo(0, 5)
  })
  it('small fonts clamp the travel distance to 48px', () => {
    const out = renderCaptionWords(cap, 1.15, 'slide', { fontSize: 20 })
    expect(out[1].translate![1]).toBeCloseTo(24, 5) // 48·0.5
  })
  it('unknown slideDirection falls back to up', () => {
    const out = renderCaptionWords(cap, 1.15, 'slide', { slideDirection: 'diag' })
    expect(out[1].translate![1]).toBeCloseTo(25, 5)
  })
})

describe('renderCaptionWords — captions without word timings', () => {
  const plain = { start: 1, end: 2, text: 'a b c', words: [] } as any
  it('splits the text into words spanning the whole caption', () => {
    const out = renderCaptionWords(plain, 1.5, 'normal')
    expect(out.map((w) => w.text)).toEqual(['a', 'b', 'c'])
    expect(out.every((w) => w.visible)).toBe(true)
  })
  it('word-driven modes animate via distributed fallback timings (bugfix 2026-07-09)', () => {
    // Captions without word timings now get distributeWords() fallback times
    // and the active index is computed over them, so one-word / progressive /
    // karaoke behave like the import path. 'a b c' over [1,2]: equal weights
    // → word bounds 1 | 1⅓ | 1⅔ | 2; t=1.5 lands inside word 1.
    expect(
      renderCaptionWords(plain, 1.5, 'one-word').map((w) => w.visible)
    ).toEqual([false, true, false])
    expect(
      renderCaptionWords(plain, 1.5, 'progressive').map((w) => w.visible)
    ).toEqual([true, true, false])
    expect(
      renderCaptionWords(plain, 1.5, 'karaoke').map((w) => w.active)
    ).toEqual([false, true, false])
  })

  it('degenerate caption (end <= start) still shows its text statically', () => {
    const broken = { start: 2, end: 2, text: 'hi there', words: [] } as any
    const out = renderCaptionWords(broken, 2, 'normal')
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('hi there')
    expect(out[0].visible).toBe(true)
  })
})

describe('subtitleContainerStyle', () => {
  it('defaults: bottom-center with 40px margins', () => {
    const s = subtitleContainerStyle(undefined, 1920, 1080)
    expect(s.position).toBe('absolute')
    expect(s.bottom).toBe('40px')
    expect(s.left).toBe('40px')
    expect(s.right).toBe('40px')
    expect(s.justifyContent).toBe('center')
    expect(s.top).toBeUndefined()
  })
  it('top-left maps to top margin + flex-start', () => {
    const s = subtitleContainerStyle(
      { position: 'top-left', marginV: 10, marginH: 20 },
      1920,
      1080
    )
    expect(s.top).toBe('10px')
    expect(s.left).toBe('20px')
    expect(s.justifyContent).toBe('flex-start')
    expect(s.bottom).toBeUndefined()
  })
  it('center rows vertically center via translateY', () => {
    const s = subtitleContainerStyle({ position: 'center-right' }, 1920, 1080)
    expect(s.top).toBe('50%')
    expect(s.transform).toBe('translateY(-50%)')
    expect(s.justifyContent).toBe('flex-end')
  })
  it('bottom-right keeps the bottom edge with flex-end', () => {
    const s = subtitleContainerStyle({ position: 'bottom-right', marginV: 64 }, 1920, 1080)
    expect(s.bottom).toBe('64px')
    expect(s.justifyContent).toBe('flex-end')
  })
})

describe('subtitleTextStyle', () => {
  it('defaults: Poppins 48px, regular, white, no box', () => {
    const s = subtitleTextStyle(undefined)
    expect(s.fontFamily).toBe("'Poppins', sans-serif")
    expect(s.fontSize).toBe('48px')
    expect(s.fontWeight).toBe('400')
    expect(s.fontStyle).toBe('normal')
    expect(s.color).toBe('#ffffff')
    expect(s.background).toBeUndefined()
    expect(s.padding).toBeUndefined()
  })
  it('bold/italic/transform/custom color', () => {
    const s = subtitleTextStyle({
      fontFamily: 'Montserrat',
      fontSize: 86,
      isBold: true,
      isItalic: true,
      color: '#f3efa2',
      textTransform: 'uppercase',
    })
    expect(s.fontFamily).toBe("'Montserrat', sans-serif")
    expect(s.fontSize).toBe('86px')
    expect(s.fontWeight).toBe('700')
    expect(s.fontStyle).toBe('italic')
    expect(s.color).toBe('#f3efa2')
    expect(s.textTransform).toBe('uppercase')
  })
  it('background box: font-proportional padding, square by default', () => {
    const s = subtitleTextStyle({ background: '#202020', fontSize: 50 })
    expect(s.background).toBe('#202020')
    expect(s.padding).toBe('6px 15px') // round(50·0.12), round(50·0.3)
    expect(s.borderRadius).toBe('0px')
  })
  it('explicit backgroundPadding/backgroundRadius win', () => {
    const s = subtitleTextStyle({
      background: '#000',
      backgroundPadding: 12,
      backgroundRadius: 8,
    })
    expect(s.padding).toBe('12px')
    expect(s.borderRadius).toBe('8px')
  })
})

describe('subtitleStrokeStyle', () => {
  it('null without an outline or with width 0', () => {
    expect(subtitleStrokeStyle(undefined)).toBeNull()
    expect(subtitleStrokeStyle({})).toBeNull()
    expect(subtitleStrokeStyle({ outline: { width: 0, color: '#000' } })).toBeNull()
  })
  it('doubles the width (centered stroke → width px visible outside)', () => {
    const s = subtitleStrokeStyle({ outline: { width: 3, color: '#112233' } })!
    expect(s.color).toBe('#112233')
    expect(s['-webkit-text-stroke']).toBe('6px #112233')
  })
  it('outline color defaults to black', () => {
    const s = subtitleStrokeStyle({ outline: { width: 2 } })!
    expect(s['-webkit-text-stroke']).toBe('4px #000000')
  })
})
