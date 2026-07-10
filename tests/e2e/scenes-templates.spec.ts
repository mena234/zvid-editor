import { test, expect, type Page, type Locator } from '@playwright/test'
import {
  openEditor,
  exportedDoc,
  loadProject,
  store,
  fx,
  resetMockOrch,
} from './helpers/app'

/**
 * Scenes + template variables: the Scenes panel (convert/CRUD/settings/
 * flatten), scene-local editing, the full-movie preview, the Variables
 * panel (typed editing, usage, rename/delete), placeholder substitution on
 * the stage, {{var}} support in typed inputs, conditions and iterate.
 *
 * Setup goes through the window.__zvidTest bridge (loadProject/selectVisual/
 * seek); edits drive the real UI; ground truth is the exported JSON.
 *
 * Selector map (from the component sources):
 *   LeftRail        -> .rail-tab[title="Scenes"|"Variables"|"Text"], .rail-panel
 *   UiSection       -> section.sec > .sec-head > span (title), .sec-body
 *   ScenesPanel     -> .scene-card (.global for root), .scene-meta .hint,
 *                      .scene-actions [title="Move up"|"Move down"|"Delete scene"],
 *                      .tpl-badge.iterate/.cond-on/.cond-off
 *   ScenesSettings  -> .scene-settings, UiField .field/.field-label/.field-ctl,
 *                      .cond-row input.ctl, .state-chip
 *   SceneStrip      -> .scene-block (dblclick = edit scene), .scene-local-note
 *   StageView       -> .scene-group (root movie backdrop/preview), .stage-item[data-item-id]
 *   VariablesPanel  -> .add-row, .var-row, .var-name, .chip, .cm-content (JSON),
 *                      .problem, label.toggle input (preview)
 *   UiNumberInput   -> span.num-wrap > input.num + .var-menu .vm-btn
 *   UiVarMenu       -> .vm-btn, .vm-pop .vm-item.mono
 */

/* ------------------------------------------------------------------ */
/* spec-local helpers                                                   */
/* ------------------------------------------------------------------ */

/** Open a left-rail panel by tab title. */
async function openPanel(page: Page, tab: 'Scenes' | 'Variables' | 'Text') {
  await page.click(`.rail-tab[title="${tab}"]`)
  await expect(page.locator('.rail-panel')).toBeVisible()
}

/** UiSection inside the left rail panel, by exact title. */
function railSec(page: Page, title: string): Locator {
  return page
    .locator('.rail-panel section.sec')
    .filter({ has: page.locator(`.sec-head span:text-is("${title}")`) })
}

/** Inspector section by exact title (same shape as inspector.spec.ts). */
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

/** Commit a value into a UiNumberInput (Enter blurs -> commit). */
async function setNum(scope: Locator, label: string, value: string) {
  const input = field(scope, label).locator('input.num')
  await input.fill(value)
  await input.press('Enter')
}

/** Scene cards in the Scenes panel (excluding the Global overlays card). */
function sceneCards(page: Page): Locator {
  return page.locator('.rail-panel .scene-card:not(.global)')
}

/** Variable row in the Variables panel, by variable name. */
function varRow(page: Page, name: string): Locator {
  return page
    .locator('.rail-panel .var-row')
    .filter({ has: page.locator(`.var-name:text-is("{{${name}}}")`) })
}

/** Replace the content of a CodeMirror JSON editor (insertText bypasses
 *  bracket auto-closing, so the text lands verbatim). */
async function setJson(row: Locator, text: string) {
  const cm = row.locator('.cm-content')
  await cm.click()
  await row.page().keyboard.press('Control+a')
  await row.page().keyboard.insertText(text)
}

/** Select the i-th root visual via the bridge; returns its editor _id. */
async function selectVisual(page: Page, index = 0): Promise<string> {
  return page.evaluate((i) => {
    const t = (window as any).__zvidTest
    const v = t.project.doc.visuals[i]
    t.editor.selectVisual(v._id)
    return v._id
  }, index)
}

async function clickInspectorTab(page: Page, label: string) {
  await page.locator('.insp-tabs button', { hasText: label }).click()
}

/** Open a collapsible inspector section that starts closed. */
async function openSec(page: Page, title: string) {
  const s = sec(page, title)
  await s.locator('button.sec-head').click()
  await expect(s.locator('.sec-body')).toBeVisible()
}

/** Assert the exported scenes' transition chain invariant: a scene with a
 *  transition must point its transitionId at the NEXT scene's id; the last
 *  scene never carries a transition. */
