import { test, expect } from '@playwright/test'
import { fx } from '../e2e/helpers/app'
import { compareVideoCase, compareImageCase } from './helpers/fidelity'

/**
 * Fidelity layer (plan §L5): the editor stage vs the real package render,
 * SSIM-compared frame by frame. Opt-in (`npm run test:fidelity`) — each case
 * runs a real `zvid render` (needs ffmpeg + the built package CLI).
 *
 * Cases stick to features the 2026-07-03 parity audit confirmed pixel-exact
 * (anchors/positions, tracks/opacity, flips, resize, video source math), so
 * a threshold breach means a REGRESSION, not a known approximation. Known
 * divergences (text metrics, filters, animation curves — see
 * EDITOR_ISSUES.md) are deliberately not asserted here.
 *
 * Artifacts per case in tests/fidelity/.artifacts/<name>/:
 *   config.json, <name>.mp4|png, render-*.png, editor-*.png, diff-*.png
 */

const W = 640
const H = 360

test('static geometry: anchors, positions, tracks, opacity, flips, resize', async ({
  page,
}) => {
  const config = {
    width: W,
    height: H,
    duration: 2,
    frameRate: 30,
    backgroundColor: '#204080',
    visuals: [
      // anchor math + explicit box
      { type: 'IMAGE', src: fx('image.png'), x: 320, y: 180, width: 200, height: 150, anchor: 'center-center' },
      // position preset + opacity, higher track overlapping the first
      { type: 'IMAGE', src: fx('image.png'), position: 'bottom-right', width: 160, height: 120, opacity: 0.6, track: 1 },
      // flip (rotation is deliberately absent: FFmpeg's rotate flattens the
      // expanded canvas's alpha to opaque black — a package-side divergence
      // the editor correctly does not reproduce; see EDITOR_ISSUES.md #2)
      { type: 'IMAGE', src: fx('image.png'), x: 40, y: 30, width: 140, height: 105, flipH: true, track: 2 },
      // resize contain (fills the frame behind everything)
      { type: 'IMAGE', src: fx('image.png'), resize: 'contain', opacity: 0.25, track: 0 },
    ],
  }
  const results = await compareVideoCase(page, 'geometry', config, [0.5, 1.5])
  for (const { t, score } of results) {
    expect(score, `SSIM at t=${t} (see tests/fidelity/.artifacts/geometry)`).toBeGreaterThan(0.97)
  }
})

test('video source math: trim offset shows the exact same frame', async ({ page }) => {
  const config = {
    width: W,
    height: H,
    duration: 2,
    frameRate: 30,
    backgroundColor: '#111111',
    visuals: [
      // burned frame numbers in clip.mp4 make source-time errors visible:
      // at t=1.0 both sides must show source frame floor((0.4+1.0)*30)=42
      { type: 'VIDEO', src: fx('clip.mp4'), x: 160, y: 90, width: 320, height: 180, videoBegin: 0.4, volume: 0 },
    ],
  }
  const results = await compareVideoCase(page, 'video-trim', config, [1.0])
  // h264 + yuv420 chroma on the digits costs a little SSIM; a wrong frame
  // number or geometry costs far more
  expect(results[0].score, 'see tests/fidelity/.artifacts/video-trim').toBeGreaterThan(0.9)
})

test('image project: still render matches the stage', async ({ page }) => {
  const config = {
    type: 'image',
    outputFormat: 'png',
    width: W,
    height: H,
    backgroundColor: '#e8e2d6',
    visuals: [
      { type: 'IMAGE', src: fx('image.png'), x: 60, y: 45, width: 240, height: 180 },
      { type: 'IMAGE', src: fx('image.png'), position: 'bottom-right', width: 200, height: 150, opacity: 0.8, track: 1 },
    ],
  }
  const score = await compareImageCase(page, 'image-still', config)
  expect(score, 'see tests/fidelity/.artifacts/image-still').toBeGreaterThan(0.97)
})
