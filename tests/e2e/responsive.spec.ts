import { test, expect, type Locator, type Page } from '@playwright/test'
import { openEditor, resetMockOrch } from './helpers/app'

async function fits(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  await expect.poll(async () => {
    const box = await locator.boundingBox()
    const viewport = page.viewportSize()!
    return !!box && box.x >= -1 && box.y >= -1
      && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1
  }).toBe(true)
}

test.beforeEach(async () => { await resetMockOrch() })

test('essential controls and workspace fit phones, tablets and laptops', async ({ page }, info) => {
  await openEditor(page)
  for (const [width, height] of [[1920,1080], [1440,900], [1366,768], [1280,720], [1024,768], [820,1180], [768,1024], [640,800], [414,896], [375,812], [320,640], [844,390]]) {
    await page.setViewportSize({ width, height })
    for (const selector of ['.topbar', '.project-identity', '.output-actions', '.account', '.stage-frame', '.stage-foot', '.tl-panel', '.rail-tabs']) {
      await fits(page, page.locator(selector))
    }
    for (const name of ['Save', 'Render', 'Export', 'Sign in']) {
      await fits(page, page.locator('.topbar').getByRole('button', { name, exact: true }))
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: info.outputPath(`editor-${width}.png`) })
  }
})

test('phone menus, settings, tools, export and sign-in remain usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await openEditor(page)
  const more = page.getByRole('button', { name: 'More editor actions', exact: true })
  await more.click()
  await fits(page, page.locator('.secondary-actions'))
  await page.getByTitle('New empty project').click()
  await fits(page, page.getByRole('button', { name: 'Image project', exact: true }))
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await expect(more).toHaveAttribute('aria-expanded', 'false')

  const settings = page.getByRole('button', { name: 'Project settings', exact: true })
  await settings.click()
  await page.getByTitle('Resolution preset', { exact: true }).selectOption('custom')
  await page.getByRole('button', { name: 'Project duration settings' }).click()
  await fits(page, page.locator('.settings-popover'))
  expect(await page.locator('.settings-popover').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('phone-settings.png') })
  await page.keyboard.press('Escape')
  await expect(settings).toBeFocused()

  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await fits(page, page.locator('.rail-panel'))
  await settings.click()
  await page.getByRole('button', { name: 'Project duration settings' }).click()
  await page.getByTitle('Output format', { exact: true }).click({ trial: true })
  await page.getByTitle('Output format', { exact: true }).selectOption('webm')
  await expect(page.getByTitle('Output format', { exact: true })).toHaveValue('webm')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Close tool panel' }).click()
  await expect(page.locator('.rail-panel')).toHaveCount(0)

  await page.locator('.topbar').getByRole('button', { name: 'Export', exact: true }).click()
  await fits(page, page.locator('.modal'))
  const download = page.getByRole('button', { name: /^Download / })
  await fits(page, download)
  const downloaded = page.waitForEvent('download')
  await download.click()
  expect((await downloaded).suggestedFilename()).toMatch(/\.json$/)
  await page.screenshot({ path: info.outputPath('phone-export.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.locator('.topbar').getByRole('button', { name: 'Render', exact: true }).click()
  await fits(page, page.locator('.modal'))
  await page.getByRole('button', { name: 'Sign in to render', exact: true }).click()
  await fits(page, page.locator('.modal'))
  await fits(page, page.getByLabel('Email', { exact: true }))
  await fits(page, page.getByLabel('Password', { exact: true }))
  await page.screenshot({ path: info.outputPath('phone-sign-in.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
})

test('account menu and image mode fit a touch viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await openEditor(page, { authed: true, query: '?type=image' })
  await page.locator('.account .avatar').click()
  await fits(page, page.locator('.account .menu'))
  await page.keyboard.press('Escape')
  await expect(page.locator('.account .avatar')).toBeFocused()
  await expect(page.locator('.tl-panel')).toHaveCount(0)
  await fits(page, page.locator('.stage-frame'))
  await page.screenshot({ path: info.outputPath('phone-image.png') })
})

test('tour reveals compact actions and stays inside small screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await openEditor(page)
  await page.getByRole('button', { name: 'More editor actions', exact: true }).click()
  await page.getByTitle('Product tour', { exact: true }).click()
  for (let step = 0; step < 9; step++) {
    await fits(page, page.locator('.tour .card'))
    const target = await page.evaluate(() => (window as any).__zvidTest.tour.current.target)
    if (target) await fits(page, page.locator(`[data-tour="${target}"]`))
    if (target === 'stage' || target === 'timeline') {
      await expect(page.locator('.rail-panel')).toHaveCount(0)
    }
    await page.locator('.tour .btn.primary').click()
  }
  await expect(page.locator('.tour')).toHaveCount(0)
})

test('touch editing and Design Studio remain accessible with a long project name', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  try {
    await openEditor(page)
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('A very long project title for testing responsive exports')
    await page.getByRole('button', { name: 'Text', exact: true }).tap()
    await page.getByRole('button', { name: 'Add a heading Heading', exact: true }).tap()
    await page.getByRole('button', { name: 'Close tool panel' }).tap()
    await fits(page, page.locator('.stage-frame'))
    await expect(page.locator('.stage-frame')).toContainText('Your heading')
    await page.locator('.stage-frame').getByText('Your heading', { exact: true }).tap()
    await fits(page, page.locator('.rail-panel'))
    await page.getByRole('button', { name: 'Close tool panel' }).tap()
    await page.getByRole('button', { name: 'Text', exact: true }).tap()
    await page.locator('.design-cta').tap()
    await expect(page.getByRole('dialog', { name: 'Design Studio', exact: true })).toBeVisible()
    await fits(page, page.locator('.modal'))
    expect(await page.locator('.modal-body').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
    await fits(page, page.locator('.modal-foot'))
    await page.locator('.modal-body').evaluate(e => e.scrollTop = 0)
    await page.screenshot({ path: info.outputPath('touch-design-studio.png') })
    await page.getByRole('button', { name: 'Close', exact: true }).tap()
    await page.locator('.topbar').getByRole('button', { name: 'Export', exact: true }).tap()
    await fits(page, page.getByRole('button', { name: 'Download JSON', exact: true }))
    await page.screenshot({ path: info.outputPath('touch-long-name-export.png') })
  } finally {
    await context.close()
  }
})
