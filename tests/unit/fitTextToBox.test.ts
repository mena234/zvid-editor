/**
 * utils/fitTextToBox.ts — editor port of package/src/lib/texts/fitTextToBox.ts.
 *
 * Vitest runs in node here (no jsdom in the project), so `fitRoutine` is driven
 * against a hand-built fake element plus stubbed DOM globals. That is enough to
 * pin the parts that matter: the no-op path must not touch a single property,
 * and the search must land on the same factor the renderer would pick.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  wantsFit,
  fitBoxOf,
  fitActiveFor,
  fitRoutine,
  applyFitFactor,
  applyRendererWhiteSpace,
  rendererWhiteSpaceFor,
  measureFitFactor,
  fitScriptSource,
  FIT_MIN_SCALE,
  RENDERER_WHITE_SPACE,
} from '../../utils/fitTextToBox'

/* ------------------------------- fake DOM -------------------------------- */

function fakeStyle() {
  const props = new Map<string, { value: string; priority: string }>()
  return {
    props,
    getPropertyValue: (p: string) => props.get(p)?.value ?? '',
    getPropertyPriority: (p: string) => props.get(p)?.priority ?? '',
    setProperty: (p: string, v: string, priority = '') =>
      props.set(p, { value: v, priority }),
    removeProperty: (p: string) => props.delete(p),
  }
}

/**
 * A container whose single text line is `naturalWidth` wide at the authored
 * 42px and scales linearly with the applied font-size — i.e. an overflow that
 * shrinking actually fixes.
 */
function fakeContainer(naturalWidth: number, naturalHeight = 50) {
  const style = fakeStyle()
  const container: any = { style, querySelectorAll: () => [] }
  const currentFactor = () => {
    const fs = style.props.get('font-size')?.value
    return fs ? parseFloat(fs) / 42 : 1
  }
  const rect = () => ({
    left: 0,
    top: 0,
    width: naturalWidth * currentFactor(),
    height: naturalHeight * currentFactor(),
  })
  const textNode = { nodeValue: 'Hello world', parentElement: container }

  vi.stubGlobal('getComputedStyle', () => ({
    fontSize: style.props.get('font-size')?.value ?? '42px',
    lineHeight: style.props.get('line-height')?.value ?? 'normal',
    letterSpacing: 'normal',
    wordSpacing: 'normal',
    fontStyle: 'normal',
    fontWeight: '400',
    fontFamily: 'Poppins',
  }))
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 })
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => null }),
    createTreeWalker: () => {
      let done = false
      return {
        nextNode: () => {
          if (done) return null
          done = true
          return textNode
        },
      }
    },
    createRange: () => ({
      selectNodeContents: () => {},
      getClientRects: () => [rect()],
      getBoundingClientRect: () => rect(),
    }),
  })
  return { container, style }
}

const OPTS = {
  minScale: FIT_MIN_SCALE,
  epsilon: 0.5,
  steps: 6,
  minImprovement: 0.8,
  originLeft: 0,
  originTop: 0,
}

afterEach(() => vi.unstubAllGlobals())

/* --------------------------------- opt-in -------------------------------- */

describe('wantsFit / fitBoxOf / fitActiveFor', () => {
  it('is TEXT-only and opt-in', () => {
    expect(wantsFit({ type: 'TEXT', fitToBox: true })).toBe(true)
    expect(wantsFit({ type: 'text', fitToBox: true })).toBe(true)
    expect(wantsFit({ type: 'TEXT' })).toBe(false)
    expect(wantsFit({ type: 'TEXT', fitToBox: false })).toBe(false)
    expect(wantsFit({ type: 'IMAGE', fitToBox: true })).toBe(false)
    expect(wantsFit({ type: 'SVG', fitToBox: true })).toBe(false)
    expect(wantsFit(null)).toBe(false)
  })

  it('only positive numeric axes count as a declared box', () => {
    expect(fitBoxOf({ width: 300, height: 100 })).toEqual({
      width: 300,
      height: 100,
    })
    expect(fitBoxOf({ width: 0, height: -5 })).toEqual({
      width: null,
      height: null,
    })
    expect(fitBoxOf({ width: '{{w}}' })).toEqual({ width: null, height: null })
  })

  it('needs both the opt-in and at least one declared axis', () => {
    expect(fitActiveFor({ type: 'TEXT', fitToBox: true, width: 300 })).toBe(true)
    expect(fitActiveFor({ type: 'TEXT', fitToBox: true, height: 90 })).toBe(true)
    expect(fitActiveFor({ type: 'TEXT', fitToBox: true })).toBe(false)
    expect(fitActiveFor({ type: 'TEXT', width: 300 })).toBe(false)
  })
})

