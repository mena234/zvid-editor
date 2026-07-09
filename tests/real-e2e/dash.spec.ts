import { test, expect } from './helpers/stack'
import { requireDash, requireOrch } from './helpers/stack'
import { ENV, NAME_PREFIX } from './helpers/env'
import { provisionVerifiedUser, orchFetch, cleanup } from './helpers/orch'
import { dashLogin, dashClientGoto } from './helpers/apps'

/**
 * Focused dashboard flows against the real stack: API keys, navigation,
 * subscription/credit UI states. Each test provisions its own verified user
 * (fresh 1200-credit FREE account) so tests are order-independent.
 *
 * IMPORTANT: this dash build's SSR of any *protected* page OOMs the render
 * worker (a real dash defect — see tests/real-e2e/README.md). So every test
 * loads the SPA once via the public /login page (SSR-safe), authenticates
 * through the UI, then reaches protected pages by CLIENT-side navigation.
 * Never `page.goto()` a protected route here.
 */

test('API key: create through the UI, revealed once, revoke through the UI', async ({
  page,
}) => {
  await requireOrch()
  await requireDash()
  const user = await provisionVerifiedUser('pw-keys')
  await dashLogin(page, user)
  await dashClientGoto(page, '/api-keys')

  let keyId = ''
  try {
    await page.getByRole('button', { name: 'Create API key' }).first().click()
    await page.fill('input.zv-input', `${NAME_PREFIX}key`)
    await page.getByRole('button', { name: 'Create API Key', exact: true }).click()

    // one-time reveal modal with the zvid_ secret
    const reveal = page.locator('span.text-green-600')
    await expect(reveal).toBeVisible({ timeout: 20_000 })
    const secret = (await reveal.innerText()).trim()
    expect(secret).toMatch(/^zvid_/)
    await page.getByRole('button', { name: 'Done' }).click()

    // card lists the key, backed by the real orch
    await expect(page.locator('.zv-card', { hasText: `${NAME_PREFIX}key` })).toBeVisible()
    const list = await orchFetch('/api-keys', { token: user.token })
    const key = list.body.apiKeys?.find((k: any) => k.name === `${NAME_PREFIX}key`)
    expect(key, 'key exists server-side').toBeTruthy()
    keyId = key.id

    // the raw key actually authenticates against orch
    const viaKey = await fetch(`${ENV.orchUrl}/api/user/profile`, {
      headers: { 'X-API-Key': secret },
    })
    expect(viaKey.status).toBe(200)

    // revoke via UI (native confirm dialog)
    page.on('dialog', (d) => d.accept())
    await page
      .locator('.zv-card', { hasText: `${NAME_PREFIX}key` })
      .locator('button[title="Delete API key"]')
      .click()
    await expect(page.locator('.zv-card', { hasText: `${NAME_PREFIX}key` })).toHaveCount(0, {
      timeout: 15_000,
    })
    const after = await orchFetch('/api-keys', { token: user.token })
    expect(after.body.apiKeys?.some((k: any) => k.id === keyId)).toBeFalsy()
    keyId = ''
  } finally {
    if (ENV.cleanup && keyId) await cleanup.apiKey(user.token, keyId)
  }
})

test('project/job navigation: pages render, editor deep links are wired', async ({
  page,
}) => {
  await requireOrch()
  await requireDash()
  const user = await provisionVerifiedUser('pw-nav')
  // seed one real cloud project so the list is non-empty
  const prj = await orchFetch('/projects', {
    method: 'POST',
    token: user.token,
    body: JSON.stringify({ name: `${NAME_PREFIX}nav`, payload: { duration: 3 } }),
  })
  const projectId: string = prj.body?.project?.id ?? prj.body?.id
  expect(projectId).toMatch(/^prj_/)

  try {
    await dashLogin(page, user)
    await dashClientGoto(page, '/projects')
    const row = page.locator('.zv-card', { hasText: `${NAME_PREFIX}nav` }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    // deep link into the editor carries the project id
    const openLink = row.locator('a[title="Open in editor"]')
    await expect(openLink).toHaveAttribute('href', new RegExp(`project=${projectId}`))

    await dashClientGoto(page, '/videos')
    await expect(page.locator('.zv-seg-btn', { hasText: 'All' }).first()).toBeVisible({
      timeout: 20_000,
    })

    // sidebar credit panel present across pages
    await expect(page.locator('span.text-2xl').first()).toBeVisible()
  } finally {
    if (ENV.cleanup) await cleanup.project(user.token, projectId)
  }
})

test('subscription page: free-plan UI states and credit-pack widgets', async ({ page }) => {
  await requireOrch()
  await requireDash()
  const user = await provisionVerifiedUser('pw-billing')
  await dashLogin(page, user)
  await dashClientGoto(page, '/subscription')

  // the plan name is the span immediately following the "Current plan:" label
  const planLine = page.locator('div', { hasText: /^\s*Current plan:/ }).last()
  await expect(planLine).toBeVisible({ timeout: 30_000 })
  await expect(planLine).toContainText(/free/i)

  // free users see Subscribe CTAs (Paddle overlay not driven)
  await expect(page.getByRole('button', { name: 'Subscribe' }).first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Cancel subscription' })).toHaveCount(0)
  await expect(page.locator('.zv-seg-btn', { hasText: 'Monthly' })).toBeVisible()
  await expect(page.locator('.zv-seg-btn', { hasText: 'Yearly' })).toBeVisible()

  // credit packs render only when orch serves packs — assert consistency
  const packs = await orchFetch('/paddle/credit-packs', { token: user.token })
  const hasPacks =
    packs.status === 200 &&
    (Array.isArray(packs.body) ? packs.body.length : packs.body?.packs?.length)
  if (hasPacks) {
    await expect(page.locator('#credit-addons')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Buy credits' }).first()).toBeVisible()
  } else {
    test.info().annotations.push({
      type: 'note',
      description: 'orch served no credit packs — pack widgets legitimately absent',
    })
  }
})

test('credits page shows the fresh-account balance with usage panels', async ({ page }) => {
  await requireOrch()
  await requireDash()
  const user = await provisionVerifiedUser('pw-credits')
  await dashLogin(page, user)
  await dashClientGoto(page, '/credits')
  // fresh FREE account = 1200 credits
  await expect(page.locator('p.text-5xl')).toHaveText('1200', { timeout: 30_000 })
  await expect(page.getByRole('link', { name: /get more credits/i })).toBeVisible()
})
