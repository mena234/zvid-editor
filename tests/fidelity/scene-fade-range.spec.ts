import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { openEditor } from '../e2e/helpers/app'
import { caseDir, renderWithPackage, extractFrame, captureStage } from './helpers/fidelity'

const require = createRequire(import.meta.url)
const sharp = require('../../../package/node_modules/sharp')
const colors = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff', '#4080c0', '#c08040', '#80c040']
const chart = (reverse: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">${colors.map((color, i) => `<rect x="${i % 4 * 80}" y="${Math.floor(i / 4) * 90}" width="80" height="90" fill="${reverse ? colors[7 - i] : color}"/>`).join('')}</svg>`

for (const effect of ['fadewhite', 'fadeblack']) {
  test(`${effect} scene transitions match native limited-range color`, async ({ page }) => {
    const name = `scene-range-${effect}`
    const config = {
      width: 320, height: 180, frameRate: 30,
      scenes: [false, true].map((reverse, i) => ({
        id: `scene-${i}`, duration: 1.2,
        ...(i === 0 ? { transition: effect, transitionDuration: 0.45, transitionId: 'scene-1' } : {}),
        visuals: [{ type: 'SVG', svg: chart(reverse), width: 320, height: 180, exitEnd: 1.2 }],
      })),
    }
    const dir = caseDir(name)
    const native = await renderWithPackage(name, config)
    // The preview-only marker independently checks wrapper scope. Leave it out
    // of the native reference so adding a global RGB overlay doesn't introduce
    // another YUV/RGB round trip in the scene-color comparison itself.
    const previewConfig = { ...config, visuals: [{ type: 'SVG', x: 0, y: 0, width: 20, height: 20, exitEnd: 1.95,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#20a0d0"/></svg>' }] }
    await openEditor(page)
    for (const frame of [24, 28, 32, 35, 40]) {
      const t = frame / 30
      const aFile = await extractFrame(native, t, 30, join(dir, `native-${frame}.png`))
      const bFile = await captureStage(page, previewConfig, t, join(dir, `editor-${frame}.png`))
      const read = (file: string) => sharp(file).removeAlpha().raw().toBuffer()
      const [a, b] = await Promise.all([read(aFile), read(bFile)])
      for (let patch = 0; patch < 8; patch++) {
        const i = ((Math.floor(patch / 4) * 90 + 45) * 320 + patch % 4 * 80 + 40) * 3
        const expected = [...a.subarray(i, i + 3)] as number[]
        const actual = [...b.subarray(i, i + 3)] as number[]
        expect(Math.max(...actual.map((v, c) => Math.abs(v - expected[c]!))),
          `${effect} frame ${frame}, patch ${patch}: preview ${actual}; native ${expected}`).toBeLessThanOrEqual(4)
      }
      const globalPixel = (10 * 320 + 10) * 3
      for (let channel = 0; channel < 3; channel++) {
        expect(b[globalPixel + channel],
          `${effect} frame ${frame}: global overlay must bypass scene correction`).toBe([32, 160, 208][channel])
      }
      if (frame === 40) {
        expect(await page.locator('.movie-backdrop').evaluate((el) => getComputedStyle(el).filter)).toBe('none')
      }
    }
  })
}
