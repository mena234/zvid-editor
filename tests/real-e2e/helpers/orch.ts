import { ENV, newIdentity } from './env'
import { verifyUserEmailViaDb } from './db'

/**
 * Thin REST client against the REAL orch — used for provisioning (verified
 * users), ground-truth assertions (jobs, credits) and cleanup. Mirrors the
 * k6-tests contract (lib/auth.js, lib/poll.js).
 */

const API = () => `${ENV.orchUrl}/api`

export interface OrchUser {
  email: string
  password: string
  firstName: string
  lastName: string
  token: string
  userId: string
}

async function j(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function orchFetch(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // dev auth rate-limit is keyed by this header — unique per call avoids
    // the 30/min ceiling when suites run back to back
    'X-Test-User': `pw-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ...(init.headers as Record<string, string>),
  }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  const res = await fetch(`${API()}${path}`, { ...init, headers })
  return { status: res.status, body: await j(res) }
}

/**
 * Register + email-verify + login a fresh synthetic user. Verification works
 * because non-production orch returns the rendered verification email in the
 * register response (same technique as k6-tests lib/auth.js).
 */
export async function provisionVerifiedUser(tag = 'pw'): Promise<OrchUser> {
  const id = newIdentity(tag)
  const reg = await orchFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: id.email,
      password: id.password,
      firstName: id.firstName,
      lastName: id.lastName,
    }),
  })
  if (reg.status !== 201) {
    throw new Error(`register failed (${reg.status}): ${JSON.stringify(reg.body).slice(0, 300)}`)
  }
  const userId: string = reg.body.userId
  // Some orch builds return the verification email HTML in dev; if not, read
  // the token from the DB (email_verifications). Verification is required for
  // dash's onboarding UX, not for orch auth itself.
  const emailHtml: string = reg.body.email ?? ''
  const htmlToken = /token=([a-f0-9]+)/i.exec(emailHtml)?.[1]
  if (htmlToken) {
    await orchFetch(`/auth/verify-email?token=${htmlToken}`, { method: 'GET' })
  } else if (userId) {
    await verifyUserEmailViaDb(userId, ENV.orchUrl)
  }
  const login = await orchFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: id.email, password: id.password }),
  })
  if (login.status !== 200 || !login.body.token) {
    throw new Error(`login failed (${login.status}): ${JSON.stringify(login.body).slice(0, 300)}`)
  }
  const token = login.body.token
  // complete onboarding so dash's require-onboarded guard lets the user reach
  // protected pages (all profile fields are optional → empty body suffices)
  await orchFetch('/user/profile', { method: 'POST', token, body: JSON.stringify({}) })
  return { ...id, token, userId: userId ?? login.body.user?.id }
}

export async function creditsBalance(token: string): Promise<number> {
  const r = await orchFetch('/credits/balance', { token })
  if (r.status !== 200) throw new Error(`balance failed: ${r.status}`)
  return Number(r.body.balance)
}

export interface JobView {
  state: string
  progress?: number
  resultUrl?: string
  raw: any
}

/** GET /api/jobs/:id — field is `state` while queued, DB status after prune. */
export async function getJob(token: string, jobId: string): Promise<JobView> {
  const r = await orchFetch(`/jobs/${jobId}`, { token })
  const b = r.body ?? {}
  const state = b.state ?? b.status ?? 'unknown'
  const resultUrl =
    typeof b.result === 'string' ? b.result : (b.result?.url ?? b.output_url ?? b.outputUrl)
  return { state, progress: b.progress, resultUrl, raw: b }
}

const TERMINAL = new Set(['completed', 'failed'])

/**
 * Poll a job to a terminal state, recording every distinct state observed —
 * the caller asserts on both the terminal state and the observed lifecycle.
 */
export async function waitForJob(
  token: string,
  jobId: string
): Promise<{ final: JobView; observedStates: string[] }> {
  const observed: string[] = []
  const deadline = Date.now() + ENV.renderTimeoutMs
  let last: JobView = { state: 'unknown', raw: null }
  while (Date.now() < deadline) {
    last = await getJob(token, jobId)
    if (observed[observed.length - 1] !== last.state) observed.push(last.state)
    if (TERMINAL.has(last.state)) {
      // on completion the result url can lag the state flip by a poll; give it
      // a couple of extra reads before returning
      if (last.state === 'completed' && !last.resultUrl) {
        for (let i = 0; i < 3 && !last.resultUrl; i++) {
          await new Promise((r) => setTimeout(r, ENV.pollIntervalMs))
          last = await getJob(token, jobId)
        }
      }
      return { final: last, observedStates: observed }
    }
    await new Promise((r) => setTimeout(r, ENV.pollIntervalMs))
  }
  throw new Error(
    `job ${jobId} not terminal after ${ENV.renderTimeoutMs / 1000}s (observed: ${observed.join(' → ')})`
  )
}

/* ------------------------- cleanup (idempotent) ------------------------- */

async function del(token: string, path: string) {
  const r = await orchFetch(path, { method: 'DELETE', token })
  if (![200, 204, 404].includes(r.status)) {
    console.warn(`cleanup ${path} → ${r.status}`)
  }
}

export const cleanup = {
  job: (t: string, id: string) => del(t, `/jobs/${id}`),
  project: (t: string, id: string) => del(t, `/projects/${id}`),
  template: (t: string, id: string) => del(t, `/templates/${id}`),
  upload: (t: string, id: string) => del(t, `/uploads/${id}`),
  apiKey: (t: string, id: string) => del(t, `/api-keys/${id}`),
}
