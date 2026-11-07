import { join, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect } from '@playwright/test'
import { openEditor, loadProject } from '../e2e/helpers/app'
import { caseDir, extractFrame, ssim } from './helpers/fidelity'

const run = promisify(execFile)

for (const rate of [30, 60]) {
  test(`${rate}fps video seeks retain fractional boundaries and adjacent frames`, async ({ page }) => {
    const dir = caseDir(`video-frame-seek-${rate}`)
    let file = resolve('tests/e2e/fixtures/clip.mp4')
    if (rate === 60) {
      file = join(dir, 'source.mp4')
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x404040:s=320x180:r=60:d=2',
        '-vf', "drawtext=text='%{n}':fontsize=64:fontcolor=white:x=(w-tw)/2:y=(h-th)/2",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', file])
    }
    // Same-origin Range-serving route also lets us read the decoded pixels
    // without CSS stage positioning or screenshot subpixel resampling.
    const url = `http://127.0.0.1:4597/__seek-test-${rate}.mp4`
    const bytes = readFileSync(file)
    await page.route(url, (route) => {
        const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
        return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4',
          headers: { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*',
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) },
          body: bytes.subarray(start, end + 1) })
    })
    await openEditor(page)
    await loadProject(page, { width: 320, height: 180, duration: 2, frameRate: rate,
      visuals: [{ type: 'VIDEO', src: url, width: 320, height: 180, volume: 0, exitEnd: 2 }] })
    await page.evaluate(() => {
      const e = (window as any).__zvidTest.editor
      e.clearSelection(); e.stageZoom = 1; e.playing = false
      const video = document.querySelector<HTMLVideoElement>('.stage-frame video')!
      const record = (_now: number, meta: VideoFrameCallbackMetadata) => {
        video.dataset.decodedTime = String(meta.mediaTime)
        video.requestVideoFrameCallback(record)
      }
      video.requestVideoFrameCallback(record)
    })
    // First move far away, then return to the production failing boundary.
    // Adjacent and reverse seeks also catch the old 40ms paused deadband.
    for (const [i, frame] of [30, 14, 15, 13, 2, 1, 14].entries()) {
      const t = frame / rate
      await page.evaluate(time => { (window as any).__zvidTest.editor.playhead = time }, t)
      await page.waitForFunction(time => {
        const video = document.querySelector<HTMLVideoElement>('.stage-frame video')!
        return video.readyState >= 2 && !video.seeking && Math.abs(Number(video.dataset.decodedTime) - time) < 0.000002
      }, t, { timeout: 10_000 }).catch(async (error) => {
        const state = await page.locator('.stage-frame video').evaluate((video: HTMLVideoElement) => ({
          currentTime: video.currentTime, decodedTime: video.dataset.decodedTime,
          readyState: video.readyState, seeking: video.seeking, error: video.error?.message,
          playhead: (window as any).__zvidTest.editor.playhead,
        }))
        throw new Error(`frame ${frame}/${rate}: ${JSON.stringify(state)}; ${error}`)
      })
      const preview = join(dir, `editor-${i}-${frame}.png`)
      const pixels = await page.locator('.stage-frame video').evaluate((video: HTMLVideoElement) => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth; canvas.height = video.videoHeight
        canvas.getContext('2d')!.drawImage(video, 0, 0)
        return canvas.toDataURL().split(',')[1]!
      })
      writeFileSync(preview, Buffer.from(pixels, 'base64'))
      const native = await extractFrame(file, t, rate, join(dir, `native-${i}-${frame}.png`))
      expect(await ssim(preview, native), `${rate}fps frame ${frame}`).toBeGreaterThan(0.995)
    }
  })
}
