import { test, expect, type Page, type Locator } from '@playwright/test'
import { openEditor, exportedDoc, loadProject, store, fx } from './helpers/app'

/**
 * Timeline (TimelinePanel + TimelineClip/TimelineAudioClip/SubtitleLane):
 * lane rendering, clip move/trim/split gestures, animation-window handles,
 * lane management, audio trims + loop hatching, ruler scrubbing, zoom and
 * transport. Interactions are driven with the real mouse/keyboard; the
 * exported JSON (window.__zvidTest.exportedDoc()) is the ground truth.
 *
 * Geometry: pixel deltas are derived from editor.pxPerSec via the bridge —
 * nothing assumes the default zoom. Snapping is ON by default: a dragged
 * edge within 7px of 0 / duration / playhead / another clip's edge snaps
 * to it, otherwise it lands on the frame grid (round(t*fps)/fps). Every
 * seed below is chosen so the expected value is exact under those rules.
 */

const FPS = 30

/** Base seed: TEXT 0-4 track0 (enter/exit anim windows), IMAGE 2-6 track1,
 *  VIDEO 0-2 track2 (videoBegin 0.2), tone.mp3 audio 0-3, duration 10. */
function baseProject(overrides: Record<string, any> = {}) {
  return {
    name: 'timeline-spec',
    width: 640,
    height: 360,
    duration: 10,
    frameRate: FPS,
    visuals: [
      {
        type: 'TEXT',
        id: 'txt',
        text: 'Hello timeline',
        x: 50,
        y: 50,
        track: 0,
        enterBegin: 0,
        enterEnd: 0.8,
        exitBegin: 3,
        exitEnd: 4,
        enterAnimation: 'fade',
        exitAnimation: 'fade',
      },
      { type: 'IMAGE', id: 'img', src: fx('image.png'), track: 1, enterBegin: 2, exitEnd: 6 },
      {
        type: 'VIDEO',
        id: 'vid',
        src: fx('clip.mp4'),
        track: 2,
        enterBegin: 0,
        exitEnd: 2,
        videoBegin: 0.2,
      },
    ],
    audios: [{ src: fx('tone.mp3'), enter: 0, exit: 3 }],
    ...overrides,
  }
}

const TXT = '.lane[data-track="0"] .clip'
const IMG = '.lane[data-track="1"] .clip'
const VID = '.lane[data-track="2"] .clip'
const ACLIP = '.lane[data-audio-track="0"] .aclip'

async function seed(page: Page, overrides: Record<string, any> = {}, clipCount = 3) {
  await loadProject(page, baseProject(overrides))
  await expect(page.locator('.tl-panel .clip')).toHaveCount(clipCount)
}

const pps = (page: Page): Promise<number> => store(page, 'editor', 'pxPerSec')

/** Mouse-drag an element by a pixel delta (from its center, rounded so the
 *  clientX delta — what the gesture math uses — is exactly dxPx). */
async function drag(page: Page, loc: Locator, dxPx: number, dyPx = 0) {
  await loc.scrollIntoViewIfNeeded()
  const box = (await loc.boundingBox())!
  const sx = Math.round(box.x + box.width / 2)
  const sy = Math.round(box.y + box.height / 2)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + dxPx, sy + dyPx, { steps: 8 })
  await page.mouse.up()
}

