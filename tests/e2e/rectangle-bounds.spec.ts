import { test, expect, type Page } from '@playwright/test'
import { openEditor, exportedDoc, loadProject } from './helpers/app'
import { LIBRARY_RECTANGLE } from '../helpers/libraryRectangle'

async function expectNoGutter(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const selection = document.querySelector('.sel-box.primary')?.getBoundingClientRect()
    const rect = document.querySelector('.stage-frame .svg-inner rect')?.getBoundingClientRect()
    if (!selection || !rect) return Infinity
    return Math.max(...(['left', 'top', 'right', 'bottom'] as const).map((side) => Math.abs(selection[side] - rect[side])))
  })).toBeLessThan(0.5)
  expect((await exportedDoc(page)).visuals[0].svg).toContain('viewBox="8 8 384 244"')
}

test('existing library rectangle fills its selection before and after resizing, undo and reload', async ({ page }, testInfo) => {
  await openEditor(page)
  await loadProject(page, {
    width: 450, height: 800, duration: 10,
    backgroundColor: '#303038',
    visuals: [{ type: 'SVG', svg: LIBRARY_RECTANGLE, x: 40, y: 220, width: 376, height: 360 }],
  })
  await page.locator('.stage-frame .stage-item').click()
  await expectNoGutter(page)

  const handle = await page.locator('.sel-box.primary [data-resize-handle="s"]').boundingBox()
  expect(handle).not.toBeNull()
  const x = handle!.x + handle!.width / 2
  const y = handle!.y + handle!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 40, { steps: 5 })
  await page.mouse.up()
  await expectNoGutter(page)
  expect((await exportedDoc(page)).visuals[0].height).toBeGreaterThan(360)
  await page.keyboard.press('Control+z')
  await expectNoGutter(page)
  expect((await exportedDoc(page)).visuals[0].height).toBe(360)

  await page.locator('.stage-frame').screenshot({ path: testInfo.outputPath('rectangle-no-gutter.png') })
  await page.evaluate(() => (window as any).__zvidTest.project.autosaveNow())
  // A fresh tab shares storage without rerunning this page's initial reset script.
  const reopened = await page.context().newPage()
  await openEditor(reopened, { keepStorage: true })
  await reopened.locator('.stage-frame .stage-item').click()
  await expectNoGutter(reopened)
})

test('new rectangle from the Shapes panel fills its selection', async ({ page }) => {
  await page.route('**/api/library/shapes?*', (route) => route.fulfill({ json: {
    kind: 'shapes', total: 1, limit: 24, offset: 0, hasMore: false,
    items: [{ kind: 'shapes', slug: 'rect', title: 'Rectangle', meta: { svg: LIBRARY_RECTANGLE, width: 400, height: 260 } }],
  } }))
  await openEditor(page)
  await page.locator('.rail-tab[data-tool="shape"]').click()
  await page.locator('.shape-card[title="Rectangle"]').click()
  await expectNoGutter(page)
})
