import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
import type { Page } from '@playwright/test'
import { openEditor, loadProject } from '../../e2e/helpers/app'

const run = promisify(execFile)

/**
 * Fidelity harness: renders a project JSON with the real zvid package CLI,
 * captures the editor stage 1:1 at the same timestamp, and compares the two
 * with FFmpeg's SSIM filter.
 *
 * Artifacts (config, render, frames, captures, diff heatmaps) land in
 * tests/fidelity/.artifacts/<case>/ for eyeballing failures.
 */

const PKG_CLI = resolve(__dirname, '../../../../package/dist/cli.cjs')
export const ARTIFACTS = resolve(__dirname, '../.artifacts')

export function caseDir(name: string): string {
  const dir = join(ARTIFACTS, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Render a project with the package CLI; returns the output media path. */
export async function renderWithPackage(
  name: string,
  config: Record<string, any>
): Promise<string> {
  const dir = caseDir(name)
  const cfgPath = join(dir, 'config.json')
  writeFileSync(cfgPath, JSON.stringify({ ...config, name }, null, 2))
  await run('node', [PKG_CLI, 'render', cfgPath, '--out', dir], {
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  const format =
    config.type === 'image' ? (config.outputFormat ?? 'png') : (config.outputFormat ?? 'mp4')
  const out = join(dir, `${name}.${format}`)
  if (!existsSync(out)) throw new Error(`package render produced no ${out}`)
  return out
}

/** Extract the frame shown at time t (frame floor(t*fps)) as PNG. */
export async function extractFrame(
  video: string,
  t: number,
  fps: number,
  outPng: string
): Promise<string> {
  const frame = Math.floor(t * fps)
  await run('ffmpeg', [
    '-y', '-v', 'error',
    '-ss', String(frame / fps),
    '-i', video,
    '-frames:v', '1',
    outPng,
  ])
  return outPng
}

/**
 * Capture the stage at playhead t, 1:1 with the project resolution
 * (stageZoom = 1, deviceScaleFactor 1). Waits for probes, fonts and video
 * seeks to settle so the capture is deterministic.
 */
export async function captureStage(
  page: Page,
  config: Record<string, any>,
  t: number,
  outPng: string
): Promise<string> {
  await loadProject(page, config)
  await page.evaluate(
    ({ time, scenes }) => {
      const T = (window as any).__zvidTest
      T.editor.clearSelection()
      T.editor.showSafeArea = false
      T.editor.showGrid = false
      T.editor.stageZoom = 1
      T.editor.playing = false
      // scene projects render like the package only in full-movie preview
      if (scenes) T.editor.scenePreviewMode = 'full'
      T.editor.playhead = time
    },
    { time: t, scenes: !!config.scenes?.length }
  )

  // fonts + media settle: no probe errors, all stage videos decoded and done
  // seeking with a stable currentTime
  await page.waitForFunction(
    () => {
      if (document.querySelector('.stage-frame .media-error')) return false
      const vids = [...document.querySelectorAll<HTMLVideoElement>('.stage-frame video')]
      return vids.every((v) => v.readyState >= 2 && !v.seeking)
    },
    undefined,
    { timeout: 30_000 }
  )
  // Webfonts: the app injects Google-Font css2 <link>s on demand and never
  // retries a failed fetch (deduped). Wait for every injected stylesheet to
  // arrive — re-injecting once on timeout — then force-load the families.
  const awaitFontSheets = () =>
    page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLLinkElement>('link[data-zvid-font]')].every(
          (l) => !!l.sheet
        ),
      undefined,
      { timeout: 10_000 }
    )
  await awaitFontSheets().catch(async () => {
    await page.evaluate(() => {
      for (const l of document.querySelectorAll<HTMLLinkElement>('link[data-zvid-font]')) {
        if (!l.sheet) {
          const retry = document.createElement('link')
          retry.rel = 'stylesheet'
          retry.href = l.href
          retry.dataset.zvidFont = `${l.dataset.zvidFont}-retry`
          l.remove()
          document.head.appendChild(retry)
        }
      }
    })
    await awaitFontSheets()
  })
  await page.evaluate(async () => {
    const fonts = (document as any).fonts
    if (!fonts) return
    const families = [
      ...document.querySelectorAll<HTMLLinkElement>('link[data-zvid-font]'),
    ].map((l) => (l.dataset.zvidFont || '').replace(/-retry$/, ''))
    await Promise.all(
      families.flatMap((f) => [
        fonts.load(`400 16px "${f}"`),
        fonts.load(`700 16px "${f}"`),
      ])
    )
    await fonts.ready
  })

  // two rAFs so the last seek/paint lands
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
      )
  )

  const frame = page.locator('.stage-frame')
  const box = (await frame.boundingBox())!
  const width = config.width ?? 1920
  const height = config.height ?? 1080
  if (Math.abs(box.width - width) > 1 || Math.abs(box.height - height) > 1) {
    throw new Error(
      `stage-frame is ${box.width}x${box.height}, expected ${width}x${height} — zoom not 1:1?`
    )
  }
  // integer-aligned clip: the frame can sit at fractional coordinates (e.g.
  // centered in odd leftover space), which would grow the capture by 1px
  await page.screenshot({
    path: outPng,
    animations: 'disabled',
    clip: { x: Math.round(box.x), y: Math.round(box.y), width, height },
  })
  return outPng
}

/** SSIM (0..1) between two same-size images; writes a diff heatmap PNG. */
export async function ssim(aPng: string, bPng: string, diffPng?: string): Promise<number> {
  const { stderr, stdout } = await run('ffmpeg', [
    '-v', 'info',
    '-i', aPng,
    '-i', bPng,
    '-filter_complex', '[0:v][1:v]ssim=stats_file=-',
    '-f', 'null', '-',
  ])
  const m = /All:([\d.]+)/.exec(stdout + stderr)
  if (!m) throw new Error(`ffmpeg ssim produced no score: ${stderr.slice(-400)}`)
  if (diffPng) {
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-i', aPng,
      '-i', bPng,
      '-filter_complex', '[0:v][1:v]blend=all_mode=difference,eq=brightness=0.3',
      '-frames:v', '1',
      diffPng,
    ]).catch(() => {})
  }
  return Number(m[1])
}

/** Full pipeline for one video case: returns SSIM at each timestamp. */
export async function compareVideoCase(
  page: Page,
  name: string,
  config: Record<string, any>,
  timestamps: number[]
): Promise<{ t: number; score: number }[]> {
  const dir = caseDir(name)
  const fps = config.frameRate ?? 30
  const rendered = await renderWithPackage(name, config)
  await openEditor(page)

  const results: { t: number; score: number }[] = []
  for (const t of timestamps) {
    const tag = String(t).replace('.', '_')
    const renderPng = await extractFrame(rendered, t, fps, join(dir, `render-${tag}.png`))
    const editorPng = await captureStage(page, config, t, join(dir, `editor-${tag}.png`))
    const score = await ssim(editorPng, renderPng, join(dir, `diff-${tag}.png`))
    results.push({ t, score })
  }
  return results
}

/** Full pipeline for one image-project case: returns the SSIM. */
export async function compareImageCase(
  page: Page,
  name: string,
  config: Record<string, any>
): Promise<number> {
  const dir = caseDir(name)
  const rendered = await renderWithPackage(name, config)
  await openEditor(page, { query: '?type=image' })
  const editorPng = await captureStage(page, config, 0, join(dir, 'editor.png'))
  return ssim(editorPng, rendered, join(dir, 'diff.png'))
}
