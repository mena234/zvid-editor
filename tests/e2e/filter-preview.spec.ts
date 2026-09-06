import { test, expect, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { openEditor, loadProject, fx } from './helpers/app'

const require = createRequire(import.meta.url)
const { getStyleFilters, toGraph } = require('../helpers/nativeStyle.cjs')
const BASE = {
  width: 640,
  height: 480,
  duration: 2,
  backgroundColor: '#334455',
}

async function patch(page: Page, change: any) {
  await page.evaluate((change) => {
    const t = (window as any).__zvidTest
    t.project.patchVisual(t.project.doc.visuals[0]._id, change)
  }, change)
}
async function ready(page: Page) {
  await expect(page.locator('.stage-frame .filtered-media').first()).toHaveAttribute(
    'data-filter-state',
    'ready',
    { timeout: 60_000 }
  )
}
async function comparePixels(page: Page, filter: any) {
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector(
      '.stage-frame .filtered-media canvas'
    ) as HTMLCanvasElement
    const source = document.querySelector('.stage-frame .media') as
      | HTMLImageElement
      | HTMLVideoElement
    const input = document.createElement('canvas')
    input.width = canvas.width
    input.height = canvas.height
    input.getContext('2d')!.drawImage(source, 0, 0, input.width, input.height)
    const encode = (c: HTMLCanvasElement) =>
      Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data)
    return {
      input: encode(input),
      actual: encode(canvas),
      width: canvas.width,
      height: canvas.height,
    }
  })
  const { filters, output } = getStyleFilters(filter, '0:v', 0, pixels)
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
      `${pixels.width}x${pixels.height}`,
      '-i',
      'pipe:0',
      '-filter_complex',
      toGraph(filters),
      '-map',
      `[${output}]`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgba',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { input: Buffer.from(pixels.input), windowsHide: true, timeout: 10_000 }
  )
  expect(result.status, result.stderr?.toString()).toBe(0)
  let max = 0,
    sum = 0
  for (let i = 0; i < result.stdout.length; i++) {
    const diff = Math.abs(result.stdout[i]! - pixels.actual[i]!)
    max = Math.max(max, diff)
    sum += diff
  }
  expect({ max, sum }, JSON.stringify(filter)).toEqual({ max: 0, sum: 0 })
}

test('image preview pixels match native filters, including rapid edits and reset', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openEditor(page)
  const initial = { brightness: 20 }
  await loadProject(page, {
    ...BASE,
    visuals: [
      {
        type: 'IMAGE',
        src: fx('image.png'),
        width: 320,
        height: 240,
        filter: initial,
      },
    ],
  })
  await ready(page)
  await comparePixels(page, initial)
  for (const filter of [
    ...[1, 2, 5, 10, 25, 50, 75, 100].map(contrast => ({ contrast })),
    { saturate: -100 },
    { 'hue-rotate': '90deg' },
    { blur: 100 },
    { invert: 0.25 },
    { colorTint: '#f60' },
    {
      brightness: 20,
      contrast: -25,
      saturate: 50,
      blur: 20,
      invert: 0.5,
      'hue-rotate': '45deg',
      colorTint: '#abcdef',
    },
  ]) {
    await patch(page, { filter })
    await ready(page)
    await comparePixels(page, filter)
  }
  const final = { brightness: -30, contrast: -50 }
  await page.evaluate((last) => {
    const t = (window as any).__zvidTest,
      id = t.project.doc.visuals[0]._id
    for (let i = -50; i <= 50; i++)
      t.project.patchVisual(id, { filter: { brightness: i } }, false)
    t.project.patchVisual(id, { filter: last })
  }, final)
  await ready(page)
  await comparePixels(page, final)
  await page.screenshot({ path: 'tests/e2e/.results/filter-preview.png' })
  await patch(page, { filter: undefined })
  await expect(page.locator('.stage-frame .filtered-media')).toHaveCount(0)
  await expect(page.locator('.stage-frame img.media')).not.toHaveClass(/filter-source/)
})

