import { describe, expect, it } from 'vitest'
import { stretchSvgToBox } from '../../utils/svgMarkup'

describe('stretchSvgToBox', () => {
  it('adds free-axis viewBox scaling to the root SVG without mutating the source', () => {
    const source =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>'

    const preview = stretchSvgToBox(source)

    expect(preview).toContain(
      '<svg preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    )
    expect(source).not.toContain('preserveAspectRatio')
  })

  it('overrides an authored aspect-ratio mode so resized artwork fills its box', () => {
    const source =
      "<svg viewBox='0 0 100 50' preserveAspectRatio='xMidYMid meet'><rect/></svg>"

    const preview = stretchSvgToBox(source)

    expect(preview).toContain('preserveAspectRatio="none"')
    expect(preview).not.toContain('xMidYMid meet')
    expect(preview.match(/preserveAspectRatio/gi)).toHaveLength(1)
  })

  it('only changes the root SVG and leaves nested SVG behavior intact', () => {
    const source =
      '<svg viewBox="0 0 100 100"><svg preserveAspectRatio="xMinYMin meet"><rect/></svg></svg>'

    expect(stretchSvgToBox(source)).toBe(
      '<svg preserveAspectRatio="none" viewBox="0 0 100 100"><svg preserveAspectRatio="xMinYMin meet"><rect/></svg></svg>'
    )
  })

  it('ignores SVG-like markup inside XML comments before the real root', () => {
    const source =
      '<!-- <svg preserveAspectRatio="meet"> --><svg viewBox="0 0 10 10"><rect/></svg>'

    expect(stretchSvgToBox(source)).toBe(
      '<!-- <svg preserveAspectRatio="meet"> --><svg preserveAspectRatio="none" viewBox="0 0 10 10"><rect/></svg>'
    )
  })

  it('keeps quoted greater-than signs inside the complete root start tag', () => {
    const source =
      '<svg aria-label="1 > 0" viewBox="0 0 10 10"><rect/></svg>'

    expect(stretchSvgToBox(source)).toBe(
      '<svg preserveAspectRatio="none" aria-label="1 > 0" viewBox="0 0 10 10"><rect/></svg>'
    )
  })

  it('does not mistake attribute value text for preserveAspectRatio', () => {
    const source =
      '<svg data-note=\'preserveAspectRatio="meet"\' viewBox="0 0 10 10"><rect/></svg>'
    const stretched = stretchSvgToBox(source)

    expect(stretched).toContain('data-note=\'preserveAspectRatio="meet"\'')
    expect(stretched).toContain('<svg preserveAspectRatio="none"')
  })

  it('does not rewrite an SVG nested under a non-SVG root', () => {
    const source = '<div><svg viewBox="0 0 10 10"><rect/></svg></div>'

    expect(stretchSvgToBox(source)).toBe(source)
  })

  it('leaves non-SVG markup unchanged', () => {
    expect(stretchSvgToBox('<div>not an svg</div>')).toBe('<div>not an svg</div>')
  })
})
