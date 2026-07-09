import { test as base, expect, type Page, type TestInfo } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ENV } from './env'
import { orchFetch, provisionVerifiedUser, type OrchUser } from './orch'

/**
 * Stack availability gates + failure diagnostics for the real-e2e suite.
 * Every gate SKIPS (never fails) with an explicit reason when a piece of
 * infrastructure is down — see tests/real-e2e/README.md for start commands.
 */

// generous timeout: nuxt dev servers cold-compile routes on first hit
async function up(url: string, timeoutMs = 20_000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.status < 500
  } catch {
    return false
  }
}

export interface StackStatus {
  orch: boolean
  orchReady: boolean
  editor: boolean
  editorOnRealOrch: boolean
  dash: boolean
  landing: boolean
  fixtures: boolean
  cell: boolean
  cellHint: string
}

let cached: StackStatus | null = null
let canary: OrchUser | null = null

/** One verified throwaway account shared by availability probes. */
export async function canaryUser(): Promise<OrchUser> {
  if (!canary) canary = await provisionVerifiedUser('pw-canary')
  return canary
}

export async function stackStatus(): Promise<StackStatus> {
  if (cached) return cached
  const s: StackStatus = {
    orch: await up(`${ENV.orchUrl}/healthz`),
    orchReady: false,
    editor: await up(ENV.editorUrl),
    editorOnRealOrch: false,
    dash: await up(`${ENV.dashUrl}/login`),
    landing: await up(ENV.landingUrl),
    fixtures: await up(`${ENV.fixtureUrl}/image.png`),
    cell: false,
    cellHint: 'unknown',
  }
  if (s.orch) {
    try {
      const r = await fetch(`${ENV.orchUrl}/readyz`, { signal: AbortSignal.timeout(4000) })
      s.orchReady = r.status === 200
    } catch {}
  }
  // Is the editor instance proxying the REAL orch (not the mocked test one)?
  // A real registered user must be able to authenticate through it.
  if (s.orch && s.orchReady && s.editor) {
    try {
      const user = await canaryUser()
      const res = await fetch(`${ENV.editorUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: user.password }),
        signal: AbortSignal.timeout(8000),
      })
      const body: any = await res.json().catch(() => ({}))
      s.editorOnRealOrch = res.status === 200 && body?.success === true
    } catch {}
  }
  // Cell liveness: orch's queue has no public probe, so treat "a fresh
  // render reaches a terminal state" as the cell check — done lazily by the
  // render spec itself. Here we only note whether REAL_SKIP_RENDER is set.
  s.cell = !ENV.skipRender
  s.cellHint = ENV.skipRender
    ? 'REAL_SKIP_RENDER=1'
    : 'assumed present; render spec will time out with a clear message if the worker is not running'
  cached = s
  return s
}

export function skipUnless(cond: boolean, reason: string) {
  base.skip(!cond, reason)
}

export async function requireOrch() {
  const s = await stackStatus()
  skipUnless(s.orch && s.orchReady, `orch not ready at ${ENV.orchUrl} — start it: cd orch && yarn start (needs MySQL + Redis; see tests/real-e2e/README.md)`)
}

export async function requireEditor() {
  await requireOrch()
  const s = await stackStatus()
  skipUnless(
    s.editor && s.editorOnRealOrch,
    `editor (real-orch config) not available at ${ENV.editorUrl} — start it: cd editor && npm run dev  (defaults to :3000 with ORCH_URL=http://localhost:4000)`
  )
}

export async function requireDash() {
  await requireOrch()
  const s = await stackStatus()
  skipUnless(s.dash, `dash not available at ${ENV.dashUrl} — start it: cd zvid-dash && npm run dev`)
}

export async function requireLanding() {
  const s = await stackStatus()
  skipUnless(s.landing, `landing not available at ${ENV.landingUrl} — start it: cd zvid-landing && npm run dev`)
}

export async function requireFixtures() {
  const s = await stackStatus()
  skipUnless(
    s.fixtures,
    `fixture server not available at ${ENV.fixtureUrl} — node editor/tests/e2e/helpers/standalone-servers.mjs (or any playwright run boots it)`
  )
}

/* --------------- console / network diagnostics fixture --------------- */

export interface Diag {
  consoleErrors: string[]
  failedRequests: string[]
}

/**
 * Extended test: collects console errors + failed/errored requests on every
 * page in the context and attaches them (plus notes) to the report when a
 * test fails. Traces/screenshots come from the project config.
 */
export const test = base.extend<{ diag: Diag }>({
  diag: [
    async ({ context }, use, testInfo) => {
      const diag: Diag = { consoleErrors: [], failedRequests: [] }
      context.on('page', (page: Page) => hook(page, diag))
      for (const page of context.pages()) hook(page, diag)
      await use(diag)
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('console-errors', {
          body: diag.consoleErrors.join('\n') || '(none)',
          contentType: 'text/plain',
        })
        await testInfo.attach('failed-requests', {
          body: diag.failedRequests.join('\n') || '(none)',
          contentType: 'text/plain',
        })
      }
    },
    { auto: true },
  ],
})

function hook(page: Page, diag: Diag) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') diag.consoleErrors.push(`[${page.url()}] ${msg.text()}`)
  })
  page.on('requestfailed', (req) => {
    diag.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
  })
  page.on('response', (res) => {
    if (res.status() >= 500) diag.failedRequests.push(`${res.status()} ${res.url()}`)
  })
}

export { expect }

/** Save an artifact buffer under the test's output dir and attach it. */
export async function saveArtifact(
  testInfo: TestInfo,
  name: string,
  data: Buffer
): Promise<string> {
  const dir = testInfo.outputDir
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, data)
  await testInfo.attach(name, { path: p })
  return p
}
