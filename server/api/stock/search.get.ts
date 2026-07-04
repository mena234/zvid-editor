/**
 * Proxy to orch's stock media search (/api/stock/search) so the browser only
 * ever talks to the editor origin — no CORS, no provider keys client-side.
 */
export default defineEventHandler(async (event) => {
  const { orchUrl } = useRuntimeConfig()
  try {
    return await $fetch('/api/stock/search', {
      baseURL: orchUrl,
      query: getQuery(event),
    })
  } catch (e: any) {
    if (e?.statusCode) {
      throw createError({
        statusCode: e.statusCode,
        statusMessage: e.data?.error || 'Stock search failed',
        data: e.data,
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: `orch is unreachable at ${orchUrl} — start it (yarn dev in orch/) or set ORCH_URL`,
    })
  }
})
