import { test, expect, type Page } from '@playwright/test'
import { openEditor, exportedDoc, loadProject, store, fx } from './helpers/app'

/**
 * Stage / canvas interactions: adding elements through the rail panels,
 * selection (click / marquee), drag-to-move, resize + rotate handles,
 * keyboard nudge, the stage context menu, snap guides and media loading.
 *
 * Ground truth is exportedDoc() — every gesture is driven through the real
 * DOM (mouse/keyboard) and asserted against the exported render JSON.
 */

/* ---------------- spec-local helpers ---------------- */

/** A raw project the importer accepts: full-hd (1920x1080), 10s. */
function baseDoc(visuals: Record<string, any>[]) {
  return {
    name: 'stage-spec',
    resolution: 'full-hd',
    duration: 10,
    frameRate: 30,
    backgroundColor: '#101319',
    outputFormat: 'mp4',
    visuals,
    audios: [],
  }
}

/** Two images with explicit geometry — layout independent of the probe. */
const ITEM_A = {
  type: 'IMAGE',
  src: fx('image.png'),
  x: 200,
  y: 150,
  width: 400,
  height: 300,
}
const ITEM_B = {
  type: 'IMAGE',
  src: fx('image.png'),
  x: 1300,
  y: 600,
  width: 300,
  height: 200,
}

interface Metrics {
  scale: number
  /** project-space point -> viewport (screen) point */
  toScreen: (x: number, y: number) => { x: number; y: number }
}

/** Stage scale = rendered .stage-frame width / project width (CSS transform). */
async function metrics(page: Page): Promise<Metrics> {
  const box = await page.locator('.stage-frame').boundingBox()
  if (!box) throw new Error('stage frame not visible')
  const proj = await page.evaluate(() => {
    const d = (window as any).__zvidTest.project.defaults
    return { w: d.width, h: d.height }
  })
  const scale = box.width / proj.w
  return {
    scale,
    toScreen: (x: number, y: number) => ({ x: box.x + x * scale, y: box.y + y * scale }),
  }
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  midDrag?: () => Promise<void>
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  if (midDrag) await midDrag()
  await page.mouse.up()
}

async function visualIds(page: Page): Promise<string[]> {
  const visuals = await store(page, 'project', 'doc.visuals')
  return visuals.map((v: any) => v._id)
}

/** Open the URL-add form of a media rail tab and submit a fixture URL.
 *  Opens the panel via the bridge — clicking an already-active rail tab
 *  would collapse the shared panel (Veed-style toggle). */
async function addByUrl(page: Page, tabTitle: string, url: string) {
  const id = { Images: 'images', Videos: 'videos', Audio: 'audio', GIFs: 'gifs' }[
    tabTitle
  ]
  await page.evaluate((p) => (window as any).__zvidTest.editor.openPanel(p), id)
  await page.click('.url-toggle')
  await page.fill('.url-form input[type="text"]', url)
  await page.click('.url-form button[type="submit"]')
}

