/**
 * Font loading + libass-style metrics for the browser ASS pipeline.
 *
 * The renderer downloads Google-Fonts TTFs into the libass fontsdir; the
 * editor fetches the SAME files through /api/fonts (server-side fetch gets
 * TTF, not woff2) so that:
 *  - jassub (libass WASM) rasterizes with the exact same font file, and
 *  - canvas measurement (rounded boxes, pop/bounce wrapping) matches the
 *    package's @napi-rs/canvas measurement.
 *
 * Mirrors parseTtfWinMetrics in package/src/lib/subtitles/roundedBoxes.ts.
 */

export interface LoadedFont {
  /** the real family name */
  family: string
  /**
   * unique FontFace alias holding exactly this TTF — measure with THIS so
   * canvas font-matching can't silently pick another weight/style of the
   * family that the document loaded elsewhere (mirrors the package's
   * zvid-boxmetrics-N alias trick)
   */
  alias: string
  /** raw TTF bytes (for jassub) */
  data: Uint8Array
  /** unitsPerEm / (winAscent + winDescent) — libass VSFilter font scale */
  scale: number
}

/** Parse unitsPerEm + OS/2 win metrics straight from a TTF (DataView port). */
export function parseTtfWinMetrics(
  buf: ArrayBuffer
): { upem: number; winCell: number } | null {
  try {
    const dv = new DataView(buf)
    const numTables = dv.getUint16(4)
    let headOff = -1
    let os2Off = -1
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16
      let tag = ''
      for (let j = 0; j < 4; j++) tag += String.fromCharCode(dv.getUint8(off + j))
      if (tag === 'head') headOff = dv.getUint32(off + 8)
      if (tag === 'OS/2') os2Off = dv.getUint32(off + 8)
    }
    if (headOff < 0 || os2Off < 0) return null
    const upem = dv.getUint16(headOff + 18)
    const winAsc = dv.getUint16(os2Off + 74)
    const winDesc = dv.getUint16(os2Off + 76)
    if (!upem || winAsc + winDesc <= 0) return null
    return { upem, winCell: winAsc + winDesc }
  } catch {
    return null
  }
}

const cache = new Map<string, Promise<LoadedFont | null>>()

/**
 * Fetch a font variant via the server TTF proxy, register it as a document
 * FontFace (so canvas measurement uses it), and return bytes + libass scale.
 * Null on any failure — callers fall back to estimates, same as the package.
 */
export function loadRenderFont(
  fontFamily: string,
  opts: { weight?: number; italic?: boolean } = {}
): Promise<LoadedFont | null> {
  const family = String(fontFamily ?? 'Poppins').split(',')[0].trim()
  const weight = opts.weight ?? 400
  const italic = !!opts.italic
  const key = `${family}|${weight}|${italic}`
  const hit = cache.get(key)
  if (hit) return hit

  const p = (async (): Promise<LoadedFont | null> => {
    if (typeof document === 'undefined') return null
    try {
      const url = `/api/fonts?family=${encodeURIComponent(family)}&weight=${weight}&italic=${italic ? 1 : 0}`
      const res = await fetch(url)
      if (!res.ok) return null
      const buf = await res.arrayBuffer()
      const metrics = parseTtfWinMetrics(buf)
      // common upem/hheaCell fallback — same default as the package
      const scale = metrics ? metrics.upem / metrics.winCell : 1000 / 1400
      const alias = `zvid-assmetrics-${family}-${weight}${italic ? '-i' : ''}`
      try {
        const face = new FontFace(alias, buf)
        await face.load()
        document.fonts.add(face)
      } catch {
        // measurement falls back to whatever the document already has
      }
      return { family, alias, data: new Uint8Array(buf), scale }
    } catch {
      return null
    }
  })()

  cache.set(key, p)
  return p
}
