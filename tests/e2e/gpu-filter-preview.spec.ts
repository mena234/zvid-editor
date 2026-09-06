import { test, expect, chromium } from '@playwright/test'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { openEditor, loadProject, fx } from './helpers/app'

const require = createRequire(import.meta.url)
const { getStyleFilters, toGraph } = require('../helpers/nativeStyle.cjs')
const filters = [
  {},
  {
    brightness: 0,
    contrast: 0,
    saturate: 0,
    blur: 0,
    invert: false,
    'hue-rotate': '0deg',
  },
  ...[-100, -50, -1, 1, 20, 100].map((brightness) => ({ brightness })),
  ...[-100, -50, -1, 0.1, 1, 2, 5, 10, 25, 50, 75, 100].map((contrast) => ({ contrast })),
  ...[-100, -50, -1, 1, 50, 100].map((saturate) => ({ saturate })),
  ...['-180deg', '-90deg', '1deg', '45.25deg', '90deg', '180deg', '360deg'].map(
    (hue) => ({ 'hue-rotate': hue })
  ),
  ...[0.1, 1, 20, 50, 99, 100].map((blur) => ({ blur })),
  { blur: '100.0' },
  ...[true, 0.05, 0.25, 0.5, 0.95, 1].map((invert) => ({ invert })),
  ...['#f60', '#ff6600', '#ffffff', '#000000', '#12abef'].map((colorTint) => ({
    colorTint,
  })),
  {
    brightness: 20,
    contrast: -25,
    saturate: 50,
    'hue-rotate': '45deg',
    blur: 20,
    invert: 0.25,
    colorTint: '#abcd12',
  },
  {
    brightness: -20,
    contrast: 1,
    saturate: 100,
    'hue-rotate': '-90deg',
    blur: 100,
    invert: true,
    colorTint: '#f60',
  },
  { brightness: 100, contrast: -100, saturate: -100, blur: 100, invert: 0.5 },
  { brightness: 20, saturate: 50, invert: 0.99 },
  { brightness: 20, saturate: 50, invert: 1 },
  { contrast: '0', saturate: '0', blur: 20 },
]

function native(input: number[], width: number, height: number, filter: any) {
  const { filters, output } = getStyleFilters(filter, '0:v', 0, { width, height })
  const graph = toGraph(filters)
  const result = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      width + 'x' + height,
      '-i',
      'pipe:0',
      ...(graph ? ['-filter_complex', graph, '-map', '[' + output + ']'] : []),
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgba',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    {
      input: Buffer.from(input),
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      timeout: 10000,
    }
  )
  expect(result.status, result.stderr?.toString()).toBe(0)
  expect(result.stdout.length).toBe(input.length)
  return result.stdout
}

test('GPU filter calculations track native FFmpeg across colors, extremes and dimensions', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openEditor(page)
  await page.evaluate(async () => {
    const { GpuFilterPreview } = await (window as any).__zvidTest.filterGpu()
    ;(window as any).__gpuOracle = new GpuFilterPreview()
  })
  const scores = []
  for (const [width, height] of [
    [64, 48],
    [65, 49],
    [2, 2],
    [1, 9],
  ]) {
    for (const filter of filters) {
      const pixels = await page.evaluate(
        ({ width, height, filter }) => {
          const source = document.createElement('canvas')
          source.width = width
          source.height = height
          const ctx = source.getContext('2d')!
          const input = ctx.createImageData(width, height)
          let seed = 23
          for (let i = 0; i < input.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) | 0
            const x = (i / 4) % width,
              y = Math.floor(i / 4 / width)
            input.data.set(
              [
                (x / Math.max(1, width - 1)) * 255,
                (y / Math.max(1, height - 1)) * 255,
                seed >>> 24,
                255,
              ],
              i
            )
          }
          ctx.putImageData(input, 0, 0)
          const result = (window as any).__gpuOracle.render(source, width, height, filter)
          ctx.clearRect(0, 0, width, height)
          ctx.drawImage(result, 0, 0)
          return {
            input: Array.from(input.data),
            output: Array.from(ctx.getImageData(0, 0, width, height).data),
          }
        },
        { width: width!, height: height!, filter }
      )
      const expected = native(pixels.input, width!, height!, filter)
      let max = 0,
        total = 0
      for (let i = 0; i < expected.length; i++) {
        const d = Math.abs(expected[i]! - pixels.output[i]!)
        max = Math.max(max, d)
        total += d
      }
      const mae = total / expected.length
      scores.push({ width, height, filter, max, mae })
      expect
        .soft(mae, JSON.stringify({ width, height, filter, max, mae }))
        .toBeLessThanOrEqual(1.5)
      expect
        .soft(max, JSON.stringify({ width, height, filter, max, mae }))
        .toBeLessThanOrEqual(6)
    }
  }
  console.log(
    'GPU fidelity:',
    JSON.stringify({
      comparisons: scores.length,
      maxChannelError: Math.max(...scores.map((s) => s.max)),
      worstMeanError: Math.max(...scores.map((s) => s.mae)),
    })
  )
  await page.evaluate(() => (window as any).__gpuOracle.dispose())
})