function expectTransitionChainReconciled(scenes: any[]) {
  scenes.forEach((s, i) => {
    const next = scenes[i + 1]
    if (!next) {
      expect(s.transition, `last scene ${s.id} must not keep a transition`).toBeUndefined()
      expect(s.transitionId).toBeUndefined()
      return
    }
    if (s.transition !== undefined) {
      expect(s.transitionId, `scene ${s.id} transitionId`).toBe(next.id)
    } else {
      expect(s.transitionId, `scene ${s.id} has no transition`).toBeUndefined()
    }
  })
}

const BASE = {
  name: 'scenes-templates-spec',
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
/* SCENES                                                               */
/* ------------------------------------------------------------------ */

test('convert flat timeline -> scenes moves visuals/audios into scene 1 unchanged', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [
      { type: 'TEXT', text: 'first', exitEnd: 3 },
      { type: 'IMAGE', src: fx('image.png'), width: 200, enterBegin: 1 },
    ],
    audios: [{ src: fx('tone.mp3'), enter: 0.5 }],
  })
  await openPanel(page, 'Scenes')

  const convert = page.locator('.rail-panel button', { hasText: 'convert timeline' })
  await expect(convert).toBeVisible()
  await convert.click()

  await expect(sceneCards(page)).toHaveCount(1)
  await expect(convert).toHaveCount(0) // only offered for flat projects

  const doc = await exportedDoc(page)
  expect(doc.scenes).toHaveLength(1)
  const s = doc.scenes[0]
  // convertToScenes wraps the flat timeline: same timings, scene-local now
  expect(s.id).toBe('scene-0')
  expect(s.duration).toBe(8) // seeded from the project duration
  expect(s.visuals).toHaveLength(2)
  expect(s.visuals[0]).toMatchObject({ type: 'TEXT', text: 'first', exitEnd: 3 })
  expect(s.visuals[1]).toMatchObject({ type: 'IMAGE', enterBegin: 1 })
  expect(s.audios).toEqual([{ src: fx('tone.mp3'), enter: 0.5 }])
  // the root timeline is empty (keys pruned from the export)
  expect(doc.visuals).toBeUndefined()
  expect(doc.audios).toBeUndefined()

  // the Global overlays card reflects the now-empty root
  await expect(page.locator('.scene-card.global')).toContainText('0 visuals · 0 audios')
})

test('scene CRUD: cards show durations (auto computed), add, reorder reconciles transitions, remove', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    scenes: [
      {
        id: 'sA',
        duration: 4,
        transition: 'fade',
        transitionId: 'sB',
        transitionDuration: 1,
        visuals: [{ type: 'TEXT', text: 'a', exitEnd: 4 }],
      },
      {
        id: 'sB',
        duration: -1, // auto — computed from content (exitEnd 3)
        transition: 'wipeleft',
        transitionId: 'sC',
        visuals: [{ type: 'TEXT', text: 'b', exitEnd: 3 }],
      },
      { id: 'sC', duration: 2, visuals: [] },
    ],
  })
  await openPanel(page, 'Scenes')

  const cards = sceneCards(page)
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0)).toContainText('4s')
  // auto (-1) durations display the plan-computed value
  await expect(cards.nth(1)).toContainText('auto (3s)')
  await expect(cards.nth(2)).toContainText('2s')
  await expect(cards.nth(0)).toContainText('fade →')

  // add: a fresh 5s scene is appended and opened for editing
  await page.locator('.rail-panel button', { hasText: 'Add scene' }).click()
  await expect(cards).toHaveCount(4)
  let doc = await exportedDoc(page)
  expect(doc.scenes[3]).toMatchObject({ id: 'scene-3', duration: 5 })
  expect(await store(page, 'editor', 'context')).not.toBe('root')

  // remove the added scene again
  await cards.nth(3).locator('[title="Delete scene"]').click()
  await expect(cards).toHaveCount(3)
  expect(await store(page, 'editor', 'context')).toBe('root') // deleted the open scene

  // reorder: move sC up between sA and sB
  await cards.nth(2).locator('[title="Move up"]').click()
  await expect(cards.nth(1)).toContainText('sC')

  doc = await exportedDoc(page)
  expect(doc.scenes.map((s: any) => s.id)).toEqual(['sA', 'sC', 'sB'])
  // sA's transition now targets sC; sC has none; sB (last) lost its transition
  expect(doc.scenes[0]).toMatchObject({ transition: 'fade', transitionId: 'sC' })
  expect(doc.scenes[1].transition).toBeUndefined()
  expect(doc.scenes[2].transition).toBeUndefined()
  expect(doc.scenes[2].transitionDuration).toBeUndefined()
  expectTransitionChainReconciled(doc.scenes)

  // move boundaries are enforced by disabled buttons
  await expect(cards.nth(0).locator('[title="Move up"]')).toBeDisabled()
  await expect(cards.nth(2).locator('[title="Move down"]')).toBeDisabled()

  // remove the middle scene -> chain still consistent
  await cards.nth(1).locator('[title="Delete scene"]').click()
  await expect(cards).toHaveCount(2)
  doc = await exportedDoc(page)
  expect(doc.scenes.map((s: any) => s.id)).toEqual(['sA', 'sB'])
  expect(doc.scenes[0]).toMatchObject({ transition: 'fade', transitionId: 'sB' })
  expectTransitionChainReconciled(doc.scenes)
})

