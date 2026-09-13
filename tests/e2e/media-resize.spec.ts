import { test, expect, type Page } from '@playwright/test'
import { exportedDoc, fx, loadProject, openEditor } from './helpers/app'

const baseItem = { x: 400, y: 220, width: 400, height: 300 }
const sourceFiles = { IMAGE: 'image.png', VIDEO: 'clip.mp4', GIF: 'anim.gif' } as const

async function loadMedia(page: Page, type: keyof typeof sourceFiles, fields: Record<string, any> = {}) {
  await loadProject(page, {
    name: 'media resize', resolution: 'full-hd', duration: 10, frameRate: 30,
    visuals: [{ type, src: fx(sourceFiles[type]), ...baseItem, ...fields }],
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

  test(`${type} side handles stretch one axis, then corners preserve the new aspect`, async ({ page }) => {
    await loadMedia(page, type)
    const before = await exportedDoc(page)
    await resize(page, 'w', -200, 60)
    let item = (await exportedDoc(page)).visuals[0]
    expect(item.width).toBeCloseTo(600, 0)
    expect(item.height).toBe(300)
    expect(item.x).toBeCloseTo(200, 0)
    expect(item.y).toBe(220)
    expect(item.resize).toBeUndefined()
    if (type === 'IMAGE') {
      expect(item.cropParams).toEqual({ x: 0, y: 0, width: 320, height: 240 })
    }
    const fit = await page.locator('.stage-item .media').evaluate((el) => getComputedStyle(el).objectFit)
    expect(fit).toBe('fill')

    await resize(page, 'n', 60, -100)
    item = (await exportedDoc(page)).visuals[0]
    expect(item.width).toBeCloseTo(600, 0)
    expect(item.height).toBeCloseTo(400, 0)
    expect(item.x).toBeCloseTo(200, 0)
    expect(item.y + item.height).toBeCloseTo(520, 0)

    const ratio = item.width / item.height
    await resize(page, 'se', 90, 2)
    item = (await exportedDoc(page)).visuals[0]
    expect(item.width / item.height).toBeCloseTo(ratio, 4)

    // Each complete gesture is one undo step, including the export crop.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    expect(await exportedDoc(page)).toEqual(before)
  })
}

test('a side drag preserves an existing cover crop in preview and exported JSON', async ({ page }) => {
  await loadMedia(page, 'IMAGE', { width: 300, height: 300, resize: 'cover' })
  await resize(page, 'e', 120, 0)
  const item = (await exportedDoc(page)).visuals[0]
  expect(item.cropParams).toEqual({ x: 40, y: 0, width: 240, height: 240 })
  const painted = await page.locator('.stage-item .media').evaluate((el) => ({
    width: parseFloat((el as HTMLElement).style.width),
    height: parseFloat((el as HTMLElement).style.height),
    left: parseFloat((el as HTMLElement).style.left),
  }))
  expect(painted.width).toBeCloseTo(item.width * 320 / 240, 3)
  expect(painted.height).toBe(item.height)
  expect(painted.left).toBeCloseTo(-item.width * 40 / 240, 3)
})

test('existing cropParams remain unchanged while manually stretching', async ({ page }) => {
  const cropParams = { x: 30, y: 20, width: 240, height: 160 }
  await loadMedia(page, 'IMAGE', { cropParams })
  await resize(page, 's', 20, 100)
  const item = (await exportedDoc(page)).visuals[0]
  expect(item.cropParams).toEqual(cropParams)
  expect(item.width).toBe(400)
  expect(item.height).toBeCloseTo(400, 0)
})

test('resizing retains authored crop placeholders from the resolved preview', async ({ page }) => {
  const cropParams = { x: 0, y: 0, width: '{{cropWidth}}', height: '{{cropHeight}}' }
  await loadProject(page, {
    resolution: 'full-hd', duration: 10,
    variables: { cropWidth: 240, cropHeight: 160 },
    visuals: [{ type: 'IMAGE', src: fx('image.png'), ...baseItem, cropParams }],
  })
  await expect(page.locator('.stage-item .media-loading')).toHaveCount(0)
  await page.locator('.stage-frame .stage-item').click()
  await resize(page, 'e', 100, 0)
  expect((await exportedDoc(page)).visuals[0].cropParams).toEqual(cropParams)
})

test('a rotated side drag follows its local axis and keeps the opposite edge fixed', async ({ page }) => {
  await loadMedia(page, 'IMAGE', { angle: 90, anchor: 'center-center', x: 800, y: 500 })
  await resize(page, 'e', 50, 100)
  const item = (await exportedDoc(page)).visuals[0]
  expect(item.width).toBeCloseTo(500, 0)
  expect(item.height).toBe(300)
  expect(item.x).toBeCloseTo(800, 0)
  expect(item.y).toBeCloseTo(550, 0)
  expect(item.angle).toBe(90)
})

test('clicking a side handle does not create a crop or change the document', async ({ page }) => {
  await loadMedia(page, 'IMAGE', { resize: 'contain' })
  const before = await exportedDoc(page)
  await page.locator('[data-resize-handle="e"]').click()
  expect(await exportedDoc(page)).toEqual(before)
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
  await resize(page, 'e', 100, 0)
  expect(await exportedDoc(page)).toEqual(before)
  release()
  await expect(page.locator('.stage-item .media-loading')).toHaveCount(0)
  await resize(page, 'e', 100, 0)
  expect((await exportedDoc(page)).visuals[0].cropParams)
    .toEqual({ x: 0, y: 0, width: 320, height: 240 })
})
