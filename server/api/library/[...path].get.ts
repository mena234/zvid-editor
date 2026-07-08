/**
 * Proxy to orch's content library (/api/library/**) so the browser only ever
 * talks to the editor origin — no CORS. List/metadata responses come from
 * orch's Redis cache; content requests 302 to the Cloudflare CDN in front of
 * Backblaze B2, which $fetch follows server-side. The httpOnly auth cookie is
 * forwarded as a Bearer token so premium items resolve for paid users.
 */
export default defineEventHandler(async (event) => {
  const { orchUrl } = useRuntimeConfig()
  const path = getRouterParam(event, 'path')
  const token = getCookie(event, 'auth_token')
  try {
    return await $fetch(`/api/library/${path}`, {
      baseURL: orchUrl,
      query: getQuery(event),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch (e: any) {
    if (e?.statusCode) {
      throw createError({
        statusCode: e.statusCode,
        statusMessage: e.data?.message || e.data?.error || 'Library request failed',
        data: e.data,
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: `orch is unreachable at ${orchUrl} — start it (yarn dev in orch/) or set ORCH_URL`,
    })
  }
})
