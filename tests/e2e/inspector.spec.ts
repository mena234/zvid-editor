import { test, expect, type Page, type Locator } from '@playwright/test'
import {
  openEditor,
  exportedDoc,
  loadProject,
  validateDoc,
  store,
  fx,
  resetMockOrch,
} from './helpers/app'

/**
 * Inspector panel: every section round-trips its fields into the exported
 * (render-ready) JSON. Setup + assertions go through the window.__zvidTest
 * bridge; the edits themselves drive the real inspector DOM.
 *
 * Selector map (from components/inspector/*.vue + components/ui/*.vue):
 *   UiSection  -> section.sec > (button|div).sec-head > span (title)
 *   UiField    -> .field > .field-label (label text) + .field-ctl (control)
 *   UiNumberInput -> input.num  (commits on Enter/blur)
 *   UiSlider   -> input[type=range] + embedded input.num
 *   UiAnchorPicker -> .anchor-grid .dot (ANCHORS order)
 *   UiEffectPicker -> .ep, .ep-q (search), .ep-cell[title="<label>"]
 *   UiCodeEditor   -> .code-ed textarea.ta
 */

/* ------------------------------------------------------------------ */
/* spec-local helpers                                                   */
/* ------------------------------------------------------------------ */

/** Inspector section by exact title. */
function sec(page: Page, title: string): Locator {
  return page
    .locator('.insp-body section.sec')
    .filter({ has: page.locator(`.sec-head span:text-is("${title}")`) })
}

/** UiField inside a scope by exact label. */
function field(scope: Locator, label: string): Locator {
  return scope
    .locator('.field')
    .filter({ has: scope.page().locator(`.field-label:text-is("${label}")`) })
}

/** Commit a value into a UiNumberInput (Enter blurs -> commit). '' clears. */
async function setNum(scope: Locator, label: string, value: string) {
  const input = field(scope, label).locator('input.num')
  await input.fill(value)
  await input.press('Enter')
}

/** Open a collapsible section that starts closed (feature disabled). */
async function openSec(page: Page, title: string) {
  const s = sec(page, title)
  await s.locator('button.sec-head').click()
  await expect(s.locator('.sec-body')).toBeVisible()
}

async function clickTab(page: Page, label: string) {
  await page.locator('.insp-tabs button', { hasText: label }).click()
}

/** Select the i-th root visual via the bridge; returns its editor _id.
 *  openInspector mirrors a stage/timeline click: the shared side panel
 *  swaps to the selection's properties. */
async function selectVisual(page: Page, index = 0): Promise<string> {
  return page.evaluate((i) => {
    const t = (window as any).__zvidTest
    const v = t.project.doc.visuals[i]
    t.editor.selectVisual(v._id)
    t.editor.openInspector()
    return v._id
  }, index)
}

async function selectAudio(page: Page, index = 0): Promise<string> {
  return page.evaluate((i) => {
    const t = (window as any).__zvidTest
    const a = t.project.doc.audios[i]
    t.editor.selectAudio(a._id)
    t.editor.openInspector()
    return a._id
  }, index)
}

/** Exported JSON of the i-th root visual (ground truth). */
async function vis(page: Page, index = 0): Promise<any> {
  return (await exportedDoc(page)).visuals?.[index]
}

const BASE = {
  name: 'inspector-spec',
  width: 640,
  height: 360,
  duration: 8,
  frameRate: 30,
  backgroundColor: '#000000',
  outputFormat: 'mp4',
}

test.beforeAll(async () => {
  await resetMockOrch()
})

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

/* ------------------------------------------------------------------ */
/* 1. LayoutSection                                                     */
/* ------------------------------------------------------------------ */

