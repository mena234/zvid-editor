import { test, expect } from '@playwright/test'
import { openEditor, exportedDoc, resetMockOrch } from './helpers/app'

/**
 * Boot & shell: the app loads, all shell regions render, the test bridge
 * works, theme toggling persists, modals open/close, the rail switches.
 */
test.beforeAll(async () => {
  await resetMockOrch()
})

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('renders all shell regions', async ({ page }) => {
  for (const sel of ['.shell', '.left-rail', '.stage-frame', '.tl-panel', '.rail-tabs']) {
    await expect(page.locator(sel).first(), sel).toBeVisible()
  }
  await expect(page).toHaveTitle(/Zvid/i)
})

test('starts with a default empty video project', async ({ page }) => {
  const doc = await exportedDoc(page)
  expect(doc.visuals ?? []).toEqual([])
  const state = await page.evaluate(() => {
    const t = (window as any).__zvidTest
    return {
      duration: t.project.doc.duration,
      frameRate: t.project.doc.frameRate,
      errors: t.validate().filter((i: any) => i.level === 'error'),
    }
  })
  expect(state.duration).toBeGreaterThan(0)
  expect(state.frameRate).toBeGreaterThan(0)
  expect(state.errors).toEqual([])
})

test('toggles theme and persists it', async ({ page }) => {
  const before = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  )
  await page.click('button[title*="Switch to"]')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .not.toBe(before)
  const stored = await page.evaluate(() => localStorage.getItem('zvid-theme'))
  const attr = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  )
  expect(stored).toBe(attr)
})

test('opens and closes the shortcuts modal', async ({ page }) => {
  await page.click('button[title="Keyboard shortcuts (?)"]')
  await expect(page.locator('.modal-backdrop')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__zvidTest.editor.modal)).toBe(
    'shortcuts'
  )
  await page.click('.modal-backdrop button[aria-label="Close"]')
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
})

test('left rail switches panels', async ({ page }) => {
  const tabs = page.locator('.rail-tab')
  expect(await tabs.count()).toBeGreaterThan(5)
  await tabs.nth(1).click()
  await expect(page.locator('.rail-panel')).toBeVisible()
})
