/**
 * utils/textTemplate.ts (iframe doc builder), utils/snippets.ts (automation
 * handoff snippets), utils/effectMeta.ts (gallery labels) and
 * utils/fonts.ts googleFontCssUrl (pure URL builder).
 */
import { describe, it, expect } from 'vitest'
import {
  styleObjectToCss,
  buildIframeDoc,
  escapeHtml,
} from '../../utils/textTemplate'
import { nodeSnippet, cliSnippet, fetchSnippet } from '../../utils/snippets'
import { effectLabel } from '../../utils/effectMeta'
import { googleFontCssUrl } from '../../utils/fonts'

/* ------------------------------ textTemplate ----------------------------- */

describe('styleObjectToCss', () => {
  it('returns an empty string for undefined', () => {
    expect(styleObjectToCss(undefined)).toBe('')
  })
  it('kebab-cases camelCase keys', () => {
    expect(styleObjectToCss({ fontSize: '48px', backgroundColor: 'red' })).toBe(
      'font-size: 48px;\nbackground-color: red;'
    )
  })
  it('filters out fontFamily (handled by the font link/container rule)', () => {
    expect(styleObjectToCss({ fontFamily: 'Inter', color: 'red' })).toBe(
      'color: red;'
    )
  })
  it('null/undefined values become empty lines (current behavior)', () => {
    expect(styleObjectToCss({ color: null, fontSize: '48px' })).toBe(
      '\nfont-size: 48px;'
    )
  })
  it('passes through already-kebab and numeric values', () => {
    expect(styleObjectToCss({ 'line-height': 1.2 })).toBe('line-height: 1.2;')
  })
})

