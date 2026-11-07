import { createRequire } from 'node:module'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect } from '@playwright/test'
import { openEditor } from '../e2e/helpers/app'
import { caseDir, captureStage } from './helpers/fidelity'

const require = createRequire(import.meta.url)
const sharp = require('../../../package/node_modules/sharp')
const run = promisify(execFile)
const width = 640
const height = 180
const cells = ['smoothup', 'circleopen'].flatMap((effect, i) =>
  ['enter', 'exit'].map((mode, j) => ({ effect, mode, x: (i * 2 + j) * 160 })))

// Solid, half-transparent, quarter-transparent, then empty vertical bands.
// The last band must retain the patterned backdrop without any black plate.
const shape = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="180"><rect width="40" height="180" fill="#E040C0"/><rect x="40" width="40" height="180" fill="#E040C0" opacity=".5"/><rect x="80" width="40" height="180" fill="#E040C0" opacity=".25"/></svg>'
const backdrop = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#205080"/><rect width="20" height="20" fill="#80A040"/><rect x="20" y="20" width="20" height="20" fill="#80A040"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`

test('transparent smooth and radial ramps match native color, alpha, and empty gaps', async ({ page }) => {
  const name = 'transparent-ramp-compositing'
  const config = {
    width, height, duration: 2, frameRate: 30,
    visuals: [
      { type: 'SVG', svg: backdrop, width, height, x: 0, y: 0 },
      ...cells.map((cell) => ({
        type: 'SVG', svg: shape, width: 160, height, x: cell.x, y: 0,
        ...(cell.mode === 'enter'
          ? { enterAnimation: cell.effect, enterBegin: 0, enterEnd: 1, exitEnd: 2 }
          : { exitAnimation: cell.effect, enterBegin: 0, exitBegin: 0, exitEnd: 1 }),
      })),
    ],
  }
  const dir = caseDir(name)
  const blank = join(dir, 'blank.png')
  const source = join(dir, 'source.png')
  const bg = join(dir, 'background.png')
  await sharp({ create: { width: 160, height, channels: 4, background: '#00000000' } }).png().toFile(blank)
  await sharp(Buffer.from(shape)).png().toFile(source)
  await sharp(Buffer.from(backdrop)).extract({ left: 0, top: 0, width: 160, height }).png().toFile(bg)
  // Lossless PNGs isolate xfade/overlay math from H.264 chroma subsampling and
  // compression, which can shift even untouched backdrop samples by 10 levels.
  for (const cell of cells) {
    const inputs = cell.mode === 'enter' ? [blank, source] : [source, blank]
    await run('ffmpeg', ['-y', '-v', 'error',
      ...[...inputs, bg].flatMap((file) => ['-loop', '1', '-framerate', '30', '-i', file]),
      '-filter_complex', `[0:v]format=gbrap[a];[1:v]format=gbrap[b];[a][b]xfade=transition=${cell.effect}:duration=1:offset=0[anim];[2:v][anim]overlay=format=rgb,select='eq(n,8)+eq(n,15)+eq(n,23)'[out]`,
      '-map', '[out]', '-fps_mode', 'vfr', '-frames:v', '3', join(dir, `${cell.effect}-${cell.mode}-%02d.png`)],
      { timeout: 30_000, maxBuffer: 1024 * 1024 })
  }
  await openEditor(page)
  for (const [index, frame] of [8, 15, 23].entries()) {
    const t = frame / 30
    const native = join(dir, `native-${frame}.png`)
    await sharp({ create: { width, height, channels: 3, background: '#000000' } })
      .composite(cells.map((cell) => ({ input: join(dir, `${cell.effect}-${cell.mode}-${String(index + 1).padStart(2, '0')}.png`), left: cell.x, top: 0 })))
      .png().toFile(native)
    const preview = await captureStage(page, config, t, join(dir, `editor-${frame}.png`))
    const read = async (path: string) => sharp(path).removeAlpha().raw().toBuffer()
    const [a, b] = await Promise.all([read(native), read(preview)])
    for (const cell of cells) {
      for (const x of [10, 50, 90, 130]) {
        for (const y of [10, 30, 50, 70, 90, 110, 130, 150, 170]) {
          const i = (y * width + cell.x + x) * 3
          const actual = Array.from(b.subarray(i, i + 3)) as number[]
          const expected = Array.from(a.subarray(i, i + 3)) as number[]
          expect(Math.max(...actual.map((v, c) => Math.abs(v - expected[c]!))),
            `${cell.effect} ${cell.mode} frame ${frame} (${x},${y}): preview ${actual}, native ${expected}`)
            .toBeLessThanOrEqual(4)
        }
      }
    }
  }

  // Scrubbing must not retain one SVG data URI per item per frame forever,
  // and collecting old definitions must never break a currently visible one.
  const retained = await page.evaluate(async () => {
    for (let i = 0; i < 300; i++) {
      ;(window as any).__zvidTest.editor.playhead = i / 300
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const references = [...document.querySelectorAll<HTMLElement>('[style*="zvid-xfade-ramp-"]')]
      .flatMap((e) => [...e.style.filter.matchAll(/#(zvid-xfade-ramp-[\da-f]+)/g)].map((m) => m[1]!))
    return {
      count: document.querySelectorAll('filter[id^="zvid-xfade-ramp-"]').length,
      visibleCount: references.length,
      missing: references.filter((id) => !document.getElementById(id)),
    }
  })
  expect(retained.visibleCount).toBeGreaterThan(0)
  expect(retained.missing).toEqual([])
  expect(retained.count).toBeLessThanOrEqual(256)
})
