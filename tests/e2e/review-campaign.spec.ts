import { test, expect, type Page } from '@playwright/test'
import { openEditor, resetMockOrch, waitBridge, loadProject } from './helpers/app'

function snapshot() {
  return {
    campaignId: 'reviews-v1', eligible: true, canPrompt: true,
    state: {
      answer: null as null | 'yes' | 'no', impressions: 0, dontAskAgain: false,
      dismissedUntil: null, g2Status: 'available', videoStatus: 'available',
    },
    config: {
      g2Url: 'https://www.g2.com/products/zvid/reviews',
      contactEmail: 'mina@zvid.io', g2Credits: 3000, videoCredits: 10000,
    },
  }
}

async function mockCampaign(page: Page) {
  const data = snapshot()
  const actions: Record<string, any>[] = []
  const failures = new Set<string>()
  const delays = new Map<string, number>()
  await page.route('**/api/review-campaign', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: data })
    const body = route.request().postDataJSON()
    actions.push(body)
    if (delays.has(body.action)) await new Promise(resolve => setTimeout(resolve, delays.get(body.action)))
    if (failures.has(body.action)) return route.fulfill({ status: 503, json: { message: 'Synthetic service failure' } })
    if (body.action === 'answer') data.state.answer = body.answer
    if (body.action === 'submit_claim') data.state[body.kind === 'g2' ? 'g2Status' : 'videoStatus'] = 'pending'
    if (body.action === 'show') {
      data.state.impressions++
      return route.fulfill({ json: { ...data, shown: true, leaseToken: 'editor-e2e-lease' } })
    }
    return route.fulfill({ json: data })
  })
  await page.addInitScript(() => {
    localStorage.setItem('zvid-tour-seen', '1')
    // Exercise mailto click handlers without opening an external email app.
    document.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('a[href^="mailto:"]')) event.preventDefault()
    }, true)
  })
  return { actions, data, failures, delays }
}

async function openManual(page: Page) {
  await page.getByRole('button', { name: /^Account for / }).click()
  await page.getByRole('button', { name: 'Share feedback / Review rewards' }).click()
}

test.beforeEach(async ({ context }) => {
  await resetMockOrch()
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'data:' || url.protocol === 'blob:'
      ? route.continue() : route.abort()
  })
})

test('negative feedback retains both rewards; links do not submit claims; video requires permission', async ({ page }, testInfo) => {
  const { actions } = await mockCampaign(page)
  await openEditor(page, { authed: true })
  await waitBridge(page, '!!t.auth.user')
  await openManual(page)
  await page.getByRole('button', { name: 'No', exact: true }).click()
  await page.getByLabel('Tell us about your experience').fill('The subtitles need more editing controls.')
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Zvid on G2' })).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Write a 5-star review of Zvid on G2 with honest feedback.')
  await expect(page.getByRole('link', { name: 'Write a review on G2' })).toHaveAttribute('href', 'https://www.g2.com/products/zvid/reviews')
  await page.getByRole('link', { name: 'Email my review screenshot' }).click()
  await expect(page.getByText('Your email app opens a draft. Attach your screenshot')).toBeVisible()
  expect(actions.some(action => action.action === 'submit_claim')).toBe(false)
  await expect(page.getByRole('button', { name: 'Email my video testimonial' })).toBeDisabled()
  await expect(page.getByRole('button', { name: "I've emailed my video submission" })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await expect(page.getByRole('link', { name: 'Email my video testimonial' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('editor-review-rewards-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: "I've emailed my video submission" }).click()
  await expect(page.getByText('Your submission is marked as sent. The team will check your email and video')).toBeVisible()
  expect(actions.at(-1)).toMatchObject({ action: 'submit_claim', kind: 'video', publicationConsent: true, leaseToken: 'editor-e2e-lease' })
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
  await openManual(page)
  await expect(page.getByRole('heading', { name: 'Review Zvid on G2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yes', exact: true })).toHaveCount(0)
})

test('render completion alone never prompts; output interaction waits until result closes', async ({ page }) => {
  const { actions } = await mockCampaign(page)
  await openEditor(page, { authed: true })
  await waitBridge(page, '!!t.auth.user')
  await loadProject(page, { name: 'Review moment', duration: 3, visuals: [{ type: 'TEXT', text: 'Result', position: 'center-center' }] })
  await page.evaluate(() => (window as any).__zvidTest.editor.openModal('render'))
  await page.getByRole('button', { name: 'Start render' }).click()
  await expect(page.locator('video.result')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForTimeout(6000)
  expect(actions.some(action => action.action === 'show')).toBe(false)
  await page.evaluate(() => (window as any).__zvidTest.editor.openModal('render'))
  await page.getByRole('button', { name: 'Start render' }).click()
  await expect(page.locator('video.result')).toBeVisible()
  await page.locator('video.result').click()
  await page.waitForTimeout(6000)
  expect(actions.some(action => action.action === 'show')).toBe(false)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForTimeout(2000)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'How is your video generation experience so far?' })).toBeVisible({ timeout: 10000 })
  expect(actions.filter(action => action.action === 'show')).toEqual([expect.objectContaining({ manual: false, source: 'editor_output' })])
})

test('rewards fit a phone viewport and opt-out persists through the server action', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { actions } = await mockCampaign(page)
  await openEditor(page, { authed: true })
  await waitBridge(page, '!!t.auth.user')
  await openManual(page)
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Share your experience with Zvid' })).toBeVisible()
  const dialog = page.getByRole('dialog')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('editor-review-rewards-phone.png'), fullPage: true })
  await page.getByRole('button', { name: "Don't ask again" }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => actions.at(-1)?.action).toBe('opt_out')
})

