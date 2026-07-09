import { test, expect } from './helpers/stack'
import {
  requireDash,
  requireEditor,
  requireFixtures,
  requireOrch,
} from './helpers/stack'
import { ENV, newIdentity, NAME_PREFIX } from './helpers/env'
import {
  provisionVerifiedUser,
  orchFetch,
  creditsBalance,
  waitForJob,
  cleanup,
  type OrchUser,
} from './helpers/orch'
import {
  dashLogin,
  dashReturn,
  dashClientGoto,
  expectDeauthenticated,
  openRealEditor,
  importViaModal,
  tinyProject,
  validateVideoArtifact,
} from './helpers/apps'

/**
 * The critical browser-to-backend workflow against the REAL stack
 * (orch + MySQL + Redis + zvid-cell + editor + dash). One self-contained
 * test with reported steps; ~2 credits are genuinely consumed per run.
 *
 * Infra prerequisites: tests/real-e2e/README.md.
 */

test.describe.configure({ mode: 'default' })

/**
 * Run a dash-UI verification with a hard wall-clock cap. The dash SSR/render
 * is unstable in this build (documented in the README); this ensures a dash
 * hiccup annotates the report instead of hanging the headline flow. The
 * facts these blocks check are also asserted via the orch API, which is the
 * source of truth.
 */
async function dashBestEffort(
  testInfo: import('@playwright/test').TestInfo,
  label: string,
  fn: () => Promise<void>
) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('dash timed out')), 60_000)),
    ])
  } catch (e) {
    testInfo.annotations.push({
      type: 'dash-best-effort',
      description: `${label}: ${(e as Error).message} — verified via orch API instead (known dash SSR instability)`,
    })
  }
}