test('video filter updates during playback and matches native after seeking', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await openEditor(page)
  const filter = {
    brightness: 10,
    saturate: 50,
    'hue-rotate': '45deg',
    blur: 20,
  }
  await loadProject(page, {
    ...BASE,
    visuals: [
      {
        type: 'VIDEO',
        src: fx('clip.mp4'),
        width: 320,
        height: 180,
        volume: 0,
        filter,
      },
    ],
  })
  await ready(page)
  await page.evaluate(() => {
    ;(window as any).__zvidTest.editor.playing = true
  })
  await expect
    .poll(() =>
      page.locator('.stage-frame .filtered-media').getAttribute('data-filter-revision')
    )
    .not.toBe('1')
  await expect
    .poll(() => page.evaluate(() => (window as any).__zvidTest.editor.playhead))
    .toBeGreaterThan(0.3)
  for (const time of [1.2, 0.2]) {
    await page.evaluate((time) => {
      const t = (window as any).__zvidTest
      t.editor.playing = false
      t.editor.playhead = time
    }, time)
    await page.waitForFunction(() => {
      const v = document.querySelector('.stage-frame video') as HTMLVideoElement
      return v.readyState >= 2 && !v.seeking
    })
    await ready(page)
    // The last old frame cannot satisfy readiness for a paused seek.
    await comparePixels(page, filter)
  }
})

test('media without CORS retries the relay; failures are explicit and removable', async ({
  page,
}) => {
  await openEditor(page)
  await page.route('https://media.example.test/image.png', (route) =>
    route.abort('failed')
  )
  await page.route('**/api/filter-media?src=*', (route) =>
    route.fulfill({
      path: 'tests/e2e/fixtures/image.png',
      contentType: 'image/png',
    })
  )
  await loadProject(page, {
    ...BASE,
    visuals: [
      {
        type: 'IMAGE',
        src: 'https://media.example.test/image.png',
        width: 320,
        height: 240,
        filter: { brightness: 20 },
      },
    ],
  })
  await ready(page)
  await expect(page.locator('.stage-frame img.media')).toHaveAttribute(
    'src',
    /\/api\/filter-media/
  )
  await comparePixels(page, { brightness: 20 })
  await page.unroute('**/api/filter-media?src=*')
  await patch(page, { src: 'http://127.0.0.1:1/missing.png' })
  await expect(page.locator('.stage-frame .media-error')).toBeVisible()
})

test('the media relay blocks private and credentialed URLs', async ({ request }) => {
  for (const src of [
    'http://127.0.0.1/a',
    'http://[::1]/a',
    'http://169.254.169.254/a',
    'http://user:pass@example.com/a',
    'file:///etc/passwd',
  ]) {
    const result = await request.get('/api/filter-media', { params: { src } })
    expect(result.status()).toBe(502)
  }
})

test('a reused worker survives sustained playback and is shared by stage items', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await openEditor(page)
  const filter = { brightness: 10, blur: 20 }
  await loadProject(page, {
    ...BASE,
    visuals: [0, 1, 2].map((i) => ({
      type: 'VIDEO',
      src: fx('clip.mp4'),
      x: i * 160,
      width: 160,
      height: 90,
      volume: 0,
      filter,
    })),
  })
  await ready(page)
  await page.evaluate(() => {
    const e = (window as any).__zvidTest.editor
    e.loop = true
    e.playing = true
  })
  await expect
    .poll(
      async () =>
        page
          .locator('.stage-frame .filtered-media')
          .evaluateAll((els) =>
            els.reduce(
              (sum, el) => sum + Number((el as HTMLElement).dataset.filterRevision),
              0
            )
          ),
      { timeout: 60_000 }
    )
    .toBeGreaterThan(220)
  await expect(page.locator('.stage-frame [data-filter-state="error"]')).toHaveCount(0)
  await page.evaluate(() => {
    ;(window as any).__zvidTest.editor.playing = false
  })
  await ready(page)
  expect(page.workers()).toHaveLength(1)
})

test('a failed engine download shows an error and Retry recovers', async ({ page }) => {
  test.setTimeout(120_000)
  await page.route('**/*ffmpeg-core*.wasm*', (route) =>
    // Vite also serves a JS URL-export module at .wasm?import&url. Blocking
    // that tests the browser's cached ESM import failure, not a WASM download.
    route.request().resourceType() === 'script' ? route.continue() : route.abort('failed')
  )
  await openEditor(page)
  await loadProject(page, {
    ...BASE,
    visuals: [
      {
        type: 'IMAGE',
        src: fx('image.png'),
        width: 320,
        height: 240,
        filter: { brightness: 20 },
      },
    ],
  })
  await expect(page.locator('.stage-frame .filtered-media')).toHaveAttribute(
    'data-filter-state',
    'error',
    { timeout: 60_000 }
  )
  await page.unroute('**/*ffmpeg-core*.wasm*')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await ready(page)
  await comparePixels(page, { brightness: 20 })
})