test('scene settings: id, explicit vs auto duration, background color, transition + duration', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    duration: 5,
    scenes: [
      { id: 'intro', duration: 4, visuals: [{ type: 'TEXT', text: 'i', exitEnd: 2.5 }] },
      { id: 'outro', duration: 3, visuals: [] },
    ],
  })
  await openPanel(page, 'Scenes')
  await sceneCards(page).nth(0).click() // opens the scene + its settings
  const settings = page.locator('.rail-panel .scene-settings')
  await expect(settings).toBeVisible()

  // explicit duration edit
  await setNum(settings, 'Duration', '6')
  await expect.poll(async () => (await exportedDoc(page)).scenes[0].duration).toBe(6)

  // auto: duration -1 exports; the panel shows the computed value (exitEnd 2.5)
  await field(settings, 'Duration').locator('input[type="checkbox"]').check()
  await expect.poll(async () => (await exportedDoc(page)).scenes[0].duration).toBe(-1)
  await expect(field(settings, 'Duration')).toContainText('computed: 2.5s')
  await expect(sceneCards(page).nth(0)).toContainText('auto (2.5s)')

  // back to explicit: seeded from the computed value
  await field(settings, 'Duration').locator('input[type="checkbox"]').uncheck()
  await expect.poll(async () => (await exportedDoc(page)).scenes[0].duration).toBe(2.5)

  // background color (falls back to project bg when empty)
  const bg = field(settings, 'Background color').locator('input[type="text"]')
  await bg.fill('#112233')
  await bg.blur()
  await expect
    .poll(async () => (await exportedDoc(page)).scenes[0].backgroundColor)
    .toBe('#112233')

  // transition to the next scene via the effect gallery
  const trField = field(settings, 'Transition to next scene')
  await trField.locator('.ep-q').fill('fade')
  await trField.locator('.ep-cell[title="Fade"]').click()
  await expect
    .poll(async () => (await exportedDoc(page)).scenes[0])
    .toMatchObject({ transition: 'fade', transitionId: 'outro', transitionDuration: 0.5 })

  await setNum(settings, 'Transition duration', '1.2')
  await expect
    .poll(async () => (await exportedDoc(page)).scenes[0].transitionDuration)
    .toBe(1.2)

  // scene id rename keeps the chain consistent (transitionId targets ids)
  const idInput = field(settings, 'Scene id').locator('input.ctl')
  await idInput.fill('opening')
  await idInput.blur()
  const doc = await exportedDoc(page)
  expect(doc.scenes[0].id).toBe('opening')
  expectTransitionChainReconciled(doc.scenes)

  // last scene offers no transition editor
  await page.locator('.rail-panel .scene-card', { hasText: 'outro' }).click()
  await expect(field(settings, 'Transition to next scene')).toHaveCount(0)
  await expect(settings).toContainText('Last scene — transitions apply between')
})

test('scene-local editing: dblclick in the SceneStrip scopes stage + new elements to the scene', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    duration: 5,
    scenes: [
      { id: 'one', duration: 4, visuals: [{ type: 'TEXT', text: 'INSIDE-TXT', exitEnd: 4 }] },
      { id: 'two', duration: 3, visuals: [] },
    ],
    visuals: [{ type: 'TEXT', text: 'OVERLAY-TXT' }],
  })

  await expect(page.locator('.scene-block')).toHaveCount(2)
  await page.locator('.scene-block').first().dblclick()

  // editing context is the scene now: local timeline note + scoped stage
  await expect(page.locator('.scene-local-note')).toBeVisible()
  expect(await store(page, 'editor', 'context')).not.toBe('root')
  await expect(page.locator('.stage-item', { hasText: 'INSIDE-TXT' })).toBeVisible()
  await expect(page.locator('.stage-item', { hasText: 'OVERLAY-TXT' })).toHaveCount(0)
  await expect(page.locator('.ctx-banner')).toContainText('one')

  // adding an element lands in scene.visuals, not the root
  await openPanel(page, 'Text')
  await page.locator('.rail-panel .preset').first().click()
  const doc = await exportedDoc(page)
  expect(doc.scenes[0].visuals).toHaveLength(2)
  expect(doc.scenes[0].visuals[1]).toMatchObject({ type: 'TEXT', text: 'Your heading' })
  expect(doc.visuals).toHaveLength(1) // untouched root overlay

  // back to all scenes
  await page.locator('.scene-local-note button', { hasText: 'all scenes' }).click()
  expect(await store(page, 'editor', 'context')).toBe('root')
  await expect(page.locator('.scene-local-note')).toHaveCount(0)
})

