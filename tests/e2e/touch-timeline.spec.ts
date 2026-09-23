import { test, expect, type Locator, type Page } from '@playwright/test'
import { openEditor, loadProject, exportedDoc, store, fx } from './helpers/app'

// Real browser touch input: dispatchTouchEvent lets Chromium generate pointer
// events, native scrolling and pointercancel instead of bypassing them with DOM events.
type Point = { x: number; y: number }
async function drag(page: Page, from: Point, to: Point, touch: boolean, cancel = false, via?: Point) {
  if (!touch) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    if (via) await page.mouse.move(via.x, via.y, { steps: 12 })
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    return
  }
  const cdp = await page.context().newCDPSession(page)
  const point = (p: Point) => ({ ...p, id: 1, radiusX: 1, radiusY: 1, force: 1 })
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] })
    let start = from
    for (const destination of via ? [via, to] : [to]) {
      for (let n = 1; n <= 12; n++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point({
          x: start.x + (destination.x - start.x) * n / 12,
          y: start.y + (destination.y - start.y) * n / 12,
        })] })
      }
      start = destination
    }
    // Finish a deliberate drag with the finger resting at its destination.
    // A zero-duration CDP flick makes Chromium suppress the next tap, even
    // on a plain HTML button outside the editor.
    await page.waitForTimeout(100)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(to)] })
    await page.waitForTimeout(100)
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
  } finally { await cdp.detach() }
}
async function center(locator: Locator): Promise<Point> {
  await locator.scrollIntoViewIfNeeded()
  const b = await locator.boundingBox()
  if (!b) throw new Error('Gesture target is not visible')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
async function delta(page: Page, locator: Locator, dx: number, dy: number, touch: boolean, cancel = false) {
  const p = await center(locator)
  await drag(page, p, { x: p.x + dx, y: p.y + dy }, touch, cancel)
}
async function act(locator: Locator, touch: boolean) {
  if (touch) await locator.tap()
  else await locator.click()
}
async function closePanel(page: Page, touch: boolean) {
  const close = page.getByRole('button', { name: 'Close tool panel', exact: true })
  if (await close.isVisible()) await act(close, touch)
  else {
    const active = page.locator('.rail-tab[aria-pressed="true"]')
    if (await active.count()) await act(active, touch)
  }
}
const visual = {
  type: 'IMAGE', id: 'picture', src: fx('image.png'), x: 600, y: 350,
  width: 400, height: 300, enterBegin: 0, enterEnd: 0.5,
  exitBegin: 2.5, exitEnd: 3, enterAnimation: 'fade', exitAnimation: 'fade',
}
async function seed(page: Page, touch: boolean, extra: Record<string, any> = {}) {
  await loadProject(page, {
    name: 'Touch parity', resolution: 'full-hd', duration: 8, frameRate: 30,
    backgroundColor: '#101319', outputFormat: 'mp4', visuals: [visual], audios: [], ...extra,
  })
  await page.evaluate(() => {
    const t = (window as any).__zvidTest
    t.editor.snapping = false
    t.editor.setZoom(35)
    t.editor.seek(1)
  })
  if (touch) await closePanel(page, touch)
  // Fit-to-stage updates through ResizeObserver after a docked panel closes.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
const viewports = [
  { name: 'desktop', width: 1366, height: 768, touch: false },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'phone', width: 375, height: 812, touch: true },
  { name: 'small phone', width: 320, height: 640, touch: true },
  { name: 'phone landscape', width: 844, height: 390, touch: true },
]
for (const viewport of viewports) {
  test.describe(`${viewport.name} stage and timeline parity`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch })
    const touch = viewport.touch
    test.beforeEach(async ({ page }) => { await openEditor(page) })

    test('move, resize, rotate and selection actions use real pointer input', async ({ page }) => {
      await seed(page, touch)
      const frame = page.locator('.stage-frame')
      const scale = (await frame.boundingBox())!.width / 1920
      await delta(page, page.locator('.stage-frame .stage-item'), 200 * scale, 60 * scale, touch)
      let v = (await exportedDoc(page)).visuals[0]
      expect(v.x).toBeCloseTo(800, -1)
      expect(v.y).toBeCloseTo(410, -1)
      if (touch) await expect(page.locator('.rail-panel')).toHaveCount(0)

      await delta(page, page.locator('[data-resize-handle="se"]'), 160 * scale, 120 * scale, touch)
      v = (await exportedDoc(page)).visuals[0]
      expect(v.width).toBeCloseTo(560, -1)
      expect(v.height).toBeCloseTo(420, -1)
      const sel = (await page.locator('.sel-box.primary').boundingBox())!
      const rotation = await center(page.locator('.rotate-handle'))
      await drag(page, rotation, { x: sel.x + sel.width + 25, y: sel.y + sel.height / 2 }, touch)
      expect((await exportedDoc(page)).visuals[0].angle).toBeCloseTo(90, 0)

      await act(page.getByTitle('Selected element actions', { exact: true }), touch)
      const menu = page.locator('.ctx-menu')
      await expect(menu).toBeVisible()
      const b = (await menu.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width)
      expect(b.y + b.height).toBeLessThanOrEqual(viewport.height)
      await act(menu.getByRole('button', { name: /^Duplicate/ }), touch)
      expect((await exportedDoc(page)).visuals).toHaveLength(2)
      if (touch) await closePanel(page, touch)
      await act(page.getByTitle('Selected element actions', { exact: true }), touch)
      await act(menu.getByRole('button', { name: /^Delete/ }), touch)
      expect((await exportedDoc(page)).visuals).toHaveLength(1)
    })

    test('visual move, trims, animation handles, split and ruler scrubbing', async ({ page }) => {
      await seed(page, touch)
      const clip = page.locator('.tl-panel .clip').first()
      await delta(page, clip, 17.5, 0, touch)
      let v = (await exportedDoc(page)).visuals[0]
      expect(v.enterBegin).toBeCloseTo(0.5, 1)
      expect(v.exitEnd).toBeCloseTo(3.5, 1)
      if (touch) await expect(page.locator('.rail-panel')).toHaveCount(0)
      await delta(page, clip.locator('.trim.l'), 17.5, 0, touch)
      await delta(page, clip.locator('.trim.r'), -17.5, 0, touch)
      v = (await exportedDoc(page)).visuals[0]
      expect(v.enterBegin).toBeCloseTo(1, 1)
      expect(v.exitEnd).toBeCloseTo(3, 1)
      const enterBefore = v.enterEnd
      await delta(page, clip.locator('.anim-handle').first(), 10.5, 0, touch)
      expect((await exportedDoc(page)).visuals[0].enterEnd).toBeCloseTo(enterBefore + 0.3, 1)
      const ruler = (await page.locator('.ruler-lane').boundingBox())!
      await drag(page, { x: ruler.x + 35, y: ruler.y + 12 }, { x: ruler.x + 70, y: ruler.y + 12 }, touch)
      await expect.poll(() => store(page, 'editor', 'playhead')).toBeCloseTo(2, 1)
      await act(page.getByTitle('Selected element actions', { exact: true }), touch)
      await act(page.locator('.ctx-menu').getByRole('button', { name: /^Split at playhead/ }), touch)
      const parts = (await exportedDoc(page)).visuals
      expect(parts).toHaveLength(2)
      expect(parts[0].exitEnd).toBeCloseTo(2, 1)
      expect(parts[1].enterBegin).toBeCloseTo(2, 1)
    })

    test('audio and subtitle moves and trims preserve source/word timing', async ({ page }) => {
      await seed(page, touch, {
        visuals: [], audios: [{ src: fx('tone.mp3'), enter: 0, exit: 3 }],
        subtitle: { captions: [{ start: 0.5, end: 2, text: 'Touch captions', words: [{ start: 0.5, end: 2, text: 'Touch captions' }] }] },
      })
      const audio = page.locator('.aclip')
      await delta(page, audio, 17.5, 0, touch)
      await delta(page, audio.locator('.trim.l'), 17.5, 0, touch)
      await delta(page, audio.locator('.trim.r'), -17.5, 0, touch)
      const a = (await exportedDoc(page)).audios[0]
      expect(a.enter).toBeCloseTo(1, 1)
      expect(a.exit).toBeCloseTo(3, 1)
      expect(a.audioBegin).toBeCloseTo(0.5, 1)
      const ruler = (await page.locator('.ruler-lane').boundingBox())!
      await drag(page, { x: ruler.x + 35, y: ruler.y + 12 }, { x: ruler.x + 70, y: ruler.y + 12 }, touch)
      await act(page.getByTitle('Selected element actions', { exact: true }), touch)
      await act(page.locator('.ctx-menu').getByRole('button', { name: /^Split at playhead/ }), touch)
      const splitAudios = (await exportedDoc(page)).audios
      expect(splitAudios).toHaveLength(2)
      expect(splitAudios[0].exit).toBeCloseTo(2, 1)
      expect(splitAudios[1].enter).toBeCloseTo(2, 1)
      expect(splitAudios[1].audioBegin).toBeCloseTo(1.5, 1)
      await act(page.getByTitle('Selected element actions', { exact: true }), touch)
      await act(page.locator('.ctx-menu').getByRole('button', { name: /^Duplicate/ }), touch)
      expect((await exportedDoc(page)).audios).toHaveLength(3)
      if (touch) await closePanel(page, touch)
      await act(page.getByTitle('Selected element actions', { exact: true }), touch)
      await act(page.locator('.ctx-menu').getByRole('button', { name: /^Delete/ }), touch)
      expect((await exportedDoc(page)).audios).toHaveLength(2)
      const caption = page.locator('.caption-block')
      await delta(page, caption, 17.5, 0, touch)
      let c = (await exportedDoc(page)).subtitle.captions[0]
      expect(c.start).toBeCloseTo(1, 1)
      expect(c.end).toBeCloseTo(2.5, 1)
      expect(c.words[0].start).toBeCloseTo(1, 1)
      await delta(page, caption.locator('.trim.r'), 17.5, 0, touch)
      c = (await exportedDoc(page)).subtitle.captions[0]
      expect(c.end).toBeCloseTo(3, 1)
      if (touch) await expect(page.locator('.rail-panel')).toHaveCount(0)
    })

    test('playback, transitions, scene editing, zoom and collapse remain usable', async ({ page }) => {
      await seed(page, touch, { duration: 5, visuals: [], scenes: [
        { id: 'Opening', duration: 3, backgroundColor: '#f00', transition: 'fade', transitionDuration: 1, visuals: [{ ...visual, enterBegin: 0, exitEnd: 3 }] },
        { id: 'Ending', duration: 3, backgroundColor: '#00f', visuals: [{ ...visual, src: fx('clip.mp4'), type: 'VIDEO', enterBegin: 0, exitEnd: 3 }] },
      ] })
      await act(page.getByTitle('Preview the full movie with scene transitions (read-only)', { exact: true }), touch)
      // The context banner can reflow in short landscape viewports; wait
      // for layout before converting timeline time into touch coordinates.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const ruler = (await page.locator('.ruler-lane').boundingBox())!
      await drag(page, { x: ruler.x + 35, y: ruler.y + 12 }, { x: ruler.x + 87.5, y: ruler.y + 12 }, touch)
      await expect.poll(() => store(page, 'editor', 'playhead')).toBeCloseTo(2.5, 1)
      await expect(page.locator('.scene-group:visible')).toHaveCount(2)
      const layers = await page.locator('.scene-group:visible').evaluateAll(els => els.map(el => getComputedStyle(el).opacity))
      expect(layers.some(opacity => Number(opacity) > 0 && Number(opacity) < 1)).toBe(true)
      await act(page.locator('.play-btn'), touch)
      await expect.poll(() => store(page, 'editor', 'playhead')).toBeGreaterThan(2.7)
      await act(page.locator('.play-btn'), touch)
      expect(await store(page, 'editor', 'playing')).toBe(false)
      const pausedTime = await store(page, 'editor', 'playhead')
      await act(page.getByTitle('Previous frame', { exact: true }), touch)
      expect(await store(page, 'editor', 'playhead')).toBeCloseTo(pausedTime - 1 / 30, 5)
      await act(page.getByTitle('Next frame', { exact: true }), touch)
      expect(await store(page, 'editor', 'playhead')).toBeCloseTo(pausedTime, 5)
      const loop = await store(page, 'editor', 'loop')
      await act(page.getByTitle('Loop (L)', { exact: true }), touch)
      expect(await store(page, 'editor', 'loop')).toBe(!loop)
      const muted = await store(page, 'editor', 'muted')
      await act(page.getByTitle('Mute (M)', { exact: true }), touch)
      expect(await store(page, 'editor', 'muted')).toBe(!muted)
      await act(page.getByTitle('Zoom in (Ctrl+scroll)', { exact: true }), touch)
      expect(await store(page, 'editor', 'stageZoom')).toBeGreaterThan(0)
      await act(page.getByTitle('Reset to fit', { exact: true }), touch)
      expect(await store(page, 'editor', 'stageZoom')).toBe(0)
      await act(page.getByTitle('Collapse timeline', { exact: true }), touch)
      await expect(page.locator('.tl-scroll')).toBeHidden()
      await act(page.getByTitle('Expand timeline', { exact: true }), touch)
      await expect(page.locator('.tl-scroll')).toBeVisible()
      await act(page.locator('.scene-block').first(), touch)
      await expect(page.locator('.rail-panel')).toBeVisible()
      await act(page.getByTitle('Back to library', { exact: true }), touch)
      await act(page.locator('.scene-card:not(.global)').first(), touch)
      await expect.poll(() => store(page, 'editor', 'context')).not.toBe('root')
    })

    test('track change, cancellation cleanup and empty-lane touch scrolling', async ({ page }) => {
      await seed(page, touch, { duration: 30 })
      await act(page.locator('.add-row .btn').filter({ hasText: 'track' }).first(), touch)
      const clip = page.locator('.clip').first()
      const from = await center(clip)
      const target = (await page.locator('[data-track="1"]').boundingBox())!
      await drag(page, from, { x: from.x, y: target.y + target.height / 2 }, touch)
      expect((await exportedDoc(page)).visuals[0].track).toBe(1)
      if (touch) {
        await delta(page, page.locator('.clip').first(), 17.5, 0, true, true)
        const afterCancel = (await exportedDoc(page)).visuals[0].enterBegin
        await page.mouse.move(from.x + 70, from.y)
        expect((await exportedDoc(page)).visuals[0].enterBegin).toBe(afterCancel)
        const lane = page.locator('.add-row .empty-lane').first()
        await lane.scrollIntoViewIfNeeded()
        const b = (await lane.boundingBox())!
        const x = Math.min(viewport.width - 30, b.x + 130)
        await drag(page, { x, y: b.y + 12 }, { x: x - 70, y: b.y + 12 }, true)
        await expect.poll(() => page.locator('.tl-scroll').evaluate(el => el.scrollLeft)).toBeGreaterThan(10)
      }
    })

    test('marquee selects multiple visuals and moves them together', async ({ page }) => {
      await seed(page, touch, { visuals: [
        { ...visual, x: 400, y: 450, width: 250, height: 200 },
        { ...visual, id: 'picture-b', x: 1100, y: 450, width: 250, height: 200 },
      ] })
      const box = (await page.locator('.stage-frame').boundingBox())!
      const scale = box.width / 1920
      const point = (x: number, y: number) => ({ x: box.x + x * scale, y: box.y + y * scale })
      await drag(page, point(300, 350), point(1500, 750), touch)
      expect(await store(page, 'editor', 'selectedIds')).toHaveLength(2)
      if (touch) await expect(page.locator('.rail-panel')).toHaveCount(0)
      await delta(page, page.locator('.stage-frame .stage-item').first(), 100 * scale, 50 * scale, touch)
      const visuals = (await exportedDoc(page)).visuals
      expect(visuals[0].x).toBeCloseTo(500, -1)
      expect(visuals[1].x).toBeCloseTo(1200, -1)
      expect(visuals[0].y).toBeCloseTo(500, -1)
      expect(visuals[1].y).toBeCloseTo(500, -1)
    })

    test('visual and audio drags continue after crossing into another track', async ({ page }) => {
      await seed(page, touch)
      await act(page.locator('.add-row .btn').filter({ hasText: 'track' }).first(), touch)
      const visualStart = await center(page.locator('.clip').first())
      const visualLane = (await page.locator('[data-track="1"]').boundingBox())!
      const visualVia = { x: visualStart.x, y: visualLane.y + visualLane.height / 2 }
      await drag(page, visualStart, { x: visualStart.x + 35, y: visualVia.y }, touch, false, visualVia)
      const v = (await exportedDoc(page)).visuals[0]
      expect(v.track).toBe(1)
      expect(v.enterBegin).toBeCloseTo(1, 1)
      expect(v.exitEnd).toBeCloseTo(4, 1)

      await seed(page, touch, { visuals: [], audios: [{ src: fx('tone.mp3'), enter: 0, exit: 3 }] })
      await act(page.locator('.add-row .btn').filter({ hasText: 'audio' }).first(), touch)
      const audio = page.locator('.aclip')
      // Scroll the track header vertically; scrolling the entire long lane
      // also pans horizontally and can put the clip under the sticky header.
      await page.locator('.tl-row:has([data-audio-track="1"]) .tl-header').scrollIntoViewIfNeeded()
      const audioStart = await center(audio)
      // In short landscape layouts the sticky ruler covers the upper part
      // of A0 after A1 is revealed. Grab the remaining visible clip area.
      const ruler = (await page.locator('.ruler-row').boundingBox())!
      audioStart.y = Math.max(audioStart.y, ruler.y + ruler.height + 3)
      const audioBox = (await audio.boundingBox())!
      expect(audioStart.y).toBeLessThan(audioBox.y + audioBox.height)
      const audioLane = (await page.locator('[data-audio-track="1"]').boundingBox())!
      const audioVia = { x: audioStart.x, y: audioLane.y + audioLane.height / 2 }
      await drag(page, audioStart, { x: audioStart.x + 35, y: audioVia.y }, touch, false, audioVia)
      const a = (await exportedDoc(page)).audios[0]
      expect(a.track).toBe(1)
      expect(a.enter).toBeCloseTo(1, 1)
      expect(a.exit).toBeCloseTo(4, 1)
    })
  })
}