async function ctxMenuClick(page: Page, itemLocator: string, buttonText: string | RegExp) {
  await page.click(itemLocator, { button: 'right' })
  await expect(page.locator('.ctx-menu')).toBeVisible()
  await page.locator('.ctx-menu button', { hasText: buttonText }).click()
  await expect(page.locator('.ctx-menu')).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

/* ---------------- 1. adding elements ---------------- */

test('adds TEXT via the Text panel presets', async ({ page }) => {
  await page.click('.rail-tab[title="Text"]')
  await page.locator('.preset').first().click() // Heading preset
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(1)
  await expect(page.locator('.tl-panel .clip')).toHaveCount(1)
  const doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(1)
  expect(doc.visuals[0].type).toBe('TEXT')
  expect(doc.visuals[0].text).toBe('Your heading')
  expect(doc.visuals[0].style?.fontSize).toBe('96px')
})

test('adds IMAGE via the Images tab URL form', async ({ page }) => {
  await addByUrl(page, 'Images', fx('image.png'))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(1)
  await expect(page.locator('.tl-panel .clip')).toHaveCount(1)
  const doc = await exportedDoc(page)
  expect(doc.visuals[0].type).toBe('IMAGE')
  expect(doc.visuals[0].src).toBe(fx('image.png'))
  expect(doc.visuals[0].resize).toBe('contain')
  await expect(page.locator('.stage-frame .stage-item img')).toBeVisible()
})

test('adds VIDEO via the Videos tab URL form', async ({ page }) => {
  await addByUrl(page, 'Videos', fx('clip.mp4'))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(1)
  await expect(page.locator('.tl-panel .clip')).toHaveCount(1)
  const doc = await exportedDoc(page)
  expect(doc.visuals[0].type).toBe('VIDEO')
  expect(doc.visuals[0].src).toBe(fx('clip.mp4'))
  await expect(page.locator('.stage-frame .stage-item video')).toBeVisible()
})

test('adds GIF via the GIFs tab URL form', async ({ page }) => {
  await addByUrl(page, 'GIFs', fx('anim.gif'))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(1)
  await expect(page.locator('.tl-panel .clip')).toHaveCount(1)
  const doc = await exportedDoc(page)
  expect(doc.visuals[0].type).toBe('GIF')
  expect(doc.visuals[0].src).toBe(fx('anim.gif'))
  // GIFs are added without resize — once the probe resolves 160x120 the
  // stage box collapses from the project size to the intrinsic size
  // (offsetWidth is unscaled layout px; the stage scale is a transform)
  await expect
    .poll(() =>
      page.locator('.stage-frame .stage-item').evaluate((el) => (el as HTMLElement).offsetWidth)
    )
    .toBe(160)
})

/* ---------------- 2. selection ---------------- */

test('click selects an element; empty-stage click clears', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A, ITEM_B]))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(2)
  const ids = await visualIds(page)
  const m = await metrics(page)

  // click the center of item A (200,150 400x300 → center 400,300)
  const c = m.toScreen(400, 300)
  await page.mouse.click(c.x, c.y)
  await expect.poll(() => store(page, 'editor', 'selectedId')).toBe(ids[0])
  expect(await store(page, 'editor', 'selectionKind')).toBe('visual')

  // selection box with 8 resize handles + rotate handle
  await expect(page.locator('.sel-box.primary')).toHaveCount(1)
  await expect(page.locator('.sel-box.primary .handle')).toHaveCount(8)
  await expect(page.locator('.sel-box.primary .rotate-handle')).toHaveCount(1)

  // click an empty part of the frame → selection cleared
  const empty = m.toScreen(100, 60)
  await page.mouse.click(empty.x, empty.y)
  await expect.poll(() => store(page, 'editor', 'selectionKind')).toBe(null)
  await expect(page.locator('.sel-box')).toHaveCount(0)
})

test('marquee drag over two elements multi-selects them', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A, ITEM_B]))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(2)
  const ids = await visualIds(page)
  const m = await metrics(page)

  // start on empty frame (60,60), sweep past both items
  await drag(page, m.toScreen(60, 60), m.toScreen(1680, 850), async () => {
    await expect(page.locator('.marquee')).toBeVisible()
  })

  await expect.poll(() => store(page, 'editor', 'selectedIds')).toEqual(
    expect.arrayContaining([ids[0], ids[1]])
  )
  expect((await store(page, 'editor', 'selectedIds'))).toHaveLength(2)
  await expect(page.locator('.sel-box')).toHaveCount(2)
})

/* ---------------- 3. drag to move ---------------- */

test('dragging a selected element updates exported x/y', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(1)
  // snapping off so the assertion is a pure mouse-delta check
  await page.evaluate(() => {
    ;(window as any).__zvidTest.editor.snapping = false
  })
  const m = await metrics(page)

  // move item A's center from (400,300) to (700,420) — +300/+120 project px
  await drag(page, m.toScreen(400, 300), m.toScreen(700, 420))

  const v = (await exportedDoc(page)).visuals[0]
  // anchor is top-left, so exported x/y are the new top-left (500, 270);
  // ±2 tolerance for pointer quantization across the stage scale
  expect(Math.abs(v.x - 500)).toBeLessThanOrEqual(2)
  expect(Math.abs(v.y - 270)).toBeLessThanOrEqual(2)
  expect(v.width).toBe(400)
  expect(v.height).toBe(300)
})

