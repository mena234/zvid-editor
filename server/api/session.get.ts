/**
 * Current session for the editor UI. Returns nulls (never errors) so the
 * editor works logged-out; only saving requires an account.
 */
export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'auth_token')
  if (!token) return { user: null, credits: null, plan: null }

  try {
    const r = await orchApi(event, '/user/profile')
    return {
      user: r.user || null,
      credits: r.credits || null,
      plan: r.plan || null,
    }
  } catch {
    return { user: null, credits: null, plan: null }
  }
})