/* -------------------------------- routine -------------------------------- */

describe('fitRoutine', () => {
  it('is a no-op when the content already fits (factor 1, nothing written)', () => {
    const { container, style } = fakeContainer(180)
    const factor = fitRoutine(container, { ...OPTS, width: 300, height: 100 })
    expect(factor).toBe(1)
    expect([...style.props.keys()]).toEqual([])
  })

  it('is a no-op when no box is declared', () => {
    const { container, style } = fakeContainer(4000)
    expect(fitRoutine(container, { ...OPTS, width: null, height: null })).toBe(1)
    expect([...style.props.keys()]).toEqual([])
  })

  it('is a no-op without a container', () => {
    expect(fitRoutine(null, { ...OPTS, width: 300, height: 100 })).toBe(1)
  })

  it('sub-pixel overflow is rounding, not a cut', () => {
    const { container, style } = fakeContainer(300.4)
    expect(fitRoutine(container, { ...OPTS, width: 300, height: 400 })).toBe(1)
    expect([...style.props.keys()]).toEqual([])
  })

  it('shrinks to the largest fitting factor and marks it important', () => {
    const { container, style } = fakeContainer(400)
    const factor = fitRoutine(container, { ...OPTS, width: 300, height: 400 })
    expect(factor).toBe(0.75) // 300/400, found by the 6-step search
    expect(style.props.get('font-size')).toEqual({
      value: `${42 * 0.75}px`,
      priority: 'important',
    })
  })

  it('never goes below the 0.5 floor', () => {
    const { container } = fakeContainer(600)
    // needs 0.25× to fit, but 0.5× already improves enough to be worth applying
    expect(fitRoutine(container, { ...OPTS, width: 150, height: 4000 })).toBe(
      FIT_MIN_SCALE
    )
  })

  it('leaves a non-scaling overflow alone (shrinking would not fix it)', () => {
    const style = fakeStyle()
    const container: any = { style, querySelectorAll: () => [] }
    const textNode = { nodeValue: 'x', parentElement: container }
    // a rect that ignores the font-size = a fixed offset, not type overflow
    const rect = { left: 0, top: 0, width: 900, height: 20 }
    vi.stubGlobal('getComputedStyle', () => ({
      fontSize: style.props.get('font-size')?.value ?? '42px',
      lineHeight: 'normal',
      letterSpacing: 'normal',
      wordSpacing: 'normal',
      fontStyle: 'normal',
      fontWeight: '400',
      fontFamily: 'Poppins',
    }))
    vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 })
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => null }),
      createTreeWalker: () => {
        let done = false
        return {
          nextNode: () => {
            if (done) return null
            done = true
            return textNode
          },
        }
      },
      createRange: () => ({
        selectNodeContents: () => {},
        getClientRects: () => [rect],
        getBoundingClientRect: () => rect,
      }),
    })
    expect(fitRoutine(container, { ...OPTS, width: 300, height: 400 })).toBe(1)
    expect([...style.props.keys()]).toEqual([]) // restored, not left at 0.5×
  })
})

/* ------------------------------ apply/restore ----------------------------- */

describe('applyFitFactor', () => {
  it('factor 1 writes nothing (an unaffected item renders as before)', () => {
    const style = fakeStyle()
    const el: any = { style, querySelectorAll: () => [] }
    vi.stubGlobal('getComputedStyle', () => ({
      fontSize: '42px',
      lineHeight: '50px',
      letterSpacing: 'normal',
      wordSpacing: 'normal',
    }))
    applyFitFactor(el, 1)
    expect([...style.props.keys()]).toEqual([])
  })

  it('scales the four type metrics, then restores the author declarations', () => {
    const style = fakeStyle()
    style.setProperty('font-size', '60px', '')
    const el: any = { style, querySelectorAll: () => [] }
    vi.stubGlobal('getComputedStyle', () => ({
      fontSize: '60px',
      lineHeight: '80px',
      letterSpacing: 'normal',
      wordSpacing: 'normal',
    }))
    applyFitFactor(el, 0.5)
    expect(style.props.get('font-size')).toEqual({
      value: '30px',
      priority: 'important',
    })
    expect(style.props.get('line-height')).toEqual({
      value: '40px',
      priority: 'important',
    })
    expect(style.props.has('letter-spacing')).toBe(false) // 'normal' stays normal

    applyFitFactor(el, 1)
    expect(style.props.get('font-size')).toEqual({ value: '60px', priority: '' })
    expect(style.props.has('line-height')).toBe(false)
  })

  it('does not resurrect a stale value over a foreign write (Vue re-patch)', () => {
    const style = fakeStyle()
    style.setProperty('font-size', '60px', '')
    const el: any = { style, querySelectorAll: () => [] }
    vi.stubGlobal('getComputedStyle', () => ({
      fontSize: '60px',
      lineHeight: 'normal',
      letterSpacing: 'normal',
      wordSpacing: 'normal',
    }))
    applyFitFactor(el, 0.5)
    // the style binding re-renders with a new authored size
    style.setProperty('font-size', '90px', '')
    applyFitFactor(el, 1)
    expect(style.props.get('font-size')).toEqual({ value: '90px', priority: '' })
  })
})