async function exportedVisual(page: Page, id: string): Promise<any> {
  const doc = await exportedDoc(page)
  return (doc.visuals ?? []).find((v: any) => v.id === id)
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

/* ------------------------------------------------------------------ */
/* 1. rendering                                                        */
/* ------------------------------------------------------------------ */

test('renders one clip per visual in its lane, audio waveform, ruler; no scene strip', async ({
  page,
}) => {
  await seed(page)

  // one bar per visual, in the lane matching its track
  await expect(page.locator(TXT)).toHaveCount(1)
  await expect(page.locator(IMG)).toHaveCount(1)
  await expect(page.locator(VID)).toHaveCount(1)
  await expect(page.locator(TXT)).toContainText('Hello timeline')

  // clip x/width follow timing * pxPerSec
  const scale = await pps(page)
  const imgBox = (await page.locator(IMG).boundingBox())!
  const laneBox = (await page.locator('.lane[data-track="1"]').boundingBox())!
  expect(imgBox.x - laneBox.x).toBeCloseTo(2 * scale, 0)
  expect(imgBox.width).toBeCloseTo(4 * scale, 0)

  // audio lane with a waveform canvas
  await expect(page.locator(ACLIP)).toHaveCount(1)
  await expect(page.locator(`${ACLIP} canvas.wave`)).toHaveCount(1)

  // ruler ticks + labels
  expect(await page.locator('.ruler-lane .tick').count()).toBeGreaterThan(5)
  expect(await page.locator('.ruler-lane .tick.major').count()).toBeGreaterThan(0)
  expect(await page.locator('.ruler-lane .tick-label').count()).toBeGreaterThan(0)

  // flat project: no scene strip; playhead present
  await expect(page.locator('.scene-row')).toHaveCount(0)
  await expect(page.locator('.playhead-grip')).toBeVisible()
})

/* ------------------------------------------------------------------ */
/* 2-3. clip drag-move + snapping                                      */
/* ------------------------------------------------------------------ */

test('drag-move shifts the whole timing window and snaps to a neighbour clip edge', async ({
  page,
}) => {
  await seed(page)
  const scale = await pps(page)

  // raw drop point 1.95s is within the 7px snap threshold of the IMAGE
  // clip's enterBegin (2.0) -> enterBegin snaps to exactly 2, delta 2.0
  await drag(page, page.locator(TXT), Math.round(1.95 * scale))

  const txt = await exportedVisual(page, 'txt')
  expect(txt.enterBegin).toBeCloseTo(2, 3)
  expect(txt.enterEnd).toBeCloseTo(2.8, 3)
  expect(txt.exitBegin).toBeCloseTo(5, 3)
  expect(txt.exitEnd).toBeCloseTo(6, 3)
  // animation windows preserved (same widths as seeded)
  expect(txt.enterEnd - txt.enterBegin).toBeCloseTo(0.8, 3)
  expect(txt.exitEnd - txt.exitBegin).toBeCloseTo(1, 3)
  expect(txt.enterAnimation).toBe('fade')
  expect(txt.exitAnimation).toBe('fade')
})

test('drag-move snaps to the playhead position', async ({ page }) => {
  await seed(page)
  const scale = await pps(page)

  // park the playhead off the frame grid — only playhead snapping can
  // produce 5.55 (the frame grid would give 5.5)
  await page.evaluate(() => (window as any).__zvidTest.editor.seek(5.55))
  await drag(page, page.locator(VID), Math.round(5.5 * scale))

  const vid = await exportedVisual(page, 'vid')
  expect(vid.enterBegin).toBeCloseTo(5.55, 3)
  expect(vid.exitEnd).toBeCloseTo(7.55, 3)
  expect(vid.videoBegin).toBeCloseTo(0.2, 3) // move never touches the source window
})

/* ------------------------------------------------------------------ */
/* 4. trim                                                             */
/* ------------------------------------------------------------------ */

test('trim handles: left edge moves enterBegin, right edge exitEnd; video trim-left re-bases videoBegin', async ({
  page,
}) => {
  await seed(page)
  const scale = await pps(page)
  const halfSec = Math.round(0.5 * scale)

  // IMAGE trim-left: only the start edge moves
  await drag(page, page.locator(`${IMG} .trim.l`), halfSec)
  let img = await exportedVisual(page, 'img')
  expect(img.enterBegin).toBeCloseTo(2.5, 3)
  expect(img.exitEnd).toBeCloseTo(6, 3)
  // no enter window seeded -> enterEnd collapses onto enterBegin and is
  // dropped from the export
  expect(img.enterEnd).toBeUndefined()

  // IMAGE trim-right: end edge moves; the collapsed exit window follows the
  // edge, so an explicit exitBegin === exitEnd appears in the doc
  await drag(page, page.locator(`${IMG} .trim.r`), halfSec)
  img = await exportedVisual(page, 'img')
  expect(img.enterBegin).toBeCloseTo(2.5, 3)
  expect(img.exitEnd).toBeCloseTo(6.5, 3)
  expect(img.exitBegin).toBeCloseTo(6.5, 3)

  // VIDEO trim-left re-bases the source window: videoBegin += shift * speed
  // (TimelineClip.vue trim-l: patch.videoBegin = max(0, videoBegin + shift*speed))
  await drag(page, page.locator(`${VID} .trim.l`), halfSec)
  const vid = await exportedVisual(page, 'vid')
  expect(vid.enterBegin).toBeCloseTo(0.5, 3)
  expect(vid.exitEnd).toBeCloseTo(2, 3)
  expect(vid.videoBegin).toBeCloseTo(0.7, 3) // 0.2 + 0.5 * speed(1)
})

/* ------------------------------------------------------------------ */
/* 5. animation-window handles                                         */
/* ------------------------------------------------------------------ */

test('enter-animation handle drags enterEnd and clamps at exitBegin', async ({ page }) => {
  await seed(page)
  const scale = await pps(page)

  // select the TEXT clip so the anim handles render (selected && width > 40)
  await page.locator(TXT).click()
  const enterHandle = page.locator(`${TXT} .anim-handle:not(.exit)`)
  await expect(enterHandle).toBeVisible()

  // anim gestures do not snap: dt is applied raw, so +0.5s exactly
  await drag(page, enterHandle, Math.round(0.5 * scale))
  let txt = await exportedVisual(page, 'txt')
  expect(txt.enterEnd).toBeCloseTo(1.3, 3) // 0.8 + 0.5
  expect(txt.exitBegin).toBeCloseTo(3, 3)

  // drag far right -> clamped to exitBegin (never past the exit window)
  await drag(page, enterHandle, Math.round(4 * scale))
  txt = await exportedVisual(page, 'txt')
  expect(txt.enterEnd).toBeCloseTo(3, 3)
  expect(txt.exitBegin).toBeCloseTo(3, 3)
  expect(txt.enterEnd).toBeLessThanOrEqual(txt.exitBegin)
})

/* ------------------------------------------------------------------ */
/* 6. split                                                            */
/* ------------------------------------------------------------------ */

test('S splits the selected video at the playhead and re-bases the right half videoBegin', async ({
  page,
}) => {
  await seed(page)

  await page.locator(VID).click() // selects the visual
  await page.evaluate(() => (window as any).__zvidTest.editor.seek(1.2))
  await page.keyboard.press('s')

  await expect(page.locator(VID)).toHaveCount(2)

  // stores/project.ts splitVisualAt: left keeps enter*, exitEnd/exitBegin cut
  // to t; right starts at t with videoBegin re-based by (t - enterBegin)*speed
  const doc = await exportedDoc(page)
  const parts = doc.visuals.filter((v: any) => v.type === 'VIDEO')
  expect(parts).toHaveLength(2)
  const left = parts.find((v: any) => v.id === 'vid')
  const right = parts.find((v: any) => v.id === 'vid-b')
  expect(left.enterBegin ?? 0).toBeCloseTo(0, 3)
  expect(left.exitEnd).toBeCloseTo(1.2, 3)
  expect(left.exitBegin).toBeCloseTo(1.2, 3)
  expect(left.videoBegin).toBeCloseTo(0.2, 3)
  expect(right.enterBegin).toBeCloseTo(1.2, 3)
  expect(right.exitEnd).toBeCloseTo(2, 3)
  expect(right.videoBegin).toBeCloseTo(1.4, 3) // 0.2 + (1.2 - 0) * speed(1)
  expect(right.track).toBe(2)
})

/* ------------------------------------------------------------------ */
/* 7. lanes                                                            */
/* ------------------------------------------------------------------ */

test('vertical drag moves a clip to another lane; +track adds and trash removes an empty lane', async ({
  page,
}) => {
  await seed(page)

  // + track adds the next free lane (V3), empty extra lanes are removable
  await page.locator('.add-row .btn', { hasText: 'track' }).first().click()
  await expect(page.locator('.lane[data-track="3"]')).toHaveCount(1)
  await page.locator('.tl-row:has(.lane[data-track="3"]) .lane-remove').click()
  await expect(page.locator('.lane[data-track="3"]')).toHaveCount(0)

  // drag the TEXT clip (track 0, bottom visual lane) up into lane V1
  const txtBox = (await page.locator(TXT).boundingBox())!
  const lane1Box = (await page.locator('.lane[data-track="1"]').boundingBox())!
  const sx = Math.round(txtBox.x + txtBox.width / 2)
  const sy = Math.round(txtBox.y + txtBox.height / 2)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx, Math.round(lane1Box.y + lane1Box.height / 2), { steps: 8 })
  await page.mouse.up()

  const txt = await exportedVisual(page, 'txt')
  expect(txt.track).toBe(1)
  expect(txt.enterBegin ?? 0).toBeCloseTo(0, 3) // horizontal position untouched
  // lane 0 had no other clips and is not an extra track -> it disappears
  await expect(page.locator('.lane[data-track="0"]')).toHaveCount(0)
  await expect(page.locator('.lane[data-track="1"] .clip')).toHaveCount(2)
})