test('global overlays: the root card edits movie-wide visuals', async ({ page }) => {
  await loadProject(page, {
    ...BASE,
    duration: 5,
    scenes: [
      { id: 'one', duration: 4, visuals: [{ type: 'TEXT', text: 'INSIDE-TXT', exitEnd: 4 }] },
    ],
    visuals: [{ type: 'TEXT', text: 'OVERLAY-TXT' }],
  })
  await openPanel(page, 'Scenes')

  const global = page.locator('.scene-card.global')
  await expect(global).toContainText('1 visuals · 0 audios')
  await expect(global).toContainText('span the whole movie')
  await global.click()
  await expect(global).toHaveClass(/active/)
  expect(await store(page, 'editor', 'context')).toBe('root')

  // overlays mode: the editable root track renders over the full movie
  await page.locator('.tp-right .seg button', { hasText: 'overlays' }).click()
  await expect(page.locator('.scene-group')).toHaveCount(1)
  await expect(
    page.locator('.stage-item.interactive', { hasText: 'OVERLAY-TXT' })
  ).toBeVisible()
  // scene content shows underneath but is not editable here
  await expect(
    page.locator('.scene-group .stage-item', { hasText: 'INSIDE-TXT' })
  ).toBeVisible()
  await expect(
    page.locator('.stage-item.interactive', { hasText: 'INSIDE-TXT' })
  ).toHaveCount(0)

  // adding an element in the root context extends the global overlays
  await openPanel(page, 'Text')
  await page.locator('.rail-panel .preset').first().click()
  const doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(2)
  expect(doc.visuals[1]).toMatchObject({ type: 'TEXT', text: 'Your heading' })
  expect(doc.scenes[0].visuals).toHaveLength(1) // scenes untouched
})

test('full-movie preview: scene groups follow the overlap-adjusted plan and total duration', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    duration: 5,
    scenes: [
      {
        id: 'A',
        duration: 4,
        transition: 'fade',
        transitionId: 'B',
        transitionDuration: 1,
        visuals: [{ type: 'TEXT', text: 'SCENE-A', exitEnd: 4 }],
      },
      { id: 'B', duration: 3, visuals: [{ type: 'TEXT', text: 'SCENE-B', exitEnd: 3 }] },
    ],
  })

  // plan: A starts 0 (4s), B starts 4-1=3 (3s) -> total 6s (> project 5s)
  const seg = page.locator('.tp-right .seg')
  await seg.locator('button', { hasText: 'overlays' }).click()
  // the movie backdrop renders in overlays mode too (scene A at t=0)
  await expect(page.locator('.scene-group')).toHaveCount(1)
  await seg.locator('button', { hasText: 'full movie' }).click()

  await expect(page.locator('.tl-panel .time-total')).toHaveText('/ 0:06.00')

  // scene strip mirrors the plan
  await expect(page.locator('.scene-block')).toHaveCount(2)
  await expect(page.locator('.scene-block').nth(0)).toHaveAttribute(
    'title',
    'A · 4s — double-click to edit'
  )
  await expect(page.locator('.scene-block').nth(1)).toHaveAttribute(
    'title',
    'B · 3s — double-click to edit'
  )
  await expect(page.locator('.scene-block .scene-transition')).toHaveAttribute(
    'title',
    'transition: fade (1s overlap)'
  )

  // playhead 0: only scene A on stage
  await expect(page.locator('.scene-group')).toHaveCount(1)
  await expect(page.locator('.scene-group', { hasText: 'SCENE-A' })).toBeVisible()

  // playhead 3.5: inside the 1s overlap -> both scenes render
  await page.evaluate(() => (window as any).__zvidTest.editor.seek(3.5))
  await expect(page.locator('.scene-group')).toHaveCount(2)

  // playhead 5: only scene B remains
  await page.evaluate(() => (window as any).__zvidTest.editor.seek(5))
  await expect(page.locator('.scene-group')).toHaveCount(1)
  await expect(page.locator('.scene-group', { hasText: 'SCENE-B' })).toBeVisible()
})