describe('measureFitFactor', () => {
  it('returns 1 with no document (SSR) and never calls the mount hook', () => {
    const mount = vi.fn()
    expect(measureFitFactor(mount, { width: 300, height: 100 })).toBe(1)
    expect(mount).not.toHaveBeenCalled()
  })

  it('hands the mount hook a host that inherits the renderer white-space', () => {
    const host: any = {
      style: {},
      setAttribute: () => {},
      remove: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    }
    vi.stubGlobal('document', {
      body: { appendChild: () => {} },
      createElement: () => host,
    })
    const mount = vi.fn(() => null)
    expect(measureFitFactor(mount, { width: 300, height: 100 })).toBe(1)
    expect(mount).toHaveBeenCalledWith(host)
    // the capture page declares no white-space, so the probe must not inherit
    // the editor page's — `.text-inner`'s pre-wrap is what made the two disagree
    expect(host.style.cssText).toContain(`white-space:${RENDERER_WHITE_SPACE}`)
    expect(host.remove).toHaveBeenCalled()
  })
})

/* --------------------------- renderer white-space -------------------------- */

/**
 * The renderer's capture page sets no `white-space`, so `.container` resolves
 * `normal` unless the item's own style declares otherwise. The editor paints
 * TEXT through `.text-inner { white-space: pre-wrap }`; measuring under that
 * reads whitespace runs as ink and shrinks further than the render does.
 */
describe('rendererWhiteSpaceFor / applyRendererWhiteSpace', () => {
  it('is `normal` unless the item declares its own value', () => {
    expect(rendererWhiteSpaceFor(undefined)).toBe('normal')
    expect(rendererWhiteSpaceFor({})).toBe('normal')
    expect(rendererWhiteSpaceFor({ style: {} })).toBe('normal')
    expect(rendererWhiteSpaceFor({ style: { whiteSpace: '  ' } })).toBe('normal')
    expect(rendererWhiteSpaceFor({ style: { whiteSpace: 42 } })).toBe('normal')
    expect(rendererWhiteSpaceFor({ style: { whiteSpace: ' pre-wrap ' } })).toBe(
      'pre-wrap'
    )
    expect(rendererWhiteSpaceFor({ style: { whiteSpace: 'nowrap' } })).toBe(
      'nowrap'
    )
    // buildHtmlContent kebab-cases the style keys, so both spellings reach the
    // renderer's .container rule
    expect(rendererWhiteSpaceFor({ style: { 'white-space': 'pre' } })).toBe('pre')
  })

  it('pins the measured copy to `normal`, over the .text-inner class rule', () => {
    const style = fakeStyle()
    applyRendererWhiteSpace({ style } as any, {
      type: 'TEXT',
      style: { fontSize: '42px' },
    })
    expect(style.props.get('white-space')).toEqual({
      value: 'normal',
      priority: 'important',
    })
  })

  it('keeps a white-space the item declares — the renderer writes it too', () => {
    const style = fakeStyle()
    applyRendererWhiteSpace({ style } as any, {
      type: 'TEXT',
      style: { whiteSpace: 'pre-wrap' },
    })
    expect(style.props.get('white-space')).toEqual({
      value: 'pre-wrap',
      priority: 'important',
    })
  })

  it('is a no-op without an element (fitting is an enhancement)', () => {
    expect(() => applyRendererWhiteSpace(null, { style: {} })).not.toThrow()
    expect(() => applyRendererWhiteSpace(undefined)).not.toThrow()
  })
})

/* ------------------------------ iframe script ----------------------------- */

describe('fitScriptSource', () => {
  it('serializes the routine with the declared box and package constants', () => {
    const src = fitScriptSource({ width: 300, height: 120 })
    expect(src).toContain("document.querySelector('.container')")
    expect(src).toContain('"width":300')
    expect(src).toContain('"height":120')
    expect(src).toContain(`"minScale":${FIT_MIN_SCALE}`)
    // the real routine, not a stub: these markers are the ink measurement
    expect(src).toContain('actualBoundingBoxAscent')
    expect(src).toContain('createTreeWalker')
    expect(src).toContain('font-size')
    expect(src).toContain('catch(e){console.error(e)}')
  })
})