/* ---------------- 4. resize + rotate handles ---------------- */

test('corner-handle resize updates exported width/height', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  const m = await metrics(page)
  await page.mouse.click(...(Object.values(m.toScreen(400, 300)) as [number, number]))
  await expect(page.locator('.sel-box.primary')).toHaveCount(1)

  // HANDLES order in StageSelection.vue: nw n ne e se s sw w → nth(4) = se
  const se = page.locator('.sel-box.primary .handle').nth(4)
  const box = (await se.boundingBox())!
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // grow by +120/+80 project px
  const to = { x: from.x + 120 * m.scale, y: from.y + 80 * m.scale }
  await drag(page, from, to)

  const v = (await exportedDoc(page)).visuals[0]
  expect(Math.abs(v.width - 520)).toBeLessThanOrEqual(3)
  expect(Math.abs(v.height - 380)).toBeLessThanOrEqual(3)
  // top-left anchor: dragging the SE handle keeps x/y in place
  expect(Math.abs(v.x - 200)).toBeLessThanOrEqual(1)
  expect(Math.abs(v.y - 150)).toBeLessThanOrEqual(1)
})

test('rotate handle sets angle; Shift snaps to 15° steps', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  const m = await metrics(page)
  await page.mouse.click(...(Object.values(m.toScreen(400, 300)) as [number, number]))
  await expect(page.locator('.sel-box.primary .rotate-handle')).toBeVisible()

  const boxCenter = async () => {
    const b = (await page.locator('.sel-box.primary').boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const handleCenter = async () => {
    const b = (await page.locator('.sel-box.primary .rotate-handle').boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }

  // free rotate: pointer at atan2(40,100)=21.8° from center → 21.8+90 ≈ 112°
  let c = await boxCenter()
  let h = await handleCenter()
  await page.mouse.move(h.x, h.y)
  await page.mouse.down()
  await page.mouse.move(c.x + 100, c.y + 40, { steps: 4 })
  await page.mouse.up()
  const angle1 = (await exportedDoc(page)).visuals[0].angle
  expect(Math.abs(angle1 - 112)).toBeLessThanOrEqual(1) // ±1: sub-pixel center

  // Shift-rotate to the same direction → snaps to the nearest 15° step (105)
  c = await boxCenter()
  h = await handleCenter()
  await page.mouse.move(h.x, h.y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(c.x + 100, c.y + 40, { steps: 4 })
  await page.keyboard.up('Shift')
  await page.mouse.up()
  expect((await exportedDoc(page)).visuals[0].angle).toBe(105)
})

/* ---------------- 5. keyboard nudge ---------------- */

test('arrow keys nudge the selected element (Shift ×10)', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  const m = await metrics(page)
  await page.mouse.click(...(Object.values(m.toScreen(400, 300)) as [number, number]))
  await expect.poll(() => store(page, 'editor', 'selectionKind')).toBe('visual')

  await page.keyboard.press('ArrowRight') // +1
  await page.keyboard.press('ArrowRight') // +1
  await page.keyboard.press('Shift+ArrowRight') // +10
  await page.keyboard.press('ArrowLeft') // -1
  await page.keyboard.press('ArrowDown') // y +1

  await expect.poll(async () => (await exportedDoc(page)).visuals[0].x).toBe(211)
  await expect.poll(async () => (await exportedDoc(page)).visuals[0].y).toBe(151)
})

/* ---------------- 6. context menu ---------------- */

test('context menu: duplicate and track bump', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(1)

  await ctxMenuClick(page, '.stage-frame .stage-item', /Duplicate/)
  await expect.poll(async () => (await exportedDoc(page)).visuals.length).toBe(2)
  expect((await exportedDoc(page)).visuals[1].type).toBe('IMAGE')

  // fresh doc for the track tests
  await loadProject(page, baseDoc([ITEM_A]))
  await ctxMenuClick(page, '.stage-frame .stage-item', /Bring forward/)
  await expect.poll(async () => (await exportedDoc(page)).visuals[0].track).toBe(1)

  await ctxMenuClick(page, '.stage-frame .stage-item', /Send backward/)
  await expect
    .poll(async () => (await exportedDoc(page)).visuals[0].track ?? 0)
    .toBe(0)
})

test('context menu: fit cover/contain, reset size, delete', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(1)

  await ctxMenuClick(page, '.stage-frame .stage-item', 'Fill frame (cover)')
  let v = (await exportedDoc(page)).visuals[0]
  expect(v.resize).toBe('cover')
  expect(v.width).toBeUndefined()
  expect(v.height).toBeUndefined()
  expect(v.position).toBe('center-center')

  await ctxMenuClick(page, '.stage-frame .stage-item', 'Fit frame (contain)')
  v = (await exportedDoc(page)).visuals[0]
  expect(v.resize).toBe('contain')

  await ctxMenuClick(page, '.stage-frame .stage-item', 'Reset to intrinsic size')
  v = (await exportedDoc(page)).visuals[0]
  expect(v.resize).toBeUndefined()
  expect(v.width).toBeUndefined()
  expect(v.height).toBeUndefined()

  await ctxMenuClick(page, '.stage-frame .stage-item', /Delete/)
  // exportProject drops the visuals key entirely once the doc is empty
  await expect
    .poll(async () => ((await exportedDoc(page)).visuals ?? []).length)
    .toBe(0)
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(0)
})

