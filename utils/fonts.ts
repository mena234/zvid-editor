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

/** css2 URL for iframe/customCode previews. */
export function googleFontCssUrl(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family.trim()
  ).replace(/%20/g, '+')}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`
}