test('flatten scenes -> flat doc with plan-start offsets applied to timings', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    duration: 8,
    scenes: [
      {
        id: 's1',
        duration: 4,
        transition: 'fade',
        transitionId: 's2',
        transitionDuration: 1,
        visuals: [{ type: 'TEXT', text: 'a', exitEnd: 2 }],
      },
      {
        id: 's2',
        duration: 3,
        visuals: [{ type: 'TEXT', text: 'b', enterBegin: 0.5, exitEnd: 2.5 }],
        audios: [{ src: fx('tone.mp3'), enter: 0, exit: 2 }],
      },
    ],
  })
  await openPanel(page, 'Scenes')
  await page.locator('.rail-panel button', { hasText: 'flatten' }).click()

  await expect
    .poll(() => store(page, 'editor', 'toast.message'))
    .toContain('flattened')

  const doc = await exportedDoc(page)
  expect(doc.scenes).toBeUndefined()
  await expect(sceneCards(page)).toHaveCount(0)

  // s1 starts at 0, s2 at 4-1=3 (transition overlap) -> timings shifted
  expect(doc.visuals).toHaveLength(2)
  expect(doc.visuals[0]).toMatchObject({ text: 'a', exitEnd: 2 })
  expect(doc.visuals[0].enterBegin).toBeUndefined() // 0 pruned from export
  expect(doc.visuals[1]).toMatchObject({ text: 'b', enterBegin: 3.5, exitEnd: 5.5 })
  expect(doc.audios).toEqual([{ src: fx('tone.mp3'), enter: 3, exit: 5 }])
  // duration keeps max(project 8, scenes total 6)
  expect(doc.duration).toBe(8)
})

/* ------------------------------------------------------------------ */
/* TEMPLATE VARIABLES                                                   */
/* ------------------------------------------------------------------ */

test('variables panel: add typed vars, typed editing, JSON editor with debounce + errors', async ({
  page,
}) => {
  await openPanel(page, 'Variables')
  const addName = page.locator('.rail-panel .add-row input.ctl')
  const addType = page.locator('.rail-panel .add-row select')
  const addBtn = page.locator('.rail-panel .add-row button[type="submit"]')

  // name validation: reserved + syntax + duplicates gate the Add button
  await addName.fill('item')
  await expect(page.locator('.rail-panel p.err')).toContainText('reserved for iterate')
  await expect(addBtn).toBeDisabled()
  await addName.fill('1bad')
  await expect(page.locator('.rail-panel p.err')).toContainText('Start with a letter')

  // string
  await addName.fill('title')
  await addBtn.click()
  const titleRow = varRow(page, 'title')
  await expect(titleRow.locator('.chip.type')).toHaveText('string')
  await expect(titleRow.locator('.chip.unused')).toHaveText('unused')
  const strInput = titleRow.locator('.var-value input.ctl')
  await strInput.fill('My Video')
  await strInput.blur()
  await expect.poll(async () => (await exportedDoc(page)).variables.title).toBe('My Video')

  // number (typed — exports as a real number)
  await addName.fill('count')
  await addType.selectOption('number')
  await addBtn.click()
  const countInput = varRow(page, 'count').locator('.var-value input.num')
  await countInput.fill('7')
  await countInput.press('Enter')
  await expect.poll(async () => (await exportedDoc(page)).variables.count).toBe(7)

  // boolean
  await addName.fill('active')
  await addType.selectOption('boolean')
  await addBtn.click()
  const check = varRow(page, 'active').locator('.check input[type="checkbox"]')
  await expect(check).toBeChecked() // boolean default = true
  await check.uncheck()
  await expect.poll(async () => (await exportedDoc(page)).variables.active).toBe(false)

  // duplicate names rejected in the form
  await addName.fill('title')
  await expect(page.locator('.rail-panel p.err')).toContainText('already exists')
  await addName.fill('')

  // array via the JSON editor — commits on a 350ms debounce
  await addName.fill('slides')
  await addType.selectOption('array')
  await addBtn.click()
  const slidesRow = varRow(page, 'slides')
  await expect(slidesRow.locator('.chip.type')).toHaveText('array')
  await setJson(slidesRow, '[{"caption":"A"},{"caption":"B"}]')
  await expect
    .poll(async () => (await exportedDoc(page)).variables.slides)
    .toEqual([{ caption: 'A' }, { caption: 'B' }])
  await expect(slidesRow).toContainText('2 items')

  // invalid JSON: error surfaced, last good value kept
  await setJson(slidesRow, '[broken')
  await expect(slidesRow.locator('.chip.bad')).toHaveText('invalid JSON')
  await expect(slidesRow.locator('p.err')).toBeVisible()
  expect((await exportedDoc(page)).variables.slides).toEqual([
    { caption: 'A' },
    { caption: 'B' },
  ])

  // fix it again (format also flushes the draft)
  await setJson(slidesRow, '["x"]')
  await slidesRow.locator('button', { hasText: 'format' }).click()
  await expect.poll(async () => (await exportedDoc(page)).variables.slides).toEqual(['x'])
  await expect(slidesRow.locator('.chip.bad')).toHaveCount(0)

  // deleting an unused variable needs no confirmation
  await varRow(page, 'count').locator('.var-head .icon-btn').nth(1).click()
  await expect(varRow(page, 'count')).toHaveCount(0)
  await expect
    .poll(async () => Object.keys((await exportedDoc(page)).variables))
    .toEqual(['title', 'active', 'slides'])
})

