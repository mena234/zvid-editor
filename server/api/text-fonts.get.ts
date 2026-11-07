import { textFontCssUrls } from '../../shared/textFontPolicy'

// Match the renderer's server-requested font faces. Google Fonts sends browser
// user agents subset WOFFs that can omit symbols (e.g. → and ≈), causing an OS
// fallback with different glyphs, line heights and auto-sized anchor positions.
const cache = new Map<string, Promise<string>>()
const MAX_CACHED_FAMILIES = 256
const NAME_RE = /^[\w\s-]{1,80}$/

async function fetchCss(family: string): Promise<string> {
  for (const url of textFontCssUrls(family)) {
    const css = await $fetch<string>(url, {
      headers: { 'User-Agent': 'axios/1.7' },
      responseType: 'text',
      timeout: 8000,
      retry: 0,
    }).catch(() => null)
    if (css?.includes('@font-face')) return css
  }
  throw createError({ statusCode: 404, statusMessage: 'font family unavailable' })
}

export default defineEventHandler(async (event) => {
  const family = String(getQuery(event).family ?? '').trim()
  if (!NAME_RE.test(family)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid font family' })
  }
  let pending = cache.get(family)
  if (!pending) {
    if (cache.size >= MAX_CACHED_FAMILIES) cache.delete(cache.keys().next().value!)
    pending = fetchCss(family).catch((error) => {
      if (cache.get(family) === pending) cache.delete(family)
      throw error
    })
    cache.set(family, pending)
  }
  const css = await pending
  setHeader(event, 'Content-Type', 'text/css; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=86400')
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  return css
})