test('GPU cropping, fitting and rounded transparent edges match the reference raster', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openEditor(page)
  const scores = []
  for (const options of [
    {},
    { fit: 'contain' },
    { fit: 'cover' },
    { crop: { x: 13, y: 7, width: 61, height: 43 } },
    { radius: { tl: 70, tr: 10, br: 40, bl: 20 } },
    { fit: 'contain', radius: { tl: 12, tr: 42, br: 0, bl: 28 } },
  ]) {
    for (const filter of [
      {},
      { blur: 20 },
      {
        brightness: 20,
        saturate: 50,
        'hue-rotate': '45deg',
        blur: 20,
        invert: 0.25,
        colorTint: '#f60',
      },
    ]) {
      const pixels = await page.evaluate(
        async ({ options, filter }) => {
          const t = (window as any).__zvidTest
          const { GpuFilterPreview } = await t.filterGpu()
          const { drawFilterFrame } = await t.filterFrame()
          const source = document.createElement('canvas')
          source.width = 96
          source.height = 64
          const ctx = source.getContext('2d')!
          const data = ctx.createImageData(96, 64)
          for (let y = 0; y < 64; y++)
            for (let x = 0; x < 96; x++) {
              data.data.set(
                [
                  (x * 255) / 95,
                  (y * 255) / 63,
                  ((x + y) * 255) / 158,
                  x < 24 ? 0 : x < 64 ? 128 : 255,
                ],
                (y * 96 + x) * 4
              )
            }
          ctx.putImageData(data, 0, 0)
          const img = new Image()
          img.src = source.toDataURL()
          await img.decode()
          const output = document.createElement('canvas')
          output.width = 120
          output.height = 90
          const target = output.getContext('2d')!
          drawFilterFrame(target, img, 120, 90, options.fit, options.crop, options.radius)
          const input = Array.from(target.getImageData(0, 0, 120, 90).data)
          const gpu = new GpuFilterPreview()
          try {
            target.clearRect(0, 0, 120, 90)
            target.drawImage(gpu.render(img, 120, 90, filter, options), 0, 0)
            return { input, output: Array.from(target.getImageData(0, 0, 120, 90).data) }
          } finally {
            gpu.dispose()
          }
        },
        { options, filter }
      )
      const expected = native(pixels.input, 120, 90, filter)
      const errors: number[] = []
      let alphaTotal = 0
      for (let i = 0; i < expected.length; i += 4) {
        const a = expected[i + 3]!,
          b = pixels.output[i + 3]!
        alphaTotal += Math.abs(a - b)
        // Compare visible, premultiplied color, not undefined RGB at alpha=0.
        for (let c = 0; c < 3; c++)
          errors.push(Math.abs(expected[i + c]! * a - pixels.output[i + c]! * b) / 255)
      }
      errors.sort((a, b) => a - b)
      const score = {
        options,
        filter,
        mae: errors.reduce((a, b) => a + b, 0) / errors.length,
        p99: errors[Math.floor(errors.length * 0.99)],
        alphaMae: alphaTotal / (120 * 90),
      }
      scores.push(score)
      // Canvas and GPU use different edge antialiasing / resampling kernels.
      // Keep the allowance localized: <=1 mean byte and <=5 bytes for 99% of colors.
      // The asymmetric rounded fixture measures ~4.06 at p99 (alpha coverage),
      // unlike the opaque color oracle's <=1 maximum error.
      expect.soft(score.mae, JSON.stringify(score)).toBeLessThanOrEqual(1)
      expect.soft(score.p99, JSON.stringify(score)).toBeLessThanOrEqual(5)
      expect.soft(score.alphaMae, JSON.stringify(score)).toBeLessThanOrEqual(0.5)
    }
  }
  console.log('GPU geometry:', JSON.stringify(scores))
})

