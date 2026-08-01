/**
 * Google Fonts support mirroring the package's downloadGoogleFont behaviour:
 * TEXT items fetch their fontFamily from fonts.googleapis.com at render time,
 * so any Google-Fonts family name is valid. The editor loads the same CSS so
 * the preview matches.
 */

export const POPULAR_GOOGLE_FONTS = [
  'Poppins',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Lato',
  'Inter',
  'Oswald',
  'Raleway',
  'Nunito',
  'Playfair Display',
  'Merriweather',
  'Rubik',
  'Work Sans',
  'Kanit',
  'Bebas Neue',
  'Anton',
  'Barlow',
  'DM Sans',
  'Manrope',
  'Josefin Sans',
  'Archivo',
  'Space Grotesk',
  'Outfit',
  'Sora',
  'Figtree',
  'Lexend',
  'Urbanist',
  'Abril Fatface',
  'Alfa Slab One',
  'Bangers',
  'Caveat',
  'Cinzel',
  'Comfortaa',
  'Cormorant Garamond',
  'Courgette',
  'Dancing Script',
  'Exo 2',
  'Fira Sans',
  'Fredoka',
  'Great Vibes',
  'IBM Plex Sans',
  'JetBrains Mono',
  'Libre Baskerville',
  'Lobster',
  'Pacifico',
  'Permanent Marker',
  'Quicksand',
  'Righteous',
  'Satisfy',
  'Shadows Into Light',
  'Source Sans 3',
  'Teko',
  'Ubuntu',
  'Varela Round',
  'Zilla Slab',
]

/**
 * Families the browser resolves itself; asking Google Fonts for them 400s.
 * Mirrors GENERIC_FAMILIES in package/src/lib/texts/buildHtmlContent.ts.
 */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
])

/** Same cap the renderer applies per TEXT element. */
export const MAX_FAMILIES_PER_ELEMENT = 4

/** First family of a CSS font stack, unquoted (`'Space Grotesk', sans-serif`). */
export function firstFamilyOf(stack: string): string | null {
  const family = String(stack)
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
  if (!family || family.startsWith('var(')) return null
  if (GENERIC_FAMILIES.has(family.toLowerCase())) return null
  return family
}

/**
 * Every Google font family a TEXT element references: its own `style.fontFamily`
 * plus every `font-family` declared in its inline HTML or its customCode CSS.
 *
 * Byte-for-byte the same rule set the renderer uses (`referencedFamilies` in
 * package/src/lib/texts/buildHtmlContent.ts) — including the declaration regex,
 * so the preview never resolves a family the render leaves in a fallback face.
 */
export function extractFontFamilies(sources: {
  /** the item's style object, or a bare font stack */
  style?: Record<string, any> | string | null
  html?: string | null
  css?: string | null
}): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  const push = (raw: string | null) => {
    if (!raw) return
    const key = raw.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    ordered.push(raw)
  }

  const declared =
    typeof sources.style === 'string'
      ? sources.style
      : (sources.style?.fontFamily as string | undefined)
  if (declared) push(firstFamilyOf(String(declared)))

  // The renderer strips backslashes from the html before anything reads it —
  // getTextImage.ts passes `html.replace(/\\/g, '')` into buildHtmlContent, and
  // referencedFamilies only ever sees the de-escaped copy. Matching the raw
  // html instead makes a literal backslash next to a font-family declaration
  // resolve a different family here than the render loads. `customCode.css`
  // reaches buildHtmlContent untouched (as `animationCss`), so it is matched as
  // authored.
  const html = sources.html ? String(sources.html).replace(/\\/g, '') : null

  for (const source of [html, sources.css]) {
    if (!source) continue
    // Declaration values end at `;` or the end of the rule / style attribute.
    const re = /font-family\s*:\s*([^;}"]+)/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(String(source)))) push(firstFamilyOf(match[1]))
  }
  return ordered.slice(0, MAX_FAMILIES_PER_ELEMENT)
}

const loaded = new Set<string>()

/** Inject a Google Fonts stylesheet for a family (id-deduplicated). */
export function loadGoogleFont(family: string) {
  if (!family || typeof document === 'undefined') return
  const clean = family.trim()
  if (!clean || loaded.has(clean)) return
  loaded.add(clean)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    clean
  ).replace(/%20/g, '+')}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`
  link.dataset.zvidFont = clean
  document.head.appendChild(link)
}

/** Inject the stylesheet of every family an element references. */
export function loadGoogleFonts(families: string[]) {
  for (const family of families) loadGoogleFont(family)
}

/** css2 URL for iframe/customCode previews. */
export function googleFontCssUrl(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family.trim()
  ).replace(/%20/g, '+')}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`
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
