import { test, expect, type Page } from '@playwright/test'
import {
  openEditor,
  exportedDoc,
  loadProject,
  resetMockOrch,
  mockOrchCalls,
  store,
  waitBridge,
  fx,
} from './helpers/app'
import { compileDesign } from '../../utils/designer/compile'
import { normalizeDesign } from '../../utils/designer/types'

/**
 * Content galleries + Design Studio + cloud render.
 *
 * Coverage:
 *  - ExamplesModal: category sections (meta.pack → data/exampleCategories),
 *    word-boundary search, chips, Video/Image mode, PRO lock, project load
 *  - ShapePanel ("shapes" kind), CanvasPanel ("canvas-presets" kind)
 *  - DesignerModal: layers, inspector edits, anim preset, insert/re-edit
 *    round-trip via the `designer` field, template gallery ("design-templates")
 *  - RenderModal: sign-in gate, Socket.IO happy path (mock orch /frontend),
 *    ack + task failures, image format options, validation gate
 *
 * Library lists are memoized per page session (useLibrary listCache), so the
 * mock is ALWAYS seeded before openEditor(). Every test reseeds in full —
 * other suites (and a sibling agent) mutate the same mock orch.
 */

/* ------------------------------------------------------------------ */
/* seed data                                                           */
/* ------------------------------------------------------------------ */

const SVG_SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#5b8cff"/></svg>'
const SVG_CIRCLE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#22c55e"/></svg>'
const SVG_BADGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><ellipse cx="60" cy="30" rx="58" ry="28" fill="#f59e0b"/></svg>'

const CANVAS_JS = 'const ctx = canvas.getContext("2d"); ctx.fillStyle = "#f0f";'

const lib = (kind: string, slug: string, title: string, meta: Record<string, any> | null, extra: Record<string, any> = {}) => ({
  kind,
  slug,
  title,
  description: null,
  meta,
  version: 1,
  sortOrder: 0,
  contentUrl: '',
  ...extra,
})

/**
 * Examples: 5 video items across 3 known packs + the Other bucket, 1 image
 * item. Titles are chosen so the search-rule assertions can't collide with
 * category keyword synonyms (exampleCategories.ts).
 */
const LIBRARY = {
  examples: [
    lib('examples', 'ex-fin-growth', 'Crypto Growth Report', { pack: 'finance', resolution: '1080×1920', duration: 8 }),
    lib('examples', 'ex-fin-pulse', 'Market Pulse', { pack: 'finance', premium: true, duration: 6 }),
    lib('examples', 'ex-shop-drop', 'Sneaker Drop Promo', { pack: 'ecommerce', duration: 12 }),
    lib('examples', 'ex-saas-launch', 'Feature Launch Teaser', { pack: 'saas', duration: 9 }),
    lib('examples', 'ex-classic-starter', 'Classic Starter', {}), // no pack → Other
    lib('examples', 'ex-img-cover', 'Podcast Cover Art', { pack: 'thumbnail', type: 'image', format: 'png', size: '1280×720' }),
  ],
  shapes: [
    lib('shapes', 'core-square', 'Square', { svg: SVG_SQUARE, width: 100, height: 100 }),
    lib('shapes', 'core-circle', 'Circle', { svg: SVG_CIRCLE, width: 100, height: 100 }),
    lib('shapes', 'promo-badge', 'Sale Badge', { svg: SVG_BADGE, width: 120, height: 60 }),
  ],
  'canvas-presets': [
    lib('canvas-presets', 'cv-confetti', 'Confetti Burst', {}),
    lib('canvas-presets', 'cv-waves', 'Wave Field', {}),
  ],
  'design-templates': [lib('design-templates', 'dt-hero', 'Hero Title', {})],
}

const LIBRARY_CONTENT = {
  'examples/ex-fin-growth': {
    name: 'seeded-example',
    duration: 4,
    visuals: [{ type: 'TEXT', text: 'seeded text', position: 'center-center' }],
  },
  'canvas-presets/cv-confetti': { js: CANVAS_JS, animationDuration: 3 },
  'canvas-presets/cv-waves': { js: '/* waves */', animationDuration: 6 },
  // stored template content carries no layer ids — normalizeDesign assigns them
  'design-templates/dt-hero': {
    version: 1,
    width: 800,
    height: 450,
    fontFamily: 'Inter',
    duration: 'auto',
    background: { kind: 'solid', color: '#112233' },
    layers: [
      { kind: 'text', text: 'From template', fontSize: 90 },
      { kind: 'shape', shape: 'circle', width: 200, height: 200 },
    ],
  },
}

