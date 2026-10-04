import { test as base, expect, request, type BrowserContext } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env, redact } from './helpers/env'
import { LiveApi } from './helpers/api'
import { RunState, type ResourceKind } from './helpers/run-state'
import { cleanupResources } from './helpers/cleanup'

export interface LiveSession {
  env: typeof env
  api: LiveApi
  run: RunState
  sensitive: boolean
  name(tag: string): string
  track(kind: ResourceKind, id: string, name: string): void
  verifyAccount(): Promise<void>
}

export const test = base.extend<{ live: LiveSession }>({
  live: [async ({ context }, use, testInfo) => {
    const run = new RunState(env.runDir, env.creditLimit)
    if (run.snapshot().stoppedReason) throw new Error(`Live run stopped: ${run.snapshot().stoppedReason}`)
    const before = new Set(run.eligibleResources().map(r => `${r.kind}:${r.id}`))
    const api = new LiveApi(context.request, env)
    const testSuffix = randomBytes(4).toString('hex')
    let savedState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined
    let initialLedger: { balance: number; jobs: number; reservations: number } | undefined
    const diagnostics: string[] = []
    const receiptFailures: string[] = []
    const pending = new Set<Promise<void>>()
    const live: LiveSession = {
      env, api, run, sensitive: false,
      name: tag => `${run.prefix}${tag.replace(/[^a-zA-Z0-9-]/g, '-')}-${testSuffix}`,
      track: (kind, id, name) => {
        const found = run.snapshot().resources.find(r => r.kind === kind && r.id === String(id))
        if (found && found.name !== name) run.rename(kind, String(id), name)
        else run.track(kind, String(id), name)
      },
      async verifyAccount() {
        const profile = await api.get('/user/profile')
        const user = profile.user
        if (!user || user.email !== env.email) throw new Error('Browser is not authenticated as the configured test account')
        if (Number(user.is_admin ?? user.isAdmin) === 1) throw new Error('Live E2E requires a non-admin customer account')
        if (!Number(user.email_verified ?? user.emailVerified)) throw new Error('Verify the test account email before running')
        if (!Number(user.profile_completed ?? user.profileCompleted)) throw new Error('Complete test-account onboarding before running')
        run.bindAccount(String(user.id))
        savedState = await context.storageState()
        await api.noActiveJobs()
        const jobs = await api.get('/jobs?limit=1')
        if (!Number.isFinite(Number(jobs.pagination?.total))) throw new Error('Missing render-job count')
        initialLedger = { balance: await api.balance(), jobs: Number(jobs.pagination.total), reservations: run.snapshot().reservations.length }
      },
    }
    const hookPage = (page: import('@playwright/test').Page) => {
      page.on('pageerror', error => { if (!live.sensitive) diagnostics.push(redact(`Page error: ${error.message}`)) })
    }
    context.pages().forEach(hookPage)
    context.on('page', hookPage)
    context.on('response', response => {
      const url = new URL(response.url())
      if (![env.dashboardUrl, env.editorUrl, env.apiUrl].includes(url.origin)) return
      if (response.status() >= 500) diagnostics.push(`${response.status()} ${url.pathname}`)
      if (!response.ok() || response.request().method() !== 'POST') return
      const kind = ({ '/api/projects': 'project', '/api/templates': 'template', '/api/uploads': 'upload', '/api/api-keys': 'apiKey' } as const)[url.pathname as '/api/projects']
      if (!kind || !run.snapshot().accountId) return
      const task = (async () => {
        try {
          const raw = await response.json()
          if (raw.success === false) return
          const body = raw.data || raw
          const item = body[kind] && typeof body[kind] === 'object' ? body[kind] : body
          const name = item.name ?? item.fileName ?? item.file_name
          if (!item.id || typeof name !== 'string' || !name.startsWith(run.prefix)) throw new Error('Missing creation identity')
          live.track(kind, item.id, name)
        } catch {
          const message = `Unresolved ${kind} creation receipt at ${url.pathname}; inspect this account before another run`
          receiptFailures.push(message)
          run.stop(message)
          writeFileSync(join(env.runDir, 'unresolved-creations.json'), JSON.stringify(receiptFailures, null, 2))
        }
      })()
      pending.add(task)
      void task.finally(() => pending.delete(task))
    })
    try {
      await use(live)
    } finally {
      await Promise.all(pending)
      // Screenshots never include password inputs or one-time key-reveal tests.
      if (!live.sensitive && testInfo.status !== testInfo.expectedStatus) {
        for (const [index, page] of context.pages().entries()) {
          if (!page.isClosed() && !/\/(login|register|api-keys)(?:[/?]|$)/.test(page.url())) {
            await testInfo.attach(`failure-${index}`, {
              body: await page.screenshot({ mask: [page.locator('input, textarea, pre, code, #account-menu'), page.getByRole('button', { name: 'Open profile menu', exact: true })], timeout: 5000 }).catch(() => Buffer.alloc(0)),
              contentType: 'image/png',
            })
          }
        }
      }
      await testInfo.attach('diagnostics', { body: diagnostics.join('\n') || 'No captured application errors', contentType: 'text/plain' })
      const resources = run.eligibleResources().filter(r => !before.has(`${r.kind}:${r.id}`))
      let failures: string[] = []
      if (savedState) {
        const cleanupContext = await request.newContext({ storageState: savedState })
        try {
          const cleanupApi = new LiveApi(cleanupContext, env)
          if (initialLedger && initialLedger.reservations === run.snapshot().reservations.length) {
            try {
              const jobs = await cleanupApi.get('/jobs?limit=1')
              expect(Number(jobs.pagination?.total), 'Non-rendering journey creates no render jobs').toBe(initialLedger.jobs)
              expect(await cleanupApi.balance(), 'Non-rendering journey spends no credits').toBe(initialLedger.balance)
            } catch { failures.push('Non-rendering journey changed the render ledger or its zero-credit check failed') }
          }
          failures.push(...await cleanupResources(cleanupApi, run, resources))
        }
        finally { await cleanupContext.dispose() }
      } else if (resources.length) failures = ['No authenticated cleanup session; manifest retained']
      await testInfo.attach('run-manifest', { body: JSON.stringify(run.snapshot(), null, 2), contentType: 'application/json' })
      if (failures.length) throw new Error(`Cleanup needs attention: ${failures.join('; ')}`)
      if (receiptFailures.length) throw new Error(receiptFailures.join('; '))
    }
  }, { timeout: 120_000 }],
})
export { expect }
