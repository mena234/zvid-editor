import { test, expect, type Page } from '@playwright/test'
import { exportedDoc, fx, loadProject, openEditor } from './helpers/app'

const baseItem = { x: 400, y: 220, width: 400, height: 300 }
const sources = {
  IMAGE: { file: 'image.png', width: 320, height: 240 },
  VIDEO: { file: 'clip.mp4', width: 320, height: 180 },
  GIF: { file: 'anim.gif', width: 160, height: 120 },
} as const

async function loadMedia(page: Page, type: keyof typeof sources, fields: Record<string, any> = {}) {
  await loadProject(page, {
    name: 'media resize', resolution: 'full-hd', duration: 10, frameRate: 30,
    visuals: [{ type, src: fx(sources[type].file), ...baseItem, ...fields }],
  })
  await expect(page.locator('.stage-item .media-loading')).toHaveCount(0)
  await page.locator('.stage-frame .stage-item').click()
  await expect(page.locator('.sel-box.primary')).toHaveCount(1)
}

async function resize(page: Page, handle: string, dx: number, dy: number) {
  const frame = (await page.locator('.stage-frame').boundingBox())!
  const scale = frame.width / 1920
  const h = (await page.locator(`[data-resize-handle="${handle}"]`).boundingBox())!
  const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx * scale, from.y + dy * scale, { steps: 6 })
  await page.mouse.up()
}

async function paintedBox(page: Page) {
  return (await page.locator('.stage-item .media').boundingBox())!
}

function expectSamePaintedBox(actual: Awaited<ReturnType<typeof paintedBox>>, expected: typeof actual) {
  // An inward edge crop must not move or scale the underlying source pixels.
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThan(0.5)
}

function expectCrop(actual: any, expected: { x: number; y: number; width: number; height: number }) {
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(actual[key], key).toBeCloseTo(expected[key], 0)
}

function expectUniformCrop(item: any, source: { width: number; height: number }) {
  const crop = item.cropParams
  expect(item.width / crop.width).toBeCloseTo(item.height / crop.height, 3)
  expect(crop.x).toBeGreaterThanOrEqual(0)
  expect(crop.y).toBeGreaterThanOrEqual(0)
  expect(crop.x + crop.width).toBeLessThanOrEqual(source.width + 0.001)
  expect(crop.y + crop.height).toBeLessThanOrEqual(source.height + 0.001)
}

test.beforeEach(async ({ page }) => { await openEditor(page) })

for (const type of ['IMAGE', 'VIDEO', 'GIF'] as const) {
  test(`${type} corner scales proportionally from the opposite corner without Shift`, async ({ page }) => {
    await loadMedia(page, type)
    await resize(page, 'nw', -100, -10)
    const item = (await exportedDoc(page)).visuals[0]
    expect(item.width).toBeCloseTo(500, 0)
    expect(item.width / item.height).toBeCloseTo(4 / 3, 4)
    expect(item.x + item.width).toBeCloseTo(800, 0)
    expect(item.y + item.height).toBeCloseTo(520, 0)
  })

  test(`${type} middle handles crop, reveal and zoom without stretching; corners preserve the crop`, async ({ page }) => {
    const source = sources[type]
    const height = 400 * source.height / source.width
    await loadMedia(page, type, { height })
    const before = await exportedDoc(page)
    const originalPaint = await paintedBox(page)

    await resize(page, 'w', 100, 60)
    let item = (await exportedDoc(page)).visuals[0]
    expect(item.width).toBeCloseTo(300, 0)
    expect(item.height).toBe(height)
    expect(item.x).toBeCloseTo(500, 0)
    expect(item.y).toBe(220)
    expectCrop(item.cropParams, {
      x: source.width / 4, y: 0, width: source.width * 3 / 4, height: source.height,
    })
    expectUniformCrop(item, source)
    expectSamePaintedBox(await paintedBox(page), originalPaint)

    // Reopen the crop to the original frame, revealing the hidden left side.
    await resize(page, 'w', -100, 0)
    item = (await exportedDoc(page)).visuals[0]
    expectCrop(item.cropParams, { x: 0, y: 0, width: source.width, height: source.height })
    expectSamePaintedBox(await paintedBox(page), originalPaint)

    // Past the source boundary the picture grows uniformly to keep the frame filled.
    await resize(page, 'w', -200, 0)
    item = (await exportedDoc(page)).visuals[0]
    expect(item.width).toBeCloseTo(600, 0)
    expect(item.height).toBe(height)
    expect(item.x + item.width).toBeCloseTo(800, 0)
    expectUniformCrop(item, source)
    expect(item.cropParams.width).toBeCloseTo(source.width, 0)
    const zoomedPaint = await paintedBox(page)
    expect(zoomedPaint.width / originalPaint.width).toBeCloseTo(1.5, 2)
    expect(zoomedPaint.height / originalPaint.height).toBeCloseTo(1.5, 2)

    const ratio = item.width / item.height
    const crop = item.cropParams
    await resize(page, 'se', 90, 2)
    item = (await exportedDoc(page)).visuals[0]
    expect(item.width / item.height).toBeCloseTo(ratio, 4)
    expect(item.cropParams).toEqual(crop)
    expectUniformCrop(item, source)

    // Every completed gesture, including its source crop, is one undo step.
    for (let gesture = 0; gesture < 4; gesture++) await page.keyboard.press('Control+z')
    expect(await exportedDoc(page)).toEqual(before)
  })
}