/** Reset the mock orch to this suite's seed (+ per-test overrides). */
function seed(overrides: Record<string, unknown> = {}) {
  return resetMockOrch({ library: LIBRARY, libraryContent: LIBRARY_CONTENT, ...overrides })
}

async function openExamples(page: Page) {
  // re-seed right before the fetch fires — a sibling suite may have reset the
  // mock between openEditor() and now (the list memoizes only after this load)
  await seed()
  await page.getByRole('button', { name: 'Examples' }).click()
  await expect(page.locator('.modal-backdrop')).toBeVisible()
  // .ex-tools only renders once the list request resolved
  await expect(page.locator('.ex-tools')).toBeVisible()
}

async function openRenderModal(page: Page) {
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('.modal-backdrop')).toBeVisible()
}

/* ------------------------------------------------------------------ */
/* 1. Examples modal                                                   */
/* ------------------------------------------------------------------ */

test('Examples modal groups items into category sections with counts', async ({ page }) => {
  await seed()
  await openEditor(page)
  await openExamples(page)

  // mode pill counts: 5 video / 1 image (meta.type 'image' splits the library)
  const modeBtns = page.locator('.ex-mode-btn')
  await expect(modeBtns.nth(0)).toHaveClass(/active/)
  await expect(modeBtns.nth(0).locator('.ex-mode-n')).toHaveText('5')
  await expect(modeBtns.nth(1).locator('.ex-mode-n')).toHaveText('1')

  // sections appear in exampleCategories.ts order, unknown/missing pack → Other
  await expect(page.locator('.cat-title')).toHaveText([
    /E-commerce\s*1/,
    /SaaS \/ dev tools\s*1/,
    /Finance \/ crypto\s*2/,
    /Other\s*1/,
  ])
  await expect(page.locator('.card')).toHaveCount(5)
  await expect(page.locator('.ex-count')).toHaveText('5 / 5')

  // chip row: All + one chip per non-empty category, with match counts
  await expect(page.locator('.ex-cat')).toHaveCount(5)
  await expect(page.locator('.ex-cat', { hasText: 'Finance / crypto' }).locator('.ex-cat-n')).toHaveText('2')

  await page.click('.modal-backdrop button[aria-label="Close"]')
})