test('layout: coords, size, preset, anchor, rotation/opacity/track, flips — defaults pruned', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'IMAGE', src: fx('image.png'), width: 200 }],
  })
  await selectVisual(page)
  // NOTE: possible bug — UiSection reads `props.startOpen ?? true`, but Vue
  // casts the absent Boolean prop to false, so the Layout section (which
  // passes no start-open) always starts COLLAPSED despite the intended
  // default-open fallback. Open it like a user would.
  await openSec(page, 'Layout')
  const layout = sec(page, 'Layout')

  await setNum(layout, 'X (anchor point)', '100')
  await setNum(layout, 'Y (anchor point)', '50')
  await setNum(layout, 'Width', '240')
  await setNum(layout, 'Height', '180')
  await setNum(layout, 'Rotation', '45')
  await setNum(layout, 'Opacity', '0.5')
  await setNum(layout, 'Track (z)', '2')
  await layout.getByRole('button', { name: 'Flip H' }).click()
  await layout.getByRole('button', { name: 'Flip V' }).click()
  // anchor grid follows ANCHORS order; index 8 = bottom-right
  await layout.locator('.anchor-grid .dot').nth(8).click()

  await expect
    .poll(async () => await vis(page))
    .toMatchObject({
      x: 100,
      y: 50,
      width: 240,
      height: 180,
      angle: 45,
      opacity: 0.5,
      track: 2,
      flipH: true,
      flipV: true,
      anchor: 'bottom-right',
    })

  // position preset overwrites x/y (preset drives placement at render)
  await field(layout, 'Position preset').locator('select').selectOption('bottom-center')
  let v = await vis(page)
  expect(v.position).toBe('bottom-center')
  expect(v.x).toBeUndefined()
  expect(v.y).toBeUndefined()

  // back to custom: preset removed, concrete coords written back
  await field(layout, 'Position preset').locator('select').selectOption('custom')
  v = await vis(page)
  expect(v.position).toBeUndefined()
  expect(typeof v.x).toBe('number')
  expect(typeof v.y).toBe('number')

  // resetting to defaults prunes the keys from the export
  await setNum(layout, 'Rotation', '') // clearable -> undefined
  await setNum(layout, 'Opacity', '1') // 1 is the package default -> pruned
  await setNum(layout, 'Track (z)', '')
  await layout.getByRole('button', { name: 'Flip H' }).click()
  await layout.getByRole('button', { name: 'Flip V' }).click()
  v = await vis(page)
  expect(v.angle).toBeUndefined()
  expect(v.opacity).toBeUndefined()
  expect(v.track).toBeUndefined()
  expect(v.flipH).toBeUndefined()
  expect(v.flipV).toBeUndefined()
})

/* ------------------------------------------------------------------ */
/* 2. TimingSection                                                     */
/* ------------------------------------------------------------------ */

test('timing (VIDEO): window fields, ordering validation, trim/speed/volume', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'VIDEO', src: fx('clip.mp4') }],
  })
  await selectVisual(page)
  await clickTab(page, 'Timing')

  const win = sec(page, 'Timeline window')
  await setNum(win, 'Appears at (enterBegin)', '1')
  await setNum(win, 'Enter anim ends (enterEnd)', '1.5')
  await setNum(win, 'Exit anim starts (exitBegin)', '3')
  await setNum(win, 'Disappears at (exitEnd)', '4')

  await expect
    .poll(async () => await vis(page))
    .toMatchObject({ enterBegin: 1, enterEnd: 1.5, exitBegin: 3, exitEnd: 4 })

  // bugfix 2026-07-09: the UI now clamps commits into the promised
  // enterBegin ≤ enterEnd ≤ exitBegin ≤ exitEnd order — an enterEnd below
  // enterBegin is raised to it, and no validation error can be produced.
  await setNum(win, 'Enter anim ends (enterEnd)', '0.5')
  // clamped to enterBegin (1) in the DOC; the minimal export prunes an
  // enterEnd equal to enterBegin (zero-length window = the default)
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__zvidTest.project.doc.visuals[0].enterEnd)
    )
    .toBe(1)
  expect((await vis(page)).enterEnd).toBeUndefined()
  expect((await validateDoc(page)).filter((i) => i.level === 'error')).toEqual([])
  // an exitBegin above exitEnd is capped at exitEnd
  await setNum(win, 'Exit anim starts (exitBegin)', '9')
  await expect.poll(async () => (await vis(page)).exitBegin).toBe(4)
  await setNum(win, 'Exit anim starts (exitBegin)', '3')
  await setNum(win, 'Enter anim ends (enterEnd)', '1.5')
  expect((await validateDoc(page)).filter((i) => i.level === 'error')).toEqual([])

  const trim = sec(page, 'Source trim')
  await setNum(trim, 'Video begin', '0.2')
  await setNum(trim, 'Video end', '1.8')
  await setNum(trim, 'Playback speed', '2')
  await setNum(trim, 'Volume', '0.5')

  await expect
    .poll(async () => await vis(page))
    .toMatchObject({ videoBegin: 0.2, videoEnd: 1.8, speed: 2, volume: 0.5 })
})