test('rename keeps old {{placeholders}} in the doc (known behavior); used vars need delete confirm', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'Hi {{title}}' }],
    variables: { title: 'X' },
  })
  await openPanel(page, 'Variables')
  const row = varRow(page, 'title')
  await expect(row.locator('.chip.used')).toHaveText('×1')

  // rename title -> heading. KNOWN behavior: usages are NOT rewritten — the
  // doc keeps {{title}} and the panel warns about the dangling references.
  await row.locator('[title="Rename"]').click()
  // while renaming, the .var-name button is swapped for the input — the
  // name-filtered row locator no longer matches, so target the input directly
  const rename = page.locator('.rail-panel input.rename')
  await rename.fill('heading')
  // bugfix 2026-07-09: commitRename now ignores the ghost blur commit from
  // the unmounting input, so Enter keeps the intended info toast (previously
  // it was replaced by a spurious "Invalid or duplicate variable name").
  await rename.press('Enter')

  await expect
    .poll(() => store(page, 'editor', 'toast.message'))
    .toContain('still reference the old name')
  const doc = await exportedDoc(page)
  expect(doc.variables).toEqual({ heading: 'X' })
  expect(doc.visuals[0].text).toBe('Hi {{title}}') // untouched placeholder
  // ...and {{title}} is now reported as undeclared
  await expect(
    railSec(page, 'Problems').locator('.problem', { hasText: '{{title}}' })
  ).toContainText('used but not defined')
  await expect(varRow(page, 'heading').locator('.chip.unused')).toHaveText('unused')

  // delete with confirm: a USED variable takes two clicks
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: '{{title}}' }],
    variables: { title: 'X' },
  })
  const used = varRow(page, 'title')
  const delBtn = used.locator('.var-head .icon-btn').nth(1)
  await delBtn.click()
  await expect(used).toHaveCount(1) // still there — armed only
  await expect(delBtn).toHaveAttribute('title', /click again to delete/)
  expect((await exportedDoc(page)).variables).toEqual({ title: 'X' })
  await delBtn.click()
  await expect(varRow(page, 'title')).toHaveCount(0)
  expect((await exportedDoc(page)).variables).toBeUndefined()
})

test('usage counting: x2 chip for a doubly-used var; undeclared {{ghost}} listed + definable', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [
      { type: 'TEXT', text: 'A {{title}}' },
      { type: 'TEXT', text: '{{title}} B' },
      { type: 'TEXT', text: '{{ghost}}' },
    ],
    variables: { title: 'T' },
  })
  await openPanel(page, 'Variables')

  await expect(varRow(page, 'title').locator('.chip.used')).toHaveText('×2')

  const problem = railSec(page, 'Problems').locator('.problem', { hasText: '{{ghost}}' })
  await expect(problem).toContainText('used but not defined — rendering will fail')

  // one-click define adds the variable and clears the problem
  await problem.locator('button', { hasText: 'define' }).click()
  await expect(varRow(page, 'ghost')).toHaveCount(1)
  await expect(varRow(page, 'ghost').locator('.chip.used')).toHaveText('×1')
  await expect(problem).toHaveCount(0)
  expect((await exportedDoc(page)).variables).toEqual({ title: 'T', ghost: '' })
})

