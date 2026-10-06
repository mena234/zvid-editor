import { describe, expect, it } from 'vitest'
import { normalizeLibraryRectangle, stretchSvgToBox } from '../../utils/svgMarkup'
import { LIBRARY_RECTANGLE } from '../helpers/libraryRectangle'

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

describe('normalizeLibraryRectangle', () => {
  it('fits the visible rectangle and retains its artwork', () => {
    const result = normalizeLibraryRectangle(LIBRARY_RECTANGLE)
    expect(result).toContain('viewBox="8 8 384 244"')
    expect(result).toContain('preserveAspectRatio="none"')
    expect(result.slice(result.indexOf('<rect'))).toBe(LIBRARY_RECTANGLE.slice(LIBRARY_RECTANGLE.indexOf('<rect')))
    expect(normalizeLibraryRectangle(result)).toBe(result)
  })

  it('also recognizes recolored and previously resized rectangles', () => {
    const source = stretchSvgToBox(LIBRARY_RECTANGLE.replace('#8b5cf6', '#ffffff'))
    const result = normalizeLibraryRectangle(source.replaceAll('"', "'"))
    expect(result).toContain('viewBox="8 8 384 244"')
    expect(result).toContain("fill='#ffffff'")
    expect(result.match(/preserveAspectRatio/g)).toHaveLength(1)
  })

  it.each([
    LIBRARY_RECTANGLE.replace('width="384"', 'width="300"'),
    LIBRARY_RECTANGLE.replace('0 0 400 260', '0 0 500 300'),
    LIBRARY_RECTANGLE.replace('<rect ', '<rect stroke="red" stroke-width="8" '),
    LIBRARY_RECTANGLE.replace('<rect ', '<rect transform="rotate(15)" '),
    LIBRARY_RECTANGLE.replace('<rect ', '<rect style="filter: blur(8px)" '),
    LIBRARY_RECTANGLE.replace('<rect ', '<rect class="custom" '),
    LIBRARY_RECTANGLE.replace('</svg>', '<circle r="10"/></svg>'),
    LIBRARY_RECTANGLE.replace('</svg>', '<style>rect { stroke: red; }</style></svg>'),
    LIBRARY_RECTANGLE.replace('x="8"', 'x="{{offset}}"'),
    '<div>not an svg</div>',
  ])('preserves unrelated or customized artwork: %s', (source) => {
    expect(normalizeLibraryRectangle(source)).toBe(source)
  })
})