test('timing (GIF): playback speed', async ({ page }) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'GIF', src: fx('anim.gif') }],
  })
  await selectVisual(page)
  await clickTab(page, 'Timing')

  const playback = sec(page, 'Playback')
  await expect(playback).toBeVisible()
  await setNum(playback, 'Speed', '2.5')
  await expect.poll(async () => (await vis(page)).speed).toBe(2.5)
})

/* ------------------------------------------------------------------ */
/* 3. MediaSection (IMAGE)                                              */
/* ------------------------------------------------------------------ */

test('media source: src swap, strict placeholder rejection, resize mode', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'IMAGE', src: fx('image.png'), width: 200 }],
  })
  await selectVisual(page)
  const source = sec(page, 'Source')
  const srcInput = source.locator('input.src-input')

  // plain URL swap commits on change
  await srcInput.fill(fx('anim.gif'))
  await srcInput.blur()
  await expect.poll(async () => (await vis(page)).src).toBe(fx('anim.gif'))

  // unknown {{placeholder}} is rejected untouched: error toast, input reverts
  await srcInput.fill('{{nope}}')
  await srcInput.blur()
  await expect.poll(() => store(page, 'editor', 'toast.kind')).toBe('error')
  await expect(srcInput).toHaveValue(fx('anim.gif'))
  expect((await vis(page)).src).toBe(fx('anim.gif'))

  // resize mode overrides width/height (they are cleared alongside)
  await field(source, 'Resize mode').locator('select').selectOption('cover')
  let v = await vis(page)
  expect(v.resize).toBe('cover')
  expect(v.width).toBeUndefined()

  await field(source, 'Resize mode').locator('select').selectOption('')
  v = await vis(page)
  expect(v.resize).toBeUndefined()
})

test('media effects: Ken Burns zoom, crop seeded from intrinsic dims, radius, chroma key', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'IMAGE', src: fx('image.png'), width: 200 }],
  })
  await selectVisual(page)

  // wait for the media probe — crop seeds from the intrinsic 320x240
  await expect(sec(page, 'Source').getByText('320×240')).toBeVisible()

  // Ken Burns
  await openSec(page, 'Ken Burns zoom')
  const zoom = sec(page, 'Ken Burns zoom')
  await field(zoom, 'Enable').locator('input[type="checkbox"]').check()
  await expect.poll(async () => (await vis(page)).zoom).toEqual({ depth: 1.2 })
  await field(zoom, 'Depth').locator('input[type="range"]').press('End') // -> max 3
  expect((await vis(page)).zoom).toEqual({ depth: 3 })

  // Crop: seeded at 10%/80% of the probed source rect
  await openSec(page, 'Crop')
  const crop = sec(page, 'Crop')
  await field(crop, 'Enable').locator('input[type="checkbox"]').check()
  await expect
    .poll(async () => (await vis(page)).cropParams)
    .toEqual({ x: 32, y: 24, width: 256, height: 192 })
  await setNum(crop, 'X', '40')
  expect((await vis(page)).cropParams).toEqual({ x: 40, y: 24, width: 256, height: 192 })

  // Rounded corners (per-corner radius)
  await openSec(page, 'Rounded corners')
  const radius = sec(page, 'Rounded corners')
  await field(radius, 'Enable').locator('input[type="checkbox"]').check()
  await expect
    .poll(async () => (await vis(page)).radius)
    .toEqual({ tl: 24, tr: 24, bl: 24, br: 24 })
  await setNum(radius, 'Top-left', '8')
  expect((await vis(page)).radius).toEqual({ tl: 8, tr: 24, bl: 24, br: 24 })

  // Chroma key
  await openSec(page, 'Chroma key')
  const chroma = sec(page, 'Chroma key')
  await field(chroma, 'Enable').locator('input[type="checkbox"]').check()
  await expect
    .poll(async () => (await vis(page)).chromaKey)
    .toEqual({ color: '#00ff00', similarity: 20, blend: 10 })
  const colorText = field(chroma, 'Key color').locator('input[type="text"]')
  await colorText.fill('#112233')
  await colorText.blur()
  await setNum(chroma, 'Similarity (0–100)', '55')
  await setNum(chroma, 'Blend (0–100)', '30')
  expect((await vis(page)).chromaKey).toEqual({ color: '#112233', similarity: 55, blend: 30 })

  // disabling removes the object wholesale
  await field(crop, 'Enable').locator('input[type="checkbox"]').uncheck()
  expect((await vis(page)).cropParams).toBeUndefined()
})