test('Examples search matches word-boundary prefixes (AND across terms); chips filter and recover', async ({ page }) => {
  await seed()
  await openEditor(page)
  await openExamples(page)
  const cards = page.locator('.card')
  const search = page.locator('.ex-search')

  // The rule (ExamplesModal matchesQuery): each term compiles to a regex
  // anchored with a LEADING \b only — so terms match word PREFIXES.
  // "row" must NOT match mid-word in "Growth" …
  await search.fill('row')
  await expect(cards).toHaveCount(0)
  await expect(page.locator('.empty-note')).toContainText('No examples match your search')
  await expect(page.locator('.ex-count')).toHaveText('0 / 5')
  // … but the prefix "grow" DOES match "Growth" at its word boundary
  await search.fill('grow')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Crypto Growth Report')
  // prefix (not whole-word) semantics: "class" finds "Classic Starter"
  await search.fill('class')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Classic Starter')

  // category keyword synonyms are part of the haystack: "crypto" is a
  // finance keyword, so BOTH finance items match even without it in a title
  await search.fill('crypto')
  await expect(cards).toHaveCount(2)
  await expect(page.locator('.cat-title')).toHaveText([/Finance \/ crypto\s*2/])
  // chips show live match counts; empty ones disable
  await expect(page.locator('.ex-cat', { hasText: 'E-commerce' })).toBeDisabled()

  // AND semantics: every term must match
  await search.fill('crypto pulse')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Market Pulse')

  // category chip narrows to a single section
  await search.fill('')
  await page.locator('.ex-cat', { hasText: 'Finance / crypto' }).click()
  await expect(page.locator('.cat-section')).toHaveCount(1)
  await expect(cards).toHaveCount(2)

  // search hits only outside the active chip → recovery link resets the chip
  await search.fill('sneaker')
  await expect(cards).toHaveCount(0)
  await expect(page.locator('.empty-note')).toContainText('Found 1 in other categories')
  await page.locator('.link-btn', { hasText: 'show all matches' }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Sneaker Drop Promo')
})

test('Examples Video/Image toggle filters by meta.type', async ({ page }) => {
  await seed()
  await openEditor(page)
  await openExamples(page)

  await page.locator('.ex-mode-btn', { hasText: 'Images' }).click()
  await expect(page.locator('.card')).toHaveCount(1)
  await expect(page.locator('.card').first()).toContainText('Podcast Cover Art')
  await expect(page.locator('.cat-title')).toHaveText([/Video thumbnails\s*1/])
  // image cards badge their format instead of a duration
  await expect(page.locator('.card .shot-badge')).toHaveText('PNG')
  await expect(page.locator('.ex-count')).toHaveText('1 / 1')

  await page.locator('.ex-mode-btn', { hasText: 'Videos' }).click()
  await expect(page.locator('.card')).toHaveCount(5)
})

test('premium example is PRO-locked for a logged-out user and clicking it opens sign-in', async ({ page }) => {
  await seed()
  await openEditor(page) // not authed → auth.user null → meta.premium locks
  await openExamples(page)

  await expect(page.locator('.pro-chip')).toBeVisible() // upgrade hint in the intro
  const locked = page.locator('.card.locked')
  await expect(locked).toHaveCount(1)
  await expect(locked).toContainText('Market Pulse')
  await expect(locked.locator('.pro-badge')).toContainText('PRO')

  await locked.click()
  // examples modal swaps for the auth modal, remembering where to return
  await expect.poll(() => store(page, 'editor', 'modal')).toBe('auth')
  expect(await store(page, 'editor', 'postAuthModal')).toBe('examples')
  await expect(page.locator('.modal-backdrop')).toBeVisible()
})

test('clicking a free example loads its project JSON into the editor', async ({ page }) => {
  await seed()
  await openEditor(page)
  await openExamples(page)

  await page.locator('.card', { hasText: 'Crypto Growth Report' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Example loaded')

  const doc = await exportedDoc(page)
  expect(doc.name).toBe('seeded-example')
  expect(doc.duration).toBe(4)
  expect(doc.visuals).toHaveLength(1)
  expect(doc.visuals[0]).toMatchObject({ type: 'TEXT', text: 'seeded text' })
})

/* ------------------------------------------------------------------ */
/* 2. Shape panel                                                      */
/* ------------------------------------------------------------------ */

test('Shape panel renders the grid, filters by chip and server-side search, and adds an SVG visual', async ({ page }) => {
  await seed()
  await openEditor(page)
  await seed() // guard against a foreign mock reset before the panel fetches
  await page.click('.rail-tab[title="Shape"]')

  // tiles come from meta.svg in the list response — no per-item content fetch
  const cards = page.locator('.shape-card')
  await expect(cards).toHaveCount(3)
  await expect(page.locator('.shape-card .shape-preview svg')).toHaveCount(3)
  await expect(page.locator('.shape-panel .status')).toContainText('All 3 shapes loaded')

  // category chips AND a slug-prefix token into the server q (core-*)
  await page.locator('.shape-cat', { hasText: 'Basic' }).click()
  await expect(cards).toHaveCount(2)
  await page.locator('.shape-cat', { hasText: /^All$/ }).click()
  await expect(cards).toHaveCount(3)

  // debounced search goes to the server as ?q=
  await page.fill('.shape-search', 'badge')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Sale Badge')
  const calls = await mockOrchCalls()
  expect(
    calls.some((c) => c.path === '/api/library/shapes' && c.query?.q === 'badge')
  ).toBe(true)

  // clicking a tile adds the SVG to the document
  await cards.first().click()
  await expect(page.locator('.toast')).toContainText('Shape added')
  const doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(1)
  expect(doc.visuals[0]).toMatchObject({
    type: 'SVG',
    svg: SVG_BADGE,
    width: 120,
    height: 60,
    position: 'center-center',
    exitEnd: 5,
  })
})

/* ------------------------------------------------------------------ */
/* 3. Canvas panel                                                     */
/* ------------------------------------------------------------------ */

test('Canvas panel lists presets and adds a full-frame TEXT visual with the preset customCode', async ({ page }) => {
  await seed()
  await openEditor(page)
  await seed() // guard against a foreign mock reset before the panel fetches
  await page.click('.rail-tab[title="Canvas"]')

  const tiles = page.locator('.canvas-tile')
  await expect(tiles).toHaveCount(2)
  await expect(page.locator('.canvas-panel .status')).toContainText('All 2 presets loaded')

  await page.locator('.canvas-tile', { hasText: 'Confetti Burst' }).click()
  await expect(page.locator('.toast')).toContainText('Confetti Burst canvas added')

  const defW = await store(page, 'project', 'defaults.width')
  const defH = await store(page, 'project', 'defaults.height')
  const doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(1)
  const v = doc.visuals[0]
  expect(v.type).toBe('TEXT')
  // addCanvasPreset: project-sized <canvas> host + the preset JS as customCode
  expect(v.html).toContain(`<canvas width="${defW}" height="${defH}"`)
  expect(v.width).toBe(defW)
  expect(v.height).toBe(defH)
  expect(v.customCode).toMatchObject({ js: CANVAS_JS, animationDuration: 3 })
})

/* ------------------------------------------------------------------ */
/* 4. Design Studio                                                    */
/* ------------------------------------------------------------------ */

test('Design Studio: build layers, edit text, pick an animation, insert, and re-edit the element', async ({ page }) => {
  await seed()
  await openEditor(page)
  await page.click('.rail-tab[title="Design"]')
  await page.click('.design-panel .hero') // "New design"
  await expect(page.locator('.modal-backdrop')).toBeVisible()

  // a blank design seeds one starter text layer
  const rows = page.locator('.layers .row')
  await expect(rows).toHaveCount(1)

  await page.click('button[title="Add a text layer"]')
  await page.click('button[title="Add a shape / icon layer"]')
  await expect(rows).toHaveCount(3)

  // select the new text layer and edit its content in the Inspector
  // (click the label — hovering a row reveals its .row-actions icon buttons,
  // which would swallow a center-point click)
  await rows.filter({ hasText: 'New text' }).locator('.row-label').click()
  await page.fill('.inspector-body textarea', 'Hello E2E')
  await expect(rows.filter({ hasText: 'Hello E2E' })).toHaveCount(1)

  // pick an animation preset from the gallery (title = preset label)
  await page.click('.ap-cell[title="Rise"]')
  await expect(rows.filter({ hasText: 'Hello E2E' }).locator('.anim-dot')).toBeVisible()

  await page.getByRole('button', { name: 'Insert element' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)

  const doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(1)
  const v = doc.visuals[0]
  expect(v.type).toBe('TEXT')
  expect(v.width).toBe(800) // designer canvas defaults
  expect(v.height).toBe(450)
  expect(v.style).toMatchObject({ fontFamily: 'Poppins' })
  // round-trip field: the full DesignDoc rides along on the item
  expect(v.designer.layers).toHaveLength(3)
  const textLayer = v.designer.layers.find((l: any) => l.text === 'Hello E2E')
  expect(textLayer?.anim?.preset).toBe('rise')
  // compiled output equals what utils/designer/compile.ts produces for the
  // exact designer doc that round-tripped through export
  const recompiled = compileDesign(normalizeDesign(v.designer))
  expect(v.html).toBe(recompiled.html)
  expect(v.customCode.css).toBe(recompiled.css)
  expect(v.customCode.animationDuration).toBe(recompiled.duration)
  expect(recompiled.duration).toBeGreaterThan(0)
  expect(v.html).toContain('class="dz"')

  // re-open on the inserted element: layers restore from the designer field
  await expect(page.locator('.design-panel .edit-selected')).toBeVisible()
  await page.click('.design-panel .edit-selected')
  await expect(page.getByText('Design Studio — edit element')).toBeVisible()
  await expect(page.locator('.layers .row')).toHaveCount(3)
  await expect(
    page.locator('.layers .row').filter({ hasText: 'Hello E2E' }).locator('.anim-dot')
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
})

test('Design Studio template gallery lists the library kind and applying one seeds layers', async ({ page }) => {
  await seed()
  await openEditor(page)
  await page.click('.rail-tab[title="Design"]')
  await page.click('.design-panel .hero')
  await expect(page.locator('.modal-backdrop')).toBeVisible()

  await seed() // guard against a foreign mock reset before the gallery fetches
  await page.getByRole('button', { name: /Templates/ }).click()
  const card = page.locator('.tpl-card', { hasText: 'Hero Title' })
  await expect(card).toBeVisible()
  await expect(page.locator('.tpl-menu')).toContainText('All 1 templates loaded')

  await card.click()
  const rows = page.locator('.layers .row')
  await expect(rows).toHaveCount(2) // starter layer replaced by template layers
  await expect(rows.filter({ hasText: 'From template' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Insert element' }).click()
  const doc = await exportedDoc(page)
  const v = doc.visuals[0]
  expect(v.style).toMatchObject({ fontFamily: 'Inter' }) // from template doc
  expect(v.html).toContain('From template') // no anim → unsplit text
  expect(v.designer.layers.map((l: any) => l.kind)).toEqual(['text', 'shape'])
})

/* ------------------------------------------------------------------ */
/* 5–7. Render modal                                                   */
/* ------------------------------------------------------------------ */

test('Render modal gates logged-out users behind sign-in', async ({ page }) => {
  await seed()
  await openEditor(page)
  await waitBridge(page, 't.auth.loaded === true')
  await openRenderModal(page)

  await expect(page.locator('.modal-backdrop')).toContainText('Sign in to render')
  await page.getByRole('button', { name: 'Sign in to render' }).click()
  await expect.poll(() => store(page, 'editor', 'modal')).toBe('auth')
  expect(await store(page, 'editor', 'postAuthModal')).toBe('render')
})

test('render happy path: queued → rendering → progress % → downloadable result', async ({ page }) => {
  await seed({ renderMode: 'progress', renderResultUrl: fx('clip.mp4') })
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded === true && !!t.auth.user')
  await page.evaluate(() =>
    (window as any).__zvidTest.project.addVisual('root', {
      type: 'TEXT',
      text: 'render me',
      position: 'center-center',
    })
  )

  await openRenderModal(page)
  await expect(page.getByRole('button', { name: /Start render/ })).toBeVisible()
  // re-assert the render mode right before submitting (foreign-reset guard)
  await seed({ renderMode: 'progress', renderResultUrl: fx('clip.mp4') })

  // the mock advances 0→30→75→complete within ~350ms — record every DOM
  // state via MutationObserver so no intermediate step can be missed
  await page.evaluate(() => {
    const w = window as any
    w.__renderSnaps = []
    const rec = () => {
      const backdrop = document.querySelector('.modal-backdrop')
      w.__renderSnaps.push({
        label: document.querySelector('.progress-label')?.textContent?.trim() ?? '',
        text: backdrop?.textContent ?? '',
      })
    }
    rec()
    w.__renderMO = new MutationObserver(rec)
    w.__renderMO.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  })

  await page.getByRole('button', { name: /Start render/ }).click()

  // done state: replayable result + download link pointing at the result url
  const video = page.locator('video.result')
  await expect(video).toBeVisible()
  await expect(video).toHaveAttribute('src', fx('clip.mp4'))
  const download = page.locator('a[download]')
  await expect(download).toHaveAttribute('href', fx('clip.mp4'))
  await expect(page.getByRole('button', { name: 'Render again' })).toBeVisible()

  const snaps: { label: string; text: string }[] = await page.evaluate(() => {
    ;(window as any).__renderMO?.disconnect()
    return (window as any).__renderSnaps
  })
  const labels = snaps.map((s) => s.label)
  expect(snaps.some((s) => /Queued/.test(s.text))).toBe(true) // post-ack queued state
  expect(snaps.some((s) => /Rendering in the cloud/.test(s.text))).toBe(true) // taskAssigned
  expect(labels).toContain('30%') // taskProgress events
  expect(labels).toContain('75%')
})

test('render ack failure shows a recoverable validation-style error', async ({ page }) => {
  await seed({ renderMode: 'fail-ack' })
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded === true && !!t.auth.user')
  await openRenderModal(page)
  // re-assert the render mode right before submitting (foreign-reset guard)
  await seed({ renderMode: 'fail-ack' })

  await page.getByRole('button', { name: /Start render/ }).click()
  const err = page.locator('.modal-backdrop .err-block')
  await expect(err).toBeVisible()
  await expect(err).toContainText('Render failed')
  await expect(err).toContainText('Mock rejected the payload')

  // recoverable: Try again returns to the idle submit state, modal stays open
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('button', { name: /Start render/ })).toBeVisible()
  await expect(page.locator('.modal-backdrop')).toBeVisible()
})

test('render task failure surfaces the task error message', async ({ page }) => {
  await seed({ renderMode: 'fail-task' })
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded === true && !!t.auth.user')
  await openRenderModal(page)
  // re-assert the render mode right before submitting (foreign-reset guard)
  await seed({ renderMode: 'fail-task' })

  await page.getByRole('button', { name: /Start render/ }).click()
  const err = page.locator('.modal-backdrop .err-block')
  await expect(err).toBeVisible()
  await expect(err).toContainText('Render failed')
  await expect(err).toContainText('Mock render exploded')
})

/* ------------------------------------------------------------------ */
/* 8. Image project render options                                     */
/* ------------------------------------------------------------------ */

test('image project render options prune quality/transparency per format', async ({ page }) => {
  await seed()
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded === true && !!t.auth.user')
  await loadProject(page, {
    type: 'image',
    name: 'img-e2e',
    outputFormat: 'png',
    width: 800,
    height: 800,
    visuals: [{ type: 'TEXT', text: 'hello-img', position: 'center-center' }],
  })

  await openRenderModal(page)
  await expect(page.locator('.modal-backdrop')).toContainText('Render image')
  const format = page.locator('.img-opts select')
  const quality = page.locator('.img-opts input[type="range"]')
  const transparent = page.locator('.img-opts input[type="checkbox"]')

  // png: lossless → quality disabled, alpha supported
  await expect(format).toHaveValue('png')
  expect(await format.locator('option').allTextContents()).toEqual(['png', 'jpg', 'webp'])
  await expect(quality).toBeDisabled()
  await expect(transparent).toBeEnabled()
  await transparent.check()
  expect(await store(page, 'project', 'doc.transparent')).toBe(true)

  // jpg: no alpha channel → transparent pruned + disabled, quality unlocked
  await format.selectOption('jpg')
  expect(await store(page, 'project', 'doc.transparent')).toBeUndefined()
  await expect(transparent).toBeDisabled()
  await expect(quality).toBeEnabled()
  await quality.evaluate((el) => {
    ;(el as HTMLInputElement).value = '70'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(await store(page, 'project', 'doc.quality')).toBe(70)
  await expect(page.locator('.modal-backdrop')).toContainText('img-e2e.jpg')

  // back to png: quality pruned (orch rejects it), alpha re-enabled
  await format.selectOption('png')
  expect(await store(page, 'project', 'doc.quality')).toBeUndefined()
  await expect(transparent).toBeEnabled()
  expect((await exportedDoc(page)).outputFormat).toBe('png')
})

/* ------------------------------------------------------------------ */
/* 9. Validation gate                                                  */
/* ------------------------------------------------------------------ */

test('a document with validation errors blocks the render and lists the issues', async ({ page }) => {
  await seed()
  await openEditor(page)
  // 'gif' is not in SUPPORTED_FORMATS → validateProjectDoc error
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ outputFormat: 'gif' })
  )

  await openRenderModal(page)
  const err = page.locator('.modal-backdrop .err-block')
  await expect(err).toContainText('validation error(s) must be fixed first')
  await expect(err).toContainText('outputFormat')
  await expect(err).toContainText('Unsupported format "gif"')
  // no submit path while invalid — not even the sign-in gate renders
  await expect(page.getByRole('button', { name: /Start render/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in to render' })).toHaveCount(0)
  await page.click('.modal-backdrop button[aria-label="Close"]')
})
