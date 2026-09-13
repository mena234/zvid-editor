import { test, expect } from '@playwright/test'
import { openEditor, loadProject, exportedDoc, resetMockOrch } from './helpers/app'

test('preview, overlays, scene editing, delete and undo keep the stage usable', async ({ page }) => {
  await resetMockOrch()
  // Exercise the host application independently of third-party analytics/chat.
  await page.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  await openEditor(page)
  await loadProject(page, {
    width: 640, height: 360, duration: 8,
    visuals: [{ type: 'TEXT', text: 'Global overlay', exitEnd: 8 }],
    scenes: [
      { id: 'one', duration: 4, transition: 'fade', transitionDuration: 0.5,
        visuals: [{ type: 'TEXT', text: 'First scene', exitEnd: 4 }] },
      { id: 'two', duration: 4,
        visuals: [{ type: 'TEXT', text: 'Second scene', exitEnd: 4 }] },
    ],
  })
  for (const playing of [false, true]) {
    await page.evaluate((value) => { (window as any).__zvidTest.editor.playing = value }, playing)
    await page.getByTitle('Preview the full movie with scene transitions (read-only)').click()
    await expect(page.locator('.stage-item.interactive')).toHaveCount(0)
    await page.getByTitle('Edit the global overlay track over the full movie').click()
    await expect(page.locator('.stage-item.interactive')).toHaveCount(1)
    await page.locator('.scene-block').first().dblclick()
    await page.getByTitle('Text', { exact: true }).click()
    await page.locator('.rail-panel .preset').first().click()
    await expect(page.locator('.stage-item.interactive')).toHaveCount(2)
    await page.evaluate(() => (window as any).__zvidTest.editor.openInspector())
    await page.getByTitle('Delete element (Del)', { exact: true }).click()
    await expect(page.locator('.stage-item.interactive')).toHaveCount(1)
    await page.keyboard.press('Control+z')
    await expect(page.locator('.stage-item.interactive')).toHaveCount(2)
    await page.keyboard.press('Control+y')
    await expect(page.locator('.stage-item.interactive')).toHaveCount(1)
    await page.locator('.scene-local-note button', { hasText: 'all scenes' }).click()
  }
  expect((await exportedDoc(page)).scenes[0].visuals).toHaveLength(1)
  expect(errors).toEqual([])
})

test('full preview ends editing and removes selection handles', async ({ page }) => {
  await page.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
  await openEditor(page)
  await loadProject(page, {
    width: 640, height: 360, duration: 8,
    visuals: [{ type: 'TEXT', text: 'Global overlay', exitEnd: 8 }],
    scenes: [{ id: 'one', duration: 8, visuals: [] }],
  })
  await page.locator('.stage-item.interactive').dblclick()
  await expect(page.locator('.text-inner.editing')).toHaveCount(1)
  await page.locator('.text-inner.editing').fill('Edited overlay')
  await page.getByTitle('Preview the full movie with scene transitions (read-only)').click()
  await expect(page.locator('.stage-frame .sel-box')).toHaveCount(0)
  await expect(page.locator('.text-inner.editing')).toHaveCount(0)
  await page.getByTitle('Edit the global overlay track over the full movie').click()
  await expect(page.locator('.stage-item.interactive')).toHaveCount(1)
  expect((await exportedDoc(page)).visuals[0].text).toBe('Edited overlay')
  await page.keyboard.press('Control+z')
  expect((await exportedDoc(page)).visuals[0].text).toBe('Global overlay')
})

test('a pending inline edit remains undoable when its scene unmounts', async ({ page }) => {
  await page.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
  await openEditor(page)
  await loadProject(page, {
    width: 640, height: 360, duration: 8,
    scenes: [{ id: 'one', duration: 8, visuals: [{ type: 'TEXT', text: 'Original' }] }],
  })
  await page.locator('.scene-block').dblclick()
  await page.locator('.stage-item.interactive').dblclick()
  await page.locator('.text-inner.editing').fill('Edited')
  // Switch without a preceding pointer blur, as keyboard/store navigation can.
  await page.evaluate(() => (window as any).__zvidTest.editor.setContext('root'))
  await expect(page.locator('.scene-group')).toHaveCount(1)
  expect((await exportedDoc(page)).scenes[0].visuals[0].text).toBe('Edited')
  await page.keyboard.press('Control+z')
  expect((await exportedDoc(page)).scenes[0].visuals[0].text).toBe('Original')
})

for (const gesture of ['move', 'resize', 'rotate']) {
  test(`switching scene ends an active ${gesture} gesture`, async ({ page }) => {
    await page.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
    await openEditor(page)
    await loadProject(page, {
      width: 640, height: 360, duration: 8,
      scenes: [
        { id: 'one', duration: 4, visuals: [{ type: 'TEXT', text: 'First', x: 100, y: 100, width: 200, height: 80, exitEnd: 4 }] },
        { id: 'two', duration: 4, visuals: [] },
      ],
    })
    await page.evaluate(() => {
      const t = (window as any).__zvidTest
      t.editor.setContext(t.project.doc.scenes[0]._id)
      t.editor.selectVisual(t.project.doc.scenes[0].visuals[0]._id)
    })
    const target = gesture === 'move' ? '.stage-item.interactive'
      : gesture === 'resize' ? '.sel-box .handle' : '.sel-box .rotate-handle'
    await page.locator(target).first().dispatchEvent('pointerdown', { button: 0, clientX: 500, clientY: 300 })
    await page.evaluate(() => {
      const t = (window as any).__zvidTest
      t.editor.setContext(t.project.doc.scenes[1]._id)
    })
    await expect(page.locator('.stage-item.interactive')).toHaveCount(0)
    const before = await exportedDoc(page)
    await page.mouse.move(750, 500)
    expect(await exportedDoc(page)).toEqual(before)
    await page.mouse.up()
  })
}

test('an empty compatible-stock page explains the limit and can advance', async ({ page }) => {
  await page.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())
  let searches = 0
  await page.route('**/api/stock/search?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('type') !== 'video')
      return route.fulfill({ json: { items: [], hasMore: false } })
    searches++
    const body = searches === 1
      ? { items: [], hasMore: true, excludedCount: 24, message: 'Some videos exceed your plan limits.' }
      : { items: [{ id: 'compatible', kind: 'video', provider: 'internal',
          preview: '/favicon.ico', src: 'http://127.0.0.1:4598/clip.mp4' }], hasMore: false }
    return route.fulfill({ json: body })
  })
  await openEditor(page)
  await page.getByTitle('Videos', { exact: true }).click()
  await expect(page.getByRole('status')).toContainText('plan limits')
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toBeVisible()
  expect(searches).toBe(1)
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.locator('.stock-panel .cell')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0)
  expect(searches).toBe(2)
})
