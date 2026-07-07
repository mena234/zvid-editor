/**
 * Google-Fonts TTF proxy for the stage's native-ASS subtitle preview.
 *
 * Browsers fetching fonts.googleapis.com CSS get woff2 URLs (UA sniffing);
 * the renderer's downloadGoogleFont (axios default UA) gets TTF. This route
 * replicates the package's fetch server-side so jassub (libass WASM) and
 * canvas measurement use the SAME font binary the renderer will use.
 * Mirrors package/src/utils/downloadGoogleFont.ts.
 */

const NAME_RE = /^[\w\s-]{1,80}$/
const cache = new Map<string, Uint8Array>()

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const family = String(q.family ?? '').trim()
  const weight = Math.min(900, Math.max(100, Number(q.weight) || 400))
  const italic = q.italic === '1' || q.italic === 'true'

  if (!NAME_RE.test(family)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid font family' })
  }

  const key = `${family}|${weight}|${italic}`
  let ttf = cache.get(key)

  if (!ttf) {
    const encoded = encodeURIComponent(family).replace(/%20/g, '+')
    // A single ital/wght combination → exactly one @font-face in the response.
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@${italic ? 1 : 0},${weight}&display=swap`

    const css = await $fetch<string>(cssUrl, {
      // no browser UA → Google serves TTF urls (same as the package's axios)
      headers: { 'User-Agent': 'axios/1.7' },
      responseType: 'text',
    }).catch(() => null)
    const match = css?.match(/url\((.*?)\)/)
    const fileUrl = match?.[1]?.replace(/['"]+/g, '')
    if (!fileUrl) {
      throw createError({ statusCode: 404, statusMessage: `no TTF for ${family}` })
    }

    const buf = await $fetch<ArrayBuffer>(fileUrl, { responseType: 'arrayBuffer' }).catch(
      () => null
    )
    if (!buf) {
      throw createError({ statusCode: 502, statusMessage: 'font download failed' })
    }
    ttf = new Uint8Array(buf)
    cache.set(key, ttf)
  }

  setHeader(event, 'Content-Type', 'font/ttf')
  setHeader(event, 'Cache-Control', 'public, max-age=86400')
  return ttf
})
