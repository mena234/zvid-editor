/**
 * Upload proxy: forwards the browser's multipart/form-data body verbatim to
 * orch's POST /api/uploads with the httpOnly auth cookie as a Bearer token
 * (orchApi can't be used here — it JSON-encodes bodies).
 */
export default defineEventHandler(async (event) => {
  const { orchUrl } = useRuntimeConfig()
  const token = getCookie(event, 'auth_token')
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not signed in',
      data: { error: 'Sign in to upload media' },
    })
  }

  const body = await readRawBody(event, false)
  const contentType = getHeader(event, 'content-type') || ''

  try {
    return await $fetch('/api/uploads', {
      baseURL: orchUrl,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: body as any,
    })
  } catch (err: any) {
    const status = err?.status || err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        statusMessage: 'Upload failed',
        data: err?.data || {},
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: `orch is unreachable at ${orchUrl} — start it (yarn dev in orch/) or set ORCH_URL`,
    })
  }
})
