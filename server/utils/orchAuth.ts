import type { H3Event } from 'h3'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Cookie options must stay identical to zvid-dash-nuxt/server/utils/authCookie.ts
 * so a session started in either app is visible to both (shared `.zvid.io`
 * domain in production; host-only `localhost` cookie in dev, which browsers
 * share across ports).
 */
export function setAuthCookie(event: H3Event, token: string) {
  setCookie(event, 'auth_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
    ...(isProd && { domain: '.zvid.io' }),
  })
}

export function clearAuthCookie(event: H3Event) {
  setCookie(event, 'auth_token', '', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    ...(isProd && { domain: '.zvid.io' }),
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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`

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
      error: body.message || body.error || fallbackError,
      details: body.details || null,
    }
  }
}
