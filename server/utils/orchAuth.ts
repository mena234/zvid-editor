import { getRequestURL, setCookie, type H3Event } from 'h3'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Share sessions with the dashboard on Zvid hosts. A production build can
 * also run on loopback over HTTP, where a `.zvid.io` cookie would be rejected.
 * Keep the HTTP exception local; production hosts still require Secure.
 */
function authCookieOptions(event: H3Event) {
  const url = getRequestURL(event, { xForwardedHost: false })
  const hostname = url.hostname.toLowerCase()
  const isLoopback = hostname === 'localhost' || hostname.endsWith('.localhost')
    || /^127(?:\.\d{1,3}){3}$/.test(hostname) || hostname === '[::1]'
  const isZvidHost = hostname === 'zvid.io' || hostname.endsWith('.zvid.io')
  return {
    httpOnly: true,
    secure: url.protocol === 'https:' || (isProd && !isLoopback),
    sameSite: 'lax' as const,
    path: '/',
    ...(isProd && isZvidHost && { domain: '.zvid.io' }),
  }
}

export function setAuthCookie(event: H3Event, token: string) {
  setCookie(event, 'auth_token', token, {
    ...authCookieOptions(event),
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })
}

export function clearAuthCookie(event: H3Event) {
  setCookie(event, 'auth_token', '', {
    ...authCookieOptions(event),
    maxAge: 0,
  })
}

interface OrchApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, unknown>
}

/**
 * Server-side fetch against the orch API, forwarding the browser's httpOnly
 * auth_token cookie as a Bearer token (same pattern as zvid-dash-nuxt).
 * Throws H3 errors whose `data` is orch's { error, message, details? } body.
 */
export async function orchApi<T = any>(
  event: H3Event,
  endpoint: string,
  options: OrchApiOptions = {}
): Promise<T> {
  const { orchUrl } = useRuntimeConfig()
  const token = getCookie(event, 'auth_token')

  if (/^\/(projects|templates)(\/|$)/.test(endpoint)) {
    setHeader(event, 'Cache-Control', 'no-store')
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const verification = getCookie(event, 'admin_verification')
  if (verification) headers['X-Admin-Verification'] = verification

  try {
    return await $fetch<T>(`/api${endpoint}`, {
      baseURL: orchUrl,
      method: options.method || 'GET',
      headers,
      body: options.body as any,
      query: options.query,
    })
  } catch (err: any) {
    const status = err?.status || err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        statusMessage: 'orch request failed',
        data: err?.data || {},
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: `orch is unreachable at ${orchUrl} — start it (yarn dev in orch/) or set ORCH_URL`,
    })
  }
}

/**
 * Envelope wrapper for mutations: returns { success, ... } instead of
 * throwing, so modal UIs can render orch's message/details directly.
 */
export async function orchAction<T = any>(
  event: H3Event,
  endpoint: string,
  options: OrchApiOptions = {},
  fallbackError = 'Request failed'
): Promise<
  | ({ success: true } & T)
  | { success: false; status: number; error: string; details?: unknown }
> {
  const token = getCookie(event, 'auth_token')
  if (!token) {
    return { success: false, status: 401, error: 'Not signed in' }
  }
  try {
    const data = await orchApi<T>(event, endpoint, options)
    return { success: true, ...(data as T) }
  } catch (err: any) {
    const body = err?.data || {}
    return {
      success: false,
      status: err?.statusCode || 500,
      error: body.error === 'ADMIN_REAUTH_REQUIRED'
        ? 'Verify your identity at https://app.zvid.io/admin/security, then reopen this project or template.'
        : body.message || body.error || fallbackError,
      details: body.details || null,
    }
  }
}