/* ------------------------------------------------------------------ */
/* 8-9. audio clips                                                    */
/* ------------------------------------------------------------------ */

test('audio clip: move shifts enter/exit, trim-left re-bases audioBegin, trim-right moves exit', async ({
  page,
}) => {
  await seed(page)
  const scale = await pps(page)

  // move +1s
  await drag(page, page.locator(ACLIP), Math.round(1 * scale))
  let audio = (await exportedDoc(page)).audios[0]
  expect(audio.enter).toBeCloseTo(1, 3)
  expect(audio.exit).toBeCloseTo(4, 3)
  expect(audio.audioBegin ?? 0).toBeCloseTo(0, 3)

  // trim-left +0.5s: TimelineAudioClip.vue -> audioBegin += shift * speed
  await drag(page, page.locator(`${ACLIP} .trim.l`), Math.round(0.5 * scale))
  audio = (await exportedDoc(page)).audios[0]
  expect(audio.enter).toBeCloseTo(1.5, 3)
  expect(audio.audioBegin).toBeCloseTo(0.5, 3)
  expect(audio.exit).toBeCloseTo(4, 3)

  // trim-right +0.5s: only exit moves
  await drag(page, page.locator(`${ACLIP} .trim.r`), Math.round(0.5 * scale))
  audio = (await exportedDoc(page)).audios[0]
  expect(audio.enter).toBeCloseTo(1.5, 3)
  expect(audio.exit).toBeCloseTo(4.5, 3)
  expect(audio.audioBegin).toBeCloseTo(0.5, 3)
})

