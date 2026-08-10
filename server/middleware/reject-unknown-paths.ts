const EDITOR_PUBLIC_PATHS = new Set(['/', '/favicon.ico', '/robots.txt'])
const EDITOR_RUNTIME_PREFIXES = ['/api/', '/_nuxt/', '/__nuxt']

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  if (
    EDITOR_PUBLIC_PATHS.has(path) ||
    path === '/api' ||
    EDITOR_RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    return
  }

  // Editor deep links are query parameters on `/`. Reject every other
  // pathname before Nuxt's SPA renderer can turn it into a duplicate 200.
  throw createError({ statusCode: 404, statusMessage: 'Page not found' })
})