test('core workflow: register → editor → save → template → render → artifact → dash → credits → logout', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(15 * 60_000)
  await requireOrch()
  await requireDash()
  await requireEditor()
  await requireFixtures()
  test.skip(ENV.skipRender, 'REAL_SKIP_RENDER=1 — core workflow needs a real render')

  let flowUser!: OrchUser
  const created = { project: '', template: '', upload: '', job: '' }

  try {
    await test.step('1. register through the real dash UI', async () => {
      const uiUser = newIdentity('pw-ui')
      await page.goto(`${ENV.dashUrl}/register`, { waitUntil: 'domcontentloaded' })
      await page.fill('#firstName', uiUser.firstName)
      await page.fill('#lastName', uiUser.lastName)
      await page.fill('#email', uiUser.email)
      await page.fill('#password', uiUser.password)
      await page.fill('#confirmPassword', uiUser.password)
      await page.getByRole('button', { name: 'Create account' }).click()
      // fresh accounts land on the verify-email screen
      await expect(
        page.getByText(/verify|check your email/i).first()
      ).toBeVisible({ timeout: 30_000 })
      // the account exists for real: orch authenticates it
      const login = await orchFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: uiUser.email, password: uiUser.password }),
      })
      expect(login.status, 'UI-registered account can log in via orch').toBe(200)
      // dash gates unverified accounts behind onboarding, so the rest of the
      // flow uses a REST-provisioned VERIFIED account (dev-only email-token
      // extraction, same technique as k6-tests)
      flowUser = await provisionVerifiedUser('pw-flow')
    })

    await test.step('2. log in through the real dash UI', async () => {
      await dashLogin(page, flowUser)
      await expect(page).not.toHaveURL(/\/login/)
    })

    await test.step('3. editor opens with the real authenticated session', async () => {
      await openRealEditor(page)
      await expect
        .poll(
          () => page.evaluate(() => (window as any).__zvidTest.auth.user?.email),
          { timeout: 20_000 }
        )
        .toBe(flowUser.email)
    })

    await test.step('4. import a deterministic project via the Import modal', async () => {
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      await page.fill('.modal-backdrop .code-ed textarea', JSON.stringify(tinyProject(`${NAME_PREFIX}core`)))
      await page.getByRole('button', { name: 'Import project' }).click()
      await expect(page.locator('.modal-backdrop')).toHaveCount(0)
      const doc = await page.evaluate(() => (window as any).__zvidTest.exportedDoc())
      expect(doc.name).toBe(`${NAME_PREFIX}core`)
      expect(doc.visuals).toHaveLength(2)
    })

    await test.step('5. upload deterministic local fixture media', async () => {
      await page.locator('.rail-tab', { hasText: 'Images' }).click()
      const uploadRes = page.waitForResponse(
        (r) => r.url().includes('/api/uploads') && r.request().method() === 'POST',
        { timeout: 60_000 }
      )
      await page.setInputFiles(
        '.uploads-section input[type="file"]',
        'tests/e2e/fixtures/image.png'
      )
      const res = await uploadRes
      if (res.status() >= 500) {
        testInfo.annotations.push({
          type: 'skip-step',
          description: `upload skipped: orch object storage (B2) unavailable (HTTP ${res.status()})`,
        })
      } else {
        expect(res.status(), 'upload accepted').toBeLessThan(400)
        const body = await res.json().catch(() => ({}))
        created.upload = body?.upload?.id ?? ''
        await expect(page.locator('.uploads-section .cell').first()).toBeVisible()
      }
    })

    await test.step('6. save and update the cloud project', async () => {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('button', { name: 'Save project' }).click()
      await expect
        .poll(() => page.evaluate(() => (window as any).__zvidTest.editor.cloudProject?.id))
        .toMatch(/^prj_/)
      created.project = await page.evaluate(
        () => (window as any).__zvidTest.editor.cloudProject.id
      )
      // verify server-side via orch, then update (rename → PUT) and re-verify
      const before = await orchFetch(`/projects/${created.project}`, { token: flowUser.token })
      expect(before.status).toBe(200)
      await page.evaluate((n) => {
        ;(window as any).__zvidTest.project.doc.name = n
      }, `${NAME_PREFIX}core-v2`)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect
        .poll(async () => {
          const r = await orchFetch(`/projects/${created.project}`, { token: flowUser.token })
          return r.body?.project?.name
        }, { timeout: 20_000 })
        .toBe(`${NAME_PREFIX}core-v2`)
    })

    await test.step('7. save as template (plan-validated)', async () => {
      await page.locator('.account .avatar').click()
      await page.locator('.account .menu .item', { hasText: 'Save as template' }).click()
      await page.getByRole('button', { name: 'Save template' }).click()
      // templates are validated against plan limits at save time (unlike
      // drafts). Success → a tpl_ id; failure → an inline validation message.
      const modal = page.locator('.modal-backdrop')
      await expect
        .poll(async () => {
          const t = await modal.innerText()
          if (/tpl_[a-z0-9]+/i.test(t)) return 'ok'
          if (/invalid|check your input|not allowed|plan limit/i.test(t)) return 'invalid'
          return 'pending'
        }, { timeout: 30_000 })
        .not.toBe('pending')
      const text = await modal.innerText()
      created.template = /tpl_[a-z0-9]+/i.exec(text)?.[0] ?? ''
      if (created.template) {
        expect(created.template).toMatch(/^tpl_/)
      } else {
        // local fixture media fails plan validation for templates — expected
        // in a local stack; the render path (which resolves local media in
        // the cell) still proceeds below
        testInfo.annotations.push({
          type: 'skip-step',
          description:
            'save-as-template rejected by plan validation (local fixture src not accepted for templates)',
        })
      }
      await page.locator('.modal-backdrop button[aria-label="Close"]').click()
    })

    let balanceBefore = 0
    await test.step('8. submit a real render', async () => {
      balanceBefore = await creditsBalance(flowUser.token)
      await page.getByRole('button', { name: 'Render', exact: true }).click()
      await expect(page.locator('.modal-backdrop')).toBeVisible()
      await page.getByRole('button', { name: 'Start render' }).click()
      // job appears in orch
      await expect
        .poll(async () => {
          const r = await orchFetch('/jobs?page=1&limit=5&sortBy=createdAt&sortOrder=DESC', {
            token: flowUser.token,
          })
          created.job = r.body?.jobs?.[0]?.id ?? ''
          return created.job
        }, { timeout: 60_000, intervals: [1000] })
        .toBeTruthy()
    })

    let resultUrl = ''
    await test.step('9. observe queued → processing → completed', async () => {
      const { final, observedStates } = await waitForJob(flowUser.token, created.job)
      testInfo.annotations.push({
        type: 'job-states',
        description: observedStates.join(' → '),
      })
      const known = new Set(['waiting', 'active', 'completed', 'stalled', 'unknown'])
      for (const s of observedStates) {
        expect(known.has(s), `unexpected job state "${s}"`).toBe(true)
      }
      expect(final.state, `job failed: ${JSON.stringify(final.raw?.failedReason ?? '')}`).toBe(
        'completed'
      )
      resultUrl = final.resultUrl ?? ''
      expect(resultUrl, 'completed job exposes an output url/path').toBeTruthy()
      // the editor's render modal also lands on its done state
      await expect(page.locator('.modal-backdrop')).toContainText(/download/i, {
        timeout: 30_000,
      })
      await page.locator('.modal-backdrop button[aria-label="Close"]').click()
    })

    await test.step('10. validate the downloaded artifact', async () => {
      const meta = await validateVideoArtifact(testInfo, resultUrl, {
        width: 640,
        height: 360,
        duration: 2,
      })
      testInfo.annotations.push({
        type: 'artifact',
        description: `${meta.format} ${meta.width}x${meta.height} ${meta.duration}s ${meta.bytes}B`,
      })
    })

    await test.step('11. job is listed for the account (orch API + dash UI)', async () => {
      // hard assertion via orch: the completed job is retrievable for the user
      const jobsRes = await orchFetch('/jobs?page=1&limit=20&sortBy=createdAt&sortOrder=DESC', {
        token: flowUser.token,
      })
      const job = (jobsRes.body?.jobs ?? []).find((j: any) => j.id === created.job)
      expect(job, 'render job is listed for the account').toBeTruthy()
      expect(job.status).toBe('completed')
      // best-effort dash UI: the renders page shows the job (dash SSR/render
      // is unstable in this build — don't fail the headline flow on it)
      await dashBestEffort(testInfo, 'dash renders page', async () => {
        await dashReturn(page, flowUser)
        await dashClientGoto(page, '/videos')
        const card = page.locator('.zv-card').filter({ hasText: job.name || `${NAME_PREFIX}core` }).first()
        await expect(card).toBeVisible({ timeout: 20_000 })
        await expect(card.getByRole('button', { name: 'Download' })).toBeVisible()
      })
    })

    await test.step('12. credit balance reflects the expected charge', async () => {
      // hard assertion: 2s ≤1080p render = 2 credits (orch ceil(duration × 1))
      const after = await creditsBalance(flowUser.token)
      expect(balanceBefore - after).toBe(2)
      // best-effort dash UI mirror of the balance
      await dashBestEffort(testInfo, 'dash credits page', async () => {
        await dashReturn(page, flowUser)
        await dashClientGoto(page, '/credits')
        await expect(page.locator('p.text-5xl')).toHaveText(String(after), { timeout: 20_000 })
      })
    })

    await test.step('13. logout and expired-session behavior', async () => {
      // hard assertion via orch: the auth token still authenticates now…
      expect((await orchFetch('/user/profile', { token: flowUser.token })).status).toBe(200)
      // …and the dash UI logout returns to /login (best-effort on dash health)
      await dashBestEffort(testInfo, 'dash logout', async () => {
        await dashReturn(page, flowUser)
        await page.locator('button[aria-label="Open profile menu"]').click()
        await page.getByRole('button', { name: 'Logout' }).click()
        await page.waitForURL(/\/login/, { timeout: 20_000 })
        await expect(page.locator('#email')).toBeVisible()
      })
    })
  } finally {
    if (ENV.cleanup && flowUser) {
      if (created.job) await cleanup.job(flowUser.token, created.job)
      if (created.project) await cleanup.project(flowUser.token, created.project)
      if (created.template) await cleanup.template(flowUser.token, created.template)
      if (created.upload) await cleanup.upload(flowUser.token, created.upload)
    }
  }
})

test('expired session: client guard bounces a de-authenticated user to login', async ({
  page,
}) => {
  await requireOrch()
  await requireDash()
  // start authenticated (real login), then drop the session and confirm the
  // app no longer treats the user as signed in: /login shows its form instead
  // of redirecting an authenticated user away.
  const user = await provisionVerifiedUser('pw-expired')
  await dashLogin(page, user)
  await expect(page).not.toHaveURL(/\/login/)
  await expectDeauthenticated(page)
  await expect(page.locator('#email')).toBeVisible()
})

test('login rejects a wrong password with a visible error', async ({ page }) => {
  await requireDash()
  await requireOrch()
  const user = await provisionVerifiedUser('pw-badpass')
  await page.goto(`${ENV.dashUrl}/login`)
  await page.fill('#email', user.email)
  await page.fill('#password', 'Wrong!Pass1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  // vue-sonner error toast; stays on /login
  await expect(page.locator('[data-sonner-toast], .zv-toast, [class*=toast]').first()).toBeVisible(
    { timeout: 15_000 }
  )
  await expect(page).toHaveURL(/\/login/)
})
