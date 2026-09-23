import { test, expect, type Page } from '@playwright/test'
import { exportedDoc, fx, loadProject, openEditor, store } from './helpers/app'

type Point = { x: number; y: number }
async function drag(page: Page, from: Point, to: Point, touch: boolean, cancel = false) {
  if (!touch) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    return
  }
  const cdp = await page.context().newCDPSession(page)
  const point = (p: Point) => ({ ...p, id: 1, radiusX: 1, radiusY: 1, force: 1 })
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] })
    for (let n = 1; n <= 12; n++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point({
        x: from.x + (to.x - from.x) * n / 12,
        y: from.y + (to.y - from.y) * n / 12,
      })] })
    }
    // End with a resting finger so a synthetic flick does not suppress the next tap.
    await page.waitForTimeout(100)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(to)] })
    await page.waitForTimeout(100)
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
  } finally { await cdp.detach() }
}

async function metrics(page: Page) {
  return page.locator('.stage-scroll').evaluate(el => ({
    left: el.scrollLeft, top: el.scrollTop,
    maxLeft: el.scrollWidth - el.clientWidth, maxTop: el.scrollHeight - el.clientHeight,
    width: el.clientWidth, height: el.clientHeight,
  }))
}

for (const viewport of [
  { width: 320, height: 640, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 820, height: 1180, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 1366, height: 768, touch: false },
]) {
  test.describe(`canvas pan ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.touch, isMobile: viewport.touch })
    test('pans to every corner without editing, handles cancellation and restores editing', async ({ page }, info) => {
      test.setTimeout(90_000)
      const act = async (locator: ReturnType<Page['locator']>) => viewport.touch ? locator.tap() : locator.click()
      await openEditor(page)
      await loadProject(page, {
        name: 'Canvas pan', resolution: 'full-hd', duration: 8,
        visuals: [{ type: 'IMAGE', src: fx('image.png'), x: 600, y: 350, width: 500, height: 300 }],
      })
      const active = page.locator('.rail-tab[aria-pressed=true]')
      if (await active.count()) await act(active)
      await act(page.locator('.stage-item'))
      const activeAfterSelect = page.locator('.rail-tab[aria-pressed=true]')
      if (await activeAfterSelect.count()) await act(activeAfterSelect)
      const before = await exportedDoc(page)
      const selectedId = await store(page, 'editor', 'selectedId')
      expect(selectedId).toBeTruthy()

      // Real zoom controls produce overflow in both axes, including landscape.
      for (let n = 0; n < 18; n++) {
        const size = await metrics(page)
        if (size.maxLeft > size.width * 0.45 && size.maxTop > size.height * 0.45) break
        await act(page.getByTitle('Zoom in (Ctrl+scroll)', { exact: true }))
      }
      const zoomed = await metrics(page)
      expect(zoomed.maxLeft).toBeGreaterThan(50)
      expect(zoomed.maxTop).toBeGreaterThan(50)
      const toggle = page.getByRole('button', { name: 'Pan canvas', exact: true })
      await act(toggle)
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      const footer = (await page.locator('.stage-foot').boundingBox())!
      expect(footer.x + footer.width).toBeLessThanOrEqual(viewport.width)

      const frame = (await page.locator('.stage-scroll').boundingBox())!
      const point = (x: number, y: number) => ({ x: frame.x + frame.width * x, y: frame.y + frame.height * y })
      const panTo = async (right: boolean, bottom: boolean) => {
        for (let n = 0; n < 20; n++) {
          const current = await metrics(page)
          const dx = (right ? current.maxLeft - current.left : current.left) > 1
          const dy = (bottom ? current.maxTop - current.top : current.top) > 1
          if (!dx && !dy) return
          await drag(page,
            point(dx ? right ? 0.85 : 0.15 : 0.5, dy ? bottom ? 0.85 : 0.15 : 0.5),
            point(dx ? right ? 0.15 : 0.85 : 0.5, dy ? bottom ? 0.15 : 0.85 : 0.5),
            viewport.touch)
        }
        throw new Error('Pan did not reach the requested canvas corner')
      }
      for (const [right, bottom] of [[true, true], [false, true], [true, false], [false, false]]) {
        await panTo(right, bottom)
        const current = await metrics(page)
        expect(current.left).toBeCloseTo(right ? current.maxLeft : 0, 0)
        expect(current.top).toBeCloseTo(bottom ? current.maxTop : 0, 0)
        expect(await exportedDoc(page)).toEqual(before)
        expect(await store(page, 'editor', 'selectedId')).toBe(selectedId)
        await expect(page.locator('.rail-panel')).toHaveCount(0)
      }
      await page.screenshot({ path: info.outputPath(`canvas-pan-${viewport.width}.png`) })

      if (viewport.touch) {
        await drag(page, point(0.8, 0.8), point(0.5, 0.5), true, true)
        await expect(page.locator('.stage-scroll')).not.toHaveClass(/panning/)
        const afterCancel = await metrics(page)
        await drag(page, point(0.8, 0.8), point(0.5, 0.5), true)
        expect((await metrics(page)).left).toBeGreaterThan(afterCancel.left)
        expect(await exportedDoc(page)).toEqual(before)
      }

      await act(toggle)
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await act(page.getByTitle('Reset to fit', { exact: true }))
      const item = (await page.locator('.stage-item').boundingBox())!
      const from = { x: item.x + item.width / 2, y: item.y + item.height / 2 }
      await drag(page, from, { x: from.x + 25, y: from.y + 12 }, viewport.touch)
      const edited = (await exportedDoc(page)).visuals[0]
      expect(edited.x).toBeGreaterThan(600)
      expect(edited.y).toBeGreaterThan(350)
    })
  })
}