/* ------------------------------------------------------------------ */
/* 4. FilterSection                                                     */
/* ------------------------------------------------------------------ */

test('filters: sliders write item.filter keys; clearing prunes the filter object', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'IMAGE', src: fx('image.png'), width: 200 }],
  })
  await selectVisual(page)
  await clickTab(page, 'Effects')
  await openSec(page, 'Color filters')
  const filters = sec(page, 'Color filters')

  // keyboard on the range inputs is deterministic (clicks depend on geometry)
  const brightness = field(filters, 'Brightness').locator('input[type="range"]')
  for (let i = 0; i < 3; i++) await brightness.press('ArrowRight') // 0 -> 3
  const hue = field(filters, 'Hue rotate').locator('input[type="range"]')
  await hue.press('ArrowRight') // 0 -> 1 -> "1deg"
  const blur = field(filters, 'Blur').locator('input[type="range"]')
  await blur.press('End') // -> 100
  const tint = field(filters, 'Color tint').locator('input[type="text"]')
  await tint.fill('#ff0000')
  await tint.blur()

  await expect
    .poll(async () => (await vis(page)).filter)
    .toEqual({ brightness: 3, 'hue-rotate': '1deg', blur: 100, colorTint: '#ff0000' })

  // clearing every key returns to a pruned/absent filter
  for (let i = 0; i < 3; i++) await brightness.press('ArrowLeft') // back to 0 -> deleted
  await hue.press('ArrowLeft')
  await blur.press('Home')
  await tint.fill('')
  await tint.blur()
  await expect.poll(async () => (await vis(page)).filter).toBeUndefined()
})

/* ------------------------------------------------------------------ */
/* 5. TextSection                                                       */
/* ------------------------------------------------------------------ */

test('text content: plain edit, HTML mode round-trip with stripTags', async ({ page }) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'hello' }],
  })
  await selectVisual(page)
  const content = sec(page, 'Content')

  const plain = content.locator('textarea')
  await plain.fill('Hello Zvid')
  await plain.blur()
  await expect.poll(async () => (await vis(page)).text).toBe('Hello Zvid')

  // -> HTML mode: text becomes wrapped html, text field dropped
  await content.locator('.seg button', { hasText: 'HTML' }).click()
  let v = await vis(page)
  expect(v.html).toBe('<div>Hello Zvid</div>')
  expect(v.text).toBeUndefined()

  const htmlTa = content.locator('textarea')
  await htmlTa.fill('<div><b>Bold</b> move</div>')
  await htmlTa.blur()
  expect((await vis(page)).html).toBe('<div><b>Bold</b> move</div>')

  // back to plain: tags stripped, html dropped
  await content.locator('.seg button', { hasText: 'Plain text' }).click()
  v = await vis(page)
  expect(v.text).toBe('Bold move')
  expect(v.html).toBeUndefined()
})