test('GPU playback switches back to exact FFmpeg after pausing', async ({ page }) => {
  await openEditor(page)
  await loadProject(page, {
    width: 640,
    height: 360,
    duration: 2,
    visuals: [
      {
        type: 'VIDEO',
        src: fx('clip.mp4'),
        width: 640,
        height: 360,
        volume: 0,
        filter: { brightness: 20, blur: 20 },
      },
    ],
  })
  const layer = page.locator('.stage-frame .filtered-media')
  await expect(layer).toHaveAttribute('data-filter-engine', 'ffmpeg', { timeout: 60_000 })
  await page.evaluate(() => {
    ;(window as any).__zvidTest.editor.playing = true
  })
  await expect(layer).toHaveAttribute('data-filter-engine', 'gpu')
  await expect(layer).not.toHaveAttribute('data-filter-gpu-unavailable', 'true')
  await page.evaluate(() => {
    ;(window as any).__zvidTest.editor.playing = false
  })
  await expect(layer).toHaveAttribute('data-filter-engine', 'ffmpeg')
  await expect(layer).toHaveAttribute('data-filter-state', 'ready')
})

test('a pending FFmpeg download never blocks GPU playback', async ({ page }) => {
  let requested = false
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/*ffmpeg-core*.wasm*', async (route) => {
    if (route.request().resourceType() !== 'script') {
      requested = true
      await gate
    }
    await route.continue()
  })
  try {
    await openEditor(page)
    await loadProject(page, {
      width: 640,
      height: 360,
      duration: 2,
      visuals: [
        {
          type: 'VIDEO',
          src: fx('clip.mp4'),
          width: 320,
          height: 180,
          volume: 0,
          filter: { brightness: 20, blur: 20 },
        },
      ],
    })
    await expect.poll(() => requested).toBe(true)
    const layer = page.locator('.stage-frame .filtered-media')
    await page.evaluate(() => {
      const e = (window as any).__zvidTest.editor
      e.loop = true
      e.playing = true
    })
    await expect(layer).toHaveAttribute('data-filter-engine', 'gpu')
    await expect(layer).toHaveAttribute('data-filter-state', 'ready')
    const revision = Number(await layer.getAttribute('data-filter-revision'))
    await expect
      .poll(async () => Number(await layer.getAttribute('data-filter-revision')))
      .toBeGreaterThan(revision + 15)
    await page.evaluate(() => {
      ;(window as any).__zvidTest.editor.playing = false
    })
    release()
    await expect(layer).toHaveAttribute('data-filter-engine', 'ffmpeg', {
      timeout: 60_000,
    })
    await expect(layer).toHaveAttribute('data-filter-state', 'ready')
  } finally {
    release()
  }
})

test('missing GPU support uses the explicit compatibility preview', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...options: any[]
    ) {
      if (kind === 'webgl2') return null
      return original.call(this, kind as any, ...options)
    } as any
  })
  await openEditor(page)
  await loadProject(page, {
    width: 640,
    height: 360,
    duration: 2,
    visuals: [
      {
        type: 'VIDEO',
        src: fx('clip.mp4'),
        width: 160,
        height: 90,
        volume: 0,
        filter: { brightness: 20 },
      },
    ],
  })
  const layer = page.locator('.stage-frame .filtered-media')
  await expect(layer).toHaveAttribute('data-filter-state', 'ready', { timeout: 60_000 })
  await expect(layer).toHaveAttribute('data-filter-gpu-unavailable', 'true')
  await page.evaluate(() => {
    ;(window as any).__zvidTest.editor.playing = true
  })
  await expect(layer.locator('.compatibility-note')).toBeVisible()
  await expect(layer).toHaveAttribute('data-filter-engine', 'ffmpeg')
})

test('a lost GPU context is replaced without stopping the video', async ({ page }) => {
  await openEditor(page)
  await loadProject(page, {
    width: 640,
    height: 360,
    duration: 2,
    visuals: [
      {
        type: 'VIDEO',
        src: fx('clip.mp4'),
        width: 320,
        height: 180,
        volume: 0,
        filter: { brightness: 20, blur: 20 },
      },
    ],
  })
  const layer = page.locator('.stage-frame .filtered-media')
  await expect(layer).toHaveAttribute('data-filter-state', 'ready', { timeout: 60_000 })
  await page.evaluate(async () => {
    const t = (window as any).__zvidTest,
      module = await t.filterGpu()
    t.editor.loop = true
    t.editor.playing = true
    const source = document.querySelector('.stage-frame video.media') as HTMLVideoElement
    module
      .renderGpuPreview(source, 320, 180, { brightness: 20, blur: 20 })
      .getContext('webgl2')
      .getExtension('WEBGL_lose_context')
      .loseContext()
  })
  const revision = Number(await layer.getAttribute('data-filter-revision'))
  await expect
    .poll(async () => Number(await layer.getAttribute('data-filter-revision')))
    .toBeGreaterThan(revision + 15)
  await expect(layer).toHaveAttribute('data-filter-engine', 'gpu')
  await expect(layer).not.toHaveAttribute('data-filter-gpu-unavailable', 'true')
})

test('full-HD GPU playback sustains the source frame rate', async ({}, info) => {
  test.setTimeout(180_000)
  const browser = await chromium.launch({
    channel: 'chrome',
    args: [
      '--enable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
    ],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unavailable'
    })
    test.skip(
      /SwiftShader|llvmpipe|unavailable/i.test(renderer),
      'A hardware GPU is required for the real-time performance gate; fidelity tests still run in software.'
    )
    const video = info.outputPath('full-hd.mp4')
    const generated = spawnSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=1920x1080:r=30:d=10',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-y',
        video,
      ],
      { windowsHide: true, timeout: 60_000 }
    )
    expect(generated.status, generated.stderr?.toString()).toBe(0)
    await page.route('**/full-hd.mp4', (route) =>
      route.fulfill({ path: video, contentType: 'video/mp4' })
    )
    await openEditor(page)
    await loadProject(page, {
      width: 1920,
      height: 1080,
      duration: 10,
      visuals: [
        {
          type: 'VIDEO',
          src: fx('full-hd.mp4'),
          width: 1920,
          height: 1080,
          volume: 0,
          filter: { brightness: 20 },
        },
      ],
    })
    const results = []
    for (const filter of [
      { brightness: 20 },
      { blur: 20 },
      {
        brightness: 20,
        contrast: -25,
        saturate: 50,
        'hue-rotate': '45deg',
        blur: 20,
        invert: 0.25,
        colorTint: '#abcdef',
      },
    ]) {
      await page.evaluate((filter) => {
        const t = (window as any).__zvidTest
        t.editor.playing = false
        t.editor.playhead = 0
        t.project.patchVisual(t.project.doc.visuals[0]._id, { filter })
      }, filter)
      const layer = page.locator('.stage-frame .filtered-media')
      await expect(layer).toHaveAttribute('data-filter-state', 'ready', {
        timeout: 60_000,
      })
      await page.evaluate(() => {
        ;(window as any).__zvidTest.editor.playing = true
      })
      await expect(layer).toHaveAttribute('data-filter-engine', 'gpu')
      const timing = await page.evaluate(async () => {
        const layer = document.querySelector(
          '.stage-frame .filtered-media'
        ) as HTMLElement
        const video = document.querySelector(
          '.stage-frame video.media.filter-source'
        ) as HTMLVideoElement
        await new Promise<void>((resolve) => {
          const start = performance.now()
          const warm = () =>
            performance.now() - start > 1000 ? resolve() : requestAnimationFrame(warm)
          requestAnimationFrame(warm)
        })
        const start = performance.now(),
          mediaStart = video.currentTime
        let revision = Number(layer.dataset.filterRevision),
          frames = 0,
          last = start
        const gaps: number[] = []
        let cpuReads = 0
        const original = CanvasRenderingContext2D.prototype.getImageData
        CanvasRenderingContext2D.prototype.getImageData = function (...args: any[]) {
          cpuReads++
          return original.apply(this, args as any)
        }
        try {
          await new Promise<void>((resolve) => {
            const tick = () => {
              const now = performance.now(),
                next = Number(layer.dataset.filterRevision)
              if (next !== revision) {
                frames += next - revision
                gaps.push(now - last)
                last = now
                revision = next
              }
              if (now - start >= 3500) resolve()
              else requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
        } finally {
          CanvasRenderingContext2D.prototype.getImageData = original
        }
        const elapsed = (performance.now() - start) / 1000
        gaps.sort((a, b) => a - b)
        return {
          fps: frames / elapsed,
          mediaRate: (video.currentTime - mediaStart) / elapsed,
          maxGap: gaps.at(-1),
          p95Gap: gaps[Math.floor(gaps.length * 0.95)],
          cpuReads,
          connected: video.isConnected,
          mediaTime: video.currentTime,
          mediaPaused: video.paused,
          playhead: (window as any).__zvidTest.editor.playhead,
        }
      })
      results.push({ filter, ...timing })
      console.log('Playback case:', JSON.stringify({ filter, ...timing }))
      expect(timing.fps, JSON.stringify(timing)).toBeGreaterThanOrEqual(27)
      expect(timing.maxGap).toBeLessThan(200)
      expect(timing.cpuReads).toBe(0)
      expect(timing.mediaRate).toBeGreaterThan(0.95)
      await page.evaluate(() => {
        ;(window as any).__zvidTest.editor.playing = false
      })
      await expect(layer).toHaveAttribute('data-filter-engine', 'ffmpeg')
    }
    console.log('Full-HD playback:', JSON.stringify({ renderer, results }))
    await info.attach('gpu-performance.json', {
      body: JSON.stringify({ renderer, results }, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await browser.close()
  }
})
