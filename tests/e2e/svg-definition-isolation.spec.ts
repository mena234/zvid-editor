import { test, expect } from '@playwright/test'
import { openEditor, exportedDoc, loadProject } from './helpers/app'

test('repeated static SVG definitions stay visible when an earlier scene is hidden', async ({ page }, testInfo) => {
  // The editor keeps inactive scenes mounted with display:none. With inline
  // SVGs, the second scene's url(#shade) resolves the hidden first definition.
  // Exercise gradients, clip paths and local <use> references without changing
  // the saved markup or requiring generated IDs in library templates.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
    <defs>
      <linearGradient id="shade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#102030"/><stop offset="100%" stop-color="#304050"/>
      </linearGradient>
      <clipPath id="clip"><rect width="400" height="400"/></clipPath>
      <rect id="tile" width="400" height="400" fill="url(#shade)"/>
    </defs>
    <g clip-path="url(#clip)"><use href="#tile"/></g>
  </svg>`
  await openEditor(page)
  await loadProject(page, {
    width: 400, height: 400, frameRate: 30, backgroundColor: '#ffffff',
    scenes: ['first', 'second'].map(id => ({
      id, duration: 3,
      visuals: [{ type: 'SVG', svg, width: 400, height: 400, x: 0, y: 0, anchor: 'top-left', enterEnd: 0, exitEnd: 3 }],
    })),
  })
  await page.evaluate(() => (window as any).__zvidTest.editor.seek(1))
  const stage = page.locator('.stage-frame')
  const first = await stage.screenshot()
  await page.evaluate(() => (window as any).__zvidTest.editor.seek(4))
  const second = await stage.screenshot({ path: testInfo.outputPath('repeated-svg-gradient.png') })
  expect(second.equals(first)).toBe(true)
  const pixel = await page.evaluate(async (png) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data)
  }, second.toString('base64'))
  expect(pixel[0]).toBeGreaterThan(20)
  expect(pixel[0]).toBeLessThan(45)
  expect(pixel[1]).toBeGreaterThan(pixel[0])
  expect(pixel[2]).toBeGreaterThan(pixel[1])
  const exported = await exportedDoc(page)
  for (const s of exported.scenes) expect(s.visuals[0].svg).toContain('id="shade"')
})