test('audio loop markers appear when the window exceeds the source duration', async ({
  page,
}) => {
  // tone.mp3 is 3s; an 8s window auto-loops -> markers at 3s and 6s
  await seed(page, { audios: [{ src: fx('tone.mp3'), enter: 0, exit: 8 }] })
  // markers depend on the async media probe resolving the source duration
  await expect(page.locator(`${ACLIP} .loop-mark`)).toHaveCount(2, { timeout: 15_000 })
})

/* ------------------------------------------------------------------ */
/* 10. ruler scrubbing                                                 */
/* ------------------------------------------------------------------ */

test('clicking and dragging the ruler scrubs the playhead', async ({ page }) => {
  await seed(page)
  const scale = await pps(page)
  const ruler = (await page.locator('.ruler-lane').boundingBox())!
  const y = ruler.y + ruler.height / 2

  await page.mouse.move(ruler.x + 3 * scale, y)
  await page.mouse.down()
  await expect
    .poll(() => store(page, 'editor', 'playhead'))
    .toBeCloseTo(3, 1)

  // still held down: dragging keeps scrubbing
  await page.mouse.move(ruler.x + 5 * scale, y, { steps: 5 })
  await expect
    .poll(() => store(page, 'editor', 'playhead'))
    .toBeCloseTo(5, 1)
  await page.mouse.up()

  // the playhead element sits at HEADER_W + playhead * pxPerSec in tl-content
  const pos = await page.evaluate(() => {
    const t = (window as any).__zvidTest
    const ph = document.querySelector('.playhead') as HTMLElement
    const content = document.querySelector('.tl-content') as HTMLElement
    return {
      playhead: t.editor.playhead,
      pxPerSec: t.editor.pxPerSec,
      x: ph.getBoundingClientRect().left - content.getBoundingClientRect().left,
    }
  })
  expect(Math.abs(pos.x - (148 + pos.playhead * pos.pxPerSec))).toBeLessThan(3)
})

