import { describe, it, expect } from 'vitest'
import {
  makeDesign,
  makeTextLayer,
  makeShapeLayer,
  makeImageLayer,
  normalizeDesign,
} from '../utils/designer/types'
import {
  compileDesign,
  designToItemPatch,
  splitTextHtml,
  autoDuration,
} from '../utils/designer/compile'
import { ANIM_PRESETS, ANIM_GROUPS } from '../utils/designer/animations'
import { SHAPES, SHAPE_GROUPS, shapePreviewSvg } from '../utils/designer/shapes'
import { DESIGN_TEMPLATES } from '../utils/designer/templates'

/** The package's customCode CSS sanitizer rules (sanitizeCustomCode.ts). */
const FORBIDDEN_CSS = [
  /@import\b/i,
  /\burl\(\s*['"]?\s*(?!data:)[a-z][a-z0-9+.-]*:/i,
  /\burl\(\s*['"]?\s*\/\//i,
  /expression\s*\(/i,
  /-moz-binding\b/i,
  /javascript\s*:/i,
  /<\/?\s*(script|style)\b/i,
]

function expectSanitizerSafe(css: string) {
  for (const pattern of FORBIDDEN_CSS) {
    expect(css).not.toMatch(pattern)
  }
}

describe('splitTextHtml', () => {
  it('splits letters into indexed spans grouped by word', () => {
    const { html, count } = splitTextHtml('Hi yo', 'letter')
    expect(count).toBe(4)
    expect(html).toContain('--i:0')
    expect(html).toContain('--i:3')
    expect(html.match(/dz-w/g)?.length).toBe(2)
    expect(html.match(/dz-c/g)?.length).toBe(4)
  })

  it('splits words and keeps newlines as <br>', () => {
    const { html, count } = splitTextHtml('one two\nthree', 'word')
    expect(count).toBe(3)
    expect(html).toContain('<br>')
    expect(html.match(/dz-c/g)?.length).toBe(3)
  })

  it('escapes markup in text content', () => {
    const { html } = splitTextHtml('<b>&', 'none')
    expect(html).toBe('&lt;b&gt;&amp;')
    const split = splitTextHtml('<x>', 'letter')
    expect(split.html).not.toContain('<x>')
    expect(split.html).toContain('&lt;')
  })

  it('keeps {{placeholders}} contiguous through letter splitting', () => {
    const { html, count } = splitTextHtml('Hi {{name}}!', 'letter')
    // H, i, {{name}}, ! → 4 stagger units; the placeholder is ONE span
    expect(count).toBe(4)
    expect(html).toContain('>{{name}}</span>')
    expect(html.match(/dz-c/g)?.length).toBe(4)
  })

  it('keeps {{placeholders}} contiguous through word splitting', () => {
    const { html, count } = splitTextHtml('by {{item.author}}', 'word')
    expect(count).toBe(2)
    expect(html).toContain('>{{item.author}}</span>')
  })

  it('normalizes inner whitespace so spaced placeholders survive word mode', () => {
    const { html } = splitTextHtml('hello {{ name }}', 'word')
    expect(html).toContain('>{{name}}</span>')
    expect(html).not.toContain('>{{<')
  })

  it('leaves placeholders raw in none mode', () => {
    const { html } = splitTextHtml('Hi {{name}}', 'none')
    expect(html).toBe('Hi {{name}}')
  })
})

describe('autoDuration', () => {
  it('rounds up to a whole number of loop periods', () => {
    // entrance ends at 2.2s (+0.5 grace) → next multiple of 1.2 ≥ 2.7 = 3.6
    expect(autoDuration(2.2, 1.2)).toBe(3.6)
  })
  it('uses a sensible floor without animations input', () => {
    expect(autoDuration(0, 0)).toBe(1.5)
  })
  it('never exceeds the package cap of 15s', () => {
    expect(autoDuration(30, 8)).toBe(15)
  })
})

describe('compileDesign', () => {
  it('compiles a full design with namespaced classes and unique keyframes', () => {
    const design = makeDesign({
      background: { kind: 'gradient', color: '#000', from: '#111', to: '#222', angle: 90, radius: 12 },
      layers: [
        makeTextLayer({
          text: 'Hello world',
          anim: { preset: 'letter-pop', duration: 0.4, delay: 0, stagger: 0.05, easing: 'smooth', dir: 'up' },
        }),
        makeShapeLayer({
          shape: 'star',
          anim: { preset: 'spin', duration: 4, delay: 0, stagger: 0, easing: 'smooth', dir: 'up' },
        }),
      ],
    })
    const out = compileDesign(design)
    expect(out.html).toContain('class="dz"')
    expect(out.html).toContain('dz-bg')
    expect(out.html).toContain('dz-l0')
    expect(out.html).toContain('dz-l1')
    expect(out.css).toContain('@keyframes dz0')
    expect(out.css).toContain('@keyframes dz1')
    expect(out.animated).toBe(true)
    expect(out.warnings).toEqual([])
    expectSanitizerSafe(out.css)
  })

  it('derives auto duration from entrance end and loop periods', () => {
    const design = makeDesign({
      layers: [
        makeTextLayer({
          text: 'ab', // 2 letters
          anim: { preset: 'rise', duration: 0.5, delay: 0.2, stagger: 0.1, easing: 'smooth', dir: 'up' },
        }),
        makeShapeLayer({
          anim: { preset: 'pulse', duration: 2, delay: 0, stagger: 0, easing: 'smooth', dir: 'up' },
        }),
      ],
    })
    // entrance ends 0.2+0.5+0.1 = 0.8 (+0.5 grace) → next multiple of 2 = 2
    expect(compileDesign(design).duration).toBe(2)
  })

  it('respects a pinned loop duration and clamps to 15s', () => {
    const design = makeDesign({ duration: 99, layers: [makeTextLayer()] })
    expect(compileDesign(design).duration).toBe(15)
  })

  it('skips hidden layers and warns on empty image urls', () => {
    const design = makeDesign({
      layers: [
        makeTextLayer({ hidden: true }),
        makeImageLayer({ name: 'Photo' }),
      ],
    })
    const out = compileDesign(design)
    expect(out.html).not.toContain('dz-l1')
    expect(out.warnings.some((w) => w.includes('Photo'))).toBe(true)
  })

  it('escapes attribute-breaking characters in image urls', () => {
    const design = makeDesign({
      layers: [makeImageLayer({ src: 'https://x.test/a.png" onerror="alert(1)' })],
    })
    const out = compileDesign(design)
    expect(out.html).not.toContain('onerror="alert')
    expect(out.html).toContain('&quot;')
  })

  it('renders gradient fills per glyph for split-text animations', () => {
    const design = makeDesign({
      layers: [
        makeTextLayer({
          text: 'Go',
          fill: { kind: 'gradient', from: '#f00', to: '#00f', angle: 90 },
          anim: { preset: 'wave', duration: 1.2, delay: 0, stagger: 0.08, easing: 'smooth', dir: 'up' },
        }),
      ],
    })
    const out = compileDesign(design)
    expect(out.css).toContain('.dz-l0 .dz-c { background-image: linear-gradient(90deg, #f00, #00f)')
  })

  it('produces static designs (no animation) with a short capture loop', () => {
    const out = compileDesign(makeDesign({ layers: [makeTextLayer()] }))
    expect(out.animated).toBe(false)
    expect(out.duration).toBe(0.5)
  })
})

describe('every animation preset', () => {
  for (const preset of Object.values(ANIM_PRESETS)) {
    it(`"${preset.id}" compiles to sanitizer-safe css with its keyframes bound`, () => {
      const layer =
        preset.textOnly || preset.split
          ? makeTextLayer({ text: 'Hey there' })
          : makeShapeLayer()
      layer.anim = {
        preset: preset.id,
        duration: preset.defaults.duration,
        delay: 0.1,
        stagger: preset.defaults.stagger ?? 0.06,
        easing: 'overshoot',
        dir: 'left',
      }
      const out = compileDesign(makeDesign({ layers: [layer] }))
      expect(out.css).toContain('@keyframes dz0')
      expect(out.css).toContain('animation')
      expect(out.animated).toBe(true)
      expect(out.duration).toBeGreaterThan(0)
      expect(out.duration).toBeLessThanOrEqual(15)
      expectSanitizerSafe(out.css)
    })
  }
})

describe('every shape', () => {
  for (const [key, def] of Object.entries(SHAPES)) {
    it(`"${key}" compiles safely (solid + gradient)`, () => {
      for (const fill of [
        { kind: 'solid' as const, color: '#3ecf8e' },
        { kind: 'gradient' as const, from: '#f00', to: '#00f', angle: 45 },
      ]) {
        const out = compileDesign(
          makeDesign({ layers: [makeShapeLayer({ shape: key, fill })] })
        )
        expectSanitizerSafe(out.css)
        if (def.kind === 'svg') {
          expect(out.html).toContain('<svg')
          expect(out.html).not.toContain('href')
        }
      }
    })
  }
})

describe('registry integrity', () => {
  it('every shape belongs to a picker group and renders a preview', () => {
    for (const [key, def] of Object.entries(SHAPES)) {
      expect(SHAPE_GROUPS, `shape "${key}" group "${def.group}"`).toContain(def.group)
      expect(shapePreviewSvg(key)).toMatch(/<svg|<span/)
    }
  })

  it('every animation preset belongs to a picker group and has a unique id', () => {
    const ids = new Set<string>()
    for (const [key, p] of Object.entries(ANIM_PRESETS)) {
      expect(ANIM_GROUPS, `preset "${key}" group "${p.group}"`).toContain(p.group)
      expect(p.id).toBe(key)
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
    }
  })

  it('meets the library size goals (200+ new shapes, expanded animations)', () => {
    expect(Object.keys(SHAPES).length).toBeGreaterThanOrEqual(229)
    expect(Object.keys(ANIM_PRESETS).length).toBeGreaterThanOrEqual(70)
  })
})

describe('templates', () => {
  for (const t of DESIGN_TEMPLATES) {
    it(`"${t.id}" builds, compiles safely and stays within the loop cap`, () => {
      const design = t.make()
      const out = compileDesign(design)
      expect(out.warnings).toEqual([])
      expect(out.duration).toBeLessThanOrEqual(15)
      expect(out.animated).toBe(true)
      expectSanitizerSafe(out.css)
      // fresh ids per call — inserting a template twice must not share ids
      const again = t.make()
      const ids = new Set(design.layers.map((l) => l.id))
      for (const l of again.layers) expect(ids.has(l.id)).toBe(false)
    })
  }
})

describe('designToItemPatch', () => {
  it('maps a design onto TEXT-item fields with round-trippable source', () => {
    const design = DESIGN_TEMPLATES[0].make()
    const patch = designToItemPatch(design)
    expect(patch.text).toBeUndefined()
    expect(patch.html).toContain('class="dz"')
    expect(patch.style).toEqual({ fontFamily: design.fontFamily })
    expect(patch.customCode.css.length).toBeGreaterThan(0)
    expect(patch.customCode.animationDuration).toBeGreaterThan(0)
    expect(patch.width).toBe(design.width)
    expect(patch.height).toBe(design.height)
    // designer source survives and re-normalizes to an equivalent doc
    const restored = normalizeDesign(patch.designer)
    expect(restored.layers.length).toBe(design.layers.length)
    expect(compileDesign(restored).html).toBe(patch.html)
  })
})
