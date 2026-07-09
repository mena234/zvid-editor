import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import {
  renderWithPackage,
  extractFrame,
  captureStage,
  ssim,
  caseDir,
  compareImageCase,
} from './helpers/fidelity'
import { openEditor } from '../e2e/helpers/app'

/**
 * Kitchen sink: ONE scenes-based project exercising every feature family,
 * compared editor-stage vs package-render at per-feature timestamps. The
 * fixture JSONs (tests/fidelity/fixtures/kitchen-sink-*.json) are also
 * directly importable in the editor for eyeballing (fixture server on :4598
 * must be running).
 *
 * Scene plan (fade s1→s2 overlaps 1s, everything after shifts -1):
 *   geometry [0,3] · media-fx [2,5] · filters [5,8] · video [8,12] ·
 *   text [12,15] · svg-gif [15,18] · anim [18,21] · chroma-zoom [21,24]
 *
 * `min` thresholds are calibrated per feature: tight where parity is
 * expected, looser floors where the preview is a documented approximation —
 * a drop below the floor still flags a regression in the approximation.
 */

const __dirname2 = dirname(fileURLToPath(import.meta.url))
const VIDEO_CFG = JSON.parse(
  readFileSync(join(__dirname2, 'fixtures', 'kitchen-sink-video.json'), 'utf8')
)
const IMAGE_CFG = JSON.parse(
  readFileSync(join(__dirname2, 'fixtures', 'kitchen-sink-image.json'), 'utf8')
)

interface Probe {
  label: string
  t: number
  min: number
}

// mins calibrated 2026-07-09 from measured scores (in comments) minus a
// safety margin — a breach is a fidelity REGRESSION, not test noise
const PROBES: Probe[] = [
  { label: 'geometry (anchors/position/opacity/flip/resize)', t: 1.5, min: 0.97 }, // 0.983
  { label: 'scene transition mid-fade', t: 2.5, min: 0.95 }, // 0.981
  { label: 'media fx (crop/radius/tint/invert)', t: 4.0, min: 0.95 }, // 0.983
  { label: 'filters (brightness/contrast/saturate/hue/blur)', t: 6.5, min: 0.85 }, // 0.915 — FFmpeg eq curves vs CSS, documented approximation
  { label: 'video A steady (videoBegin trim)', t: 8.8, min: 0.97 }, // 0.995
  { label: 'video transition mid-wiperight', t: 10.0, min: 0.95 }, // 0.992
  { label: 'video B steady (speed 0.5)', t: 11.2, min: 0.97 }, // 0.994
  { label: 'text styles + subtitle', t: 13.5, min: 0.92 }, // 0.964 — font raster + subtitle metrics
  { label: 'svg + static gif', t: 16.5, min: 0.92 }, // 0.959 — librsvg vs browser raster
  { label: 'enter animation mid-wipe/fade', t: 18.5, min: 0.92 }, // 0.956
  { label: 'animations steady', t: 19.5, min: 0.95 }, // 0.989
  { label: 'exit animation mid-wipe/slide', t: 20.5, min: 0.95 }, // 0.986 after the black-plate fix
  { label: 'chroma key + ken burns zoom', t: 22.5, min: 0.8 }, // 0.861 — zoom edge crop + CK badge
]

test('kitchen-sink video: every feature family at its own timestamp', async ({
  page,
}, testInfo) => {
  const name = 'kitchen-sink-video'
  const dir = caseDir(name)
  const fps = VIDEO_CFG.frameRate ?? 30
  const rendered = await renderWithPackage(name, VIDEO_CFG)
  await openEditor(page)

  const scores: string[] = []
  const failures: string[] = []
  for (const probe of PROBES) {
    const tag = String(probe.t).replace('.', '_')
    const renderPng = await extractFrame(rendered, probe.t, fps, join(dir, `render-${tag}.png`))
    const editorPng = await captureStage(page, VIDEO_CFG, probe.t, join(dir, `editor-${tag}.png`))
    const score = await ssim(editorPng, renderPng, join(dir, `diff-${tag}.png`))
    const line = `t=${probe.t.toFixed(1).padStart(5)}  ssim=${score.toFixed(4)}  min=${probe.min}  ${probe.label}`
    scores.push(line)
    if (score < probe.min) failures.push(line)
  }

  testInfo.annotations.push({ type: 'fidelity-scorecard', description: scores.join('\n') })
  console.log(`\n[kitchen-sink-video scorecard]\n${scores.join('\n')}\n`)
  expect(failures, `below-threshold probes (diffs in ${dir})`).toEqual([])
})

test('kitchen-sink image: full still-image feature surface', async ({ page }) => {
  const score = await compareImageCase(page, 'kitchen-sink-image', IMAGE_CFG)
  console.log(`[kitchen-sink-image] ssim=${score.toFixed(4)}`)
  // measured 0.987 (2026-07-09)
  expect(score, 'see tests/fidelity/.artifacts/kitchen-sink-image').toBeGreaterThan(0.95)
})