/* ------------------------------------------------------------------ */
/* 11. zoom                                                            */
/* ------------------------------------------------------------------ */

test('ctrl+wheel zooms pxPerSec (clamped 8-600) and clip widths scale', async ({ page }) => {
  await seed(page)
  const pps0 = await pps(page)
  const width0 = (await page.locator(TXT).boundingBox())!.width
  expect(width0).toBeCloseTo(4 * pps0, 0)

  // ctrl+wheel up over the timeline -> 1.2x zoom in
  const scroll = (await page.locator('.tl-scroll').boundingBox())!
  await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await expect.poll(() => pps(page)).toBeCloseTo(Math.min(600, pps0 * 1.2), 3)

  // clip width follows the zoom
  const pps1 = await pps(page)
  await expect
    .poll(async () => (await page.locator(TXT).boundingBox())!.width)
    .toBeCloseTo(4 * pps1, 0)

  // keyboard shortcut Ctrl+'=' zooms 1.3x
  await page.keyboard.press('Control+=')
  await expect.poll(() => pps(page)).toBeCloseTo(Math.min(600, pps1 * 1.3), 3)

  // setZoom clamps to [8, 600] (the transport slider itself only reaches
  // 400 — its max attribute is smaller than the store clamp)
  await page.evaluate(() => (window as any).__zvidTest.editor.setZoom(10_000))
  await expect.poll(() => pps(page)).toBe(600)
  await page.evaluate(() => (window as any).__zvidTest.editor.setZoom(0.1))
  await expect.poll(() => pps(page)).toBe(8)
  await expect(page.locator('.tp-right input[type="range"]')).toHaveAttribute('max', '400')

  // widths re-scale after the clamp too: TEXT 4s * 8px/s = 32px
  await expect
    .poll(async () => (await page.locator(TXT).boundingBox())!.width)
    .toBeCloseTo(32, 0)
})

/* ------------------------------------------------------------------ */
/* 12. transport                                                       */
/* ------------------------------------------------------------------ */