test('placeholder preview: stage resolves {{name}} when preview is on; export always raw', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'Hello {{name}}' }],
    variables: { name: 'Ada' },
  })

  // variablesPreview defaults ON — the stage shows the substituted value
  await expect(page.locator('.stage-item', { hasText: 'Hello Ada' })).toBeVisible()
  expect((await exportedDoc(page)).visuals[0].text).toBe('Hello {{name}}')

  // toggle preview off in the Variables panel -> raw placeholder on stage
  await openPanel(page, 'Variables')
  const toggle = page.locator('.rail-panel label.toggle input')
  await toggle.uncheck()
  await expect(page.locator('.stage-item', { hasText: 'Hello {{name}}' })).toBeVisible()
  await expect(page.locator('.stage-item', { hasText: 'Hello Ada' })).toHaveCount(0)

  await toggle.check()
  await expect(page.locator('.stage-item', { hasText: 'Hello Ada' })).toBeVisible()

  // the document itself never changes
  expect((await exportedDoc(page)).visuals[0].text).toBe('Hello {{name}}')
})

test('NumberInput: VarMenu inserts a number var as the exported value; string var rejected', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'num target' }],
    variables: { n: 42, s: 'abc' },
  })
  await selectVisual(page)
  await openSec(page, 'Layout')
  const xField = field(sec(page, 'Layout'), 'X (anchor point)')

  // the picker offers only number-typed placeholders ({{s}} filtered out)
  await xField.locator('.vm-btn').click()
  await expect(xField.locator('.vm-pop .vm-item.mono')).toHaveText(['{{n}}'])
  await xField.locator('.vm-pop .vm-item.mono').click()

  await expect
    .poll(async () => (await exportedDoc(page)).visuals[0].x)
    .toBe('{{n}}') // placeholder STRING exported, resolved at render
  await expect(xField.locator('input.num')).toHaveClass(/var-mode/)

  // a string variable in a number field: error state, document untouched
  const input = xField.locator('input.num')
  await input.fill('{{s}}')
  await input.press('Enter')
  await expect(input).toHaveClass(/invalid/)
  await expect.poll(() => store(page, 'editor', 'toast.kind')).toBe('error')
  expect(await store(page, 'editor', 'toast.message')).toContain('needs a number')
  expect((await exportedDoc(page)).visuals[0].x).toBe('{{n}}')

  // unknown variable: same strict rejection
  await input.fill('{{nope}}')
  await input.press('Enter')
  await expect(input).toHaveClass(/invalid/)
  expect((await exportedDoc(page)).visuals[0].x).toBe('{{n}}')
})

test('element condition: chip tracks the var, falsy dims on stage, full preview drops it', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'TEXT', text: 'CondTarget' }],
    variables: { show: true },
  })
  const id = await selectVisual(page)
  await clickInspectorTab(page, 'Timing')
  const tpl = sec(page, 'Template')
  const cond = tpl.locator('.cond-row input.ctl')

  await cond.fill('{{show}}')
  await cond.blur()
  await expect(tpl.locator('.state-chip')).toHaveText('on')
  expect((await exportedDoc(page)).visuals[0].condition).toBe('{{show}}')

  const item = page.locator(`.stage-item[data-item-id="${id}"]`)
  await expect(item).toHaveCSS('opacity', '1')

  // flip the variable through the panel -> chip off, element dimmed (0.3)
  // but still present/selectable in the editing context
  await openPanel(page, 'Variables')
  await varRow(page, 'show').locator('.check input[type="checkbox"]').uncheck()
  await expect(tpl.locator('.state-chip')).toHaveText('off')
  await expect(item).toHaveCSS('opacity', '0.3')

  // the resolved full preview (what orch renders) prunes it entirely
  expect(
    await page.evaluate(
      () => (window as any).__zvidTest.project.resolvedPreviewDoc.visuals.length
    )
  ).toBe(0)
  // the raw document still owns the element
  expect((await exportedDoc(page)).visuals).toHaveLength(1)
})

