import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { textFontStack, fontSample, referencedTextFamilies, textFontCssUrls, textFontCss, textFontHtml } from '../../shared/textFontPolicy'
import { buildIframeDoc } from '../../utils/textTemplate'

describe('multilingual TEXT fonts', () => {
  it('keeps individual author stack members in order, before script fallbacks', () => {
    expect(textFontStack('Noto Sans Arabic, Noto Sans SC, sans-serif', 'مرحبا 世界'))
      .toBe("'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans', sans-serif")
    expect(textFontStack('Poppins', 'שלום мир')).toContain("'Noto Sans Hebrew', 'Noto Sans'")
  })
  it('never caps away script coverage when an author specifies four fonts', () => {
    const list = referencedTextFamilies('Inter, Roboto, Poppins, Lobster', 'বাংলা 日本語')
    expect(list).toContain('Noto Sans Bengali')
    expect(list).toContain('Noto Sans SC')
    expect(list).toContain('Noto Sans')
  })
  it('handles quoted stacks in markup and decodes numeric entities for script detection', () => {
    expect(fontSample(null, '<b>&#x0627;&#20013;</b>')).toBe('ا中')
    expect(referencedTextFamilies('Poppins', 'مرحبا 世界', `<b style='font-family: "Noto Sans Arabic", "Noto Sans SC"'>x</b>`))
      .toEqual(['Poppins', 'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans'])
  })
  it('provides bounded fallbacks when the selected family lacks italic styles', () => {
    const urls = textFontCssUrls('Noto Sans Arabic')
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain(':ital,wght@')
    expect(urls[1]).toContain(':wght@')
    expect(urls[2]).toBe('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic&display=swap')
  })
  it('allows HTML first-strong bidi detection while preserving explicit CSS direction', () => {
    const doc = buildIframeDoc({ text: 'السعر 123 USD', style: { direction: 'ltr' } })
    expect(doc).toContain('dir="auto"')
    expect(doc).toContain('direction: ltr;')
  })
  it('preserves plain-text line breaks without changing authored HTML whitespace', () => {
    expect(buildIframeDoc({ text: 'こんにちは\n世界' })).toContain('white-space: pre-wrap;')
    expect(buildIframeDoc({ html: '<span>こんにちは\n世界</span>' })).not.toContain('white-space: pre-wrap;')
    const overridden = buildIframeDoc({ text: 'こんにちは\n世界', style: { whiteSpace: 'normal' } })
    expect(overridden.indexOf('white-space: normal;')).toBeGreaterThan(overridden.indexOf('white-space: pre-wrap;'))
  })
  it('does not let family names escape a CSS style block', () => {
    const css = textFontStack("Bad'</style><script>alert(1)</script>", 'x')
    expect(css).not.toContain('</style>')
    expect(css).not.toContain('<script>')
    expect(css).toContain("Bad\\'")
  })
  it('extends nested and scoped declarations while preserving author order and importance', () => {
    const html = textFontHtml(`<span style='font-family: "Poppins", "Noto Sans Arabic" !important; color:red'>مرحبا 世界</span>`)
    expect(html).toContain("font-family: 'Poppins', 'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans', sans-serif !important;")
    expect(html).toContain('color:red')
    expect(textFontHtml(html)).toBe(html)
    const css = textFontCss('.specific { font-family: Poppins; font-size:38px }', 'مرحبا 世界')
    expect(css).toContain("font-family: 'Poppins', 'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans', sans-serif;")
    expect(css).toContain('font-size:38px')
  })
  it('leaves strings, comments, font-face names, CSS variables and shorthand semantics intact', () => {
    for (const css of [
      '/* font-family: Poppins */ .x { content: "font-family: Poppins"; }',
      '@font-face {font-family: Mine; src:url(mine.woff2)}',
      '.x { font-family:var(--brand-font); font-family:inherit; font:italic 38px Poppins }',
      '.x { --custom: font-family:Poppins; font-family:Poppins /* author comment */ }',
      '.x { font-family:Noto\\ Sans; }',
      '@supports (font-family:Poppins) { .x { color:red } }',
    ]) expect(textFontCss(css, 'مرحبا 世界')).toBe(css)
    expect(textFontHtml('<span title="font-family:Poppins">مرحبا</span>'))
      .toBe('<span title="font-family:Poppins">مرحبا</span>')
    for (const html of [
      '<span style="color:&#35;fff">مرحبا</span>',
      '<span style="font-family:Poppins;color:&#x23;fff">مرحبا</span>',
      "<span style='color:white'>مرحبا</span>",
    ]) expect(textFontHtml(html)).toBe(html)
  })
  it('uses the same font policy in the renderer and editor', () => {
    const normalize = (value: string) => value.replace(/import[\s\S]*?from.*?;?\r?\n/g, '').replace(/\/\*\* Mirrored.*?\*\//s, '').replace(/\s+/g, '')
    expect(normalize(readFileSync(new URL('../../shared/textFontPolicy.ts', import.meta.url), 'utf8')))
      .toBe(normalize(readFileSync(new URL('../../../package/src/lib/texts/fontPolicy.ts', import.meta.url), 'utf8')))
  })
})