test('prev/next jump between clip start points; fit sets duration to content end', async ({
  page,
}) => {
  // duration 5 < content end 6 so the "content exceeds duration" fit link
  // shows (contentEnd is seeded with the duration, so fit can only extend)
  await seed(page, { duration: 5 })

  const next = page.locator('button[title="Next start point (End)"]')
  const prev = page.locator('button[title="Previous start point (Home)"]')

  // jump points (usePlayheadJumps): visual/audio starts + 0 + duration
  // = [0 (txt/vid/audio), 2 (img), 5 (duration)]
  await next.click()
  await expect.poll(() => store(page, 'editor', 'playhead')).toBeCloseTo(2, 3)
  await next.click()
  await expect.poll(() => store(page, 'editor', 'playhead')).toBeCloseTo(5, 3)
  await prev.click()
  await expect.poll(() => store(page, 'editor', 'playhead')).toBeCloseTo(2, 3)
  await prev.click()
  await expect.poll(() => store(page, 'editor', 'playhead')).toBeCloseTo(0, 3)

  // over-duration badge offers "fit" -> duration becomes the content end (6)
  await expect(page.locator('.over-badge')).toBeVisible()
  await page.locator('.over-badge .link').click()
  await expect.poll(async () => (await exportedDoc(page)).duration).toBeCloseTo(6, 3)
  await expect(page.locator('.over-badge')).toHaveCount(0)

  // with content == duration the plain button keeps 6
  await page.locator('button', { hasText: 'Fit duration' }).click()
  await expect.poll(async () => (await exportedDoc(page)).duration).toBeCloseTo(6, 3)

  // bugfix 2026-07-09: Fit can also SHRINK a too-long duration down to the
  // real last clip end (all seeded clips have explicit ends, max 6)
  await page.evaluate(() => {
    ;(window as any).__zvidTest.project.patchProject({ duration: 12 })
  })
  await page.locator('button', { hasText: 'Fit duration' }).click()
  await expect.poll(async () => (await exportedDoc(page)).duration).toBeCloseTo(6, 3)
})

test('collapse toggle hides the lanes and gives the stage the height', async ({ page }) => {
  await seed(page)

  const stageH = async () => (await page.locator('.stage-wrap').boundingBox())!.height
  const before = await stageH()
  await expect(page.locator('.tl-scroll')).toBeVisible()

  await page.locator('button[title="Collapse timeline"]').click()
  await expect(page.locator('.tl-scroll')).toBeHidden()
  expect(await store(page, 'editor', 'timelineCollapsed')).toBe(true)
  // the zoom slider hides with the lanes; playback controls stay usable
  await expect(page.locator('.tp-right input[type="range"]')).toHaveCount(0)
  await expect(page.locator('.play-btn')).toBeVisible()
  // the stage absorbs the freed lane height (292px panel -> transport only)
  await expect.poll(stageH).toBeGreaterThan(before + 200)

  await page.locator('button[title="Expand timeline"]').click()
  await expect(page.locator('.tl-scroll')).toBeVisible()
  await expect(page.locator('.tp-right input[type="range"]')).toHaveCount(1)
  await expect.poll(stageH).toBeCloseTo(before, 0)
})

/* ------------------------------------------------------------------ */
/* 13. subtitle lane                                                   */
/* ------------------------------------------------------------------ */

test('subtitle captions render; dragging a caption shifts start/end and word timings', async ({
  page,
}) => {
  await seed(page, {
    subtitle: {
      captions: [
        {
          start: 1,
          end: 2.5,
          text: 'hello world',
          words: [
            { start: 1, end: 1.7, text: 'hello' },
            { start: 1.7, end: 2.5, text: 'world' },
          ],
        },
        {
          start: 4,
          end: 5,
          text: 'second',
          words: [{ start: 4, end: 5, text: 'second' }],
        },
      ],
    },
  })

  const blocks = page.locator('.sub-row .caption-block')
  await expect(blocks).toHaveCount(2)
  await expect(blocks.first()).toContainText('hello world')

  // caption move has no snapping: SubtitleLane.vue shifts start/end AND
  // every word by the same raw delta
  const scale = await pps(page)
  await drag(page, blocks.first(), Math.round(1 * scale))

  const sub = (await exportedDoc(page)).subtitle
  expect(sub.captions[0].start).toBeCloseTo(2, 3)
  expect(sub.captions[0].end).toBeCloseTo(3.5, 3)
  expect(sub.captions[0].words).toEqual([
    { start: 2, end: 2.7, text: 'hello' },
    { start: 2.7, end: 3.5, text: 'world' },
  ])
  // untouched caption stays put
  expect(sub.captions[1].start).toBeCloseTo(4, 3)
  expect(sub.captions[1].end).toBeCloseTo(5, 3)
})
