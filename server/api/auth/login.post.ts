/** Sign in from inside the editor; sets the same auth_token cookie as dash. */
export default defineEventHandler(async (event) => {
  const { email, password } = await readBody(event)

  try {
    const data = await orchApi(event, '/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setAuthCookie(event, data.token)
    return { success: true, user: data.user }
  } catch (err: any) {
    const body = err?.data || {}
    return {
      success: false,
      error: body.message || body.error || 'Login failed',
    }
  }
})
