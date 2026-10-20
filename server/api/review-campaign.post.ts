export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!getCookie(event, 'auth_token')) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in to share feedback' })
  }
  const origin = getHeader(event, 'origin')
  if (origin && origin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin feedback requests are not allowed' })
  }
  const body = await readBody(event)
  return orchApi(event, '/user/review-campaign', { method: 'POST', body })
})
