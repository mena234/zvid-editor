import { test, expect } from '@playwright/test'
import { openEditor, loadProject, exportedDoc, resetMockOrch } from './helpers/app'

const BASE = {
  name: 'font-catalog', width: 640, height: 360, duration: 8,
  frameRate: 30, outputFormat: 'mp4',
  visuals: [{ type: 'TEXT', text: 'All Google Fonts' }],
}

test.beforeAll(async () => { await resetMockOrch() })
test.beforeEach(async ({ page }) => {
  await openEditor(page)
  await loadProject(page, BASE)
  await page.evaluate(() => {
    const t = (window as any).__zvidTest
    t.editor.selectVisual(t.project.doc.visuals[0]._id)
    t.editor.openInspector()
  })
})

test('full catalog: browse beyond the first page, search, select, export, and reopen', async ({ page }, testInfo) => {
  const trigger = page.getByRole('button', { name: 'Font family', exact: true })
  const menu = page.getByRole('dialog', { name: 'Choose Google font' })
  const search = page.getByRole('textbox', { name: 'Search Google Fonts' })
  const fontLinks = page.locator('head link[data-zvid-font]')
  const initialLinks = await fontLinks.count()
  await trigger.click()
  await expect(search).toBeFocused()
  expect(Number((await menu.getByRole('status').innerText()).replace(/\D/g, ''))).toBeGreaterThan(1900)
  await expect(menu.locator('.font-item[aria-pressed]')).toHaveCount(60)
  await menu.getByRole('button', { name: /Show more fonts/ }).click()
  await expect(menu.locator('.font-item[aria-pressed]')).toHaveCount(120)
  await expect(fontLinks).toHaveCount(initialLinks)
  // Show more focuses the first newly revealed family. Enter selects it,
  // without the editor's global Enter shortcut starting a stage text edit.
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  expect((await exportedDoc(page)).visuals[0].text).toBe('All Google Fonts')
  await trigger.press('Enter')
  await expect(search).toBeFocused()

  // Search must scan the entire catalog, not just the displayed page.
  await search.fill('  noto sans arabic  ')
  await expect(menu.getByRole('button', { name: 'Noto Sans Arabic', exact: true })).toBeVisible()
  await expect(menu.locator('.custom')).toHaveCount(0)
  await search.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect.poll(async () => (await exportedDoc(page)).visuals[0].style.fontFamily).toBe('Noto Sans Arabic')
  await expect(page.locator('head link[data-zvid-font="Noto Sans Arabic"]')).toHaveCount(1)

  // Importing the exported document retains a newly available family.
  await loadProject(page, await exportedDoc(page))
  await page.evaluate(() => {
    const t = (window as any).__zvidTest
    t.editor.selectVisual(t.project.doc.visuals[0]._id)
    t.editor.openInspector()
  })
  await expect(trigger).toContainText('Noto Sans Arabic')
  await trigger.click()
  await search.fill('ZCOOL XiaoWei')
  await menu.getByRole('button', { name: 'ZCOOL XiaoWei', exact: true }).click()
  await expect.poll(async () => (await exportedDoc(page)).visuals[0].style.fontFamily).toBe('ZCOOL XiaoWei')
  await trigger.click()
  await search.fill('Bungee')
  await expect(menu.getByRole('button', { name: 'Bungee Spice', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('font-picker.png') })
  await search.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('custom names remain available and dismissal does not change the selection', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Font family', exact: true })
  const menu = page.getByRole('dialog', { name: 'Choose Google font' })
  const search = page.getByRole('textbox', { name: 'Search Google Fonts' })
  await trigger.click()
  await search.fill('   ')
  await expect(menu.locator('.custom')).toHaveCount(0)
  await search.fill('  Future Catalog Font  ')
  await expect(menu).toContainText('No matching fonts')
  await menu.getByRole('button', { name: 'Use “Future Catalog Font”', exact: true }).click()
  await expect.poll(async () => (await exportedDoc(page)).visuals[0].style.fontFamily).toBe('Future Catalog Font')
  await trigger.click()
  await page.locator('.field-label', { hasText: 'Font family (Google Fonts)' }).click()
  await expect(menu).toHaveCount(0)
  await expect(trigger).toContainText('Future Catalog Font')
})

test('subtitle and Design Studio pickers export families from the full catalog', async ({ page }) => {
  await page.route('**/jassub/**', (route) => route.abort())
  await page.route('**/api/fonts**', (route) => route.abort())
  await page.click('.rail-tab[title="Subtitles"]')
  await page.getByRole('button', { name: 'Add caption at playhead' }).click()
  await page.locator('.subs-panel .sec-head.as-btn', { hasText: 'Subtitle style' }).click()
  await page.locator('.subs-panel').getByRole('button', { name: 'Font family', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Choose Google font' })
  const search = page.getByRole('textbox', { name: 'Search Google Fonts' })
  await search.fill('Noto Sans Devanagari')
  await menu.getByRole('button', { name: 'Noto Sans Devanagari', exact: true }).click()
  await expect.poll(async () => (await exportedDoc(page)).subtitle?.font?.family).toBe('Noto Sans Devanagari')

  await page.click('.rail-tab[title="Design"]')
  await page.click('.design-panel .hero')
  // Clicking an empty corner opens the design-wide canvas/font controls.
  await page.locator('.preview .frame').click({ position: { x: 5, y: 5 } })
  await page.locator('.col-right').getByRole('button', { name: 'Font family', exact: true }).click()
  await search.fill('Bungee Spice')
  await menu.getByRole('button', { name: 'Bungee Spice', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await expect.poll(async () => (await exportedDoc(page)).visuals.at(-1)?.style?.fontFamily).toBe('Bungee Spice')
  expect((await exportedDoc(page)).visuals.at(-1).designer.fontFamily).toBe('Bungee Spice')
})
