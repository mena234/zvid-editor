/** Which stock providers orch has API keys for, per media type. */
export default defineEventHandler(async (event) => {
  const { orchUrl } = useRuntimeConfig()
  try {
    return await $fetch('/api/stock/providers', { baseURL: orchUrl })
  } catch (e: any) {
    if (e?.statusCode) {
      throw createError({
        statusCode: e.statusCode,
        statusMessage: e.data?.error || 'Provider lookup failed',
        data: e.data,
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: `orch is unreachable at ${orchUrl} — start it (yarn dev in orch/) or set ORCH_URL`,
    })
  }
})