test('typography: font search+pick, size/weight/color/transform, customCode override warning', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'style me' }],
  })
  const id = await selectVisual(page)
  const typo = sec(page, 'Typography')

  // font picker: open, search, select — loads the font and writes the style
  await typo.locator('.font-btn').click()
  await typo.locator('.font-menu input.ctl').fill('Robo')
  await typo.getByRole('button', { name: 'Roboto', exact: true }).click()
  await expect.poll(async () => (await vis(page)).style?.fontFamily).toBe('Roboto')

  await setNum(typo, 'Size', '60')
  await field(typo, 'Weight').locator('select').selectOption('700')
  const color = field(typo, 'Color').locator('input[type="text"]')
  await color.fill('#ff0000')
  await color.blur()
  await field(typo, 'Transform').locator('select').selectOption('uppercase')

  await expect
    .poll(async () => (await vis(page)).style)
    .toEqual({
      fontFamily: 'Roboto',
      fontSize: '60px',
      fontWeight: '700',
      color: '#ff0000',
      textTransform: 'uppercase',
    })

  // customCode overrides typography -> the section warns about it
  await expect(typo.locator('.hint.warn')).toHaveCount(0)
  await page.evaluate(
    (vid) =>
      (window as any).__zvidTest.project.patchVisual(vid, {
        customCode: { css: '.x { color: red; }' },
      }),
    id
  )
  await expect(typo.locator('.hint.warn')).toContainText('custom CSS')
})

/* ------------------------------------------------------------------ */
/* 6. CustomCodeSection                                                 */
/* ------------------------------------------------------------------ */

test('custom code: css/js, rejected-API warning, loop duration clamps to 15s', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'animated' }],
  })
  await selectVisual(page)
  await clickTab(page, 'Effects')
  await openSec(page, 'Animation code (customCode)')
  const cc = sec(page, 'Animation code (customCode)')

  const cssTa = field(cc, 'CSS').locator('textarea')
  await cssTa.fill('.badge { animation: pulse 1s infinite; }')
  await cssTa.blur()
  await expect
    .poll(async () => (await vis(page)).customCode?.css)
    .toBe('.badge { animation: pulse 1s infinite; }')
  await expect(cc.locator('.hint.warn')).toHaveCount(0)

  // fetch( in js triggers the renderer-rejection warning
  const jsTa = field(cc, 'JavaScript').locator('textarea')
  await jsTa.fill("fetch('https://example.com/data')")
  await jsTa.blur()
  await expect(cc.locator('.hint.warn')).toContainText(
    /Network\/storage\/navigation APIs are rejected/
  )
  expect((await vis(page)).customCode?.js).toBe("fetch('https://example.com/data')")

  // loop duration is clamped to the 15s ceiling by the input itself
  await setNum(cc, 'Loop duration', '99')
  expect((await vis(page)).customCode?.animationDuration).toBe(15)
})

/* ------------------------------------------------------------------ */
/* 7. AnimationSection                                                  */
/* ------------------------------------------------------------------ */

test('animations: enter via gallery search seeds a window, exit likewise, none clears', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'VIDEO', src: fx('clip.mp4'), exitEnd: 4 }],
  })
  await selectVisual(page)
  await clickTab(page, 'Effects')

  // enter: search the gallery, pick the Fade tile
  const enter = sec(page, 'Enter animation')
  await enter.locator('.ep-q').fill('fade')
  await expect(enter.locator('.ep-cell[title="Fade"]')).toBeVisible()
  await enter.locator('.ep-cell[title="Fade"]').click()
  // no window existed (enterEnd defaulted to enterBegin) -> 1s window seeded
  await expect
    .poll(async () => await vis(page))
    .toMatchObject({ enterAnimation: 'fade', enterEnd: 1 })

  // exit: pick a wipe; zero-length exit window gets seeded backwards from exitEnd
  const exit = sec(page, 'Exit animation')
  await exit.locator('.ep-cell[title="Wipe ←"]').click()
  await expect
    .poll(async () => await vis(page))
    .toMatchObject({ exitAnimation: 'wipeleft', exitBegin: 3, exitEnd: 4 })

  // the None tile clears the effect
  await enter.locator('.ep-cell[title="None"]').click()
  expect((await vis(page)).enterAnimation).toBeUndefined()
})