test('scene condition + iterate: xN badge, preview expands per item, duration multiplies', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    duration: 5,
    scenes: [
      {
        id: 'slide',
        duration: 2,
        visuals: [{ type: 'TEXT', text: '{{item.caption}}', exitEnd: 2 }],
      },
      { id: 'end', duration: 2, visuals: [{ type: 'TEXT', text: 'END', exitEnd: 2 }] },
    ],
    variables: { slides: [{ caption: 'A' }, { caption: 'B' }, { caption: 'C' }], showEnd: true },
  })
  await openPanel(page, 'Scenes')

  // iterate: bind the slide scene to the array variable
  await sceneCards(page).nth(0).click()
  const settings = page.locator('.rail-panel .scene-settings')
  await field(settings, 'Repeat for each item (iterate)')
    .locator('select')
    .selectOption('slides')
  await expect(field(settings, 'Item alias').locator('input.ctl')).toHaveValue('item')
  await expect(settings).toContainText('Renders as 3 scenes')

  const doc1 = await exportedDoc(page)
  expect(doc1.scenes[0].iterate).toBe('slides')
  expect(doc1.scenes[0].iterateAs).toBeUndefined() // 'item' default not written

  // the source card badges xN; the panel still lists the 2 source scenes
  await expect(sceneCards(page).nth(0).locator('.tpl-badge.iterate')).toHaveText('×3')
  await expect(sceneCards(page)).toHaveCount(2)

  // scene condition on the last scene
  await sceneCards(page).nth(1).click()
  const cond = settings.locator('.cond-row input.ctl')
  await cond.fill('{{showEnd}}')
  await cond.blur()
  await expect(settings.locator('.state-chip')).toHaveText('on')
  await expect(sceneCards(page).nth(1).locator('.tpl-badge.cond-on')).toHaveText('if ✓')
  expect((await exportedDoc(page)).scenes[1].condition).toBe('{{showEnd}}')

  // full-movie preview expands iterate: 3 slide clones + end = 4 planned
  // scenes, total 4×2 = 8s (> project 5s)
  await page.locator('.rail-panel .scene-card.global').click()
  await expect(page.locator('.scene-block')).toHaveCount(4)
  await expect(page.locator('.tl-panel .time-total')).toHaveText('/ 0:08.00')
  expect(
    await page.evaluate(() => {
      const t = (window as any).__zvidTest
      return t.project.resolvedPreviewDoc.scenes.map((s: any) => s.id)
    })
  ).toEqual(['slide-0', 'slide-1', 'slide-2', 'end'])
  // the first clone previews the first item on stage
  await expect(page.locator('.scene-group', { hasText: 'A' }).first()).toBeVisible()

  // flip the condition default -> 'end' drops from the resolved preview and
  // the total shrinks to 3×2 = 6s
  await page.evaluate(() =>
    (window as any).__zvidTest.project.setVariable('showEnd', false)
  )
  await expect(page.locator('.scene-block')).toHaveCount(3)
  await expect(page.locator('.tl-panel .time-total')).toHaveText('/ 0:06.00')
  await expect(sceneCards(page).nth(1).locator('.tpl-badge.cond-off')).toHaveText('if ✗')
  expect(
    await page.evaluate(
      () => (window as any).__zvidTest.project.resolvedPreviewDoc.scenes.length
    )
  ).toBe(3)
  // the raw document keeps both scenes
  expect((await exportedDoc(page)).scenes).toHaveLength(2)
})

test('strict template validation: invalid/unknown expressions are rejected, not committed', async ({
  page,
}) => {
  await loadProject(page, {
    ...BASE,
    scenes: [
      { id: 'a', duration: 2, visuals: [] },
      { id: 'b', duration: 2, visuals: [] },
    ],
    variables: { arr: [1, 2] },
  })
  await openPanel(page, 'Scenes')
  await sceneCards(page).nth(0).click()
  const settings = page.locator('.rail-panel .scene-settings')
  const cond = settings.locator('.cond-row input.ctl')

  // unsupported expression syntax -> error toast, input reverts, no commit
  await cond.fill('{{a b}}')
  await cond.blur()
  await expect.poll(() => store(page, 'editor', 'toast.kind')).toBe('error')
  expect(await store(page, 'editor', 'toast.message')).toContain('Unsupported expression')
  await expect(cond).toHaveValue('')
  expect((await exportedDoc(page)).scenes[0].condition).toBeUndefined()

  // unknown variable -> same strict rejection
  await cond.fill('{{nope}}')
  await cond.blur()
  await expect
    .poll(() => store(page, 'editor', 'toast.message'))
    .toContain('is not defined')
  await expect(cond).toHaveValue('')
  expect((await exportedDoc(page)).scenes[0].condition).toBeUndefined()

  // bugfix 2026-07-09: an unclosed '{{arr' is rejected by
  // validateTemplateValue instead of committing as a literal string
  await cond.fill('{{arr')
  await cond.blur()
  await expect
    .poll(() => store(page, 'editor', 'toast.message'))
    .toContain('Unclosed {{ placeholder')
  await expect(cond).toHaveValue('')
  expect((await exportedDoc(page)).scenes[0].condition).toBeUndefined()
})