test('failed feedback retains entered text and can be retried successfully', async ({ page }) => {
  const { failures, actions } = await mockCampaign(page)
  await openEditor(page, { authed: true })
  await waitBridge(page, '!!t.auth.user')
  await openManual(page)
  await page.getByRole('button', { name: 'No', exact: true }).click()
  const input = page.getByLabel('Tell us about your experience')
  const feedback = 'تجربة المستخدم 🙂\n<script>window.feedbackExecuted = true</script>'
  await input.fill(feedback)
  failures.add('feedback')
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(input).toHaveValue(feedback)
  failures.delete('feedback')
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Zvid on G2' })).toBeVisible()
  expect(actions.filter(action => action.action === 'feedback')).toHaveLength(2)
  expect(await page.evaluate(() => (window as any).feedbackExecuted)).toBeUndefined()
})

test('a failed claim stays available and retry becomes pending without duplication', async ({ page }) => {
  const { failures, actions } = await mockCampaign(page)
  await openEditor(page, { authed: true })
  await waitBridge(page, '!!t.auth.user')
  await openManual(page)
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  const claim = page.getByRole('button', { name: "I've emailed my G2 submission" })
  failures.add('submit_claim')
  await claim.click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(claim).toBeEnabled()
  failures.delete('submit_claim')
  await claim.click()
  await expect(claim).toHaveCount(0)
  await expect(page.getByRole('dialog')).toContainText('team will check your email before awarding credits')
  expect(actions.filter(action => action.action === 'submit_claim')).toHaveLength(2)
})

test('closing during a slow answer does not reopen the dialog after the response', async ({ page }) => {
  const { delays, actions } = await mockCampaign(page)
  await openEditor(page, { authed: true })
  await waitBridge(page, '!!t.auth.user')
  await openManual(page)
  delays.set('answer', 1800)
  const response = page.waitForResponse(response =>
    response.url().endsWith('/api/review-campaign') && response.request().postDataJSON()?.action === 'answer'
  )
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect.poll(() => actions.some(action => action.action === 'answer')).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1000 })
  await response
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('awarded rewards reopen without submission buttons or renewed consent', async ({ page }) => {
  const { data } = await mockCampaign(page)
  data.state.g2Status = 'awarded'
  data.state.videoStatus = 'awarded'
  await openEditor(page, { authed: true })
  await waitBridge(page, '!!t.auth.user')
  await openManual(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Your G2 review reward has been awarded.')
  await expect(dialog).toContainText('Your video testimonial reward has been awarded.')
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /I've emailed/ })).toHaveCount(0)
})
