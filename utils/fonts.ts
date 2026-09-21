/**
 * Google Fonts support mirroring the package's downloadGoogleFont behaviour:
 * TEXT items fetch their fontFamily from fonts.googleapis.com at render time,
 * so any Google-Fonts family name is valid. The editor loads the same CSS so
 * the preview matches.
 */

import { parseFontFamilies } from '../shared/fontResolution'
import { fontSample, referencedTextFamilies, textFontCssUrls } from '../shared/textFontPolicy'
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
      const urls = textFontCssUrls(clean)
      let candidate = 0
      link.href = urls[candidate]
      link.onload = () => resolve()
      link.onerror = () => {
        if (++candidate < urls.length) link.href = urls[candidate]
        else { loaded.delete(clean); resolve() }
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

/** css2 URL for iframe/customCode previews. */
export function googleFontCssUrl(family: string): string {
  return textFontCssUrls(family)[0]
}

/** A fixed retry handler, with URL data in escaped attributes, for sandboxed documents. */
export function googleFontLinks(families: string[]): string {
  const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return [...new Set(families)].map(family => {
    const urls = textFontCssUrls(family)
    return `<link rel="stylesheet" href="${urls[0]}" data-fallback="${attr(JSON.stringify(urls.slice(1)))}" onerror="const a=JSON.parse(this.dataset.fallback);if(a.length){this.href=a.shift();this.dataset.fallback=JSON.stringify(a)}">`
  }).join('\n')
}

/**
 * One css2 URL per family — the sandboxed iframe is a separate document, so it
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