/* ---------------- 7. snap guides ---------------- */

test('snap guides appear near canvas center and snap the drop', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  const m = await metrics(page)

  // drag A's center exactly onto the canvas center → v+h guides while held
  await drag(page, m.toScreen(400, 300), m.toScreen(960, 540), async () => {
    await expect(page.locator('.stage-frame .guide')).toHaveCount(2)
    await expect(page.locator('.stage-frame .guide.v')).toHaveCount(1)
    await expect(page.locator('.stage-frame .guide.h')).toHaveCount(1)
  })
  // guides clear on release; position snapped exactly to the center lines
  await expect(page.locator('.stage-frame .guide')).toHaveCount(0)
  const v = (await exportedDoc(page)).visuals[0]
  expect(v.x).toBe(760) // 960 - 400/2
  expect(v.y).toBe(390) // 540 - 300/2
})

test('toggling snapping off suppresses the guides', async ({ page }) => {
  await loadProject(page, baseDoc([ITEM_A]))
  await page.click('button[title="Toggle snapping"]')
  await expect.poll(() => store(page, 'editor', 'snapping')).toBe(false)

  const m = await metrics(page)
  await drag(page, m.toScreen(400, 300), m.toScreen(960, 540), async () => {
    await expect(page.locator('.stage-frame .guide')).toHaveCount(0)
  })
})

/* ---------------- 8. media loading ---------------- */

test('video and image load without errors and the probe resolves dims', async ({
  page,
}) => {
  await loadProject(
    page,
    baseDoc([
      { type: 'VIDEO', src: fx('clip.mp4'), x: 0, y: 0, width: 640, height: 360 },
      {
        type: 'IMAGE',
        src: fx('image.png'),
        resize: 'contain',
        position: 'center-center',
        anchor: 'center-center',
      },
    ])
  )
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(2)
  const ids = await visualIds(page)

  // the stage <video> loads its metadata (intrinsic 320x180, burned frames)
  const video = page.locator(`.stage-item[data-item-id="${ids[0]}"] video`)
  await expect.poll(() => video.evaluate((el: any) => el.videoWidth)).toBe(320)
  expect(await video.evaluate((el: any) => el.videoHeight)).toBe(180)

  // resize:'contain' with no explicit size starts at the project box
  // (1920x1080) and settles at 1440x1080 once the probe reports 320x240 —
  // offsetWidth is unscaled layout px, so this proves the probe resolved
  const image = page.locator(`.stage-item[data-item-id="${ids[1]}"]`)
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLElement).offsetWidth))
    .toBe(1440)
  expect(await image.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(1080)

  // no failure overlay on either element
  await expect(page.locator('.media-error')).toHaveCount(0)
})
