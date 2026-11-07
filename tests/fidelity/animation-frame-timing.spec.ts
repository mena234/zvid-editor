import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { fx, openEditor } from '../e2e/helpers/app'
import { caseDir, renderWithPackage, extractFrame, captureStage, ssim } from './helpers/fidelity'

test('fractional item timings use the renderer animation frame clock', async ({ page }) => {
  const name = 'fractional-animation-frame-clock'
  const config = {
    width: 640, height: 360, duration: 4.8, frameRate: 30, backgroundColor: '#204080',
    visuals: [
      { type: 'IMAGE', src: fx('image.png'), x: 40, y: 30, width: 240, height: 140,
        enterBegin: 3.16, enterEnd: 3.41, enterAnimation: 'slideleft',
        exitBegin: 4.16, exitEnd: 4.41, exitAnimation: 'slideright' },
      { type: 'IMAGE', src: fx('image.png'), x: 330, y: 190, width: 240, height: 140,
        enterBegin: 3.16, enterEnd: 3.41, enterAnimation: 'slideup',
        exitBegin: 4.16, exitEnd: 4.41, exitAnimation: 'slidedown' },
    ],
  }
  const dir = caseDir(name)
  const video = await renderWithPackage(name, config)
  await openEditor(page)
  // Forward, backward and exit seeks catch both the integer PTS shift and
  // the half-frame duration rounding that moved the production pizza slide.
  for (const frame of [98, 96, 101, 128, 126, 131]) {
    const t = frame / 30
    const rendered = await extractFrame(video, t, 30, join(dir, `render-${frame}.png`))
    const editor = await captureStage(page, config, t, join(dir, `editor-${frame}.png`))
    const score = await ssim(editor, rendered, join(dir, `diff-${frame}.png`))
    expect(score, `animation frame ${frame}`).toBeGreaterThan(0.98)
  }
})
