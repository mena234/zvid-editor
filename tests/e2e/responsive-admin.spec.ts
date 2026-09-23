import { test, expect, type Locator, type Page } from '@playwright/test'
import { openEditor, loadProject, store, fx } from './helpers/app'

const title = `Responsive admin example ${'UnbrokenExampleTitle'.repeat(15)}`
const slug = 'responsive-admin-fixture'
async function fits(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  const b = (await locator.boundingBox())!
  const viewport = page.viewportSize()!
  expect(b.x).toBeGreaterThanOrEqual(-1)
  expect(b.y).toBeGreaterThanOrEqual(-1)
  expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(b.y + b.height).toBeLessThanOrEqual(viewport.height + 1)
}
async function publishState(page: Page, patch: Record<string, unknown>) {
  // Test fixture only: drive local progress/error/result views without starting
  // a cloud render or touching the shared mock service's mutable state.
  await page.evaluate(patch => {
    const editor = (window as any).__zvidTest.editor
    editor._p._s.get('examplePublish').$patch(patch)
  }, patch)
}

for (const viewport of [
  { name: 'phone', width: 320, height: 640 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'landscape', width: 844, height: 390 },
]) {
  test.describe(`responsive admin ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true })
    test.beforeEach(async ({ page }) => {
      await page.route('**/api/session', route => route.fulfill({ json: {
        user: { id: 9, email: 'admin@example.test', isAdmin: true }, credits: { balance: 0 }, plan: null,
      } }))
      await openEditor(page)
      await page.waitForFunction(() => (window as any).__zvidTest.auth.loaded)
      await loadProject(page, { name: 'Admin UI fixture', resolution: 'full-hd', duration: 3,
        visuals: [{ type: 'IMAGE', src: fx('image.png'), width: 200, height: 200 }], audios: [],
      })
      await page.evaluate(({ title, slug }) => {
        const t = (window as any).__zvidTest
        t.auth.user = { id: 9, email: 'admin@example.test', isAdmin: true }
        t.editor.setSourceExample({ slug, title, meta: null })
      }, { title, slug })
    })

    test('long title preserves both actions and publish confirmation fits', async ({ page }, info) => {
      const banner = page.locator('.admin-ex-banner')
      await fits(page, banner)
      expect(await banner.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const stop = banner.getByRole('button', { name: 'Stop editing', exact: true })
      const publish = banner.getByRole('button', { name: 'Render & publish', exact: true })
      await fits(page, stop)
      await fits(page, publish)
      await publish.tap()
      const dialog = page.getByRole('dialog', { name: 'Publish example', exact: true })
      await fits(page, dialog)
      await expect(dialog).toContainText(title)
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const confirm = dialog.getByRole('button', { name: 'Render & publish', exact: true })
      await confirm.scrollIntoViewIfNeeded()
      await fits(page, confirm)
      await confirm.tap({ trial: true })
      await page.screenshot({ path: info.outputPath('admin-confirmation.png') })
      await dialog.getByRole('button', { name: 'Close', exact: true }).tap()
      await stop.tap()
      await expect(banner).toHaveCount(0)
      expect(await store(page, 'editor', 'sourceExample')).toBeNull()
    })

    test('error, active progress and completed preview remain reachable', async ({ page }, info) => {
      let publishRequests = 0
      await page.route('**/api/admin/**', async route => {
        publishRequests++
        await route.fulfill({ status: 500, json: { message: 'No admin network requests expected in responsive UI tests' } })
      })
      await publishState(page, { status: 'error', slug, title,
        errorMsg: 'LongDiagnosticWithoutBreaks'.repeat(30),
        errorDetails: [{ field: 'visuals.0.src', message: 'LongSourceError'.repeat(25) }],
      })
      const banner = page.locator('.admin-ex-banner')
      await banner.getByRole('button', { name: 'Render & publish', exact: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'Publish example', exact: true })
      await fits(page, dialog)
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const retry = dialog.getByRole('button', { name: 'Try again', exact: true })
      await retry.scrollIntoViewIfNeeded()
      await fits(page, retry)
      await retry.tap()
      await expect(dialog.getByRole('button', { name: 'Render & publish', exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Close', exact: true }).tap()

      await publishState(page, { status: 'rendering', slug, title, progress: 47 })
      await fits(page, banner.getByTitle('Publishing — click for details', { exact: true }))
      await expect(banner.getByRole('button', { name: 'Render & publish', exact: true })).toBeDisabled()
      await banner.getByRole('button', { name: 'Stop editing', exact: true }).tap()
      await expect(banner).toBeVisible()
      await banner.getByTitle('Publishing — click for details', { exact: true }).tap()
      await fits(page, dialog)
      await expect(dialog).toContainText(title)
      await expect(dialog).toContainText('47%')
      await publishState(page, { status: 'done', progress: 100, newVersion: 2, previewUrl: fx('clip.mp4') })
      const preview = dialog.locator('video.result')
      await preview.scrollIntoViewIfNeeded()
      await fits(page, preview)
      await expect(preview).toHaveJSProperty('muted', true)
      const done = dialog.getByRole('button', { name: 'Done', exact: true })
      await done.scrollIntoViewIfNeeded()
      await fits(page, done)
      await page.screenshot({ path: info.outputPath('admin-completed.png') })
      await done.tap()
      await expect(dialog).toHaveCount(0)
      await expect(banner).toHaveCount(0)
      expect(publishRequests).toBe(0)
    })
  })
}
