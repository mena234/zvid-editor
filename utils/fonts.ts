/**
 * Google Fonts support mirroring the package's downloadGoogleFont behaviour:
 * TEXT items fetch their fontFamily from fonts.googleapis.com at render time,
 * so any Google-Fonts family name is valid. Request the CSS through the server
 * so browser-specific font subsets cannot change glyph coverage or metrics.
 */

import { parseFontFamilies } from '../shared/fontResolution'
import { fontSample, referencedTextFamilies } from '../shared/textFontPolicy'
export { MAX_FAMILIES_PER_ELEMENT, textFontStack } from '../shared/textFontPolicy'

export function firstFamilyOf(stack: string): string | null {
  return parseFontFamilies(stack)[0] || null
}

/** All stack members plus downloaded fallbacks for the actual script. */
export function extractFontFamilies(sources: {
  style?: Record<string, any> | string | null
  html?: string | null
  text?: string | null
  css?: string | null
}): string[] {
  const declared = typeof sources.style === 'string' ? sources.style : sources.style?.fontFamily
  const html = sources.html ? String(sources.html).replace(/\\/g, '') : null
  return referencedTextFamilies(String(declared || ''), fontSample(sources.text, html), html, sources.css)
}

/** Mirrors the renderer's text-bearing SVG capture font discovery. */
export function extractSvgFontFamilies(svg: string, customCss?: string | null): string[] {
  if (!/<(?:text|tspan|textPath|foreignObject)\b/i.test(svg)) return []
  const declared = Array.from(
    svg.matchAll(/\bfont-family\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
    match => match[1] ?? match[2] ?? match[3]
  )
  // Parse CSS separately: a style attribute's closing quote is not CSS and
  // must never consume following SVG markup as part of a family name.
  const css = [
    ...Array.from(svg.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi), match => match[1] ?? match[2] ?? match[3]),
    ...Array.from(svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi), match => match[1]),
  ]
  return referencedTextFamilies(['Poppins', ...declared].join(', '), fontSample(undefined, svg), ...css, customCss)
}

const loaded = new Map<string, Promise<void>>()

/** Deduplicate the stylesheet, then eagerly load this text's selected face. */
export async function loadGoogleFont(family: string, text = '', variant: { weight?: string | number; italic?: boolean } = {}) {
  if (!family || typeof document === 'undefined') return
  const clean = family.trim()
  if (!clean) return
  if (!loaded.has(clean)) {
    loaded.set(clean, new Promise<void>((resolve) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = googleFontCssUrl(clean)
      link.onload = () => resolve()
      link.onerror = () => {
        loaded.delete(clean)
        link.remove()
        resolve()
      }
      link.dataset.zvidFont = clean
      document.head.appendChild(link)
    }))
  }
  await loaded.get(clean)
  if (text) {
    const quoted = JSON.stringify(clean)
    await document.fonts.load(`${variant.italic ? 'italic' : 'normal'} ${variant.weight || 400} 16px ${quoted}`, text).catch(() => [])
  }
}

/** All script faces must settle before the preview is measured. */
export async function loadGoogleFonts(families: string[], text = '', variant: { weight?: string | number; italic?: boolean } = {}) {
  await Promise.all(families.map(family => loadGoogleFont(family, text, variant)))
}

/** The server applies the renderer's bounded CSS fallback sequence. */
export function googleFontCssUrl(family: string): string {
  return `/api/text-fonts?family=${encodeURIComponent(family.trim())}`
}

/** Sandboxed documents use the same complete faces as the main preview. */
export function googleFontLinks(families: string[]): string {
  const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return googleFontCssUrls(families)
    .map(url => `<link rel="stylesheet" href="${attr(url)}">`).join('\n')
}

/**
 * One CSS URL per family — the sandboxed iframe is a separate document, so it
 * needs its own <link> for each family instead of the document-level ones.
 * `googleFontCssUrl`'s single-family shape is pinned by tests; this only maps.
 */
export function googleFontCssUrls(families: string[]): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const family of families) {
    if (!family) continue
    const url = googleFontCssUrl(family)
    if (seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}