test('transition link: ids assigned, effect + duration editable, unlink clears', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [
      { type: 'VIDEO', src: fx('clip.mp4'), exitEnd: 4 },
      { type: 'VIDEO', src: fx('clip-b.mp4'), id: 'clip-b', enterBegin: 4 },
    ],
  })
  await selectVisual(page, 0)
  await clickTab(page, 'Effects')
  await openSec(page, 'Transition to another video')
  const tr = sec(page, 'Transition to another video')

  await field(tr, 'Target video').locator('select').selectOption({ label: 'clip-b' })
  let v = await vis(page, 0)
  expect(v.transition).toBe('fade')
  expect(v.transitionId).toBe('clip-b')
  expect(v.transitionDuration).toBe(0.5)
  expect(v.id).toMatch(/^vid-/) // source id auto-assigned on link

  // effect gallery inside the section (allow-none=false: no None tile)
  await tr.locator('.ep-cell[title="Dissolve"]').click()
  await expect.poll(async () => (await vis(page, 0)).transition).toBe('dissolve')
  await expect(tr.locator('.ep-cell[title="None"]')).toHaveCount(0)

  await setNum(tr, 'Overlap duration', '1.2')
  expect((await vis(page, 0)).transitionDuration).toBe(1.2)

  // unlink: all three transition fields dropped (assigned ids remain)
  await field(tr, 'Target video').locator('select').selectOption('')
  v = await vis(page, 0)
  expect(v.transition).toBeUndefined()
  expect(v.transitionId).toBeUndefined()
  expect(v.transitionDuration).toBeUndefined()
  expect(v.id).toMatch(/^vid-/)
})

/* ------------------------------------------------------------------ */
/* 8. SvgSection                                                        */
/* ------------------------------------------------------------------ */

test('svg: markup edits round-trip; invalid markup shows the parse-invalid state', async ({
  page,
}) => {
  const CIRCLE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>'
  const RECT =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="80" height="60" fill="blue"/></svg>'
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'SVG', svg: CIRCLE }],
  })
  await selectVisual(page)
  const svgSec = sec(page, 'SVG markup')
  await expect(svgSec.locator('p.hint')).toContainText('✓ valid SVG')

  const ta = svgSec.locator('textarea')
  await ta.fill(RECT)
  await ta.blur()
  await expect.poll(async () => (await vis(page)).svg).toBe(RECT)
  await expect(svgSec.locator('p.hint')).toContainText('✓ valid SVG')

  // bugfix 2026-07-09: markup that does not parse as SVG is REJECTED — an
  // error toast appears and the document keeps the last valid markup.
  await ta.fill('<div>nope</div>')
  await ta.blur()
  await expect(page.locator('.toast', { hasText: 'does not parse as SVG' })).toBeVisible()
  expect((await vis(page)).svg).toBe(RECT)
  await expect(svgSec.locator('p.hint')).toContainText('✓ valid SVG')
})

/* ------------------------------------------------------------------ */
/* 9. RawJsonSection                                                    */
/* ------------------------------------------------------------------ */

