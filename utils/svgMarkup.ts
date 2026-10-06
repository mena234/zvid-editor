interface SvgStartTag {
  end: number
  nameEnd: number
}

interface AttributeRange {
  start: number
  end: number
}

function scanTagEnd(markup: string, start: number): number {
  let quote = ''
  for (let i = start + 1; i < markup.length; i += 1) {
    const char = markup[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return i
    }
  }
  return -1
}

/** Scan a `<!DOCTYPE ...>`-style declaration, including its internal subset. */
function scanDeclarationEnd(markup: string, start: number): number {
  let quote = ''
  let bracketDepth = 0
  for (let i = start + 2; i < markup.length; i += 1) {
    const char = markup[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '[') {
      bracketDepth += 1
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
    } else if (char === '>' && bracketDepth === 0) {
      return i + 1
    }
  }
  return markup.length
}

/**
 * Locate the document's root SVG start tag without treating comments,
 * declarations, processing instructions, or quoted `>` characters as markup.
 */
function findRootSvgStartTag(markup: string): SvgStartTag | null {
  let cursor = 0
  while (cursor < markup.length) {
    const start = markup.indexOf('<', cursor)
    if (start < 0) return null

    if (markup.startsWith('<!--', start)) {
      const end = markup.indexOf('-->', start + 4)
      if (end < 0) return null
      cursor = end + 3
      continue
    }
    if (markup.startsWith('<?', start)) {
      const end = markup.indexOf('?>', start + 2)
      if (end < 0) return null
      cursor = end + 2
      continue
    }
    if (markup.startsWith('<![CDATA[', start)) {
      const end = markup.indexOf(']]>', start + 9)
      if (end < 0) return null
      cursor = end + 3
      continue
    }
    if (markup.startsWith('<!', start)) {
      cursor = scanDeclarationEnd(markup, start)
      continue
    }
    if (markup.startsWith('</', start)) return null

    const nameStart = start + 1
    let nameEnd = nameStart
    while (nameEnd < markup.length && !/[\s/>]/.test(markup[nameEnd])) {
      nameEnd += 1
    }
    if (nameEnd === nameStart) {
      cursor = start + 1
      continue
    }

    // The first actual element is the root. Do not rewrite a nested SVG in
    // arbitrary HTML/XML markup.
    if (markup.slice(nameStart, nameEnd).toLowerCase() !== 'svg') return null
    const end = scanTagEnd(markup, start)
    return end < 0 ? null : { end, nameEnd }
  }
  return null
}

function findAttribute(
  markup: string,
  from: number,
  to: number,
  wantedName: string
): AttributeRange | null {
  let cursor = from
  while (cursor < to) {
    while (cursor < to && /\s/.test(markup[cursor])) cursor += 1
    if (cursor >= to || markup[cursor] === '/') return null

    const nameStart = cursor
    while (cursor < to && !/[\s=/>]/.test(markup[cursor])) cursor += 1
    const nameEnd = cursor
    if (nameEnd === nameStart) {
      cursor += 1
      continue
    }

    while (cursor < to && /\s/.test(markup[cursor])) cursor += 1
    let attributeEnd = nameEnd
    if (markup[cursor] === '=') {
      cursor += 1
      while (cursor < to && /\s/.test(markup[cursor])) cursor += 1
      const quote = markup[cursor]
      if (quote === '"' || quote === "'") {
        cursor += 1
        while (cursor < to && markup[cursor] !== quote) cursor += 1
        if (cursor < to) cursor += 1
      } else {
        while (cursor < to && !/\s/.test(markup[cursor])) cursor += 1
      }
      attributeEnd = cursor
    }

    if (markup.slice(nameStart, nameEnd).toLowerCase() === wantedName) {
      return { start: nameStart, end: attributeEnd }
    }
  }
  return null
}

/**
 * Return SVG markup whose root viewBox stretches to the authored item box.
 *
 * SVG defaults to `preserveAspectRatio="xMidYMid meet"`. That default keeps
 * the artwork's intrinsic ratio even after an editor side-handle changes only
 * width or height, so the selection grows while the artwork letterboxes in the
 * middle. The editor's width/height are free-axis geometry, so force the root
 * viewport mapping to fill them.
 */
export function stretchSvgToBox(markup: string): string {
  const root = findRootSvgStartTag(markup)
  if (!root) return markup

  const attribute = findAttribute(
    markup,
    root.nameEnd,
    root.end,
    'preserveaspectratio'
  )
  if (attribute) {
    return `${markup.slice(0, attribute.start)}preserveAspectRatio="none"${markup.slice(
      attribute.end
    )}`
  }

  return `${markup.slice(0, root.nameEnd)} preserveAspectRatio="none"${markup.slice(
    root.nameEnd
  )}`
}

/** Parse only the plain, quoted attributes used by the built-in rectangle. */
function rectangleAttributes(
  source: string,
  allowed: string[]
): Map<string, string> | null {
  const attributes = new Map<string, string>()
  const pattern = /\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy
  let cursor = 0
  while (source.slice(cursor).trim()) {
    pattern.lastIndex = cursor
    const match = pattern.exec(source)
    if (!match || !allowed.includes(match[1]) || attributes.has(match[1])) return null
    attributes.set(match[1], match[2] ?? match[3])
    cursor = pattern.lastIndex
  }
  return attributes
}

/**
 * The original library rectangle has an 8-unit transparent gutter baked into
 * its 400 × 260 viewport. Remove that gutter in the saved SVG, so selection,
 * resizing and exported renders all use the same visible bounds.
 *
 * Match this legacy asset's geometry, not its paint or the item's dimensions
 * (users can recolor/stretch it). Leave arbitrary SVGs, strokes, transforms,
 * CSS, animation and composed artwork alone: their margins can be intentional.
 */
export function normalizeLibraryRectangle(markup: string): string {
  const match = /^\s*<svg\b([^<>]*)>\s*<rect\b([^<>]*?)\s*(?:\/>|>\s*<\/rect>)\s*<\/svg>\s*$/.exec(markup)
  if (!match) return markup
  const root = rectangleAttributes(match[1], [
    'xmlns', 'viewBox', 'preserveAspectRatio', 'width', 'height',
  ])
  const rect = rectangleAttributes(match[2], [
    'x', 'y', 'width', 'height', 'rx', 'fill', 'opacity',
  ])
  if (!root || !rect) return markup
  const viewBox = root.get('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (!viewBox || viewBox.length !== 4 ||
    !viewBox.every((v, i) => v === [0, 0, 400, 260][i])) return markup
  for (const [key, expected] of Object.entries({ x: 8, y: 8, width: 384, height: 244, rx: 18 })) {
    if (!rect.has(key) || Number(rect.get(key)) !== expected) return markup
  }

  const tag = findRootSvgStartTag(markup)!
  const attribute = findAttribute(markup, tag.nameEnd, tag.end, 'viewbox')!
  return stretchSvgToBox(
    `${markup.slice(0, attribute.start)}viewBox="8 8 384 244"${markup.slice(attribute.end)}`
  )
}
