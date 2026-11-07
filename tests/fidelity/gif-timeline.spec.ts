import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { fx, openEditor, loadProject } from '../e2e/helpers/app'
import { caseDir, renderWithPackage, extractFrame, ssim } from './helpers/fidelity'

test.use({ viewport: { width: 1600, height: 1400 } })

// Production edu-certificate confetti source retained locally so changes to the
// remote GIF cannot silently change the frame-timing regression.
const config = {
  width: 640, height: 640, duration: 8, frameRate: 30, backgroundColor: '#10131c',
  visuals: [{ type: 'GIF', src: fx('confetti.gif'), width: 500, height: 500, x: 70, y: 70,
    enterBegin: 1.9, enterEnd: 2.2, enterAnimation: 'fade',
    exitBegin: 7.4, exitEnd: 8, exitAnimation: 'fade' }],
}

for (const animated of [true, false]) {
test(`GIF frames follow forward/backward seeks, loops and paused time (animation=${animated})`, async ({ page }) => {
  const name = `gif-timeline-clock-${animated ? 'animated' : 'plain'}`
  const dir = caseDir(name)
  const project = animated ? config : { ...config, visuals: [{ ...config.visuals[0], enterAnimation: null, exitAnimation: null }] }
  const video = await renderWithPackage(name, project)
  await openEditor(page)
  await loadProject(page, project)
  await page.evaluate(() => {
    const e = (window as any).__zvidTest.editor
    e.clearSelection(); e.stageZoom = 1; e.showSafeArea = false; e.showGrid = false; e.playing = false
  })
  let initial = ''
  // Frame 142 is the exact production discrepancy; later times cover the long
  // final GIF delay and its next loop. Return to the first frame without reload.
  for (const [i, frame] of [142, 175, 92, 215, 142].entries()) {
    await page.evaluate(t => { (window as any).__zvidTest.editor.playhead = t }, frame / 30)
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.timeline-gif')?.dataset.gifState === 'ready')
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    const pixels = await page.locator('.timeline-gif').evaluate((c: HTMLCanvasElement) => c.toDataURL())
    if (i === 0) initial = pixels
    if (i === 4) expect(pixels).toBe(initial)
    const box = (await page.locator('.stage-frame').boundingBox())!
    const editor = join(dir, `editor-${i}-${frame}.png`)
    await page.screenshot({ path: editor, clip: { x: Math.round(box.x), y: Math.round(box.y), width: 640, height: 640 } })
    const rendered = await extractFrame(video, frame / 30, 30, join(dir, `render-${i}-${frame}.png`))
    // GIF palette edges are softened by the final H.264/yuv420 encode. The
    // dense-particle frame measures 0.978 even with identical frame geometry.
    expect(await ssim(editor, rendered, join(dir, `diff-${i}-${frame}.png`)), `GIF frame ${frame}`).toBeGreaterThan(0.97)
  }
  await page.waitForTimeout(400)
  expect(await page.locator('.timeline-gif').evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(initial)
  // Rapid seeks must not let an older asynchronous decode overwrite the latest.
  await page.evaluate(async () => {
    const e = (window as any).__zvidTest.editor
    for (const t of [7.1, 3.2, 4.8, 142 / 30]) { e.playhead = t; await Promise.resolve() }
  })
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.timeline-gif')?.dataset.gifState === 'ready')
  expect(await page.locator('.timeline-gif').evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(initial)
})
}

test('unsupported GIF decoder retains the existing image preview', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'ImageDecoder', { value: undefined }))
  await openEditor(page)
  await loadProject(page, config)
  await page.evaluate(() => { (window as any).__zvidTest.editor.playhead = 142 / 30 })
  await expect(page.locator('.stage-frame .media-box img')).toBeVisible()
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>('.stage-frame .media-box img')
    return img?.complete && img.naturalWidth === 500
  })
  await expect(page.locator('.timeline-gif')).toHaveCount(0)
})