test('a cover image reveals cropped source before uniformly enlarging it', async ({ page }) => {
  await loadMedia(page, 'IMAGE', { width: 300, height: 300, resize: 'cover' })
  await resize(page, 'e', 60, 0)
  let item = (await exportedDoc(page)).visuals[0]
  expect(item.width).toBeCloseTo(360, 0)
  expect(item.x).toBe(400)
  expectUniformCrop(item, sources.IMAGE)
  expect(item.cropParams.width).toBeCloseTo(288, 0)
  expect(item.cropParams.height).toBeCloseTo(240, 0)
  let painted = await page.locator('.stage-item .media').evaluate((el) => ({
    width: parseFloat((el as HTMLElement).style.width),
    height: parseFloat((el as HTMLElement).style.height),
  }))
  expect(painted.width).toBeCloseTo(400, 0)
  expect(painted.height).toBeCloseTo(300, 0)

  await resize(page, 'e', 160, 0)
  item = (await exportedDoc(page)).visuals[0]
  expect(item.width).toBeCloseTo(520, 0)
  expect(item.x).toBe(400)
  expectUniformCrop(item, sources.IMAGE)
  expect(item.cropParams.width).toBeCloseTo(320, 0)
  painted = await page.locator('.stage-item .media').evaluate((el) => ({
    width: parseFloat((el as HTMLElement).style.width),
    height: parseFloat((el as HTMLElement).style.height),
  }))
  expect(painted.width).toBeCloseTo(520, 0)
  expect(painted.height).toBeCloseTo(390, 0)
})

for (const { handle, dx, dy, crop } of [
  { handle: 'w', dx: 100, dy: 0, crop: { x: 100, y: 30, width: 180, height: 180 } },
  { handle: 'e', dx: -100, dy: 0, crop: { x: 40, y: 30, width: 180, height: 180 } },
  { handle: 'n', dx: 0, dy: 75, crop: { x: 40, y: 75, width: 240, height: 135 } },
  { handle: 's', dx: 0, dy: -75, crop: { x: 40, y: 30, width: 240, height: 135 } },
]) {
  test(`existing source crop trims only the dragged ${handle} edge`, async ({ page }) => {
    await loadMedia(page, 'IMAGE', { cropParams: { x: 40, y: 30, width: 240, height: 180 } })
    const before = await paintedBox(page)
    await resize(page, handle, dx, dy)
    const item = (await exportedDoc(page)).visuals[0]
    expectCrop(item.cropParams, crop)
    expectUniformCrop(item, sources.IMAGE)
    expectSamePaintedBox(await paintedBox(page), before)
  })
}

for (const { flip, handle, dx, dy, crop } of [
  { flip: 'flipH', handle: 'w', dx: 100, dy: 0, crop: { x: 40, y: 30, width: 180, height: 180 } },
  { flip: 'flipV', handle: 'n', dx: 0, dy: 75, crop: { x: 40, y: 30, width: 240, height: 135 } },
]) {
  test(`${flip} keeps source pixels stationary when cropping the visible ${handle} edge`, async ({ page }) => {
    await loadMedia(page, 'IMAGE', {
      [flip]: true, cropParams: { x: 40, y: 30, width: 240, height: 180 },
    })
    const before = await paintedBox(page)
    await resize(page, handle, dx, dy)
    const item = (await exportedDoc(page)).visuals[0]
    expect(item[flip]).toBe(true)
    expectCrop(item.cropParams, crop)
    expectUniformCrop(item, sources.IMAGE)
    expectSamePaintedBox(await paintedBox(page), before)
  })
}

test('corner resizing retains authored crop placeholders; side cropping changes only affected fields', async ({ page }) => {
  const cropParams = { x: 0, y: 0, width: '{{cropWidth}}', height: '{{cropHeight}}' }
  await loadProject(page, {
    resolution: 'full-hd', duration: 10,
    variables: { cropWidth: 240, cropHeight: 160 },
    visuals: [{ type: 'IMAGE', src: fx('image.png'), ...baseItem, width: 360, height: 240, cropParams }],
  })
  await expect(page.locator('.stage-item .media-loading')).toHaveCount(0)
  await page.locator('.stage-frame .stage-item').click()
  await resize(page, 'se', 90, 0)
  expect((await exportedDoc(page)).visuals[0].cropParams).toEqual(cropParams)
  await resize(page, 'e', -90, 0)
  const crop = (await exportedDoc(page)).visuals[0].cropParams
  expect(crop.x).toBe(0)
  expect(crop.y).toBe(0)
  expect(crop.width).toBeCloseTo(192, 0)
  expect(crop.height).toBe('{{cropHeight}}')
})

