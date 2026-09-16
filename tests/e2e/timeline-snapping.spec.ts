import { test, expect, type Page, type Locator } from '@playwright/test'
import { openEditor, loadProject, exportedDoc, fx } from './helpers/app'

async function trimTo(page: Page, handle: Locator, from: number, to: number) {
  await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!
  const scale = await page.evaluate(() => (window as any).__zvidTest.editor.pxPerSec)
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  // Small pointer deltas reproduce an auto end repeatedly snapping to itself.
  await page.mouse.move(x + Math.round((to - from) * scale), y, { steps: 140 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('a slow trim in an automatic scene lands on exactly eight seconds', async ({ page }) => {
  await loadProject(page, {
    durationMode: 'auto',
    scenes: [
      {
        duration: -1,
        visuals: [
          { type: 'TEXT', text: 'Title', exitEnd: 5, track: 0 },
          { type: 'TEXT', text: 'Follows scene', track: 1 },
        ],
      },
      { duration: 5 },
    ],
  })
  await page.locator('.scene-block').first().dblclick()
  await trimTo(page, page.locator('.lane[data-track="0"] .trim.r'), 5, 8.02)
  expect((await exportedDoc(page)).scenes[0].visuals[0].exitEnd).toBe(8)
  await expect(page.locator('.scene-duration')).toHaveText('Scene: 0:08.00')
  await expect(page.getByTestId('project-duration')).toHaveText('Project: 0:13.00')
})

test('audio snaps to a half second without being pulled back by matching music', async ({ page }) => {
  await loadProject(page, {
    durationMode: 'auto',
    visuals: [{ type: 'TEXT', text: 'Follows project' }],
    audios: [
      { src: fx('tone.mp3'), exit: 5, track: 0 },
      { src: fx('tone.mp3'), matchDuration: true, track: 1 },
    ],
  })
  await trimTo(page, page.locator('.lane[data-audio-track="0"] .trim.r'), 5, 9.47)
  expect((await exportedDoc(page)).audios[0].exit).toBe(9.5)
  await expect(page.getByTestId('project-duration')).toHaveText('Project: 0:09.50')
  await page.keyboard.press('Control+z')
  expect((await exportedDoc(page)).audios[0].exit).toBe(5)
})

test('switching snapping off allows a precise fractional ending', async ({ page }) => {
  await loadProject(page, {
    durationMode: 'auto',
    visuals: [{ type: 'TEXT', text: 'Title', exitEnd: 5 }],
  })
  await page.getByTitle('Toggle snapping', { exact: true }).click()
  await trimTo(page, page.locator('.tl-panel .clip .trim.r'), 5, 8.05)
  expect((await exportedDoc(page)).visuals[0].exitEnd).toBe(8.05)
})

test('an audio source end remains a snap point when it determines automatic duration', async ({ page }) => {
  await loadProject(page, {
    durationMode: 'auto',
    visuals: [{ type: 'TEXT', text: 'Title', exitEnd: 7 }],
    audios: [{ src: fx('tone.mp3'), audioEnd: 5.55 }],
  })
  await trimTo(page, page.locator('.tl-panel .clip .trim.r'), 7, 5.5)
  expect((await exportedDoc(page)).visuals[0].exitEnd).toBe(5.55)
})
