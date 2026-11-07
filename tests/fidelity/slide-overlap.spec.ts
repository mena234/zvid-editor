import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { fx, openEditor } from '../e2e/helpers/app'
import { caseDir, renderWithPackage, extractFrame, captureStage } from './helpers/fidelity'

const require = createRequire(import.meta.url)
const sharp = require('../../../package/node_modules/sharp')
const effects = ['slideleft', 'slideright', 'slideup', 'slidedown']
const background = [32, 64, 128]

// An opaque image/video still slides against a transparent animation canvas.
// The exposed half must show the lower layers, not a fabricated black plate.
for (const type of ['IMAGE', 'VIDEO']) {
  test(`${type} enter and exit slides preserve the underlying backdrop`, async ({ page }) => {
    const name = `slide-backdrop-${type.toLowerCase()}`
    const cells = ['enter', 'exit'].flatMap((mode, row) => effects.map((effect, col) => ({ mode, effect, x: col * 160, y: row * 180 })))
    const config = {
      width: 640, height: 360, duration: 2, frameRate: 30, backgroundColor: '#204080',
      visuals: cells.map((cell) => ({
        type, src: fx(type === 'IMAGE' ? 'image.png' : 'clip.mp4'),
        x: cell.x, y: cell.y, width: 160, height: 180,
        ...(type === 'VIDEO' ? { volume: 0 } : {}),
        ...(cell.mode === 'enter'
          ? { enterAnimation: cell.effect, enterBegin: 0, enterEnd: 1, exitEnd: 2 }
          : { exitAnimation: cell.effect, enterBegin: 0, exitBegin: 0, exitEnd: 1 }),
      })),
    }
    const dir = caseDir(name)
    const render = await renderWithPackage(name, config)
    const renderPng = await extractFrame(render, 0.5, 30, join(dir, 'render.png'))
    await openEditor(page)
    const editorPng = await captureStage(page, config, 0.5, join(dir, 'editor.png'))
    for (const file of [renderPng, editorPng]) {
      const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      for (const cell of cells) {
        let x = 80, y = 90
        const before = cell.mode === 'enter'
        if (cell.effect === 'slideleft') x = before ? 40 : 120
        if (cell.effect === 'slideright') x = before ? 120 : 40
        if (cell.effect === 'slideup') y = before ? 45 : 135
        if (cell.effect === 'slidedown') y = before ? 135 : 45
        const i = ((cell.y + y) * info.width + cell.x + x) * info.channels
        const pixel = Array.from(data.subarray(i, i + 3)) as number[]
        expect(Math.max(...pixel.map((value, channel) => Math.abs(value - background[channel]))),
          `${file}: ${cell.mode} ${cell.effect} backdrop pixel ${pixel}`).toBeLessThanOrEqual(4)
      }
    }
  })
}