test('raw JSON: apply persists, invalid JSON errors, revert restores', async ({ page }) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'raw' }],
  })
  await selectVisual(page)
  await clickTab(page, 'JSON')
  const raw = sec(page, 'Raw element JSON')
  const ta = raw.locator('.code-ed textarea')
  await expect(ta).toHaveValue(/"text": "raw"/)

  // valid edit -> Apply replaces the element wholesale
  await ta.fill(JSON.stringify({ type: 'TEXT', text: 'edited', x: 10 }, null, 2))
  await raw.getByRole('button', { name: 'Apply' }).click()
  await expect.poll(async () => await vis(page)).toEqual({ type: 'TEXT', text: 'edited', x: 10 })

  // invalid JSON -> inline error, document untouched
  await ta.fill('{ "type": "TEXT", ')
  await raw.getByRole('button', { name: 'Apply' }).click()
  await expect(raw.locator('pre.err')).toContainText('JSON parse error')
  expect(await vis(page)).toEqual({ type: 'TEXT', text: 'edited', x: 10 })

  // revert restores the serialized element and clears the error
  await raw.getByRole('button', { name: 'Revert' }).click()
  await expect(raw.locator('pre.err')).toHaveCount(0)
  await expect(ta).toHaveValue(/"text": "edited"/)
})

/* ------------------------------------------------------------------ */
/* 10. AudioSection                                                     */
/* ------------------------------------------------------------------ */

test('audio: placement, trim, mix, loop-count hint, src swap', async ({ page }) => {
  await loadProject(page, {
    ...BASE,
    audios: [{ src: fx('tone.mp3') }],
  })
  await selectAudio(page)
  await expect(sec(page, 'Source').locator('.ok')).toContainText('✓ loaded')

  const placement = sec(page, 'Timeline placement')
  await setNum(placement, 'Starts at (enter)', '0.5')
  await setNum(placement, 'Ends at (exit)', '8')

  const trim = sec(page, 'Source trim')
  await setNum(trim, 'Audio begin', '0.2')
  await setNum(trim, 'Audio end', '2.8')

  const mix = sec(page, 'Mix')
  await setNum(mix, 'Volume', '0.5')
  await setNum(mix, 'Speed (atempo)', '1.3')
  await setNum(mix, 'Track', '1')

  await expect
    .poll(async () => (await exportedDoc(page)).audios?.[0])
    .toMatchObject({
      src: fx('tone.mp3'),
      enter: 0.5,
      exit: 8,
      audioBegin: 0.2,
      audioEnd: 2.8,
      volume: 0.5,
      speed: 1.3,
      track: 1,
    })

  // window (7.5s) > trimmed segment (2.6s / 1.3x = 2s) -> loop hint
  await expect(trim.locator('p.hint')).toContainText('auto-loops ×4')

  const srcInput = sec(page, 'Source').locator('input.src')
  await srcInput.fill(fx('clip.mp4'))
  await srcInput.blur()
  await expect
    .poll(async () => (await exportedDoc(page)).audios?.[0].src)
    .toBe(fx('clip.mp4'))
})

/* ------------------------------------------------------------------ */
/* 11. ProjectSection                                                   */
/* ------------------------------------------------------------------ */

test('project: stats reflect the doc; validation issue appears and clears', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [
      { type: 'TEXT', text: 'one' },
      { type: 'IMAGE', src: fx('image.png') },
    ],
    audios: [{ src: fx('tone.mp3') }],
  })
  // empty-stage click -> project settings in the shared panel
  await page.evaluate(() => (window as any).__zvidTest.editor.openProjectSettings())
  await expect(sec(page, 'Overview')).toBeVisible()
  await expect(page.locator('.insp-body .stat b')).toHaveText(['2', '1', '0', '0'])

  const validation = sec(page, 'Validation')
  await expect(validation.locator('.hint.ok')).toContainText('No issues')

  // seed a problem via the bridge: unsupported outputFormat
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ outputFormat: 'xyz' })
  )
  await expect(validation.locator('.issue.error')).toContainText('Unsupported format "xyz"')
  await expect(validation.locator('.issue.error .issue-path')).toHaveText('outputFormat')

  // fix it -> the list clears
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ outputFormat: 'mp4' })
  )
  await expect(validation.locator('.issue')).toHaveCount(0)
  await expect(validation.locator('.hint.ok')).toContainText('No issues')
})