describe('escapeHtml', () => {
  it('escapes & < > but not quotes', () => {
    expect(escapeHtml('<b> & "q" \'s\'')).toBe('&lt;b&gt; &amp; "q" \'s\'')
  })
  it('escapes & first (no double-escaping)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('buildIframeDoc', () => {
  it('text mode: escaped text, default font + default font size, fit-content', () => {
    const doc = buildIframeDoc({ text: '<hi & bye>' })
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain(`href="${googleFontCssUrl('Poppins')}"`)
    expect(doc).toContain("font-family: 'Poppins', sans-serif;")
    expect(doc).toContain('font-size: 42px;') // TEXT_DEFAULT_FONT_SIZE
    expect(doc).toContain('width: fit-content;')
    expect(doc).toContain('<div class="container">&lt;hi &amp; bye&gt;</div>')
  })
  it('explicit style/size: custom family link, style props, px box', () => {
    const doc = buildIframeDoc({
      text: 'x',
      style: { fontFamily: 'Inter', fontSize: '30px', color: '#fff' },
      width: 300,
      height: 150,
    })
    expect(doc).toContain(`href="${googleFontCssUrl('Inter')}"`)
    expect(doc).toContain("font-family: 'Inter', sans-serif;")
    expect(doc).toContain('font-size: 30px;')
    expect(doc).toContain('color: #fff;')
    expect(doc).toContain('width: 300px;')
    expect(doc).toContain('height: 150px;')
    expect(doc).not.toContain('fit-content')
    expect(doc).not.toContain('font-size: 42px;')
  })
  it('html mode: markup is injected raw (not escaped)', () => {
    const doc = buildIframeDoc({ html: '<em>hey</em>' })
    expect(doc).toContain('<div class="container"><em>hey</em></div>')
  })
  it('svg mode: raw svg body, svg sizing rule, no default font size', () => {
    const svg = '<svg viewBox="0 0 10 10"><rect/></svg>'
    const doc = buildIframeDoc({ svg })
    expect(doc).toContain(`<div class="container">${svg}</div>`)
    expect(doc).toContain('.container svg { display:block; width:100%; height:100%; }')
    expect(doc).not.toContain('font-size: 42px;')
  })
  it('svg wins over html which wins over text', () => {
    const doc = buildIframeDoc({ svg: '<svg/>', html: '<em>h</em>', text: 't' })
    expect(doc).toContain('<div class="container"><svg/></div>')
  })
  it('customCss and customJs are embedded (js wrapped in try/catch)', () => {
    const doc = buildIframeDoc({
      text: 'x',
      customCss: '.container { outline: 1px solid red; }',
      customJs: 'console.log(1)',
    })
    expect(doc).toContain('.container { outline: 1px solid red; }')
    expect(doc).toContain(
      '<script>try{console.log(1)}catch(e){console.error(e)}</script>'
    )
  })
  it('no script tag without customJs', () => {
    expect(buildIframeDoc({ text: 'x' })).not.toContain('<script>')
  })
})

/* -------------------------------- snippets ------------------------------- */

const PROJECT_JSON = `{
  "duration": 5,
  "scenes": []
}`

describe('nodeSnippet', () => {
  it('embeds the project JSON verbatim and calls zvid', () => {
    const s = nodeSnippet(PROJECT_JSON, 'promo')
    expect(s).toContain("import zvid from 'zvid'")
    expect(s).toContain(`const project = ${PROJECT_JSON}`)
    expect(s).toContain("await zvid(project, './output'")
    expect(s).toContain('result.localPath')
  })
})

describe('cliSnippet', () => {
  it('references the named JSON file and the render command', () => {
    const s = cliSnippet('promo')
    expect(s).toContain('(e.g. promo.json)')
    expect(s).toContain('npx zvid render promo.json --out ./dist')
  })
})

describe('fetchSnippet', () => {
  it('POSTs the project JSON with continuation lines indented by 2', () => {
    const s = fetchSnippet(PROJECT_JSON)
    expect(s).toContain("await fetch('https://YOUR-RENDER-API/render'")
    expect(s).toContain("method: 'POST'")
    // indent helper: first line unpadded, following lines +2 spaces
    expect(s).toContain('body: JSON.stringify({\n    "duration": 5,\n    "scenes": []\n  })')
    expect(s).toContain('const { videoUrl } = await res.json()')
  })
  it('single-line JSON passes through unchanged', () => {
    expect(fetchSnippet('{"a":1}')).toContain('body: JSON.stringify({"a":1})')
  })
})

/* ------------------------------- effectMeta ------------------------------ */

describe('effectLabel', () => {
  it('returns curated labels for known effects', () => {
    expect(effectLabel('fade')).toBe('Fade')
    expect(effectLabel('slideleft')).toBe('Slide ←')
    expect(effectLabel('wipetl')).toBe('Wipe ↖')
    expect(effectLabel('zoomin')).toBe('Zoom in')
    expect(effectLabel('fadegrays')).toBe('To gray')
  })
  it('humanizes unknown ids (camelCase split + capitalized)', () => {
    expect(effectLabel('crossZoom')).toBe('Cross Zoom')
    expect(effectLabel('melt')).toBe('Melt')
    expect(effectLabel('wave3d')).toBe('Wave 3d') // digit splits after a lowercase too
  })
})

/* --------------------------------- fonts --------------------------------- */

describe('googleFontCssUrl', () => {
  const SUFFIX =
    ':ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap'
  it('builds the css2 URL with the full weight axis', () => {
    expect(googleFontCssUrl('Poppins')).toBe(
      `https://fonts.googleapis.com/css2?family=Poppins${SUFFIX}`
    )
  })
  it('spaces become + (Google Fonts convention)', () => {
    expect(googleFontCssUrl('Open Sans')).toBe(
      `https://fonts.googleapis.com/css2?family=Open+Sans${SUFFIX}`
    )
  })
  it('trims surrounding whitespace', () => {
    expect(googleFontCssUrl('  Inter ')).toBe(
      `https://fonts.googleapis.com/css2?family=Inter${SUFFIX}`
    )
  })
})
