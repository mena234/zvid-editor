import { test, expect } from './helpers/stack'
import { requireLanding, requireOrch } from './helpers/stack'
import { ENV, newIdentity } from './helpers/env'

/**
 * Landing-site flows against the real stack: pricing → registration/login
 * handoff, public blog routes, and the (partner/affiliate-embedded) contact
 * form. Paddle overlays are not driven end-to-end — button/gate states are
 * asserted instead.
 */

test('home page renders with working nav login/register handoff', async ({ page }) => {
  await requireLanding()
  await page.goto(ENV.landingUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('nav, [class*=navbar]').first()).toBeVisible({ timeout: 30_000 })

  // nav Login link targets the dash login page. (Dev-config quirk: the host
  // is localhost:3001 while dash serves :3002 — assert the path handoff.)
  const login = page.locator('a[href*="/login"]').first()
  await expect(login).toBeVisible()

  // hero CTA ("Create Your First Video") hands off to dash registration
  const cta = page.locator('a[href*="/register"]').first()
  await expect(cta).toBeVisible()
})

test('pricing: plan cards, cadence toggle, email gate routes unknown users to registration', async ({
  page,
}) => {
  await requireLanding()
  await requireOrch()
  await page.goto(`${ENV.landingUrl}/pricing`, { waitUntil: 'domcontentloaded' })

  // paid plan cards come from orch's real paddle catalog
  const subscribe = page.getByRole('button', { name: 'Subscribe' }).first()
  await expect(subscribe).toBeEnabled({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Monthly' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yearly' })).toBeVisible()

  // email gate: an unregistered address must be told to register, with a
  // register link (real orch precheckout decides this)
  await subscribe.click()
  const gate = page.locator('#checkout-email')
  await expect(gate).toBeVisible({ timeout: 15_000 })
  await gate.fill(newIdentity('pw-gate').email)
  await page.getByRole('button', { name: /continue/i }).click()
  const registerLink = page.getByRole('link', { name: /register/i }).first()
  await expect(registerLink).toBeVisible({ timeout: 30_000 })
  expect(await registerLink.getAttribute('href')).toMatch(/\/register/)
})

test('public blog routes serve real content', async ({ page }) => {
  await requireLanding()
  await requireOrch()
  const res = await page.goto(`${ENV.landingUrl}/blog`, { waitUntil: 'domcontentloaded' })
  expect(res!.status(), '/blog route serves').toBeLessThan(400)

  // if orch has published posts, the first article link must open
  // (posts are two-segment /blog/<category>/<slug>; skip category/tag indexes)
  const postHrefs = await page.$$eval('a[href^="/blog/"]', (as) =>
    as
      .map((a) => a.getAttribute('href') || '')
      .filter((h) => /^\/blog\/(?!tag\/)[^/]+\/[^/]+$/.test(h))
  )
  if (postHrefs.length > 0) {
    const postRes = await page.goto(`${ENV.landingUrl}${postHrefs[0]}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(postRes!.status()).toBeLessThan(400)
    await expect(page.locator('h1').first()).toBeVisible()
  } else {
    test.info().annotations.push({
      type: 'note',
      description: 'no published blog posts in this environment — listing asserted only',
    })
  }
})

test('contact form on /partner submits to the real orch contact endpoint', async ({
  page,
}) => {
  await requireLanding()
  await requireOrch()
  await page.goto(`${ENV.landingUrl}/partner`, { waitUntil: 'domcontentloaded' })
  const email = page.locator('input[type="email"][id^="contact"], #contact-email').first()
  if ((await email.count()) === 0) {
    test.skip(true, '/partner does not embed the contact form in this build')
  }
  await email.scrollIntoViewIfNeeded()
  await email.fill(newIdentity('pw-contact').email)
  await page
    .locator('textarea[id^="contact"], #contact-text')
    .first()
    .fill('[automated real-e2e test] please ignore — synthetic contact-form check.')
  const contactRes = page.waitForResponse(
    (r) => r.url().includes('/contact') && r.request().method() === 'POST',
    { timeout: 30_000 }
  )
  await page.getByRole('button', { name: 'Submit' }).click()
  expect((await contactRes).status()).toBeLessThan(400)
  await expect(page.getByText(/request sent/i)).toBeVisible({ timeout: 15_000 })
})

test('legal + misc public routes respond', async ({ page }) => {
  await requireLanding()
  for (const path of ['/privacy', '/terms', '/editor']) {
    const res = await page.goto(`${ENV.landingUrl}${path}`, { waitUntil: 'domcontentloaded' })
    expect(res!.status(), path).toBeLessThan(400)
  }
})