test('an unresolved crop cannot corrupt the document when variable preview is disabled', async ({ page }) => {
  await loadProject(page, {
    resolution: 'full-hd', duration: 10,
    variables: { cropWidth: 240, cropHeight: 160 },
    visuals: [{
      type: 'IMAGE', src: fx('image.png'), ...baseItem, width: 360, height: 240,
      cropParams: { x: 0, y: 0, width: '{{cropWidth}}', height: '{{cropHeight}}' },
    }],
  })
  await expect(page.locator('.stage-item .media-loading')).toHaveCount(0)
  await page.evaluate(() => { (window as any).__zvidTest.editor.variablesPreview = false })
  await page.locator('.stage-frame .stage-item').click()
  await expect(page.locator('.sel-box.primary')).toHaveCount(1)
  const before = await exportedDoc(page)

  await resize(page, 'e', -90, 0)
  const after = await exportedDoc(page)
  expect(after).toEqual(before)
  for (const key of ['x', 'y', 'width', 'height'])
    expect(Number.isFinite(after.visuals[0][key]), key).toBe(true)
})

test('a rotated side crop follows its local axis and keeps the opposite edge fixed', async ({ page }) => {
  await loadMedia(page, 'IMAGE', { angle: 90, anchor: 'center-center', x: 800, y: 500 })
  const before = await paintedBox(page)
  await resize(page, 'e', 50, -100)
  const item = (await exportedDoc(page)).visuals[0]
  expect(item.width).toBeCloseTo(300, 0)
  expect(item.height).toBe(300)
  expect(item.x).toBeCloseTo(800, 0)
  expect(item.y).toBeCloseTo(450, 0)
  expect(item.angle).toBe(90)
  expectCrop(item.cropParams, { x: 0, y: 0, width: 240, height: 240 })
  expectUniformCrop(item, sources.IMAGE)
  expectSamePaintedBox(await paintedBox(page), before)
})

test('clicking a side handle does not create a crop or change the document', async ({ page }) => {
  await loadMedia(page, 'IMAGE', { resize: 'contain' })
  const before = await exportedDoc(page)
  await page.locator('[data-resize-handle="e"]').click()
  expect(await exportedDoc(page)).toEqual(before)
})

test('middle handles preserve an explicitly contained image and its letterboxing', async ({ page }) => {
  await loadMedia(page, 'IMAGE', { width: 400, height: 400, resize: 'contain' })
  const media = page.locator('.stage-item .media')
  await expect(media).toHaveCSS('object-fit', 'contain')

  // The first movement must retain the user's fit mode, without switching
  // the square letterboxed frame to a cover crop.
  await resize(page, 'e', -20, 0)
  let item = (await exportedDoc(page)).visuals[0]
  expect(item.resize).toBe('contain')
  expect(item.cropParams).toBeUndefined()
  await expect(media).toHaveCSS('object-fit', 'contain')

  await resize(page, 'e', -80, 0)
  item = (await exportedDoc(page)).visuals[0]
  expect(item.x).toBe(400)
  expect(item.width).toBeCloseTo(300, 0)
  expect(item.height).toBe(400)
  expect(item.resize).toBe('contain')
  expect(item.cropParams).toBeUndefined()
  // CSS contain keeps the complete 4:3 source proportional inside the box.
  await expect(media).toHaveCSS('object-fit', 'contain')
  await expect(media).toHaveCSS('object-position', '50% 50%')
})

test('a highly zoomed video crop stops at a renderable source width', async ({ page }) => {
  await loadMedia(page, 'VIDEO', {
    width: 800, height: 450, cropParams: { x: 0, y: 0, width: 4, height: 2.25 },
  })
  const before = await paintedBox(page)
  // At 200 output pixels per source pixel, the normal 8px handle minimum
  // would produce an invalid subpixel video crop. Preserve two source pixels.
  await resize(page, 'e', -792, 0)
  const item = (await exportedDoc(page)).visuals[0]
  expect(item.x).toBe(400)
  expect(item.width).toBeCloseTo(400, 0)
  expect(item.height).toBe(450)
  expectCrop(item.cropParams, { x: 0, y: 0, width: 2, height: 2.25 })
  expectUniformCrop(item, sources.VIDEO)
  expectSamePaintedBox(await paintedBox(page), before)
})

test('an image awaiting metadata never gets a guessed source crop', async ({ page }) => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/image.png?resize-delayed', async (route) => {
    await ready
    await route.continue()
  })
  await loadProject(page, {
    resolution: 'full-hd', duration: 10,
    visuals: [{ type: 'IMAGE', src: fx('image.png?resize-delayed'), ...baseItem }],
  })
  await page.locator('.stage-item').click()
  const before = await exportedDoc(page)
  await resize(page, 'e', -100, 0)
  expect(await exportedDoc(page)).toEqual(before)
  release()
  await expect(page.locator('.stage-item .media-loading')).toHaveCount(0)
  await resize(page, 'e', -100, 0)
  expectCrop((await exportedDoc(page)).visuals[0].cropParams,
    { x: 0, y: 0, width: 240, height: 240 })
})
