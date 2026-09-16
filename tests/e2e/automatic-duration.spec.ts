import { test, expect } from '@playwright/test'
import { openEditor, loadProject, exportedDoc } from './helpers/app'

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('project and scene durations stay distinct and survive reload', async ({
  page,
}) => {
  await loadProject(page, {
    durationMode: 'auto',
    scenes: [
      { id: 'a', duration: 5 },
      { id: 'b', duration: 5 },
      { id: 'c', duration: 5 },
    ],
  })
  await expect(page.getByTestId('project-duration')).toContainText('0:15')
  await page.locator('.scene-block').nth(1).dblclick()
  await expect(page.locator('.scene-duration')).toContainText('0:05')
  await expect(page.getByTestId('project-duration')).toContainText('0:15')
  await page.evaluate(() => (window as any).__zvidTest.project.autosaveNow())
  const reopened = await page.context().newPage()
  await openEditor(reopened, { keepStorage: true })
  await expect(reopened.getByTestId('project-duration')).toContainText('0:15')
})

test('auto trim updates the project and undo restores both', async ({
  page,
}) => {
  await loadProject(page, {
    durationMode: 'auto',
    visuals: [{ type: 'TEXT', text: 'Title', exitEnd: 5 }],
  })
  const handle = page.locator('.tl-panel .clip .trim.r')
  const box = await handle.boundingBox()
  const px = await page.evaluate(
    () => (window as any).__zvidTest.editor.pxPerSec
  )
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    box!.x + box!.width / 2 + px * 3,
    box!.y + box!.height / 2,
    { steps: 8 }
  )
  await page.mouse.up()
  await expect(page.getByTestId('project-duration')).toContainText('0:08')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('project-duration')).toContainText('0:05')
  expect((await exportedDoc(page)).duration).toBeUndefined()
})

test('set-length scene exposes overflow and can extend to fit', async ({
  page,
}) => {
  await loadProject(page, {
    durationMode: 'auto',
    scenes: [
      {
        id: 'a',
        duration: 5,
        visuals: [{ type: 'TEXT', text: 'Title', exitEnd: 8 }],
      },
      { id: 'b', duration: 5 },
    ],
  })
  await page.locator('.scene-block').first().dblclick()
  await page
    .getByRole('button', { name: 'Extend scene to fit', exact: true })
    .click()
  await expect(page.getByTestId('project-duration')).toContainText('0:13')
  await expect(page.locator('.scene-duration')).toContainText('0:08')
})

test('fitting an automatic scene keeps it following later edits', async ({ page }) => {
  await loadProject(page, {
    durationMode: 'auto',
    scenes: [
      { duration: -1, visuals: [{ type: 'TEXT', text: 'Title', exitEnd: 5 }] },
      { duration: 5 },
    ],
  })
  await page.locator('.scene-block').first().dblclick()
  await page.getByRole('button', { name: 'Fit duration', exact: true }).click()
  expect((await exportedDoc(page)).scenes[0].duration).toBe(-1)
  await page.evaluate(() => {
    const p = (window as any).__zvidTest.project
    p.patchVisual(p.doc.scenes[0].visuals[0]._id, { exitEnd: 3 })
  })
  await expect(page.getByTestId('project-duration')).toContainText('0:08')
})

test('fit duration includes captions and clears an automatic minimum', async ({
  page,
}) => {
  await loadProject(page, {
    durationMode: 'auto',
    duration: 20,
    visuals: [{ type: 'TEXT', text: 'Background' }],
    scenes: [{ duration: 5 }],
    subtitle: { captions: [{ start: 5, end: 7, text: 'End' }] },
  })
  await page.getByRole('button', { name: 'Fit duration', exact: true }).click()
  await expect(page.getByTestId('project-duration')).toContainText('0:07')
  await page.getByRole('button', { name: 'Project duration settings' }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Fit content automatically' })
  ).toBeChecked()
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.locator('.output-actions').getByRole('button', { name: 'Save', exact: true })).toBeInViewport()
    await expect(page.locator('.output-actions').getByRole('button', { name: 'Render', exact: true })).toBeInViewport()
    await expect(page.locator('.output-actions').getByRole('button', { name: 'Export', exact: true })).toBeInViewport()
  }
  await page.screenshot({ path: 'tests/e2e/.results/automatic-duration.png' })
})
