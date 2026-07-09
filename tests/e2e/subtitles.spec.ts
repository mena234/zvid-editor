import { test, expect, type Page, type Locator } from '@playwright/test'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  openEditor,
  exportedDoc,
  loadProject,
  store,
  fx,
  resetMockOrch,
} from './helpers/app'
// Pure shared modules (no app runtime) — the same code the editor runs, so
// expected word/chunk timings are computed with identical rounding.
import { distributeWords, chunkCaptions } from '../../shared/schema/subtitle'
import { SUBTITLE_MODES } from '../../shared/schema/constants'

/**
 * Subtitle editor end-to-end: SubtitlesPanel CRUD + import, the word grid
 * (retime/split/merge), max-words chunking, the style section → v2 wire
 * export, the stage overlay preview (DOM word-span fallback) and the
 * timeline caption lane.
 *
 * NETWORK: the native jassub/ASS preview path would fetch fonts through
 * /api/fonts (external). Every test aborts the jassub module request so the
 * overlay deterministically uses its DOM word-span fallback and no external
 * font traffic ever happens.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

/* ---------------- spec-local helpers ---------------- */

function baseDoc(subtitle?: Record<string, any>) {
  const doc: Record<string, any> = {
    name: 'subtitles-spec',
    resolution: 'full-hd',
    duration: 10,
    frameRate: 30,
    backgroundColor: '#101319',
    outputFormat: 'mp4',
    visuals: [],
    audios: [],
  }
  if (subtitle) doc.subtitle = subtitle
  return doc
}

/** Whisper-fixture word timings (also used to seed deterministic captions). */
const W3 = [
  { start: 0.2, end: 0.6, text: 'Hello' },
  { start: 0.6, end: 1, text: 'fixture' },
  { start: 1, end: 1.4, text: 'world' },
]
const CAP3 = { start: 0.2, end: 1.4, text: 'Hello fixture world', words: W3 }

/** Normalize exported captions to comparable {start,end,text,words}. */
function pickCaps(caps: any[]) {
  return (caps ?? []).map((c: any) => ({
    start: c.start,
    end: c.end,
    text: c.text,
    words: (c.words ?? []).map((w: any) => ({ start: w.start, end: w.end, text: w.text })),
  }))
}

async function openSubs(page: Page) {
  await page.click('.rail-tab[title="Subtitles"]')
  await expect(page.locator('.subs-panel')).toBeVisible()
}

/**
 * Expand the collapsible "Subtitle style" section. It starts CLOSED: UiSection
 * does `startOpen ?? true`, but Vue casts the absent boolean prop to false.
 */
async function openStyleSection(page: Page) {
  const head = page.locator('.subs-panel .sec-head.as-btn', {
    hasText: 'Subtitle style',
  })
  await head.click()
  await expect(field(page, 'Mode').locator('select')).toBeVisible()
}

/** A UiField in the subtitles panel by its exact label. */
function field(page: Page, label: string): Locator {
  return page.locator(`.subs-panel .field:has(.field-label:text-is("${label}"))`)
}

/** Commit a UiNumberInput ('' clears when the field is clearable). */
async function setNum(page: Page, label: string, value: string) {
  const input = field(page, label).locator('input.num')
  await input.fill(value)
  await input.press('Enter')
}

/** Commit a UiColorInput's text input ('' clears). */
async function setColor(page: Page, label: string, value: string) {
  const input = field(page, label).locator('input.text')
  await input.fill(value)
  await input.blur()
}

async function setPlayhead(page: Page, t: number) {
  await page.evaluate((v) => {
    const ed = (window as any).__zvidTest.editor
    ed.playing = false
    ed.playhead = v
  }, t)
}

/** Select a caption row in the panel and wait for its editing section. */
async function selectCaption(page: Page, i: number) {
  await page.locator('.cap-list .cap-row').nth(i).click()
  await expect(
    page.locator('.subs-panel .sec-head', { hasText: `Caption ${i + 1}` })
  ).toBeVisible()
}

async function exportedSubtitle(page: Page) {
  return (await exportedDoc(page)).subtitle
}

const badge = (page: Page) => page.locator('.rail-tab[title="Subtitles"] .count')
const OVERLAY = '.subtitle-overlay:not(.ass-layer)'

async function dragBy(page: Page, loc: Locator, dx: number) {
  const b = (await loc.boundingBox())!
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx / 2, cy, { steps: 2 })
  await page.mouse.move(cx + dx, cy, { steps: 2 })
  await page.mouse.up()
}

test.beforeAll(async () => {
  await resetMockOrch()
})

test.beforeEach(async ({ page }) => {
  // Force the DOM word-span fallback: abort the jassub module so the native
  // ASS preview (which fetches fonts via /api/fonts) can never initialize.
  await page.route('**/*jassub*', (route) => route.abort())
  await openEditor(page)
})

/* ---------------- 1. panel basics ---------------- */

test('add caption creates a selected caption and updates the rail badge', async ({
  page,
}) => {
  await openSubs(page)
  await expect(badge(page)).toHaveCount(0)

  await page.click('.subs-panel button:has-text("Add caption at playhead")')

  await expect(page.locator('.cap-list .cap-row')).toHaveCount(1)
  await expect(page.locator('.cap-list .cap-row').first()).toHaveClass(/active/)
  expect(await store(page, 'editor', 'selectionKind')).toBe('caption')
  expect(await store(page, 'editor', 'selectedCaptionIndex')).toBe(0)
  await expect(badge(page)).toHaveText('1')

  // playhead was 0 → caption 0..2s, words distributed like the app does
  const sub = await exportedSubtitle(page)
  expect(pickCaps(sub.captions)).toEqual([
    {
      start: 0,
      end: 2,
      text: 'New caption',
      words: distributeWords('New caption', 0, 2),
    },
  ])
  // word grid shows the two distributed words
  await expect(page.locator('.word-grid input.w-text')).toHaveCount(2)
})

test('edits caption start, end and text (text redistributes words)', async ({
  page,
}) => {
  await loadProject(
    page,
    baseDoc({
      captions: [{ start: 1, end: 2, text: 'Old text', words: distributeWords('Old text', 1, 2) }],
    })
  )
  await openSubs(page)
  await selectCaption(page, 0)

  await setNum(page, 'Start', '0.5')
  await setNum(page, 'End', '3')
  await expect
    .poll(async () => (await exportedSubtitle(page)).captions[0].start)
    .toBe(0.5)
  expect((await exportedSubtitle(page)).captions[0].end).toBe(3)

  const ta = page.locator('.subs-panel textarea')
  await ta.fill('Alpha beta')
  await ta.blur()

  const cap = (await exportedSubtitle(page)).captions[0]
  expect(cap.text).toBe('Alpha beta')
  // words redistributed proportionally across the edited window
  expect(pickCaps([cap])[0].words).toEqual(distributeWords('Alpha beta', 0.5, 3))
})

test('deletes captions; empty subtitle is dropped from the export', async ({
  page,
}) => {
  await loadProject(
    page,
    baseDoc({
      captions: [
        CAP3,
        { start: 2, end: 3, text: 'Second one', words: distributeWords('Second one', 2, 3) },
      ],
    })
  )
  await openSubs(page)
  await expect(page.locator('.cap-list .cap-row')).toHaveCount(2)
  await expect(badge(page)).toHaveText('2')

  await page.locator('.cap-list .cap-row').nth(0).locator('.icon-btn').click()
  await expect(page.locator('.cap-list .cap-row')).toHaveCount(1)
  await expect(page.locator('.cap-list .cap-row')).toContainText('Second one')
  await expect(badge(page)).toHaveText('1')

  await page.locator('.cap-list .cap-row').nth(0).locator('.icon-btn').click()
  await expect(page.locator('.cap-list .cap-row')).toHaveCount(0)
  await expect(badge(page)).toHaveCount(0)
  // a subtitle without captions or src is dropped entirely
  expect((await exportedDoc(page)).subtitle).toBeUndefined()
})

/* ---------------- 2. import ---------------- */

test('imports subs.srt via the panel file input', async ({ page }) => {
  await openSubs(page)
  await page
    .locator('.subs-panel input[type="file"]')
    .setInputFiles(path.join(FIXTURES_DIR, 'subs.srt'))

  await expect(page.locator('.cap-list .cap-row')).toHaveCount(2)
  await expect(badge(page)).toHaveText('2')

  const sub = await exportedSubtitle(page)
  expect(pickCaps(sub.captions)).toEqual([
    {
      start: 0.2,
      end: 1.4,
      text: 'Hello fixture world',
      words: distributeWords('Hello fixture world', 0.2, 1.4),
    },
    {
      start: 1.6,
      end: 2.8,
      text: 'Second caption line',
      words: distributeWords('Second caption line', 1.6, 2.8),
    },
  ])
})

test('imports subs.vtt via the panel file input', async ({ page }) => {
  await openSubs(page)
  await page
    .locator('.subs-panel input[type="file"]')
    .setInputFiles(path.join(FIXTURES_DIR, 'subs.vtt'))

  await expect(page.locator('.cap-list .cap-row')).toHaveCount(2)
  const sub = await exportedSubtitle(page)
  expect(pickCaps(sub.captions).map((c) => [c.start, c.end, c.text])).toEqual([
    [0.2, 1.4, 'Hello fixture world'],
    [1.6, 2.8, 'Second caption line'],
  ])
})

test('imports whisper.json preserving the exact word timings', async ({ page }) => {
  await openSubs(page)
  await page
    .locator('.subs-panel input[type="file"]')
    .setInputFiles(path.join(FIXTURES_DIR, 'whisper.json'))

  await expect(page.locator('.cap-list .cap-row')).toHaveCount(1)
  const sub = await exportedSubtitle(page)
  expect(pickCaps(sub.captions)).toEqual([CAP3])
})

test('src URL: exports {src} only, "Load into editor" pulls the captions in', async ({
  page,
}) => {
  await loadProject(page, baseDoc({ src: fx('subs.srt') }))

  // v2 wire shape: a src-only subtitle exports just the URL
  expect(await exportedSubtitle(page)).toEqual({ src: fx('subs.srt') })

  await openSubs(page)
  await expect(page.locator('.src-note')).toBeVisible()
  await expect(page.locator('.src-note .src-url')).toHaveText(fx('subs.srt'))

  await page.click('.src-note button:has-text("Load into editor")')
  await expect(page.locator('.cap-list .cap-row')).toHaveCount(2)

  const sub = await exportedSubtitle(page)
  expect(sub.src).toBeUndefined()
  expect(pickCaps(sub.captions).map((c) => c.text)).toEqual([
    'Hello fixture world',
    'Second caption line',
  ])
})

/* ---------------- 3. word grid ---------------- */

test('word grid edits word text and timing', async ({ page }) => {
  await loadProject(page, baseDoc({ captions: [CAP3] }))
  await openSubs(page)
  await selectCaption(page, 0)
  await expect(page.locator('.word-grid input.w-text')).toHaveCount(3)

  // word rows are [text, start, end] — numeric inputs are 2 per word
  const nums = page.locator('.word-grid .num-wrap input.num')
  await nums.nth(2).fill('0.7') // word[1].start
  await nums.nth(2).press('Enter')
  await expect
    .poll(async () => (await exportedSubtitle(page)).captions[0].words[1].start)
    .toBe(0.7)

  const wText = page.locator('.word-grid input.w-text').nth(0)
  await wText.fill('Howdy')
  await wText.blur()
  const cap = (await exportedSubtitle(page)).captions[0]
  expect(cap.words[0].text).toBe('Howdy')
  // bugfix 2026-07-09: word edits rebuild the caption-level text so normal
  // mode and word-driven modes render the same content
  expect(cap.text).toBe('Howdy fixture world')
})

test('"even retime" redistributes word timings across the caption', async ({
  page,
}) => {
  // deliberately skewed words
  await loadProject(
    page,
    baseDoc({
      captions: [
        {
          start: 0.2,
          end: 1.4,
          text: 'Hello fixture world',
          words: [
            { start: 0.2, end: 0.3, text: 'Hello' },
            { start: 0.3, end: 0.35, text: 'fixture' },
            { start: 0.35, end: 1.4, text: 'world' },
          ],
        },
      ],
    })
  )
  await openSubs(page)
  await selectCaption(page, 0)

  await page.click('.word-head button:has-text("even retime")')

  const cap = (await exportedSubtitle(page)).captions[0]
  expect(pickCaps([cap])[0].words).toEqual(
    distributeWords('Hello fixture world', 0.2, 1.4)
  )
})

test('splits a caption at the word midpoint and merges it back', async ({
  page,
}) => {
  await loadProject(page, baseDoc({ captions: [CAP3] }))
  await openSubs(page)
  await selectCaption(page, 0)

  await page.click('.word-head button:has-text("split")')
  await expect(page.locator('.cap-list .cap-row')).toHaveCount(2)
  let caps = pickCaps((await exportedSubtitle(page)).captions)
  // mid = ceil(3/2) = 2 → left keeps 2 words, right starts at word[2].start
  expect(caps).toEqual([
    { start: 0.2, end: 1, text: 'Hello fixture', words: [W3[0], W3[1]] },
    { start: 1, end: 1.4, text: 'world', words: [W3[2]] },
  ])

  await page.click('.word-head button:has-text("merge ↓")')
  await expect(page.locator('.cap-list .cap-row')).toHaveCount(1)
  caps = pickCaps((await exportedSubtitle(page)).captions)
  expect(caps).toEqual([CAP3])
})

/* ---------------- 4. max words per line ---------------- */

test('max-words control re-chunks captions like chunkCaptions', async ({
  page,
}) => {
  const words = [
    { start: 0, end: 1, text: 'one' },
    { start: 1, end: 2, text: 'two' },
    { start: 2, end: 3, text: 'three' },
    { start: 3, end: 4, text: 'four' },
    { start: 4, end: 5, text: 'five' },
  ]
  const seed = { start: 0, end: 5, text: 'one two three four five', words }
  await loadProject(page, baseDoc({ captions: [seed] }))
  await openSubs(page)

  const input = field(page, 'Max words per line').locator('input.num')
  await input.fill('2')
  await input.press('Enter')
  await page.click('.max-words-row button:has-text("Split captions")')

  await expect(page.locator('.cap-list .cap-row')).toHaveCount(3)
  const got = pickCaps((await exportedSubtitle(page)).captions)
  // must match the shared chunkCaptions semantics exactly
  const want = pickCaps(chunkCaptions([JSON.parse(JSON.stringify(seed))], 2))
  expect(got).toEqual(want)
  expect(got.map((c) => [c.start, c.end, c.text])).toEqual([
    [0, 2, 'one two'],
    [2, 4, 'three four'],
    [4, 5, 'five'],
  ])
})

/* ---------------- 5. styles → v2 wire export ---------------- */

test('style controls: all modes listed, every style maps to the v2 export', async ({
  page,
}) => {
  await loadProject(page, baseDoc({ captions: [CAP3] }))
  await openSubs(page)
  await openStyleSection(page)

  const modeSel = field(page, 'Mode').locator('select')
  expect(await modeSel.locator('option').allTextContents()).toEqual([
    ...SUBTITLE_MODES,
  ])

  // slide exposes the direction picker; non-default direction is exported
  await modeSel.selectOption('slide')
  const dirSel = field(page, 'Slide direction').locator('select')
  await dirSel.selectOption('left')
  let sub = await exportedSubtitle(page)
  expect(sub.animation).toBe('slide')
  expect(sub.direction).toBe('left')
  await dirSel.selectOption('up') // default → dropped
  expect((await exportedSubtitle(page)).direction).toBeUndefined()

  await modeSel.selectOption('karaoke')
  await setNum(page, 'Font size (px)', '64')
  await setColor(page, 'Color', '#ffff00')
  await setColor(page, 'Active word color', '#ff0000')
  await field(page, 'Bold').locator('input[type="checkbox"]').check()
  await field(page, 'Italic').locator('input[type="checkbox"]').check()
  await setNum(page, 'Outline width', '3')
  await setColor(page, 'Outline color', '#112233')
  await setColor(page, 'Background', '#111111')
  await setNum(page, 'Box padding', '12')
  await field(page, 'Position').locator('select').selectOption('top-center')
  await setNum(page, 'Vertical margin', '30')
  await setNum(page, 'Horizontal margin', '20')
  await field(page, 'Text transform').locator('select').selectOption('uppercase')

  const { captions, ...styles } = await exportedSubtitle(page)
  expect(pickCaps(captions)).toEqual([CAP3]) // captions untouched by styling
  expect(styles).toEqual({
    animation: 'karaoke',
    font: {
      size: 64,
      color: '#ffff00',
      bold: true,
      italic: true,
      transform: 'uppercase',
    },
    stroke: { color: '#112233', width: 3 },
    background: { color: '#111111', padding: 12 },
    activeWord: { color: '#ff0000' },
    position: 'top', // 'top-center' collapses to the v2 shorthand
    margin: { x: 20, y: 30 },
  })
})

test('cleared/reset styles are omitted from the export', async ({ page }) => {
  await loadProject(page, baseDoc({ captions: [CAP3] }))
  await openSubs(page)
  await openStyleSection(page)

  await setNum(page, 'Font size (px)', '64')
  await setColor(page, 'Color', '#ffff00')
  await setColor(page, 'Background', '#111111')
  await setNum(page, 'Box padding', '12')
  await setNum(page, 'Vertical margin', '30')
  await field(page, 'Position').locator('select').selectOption('top-center')
  await field(page, 'Bold').locator('input[type="checkbox"]').check()
  await expect
    .poll(async () => Object.keys((await exportedSubtitle(page)) ?? {}).sort())
    .toEqual(['background', 'captions', 'font', 'margin', 'position'])

  // NOTE: possible bug/quirk — clearing Background hides the Box padding
  // field but keeps styles.backgroundPadding (exported as background.padding),
  // so padding must be cleared BEFORE the background color.
  await setNum(page, 'Box padding', '')
  await setColor(page, 'Background', '')
  await setNum(page, 'Font size (px)', '')
  await setColor(page, 'Color', '')
  await setNum(page, 'Vertical margin', '')
  await field(page, 'Position').locator('select').selectOption('bottom-center')
  await field(page, 'Bold').locator('input[type="checkbox"]').uncheck()

  await expect
    .poll(async () => Object.keys((await exportedSubtitle(page)) ?? {}))
    .toEqual(['captions'])
})

/* ---------------- 6. stage preview (DOM fallback) ---------------- */

test('overlay shows the caption at the playhead and hides outside it', async ({
  page,
}) => {
  await loadProject(page, baseDoc({ captions: [CAP3] }))

  // jassub is blocked → the native ASS canvas never activates
  await expect(page.locator('.ass-layer')).toBeHidden()

  await setPlayhead(page, 0.5)
  await expect(page.locator(OVERLAY)).toBeVisible()
  await expect(page.locator(`${OVERLAY} .fill-layer`)).toHaveText(
    'Hello fixture world'
  )

  await setPlayhead(page, 2)
  await expect(page.locator(OVERLAY)).toHaveCount(0)

  await setPlayhead(page, 0.1) // before the caption starts
  await expect(page.locator(OVERLAY)).toHaveCount(0)
})

test('karaoke/highlight: the active word span carries the active styling', async ({
  page,
}) => {
  await loadProject(
    page,
    baseDoc({
      captions: [CAP3],
      styles: { mode: 'karaoke', activeWord: { color: '#ff0000' } },
    })
  )
  await setPlayhead(page, 0.8) // inside word[1] "fixture" (0.6–1.0)

  const spans = page.locator(`${OVERLAY} .fill-layer .w`)
  await expect(spans).toHaveCount(3)
  await expect(spans.nth(1)).toHaveText('fixture')
  await expect(spans.nth(1)).toHaveCSS('color', 'rgb(255, 0, 0)')
  // non-active words keep the base color (default #ffffff)
  await expect(spans.nth(0)).toHaveCSS('color', 'rgb(255, 255, 255)')

  // highlight boxes the active word with activeWord.background
  await loadProject(
    page,
    baseDoc({
      captions: [CAP3],
      styles: { mode: 'highlight', activeWord: { background: '#008000' } },
    })
  )
  await setPlayhead(page, 0.8)
  const hlSpans = page.locator(`${OVERLAY} .fill-layer .w`)
  await expect(hlSpans).toHaveCount(3)
  await expect(hlSpans.nth(1)).toHaveCSS('background-color', 'rgb(0, 128, 0)')
  await expect(hlSpans.nth(0)).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  )
})

test('one-word mode renders only the word being spoken', async ({ page }) => {
  await loadProject(
    page,
    baseDoc({ captions: [CAP3], styles: { mode: 'one-word' } })
  )

  const spans = page.locator(`${OVERLAY} .fill-layer .w`)
  await setPlayhead(page, 0.3)
  await expect(spans).toHaveCount(1)
  await expect(spans).toHaveText('Hello')

  await setPlayhead(page, 0.8)
  await expect(spans).toHaveText('fixture')

  await setPlayhead(page, 1.2)
  await expect(spans).toHaveText('world')
})

/* ---------------- 7. timeline lane ---------------- */

test('timeline lane: blocks render, click selects, trims adjust start/end', async ({
  page,
}) => {
  await loadProject(
    page,
    baseDoc({
      captions: [
        { start: 1, end: 3, text: 'First block', words: distributeWords('First block', 1, 3) },
        { start: 4, end: 6, text: 'Second block', words: distributeWords('Second block', 4, 6) },
      ],
    })
  )
  const blocks = page.locator('.sub-row .caption-block')
  await expect(blocks).toHaveCount(2)

  // click selects the caption and flips the rail to the subtitles panel
  await blocks.nth(0).click()
  await expect.poll(() => store(page, 'editor', 'selectionKind')).toBe('caption')
  expect(await store(page, 'editor', 'selectedCaptionIndex')).toBe(0)
  expect(await store(page, 'editor', 'leftPanel')).toBe('subtitles')
  await expect(blocks.nth(0)).toHaveClass(/selected/)

  // px/s from the distance between the two block lefts (3s apart)
  const b0 = (await blocks.nth(0).boundingBox())!
  const b1 = (await blocks.nth(1).boundingBox())!
  const pxPerSec = (b1.x - b0.x) / 3
  expect(pxPerSec).toBeGreaterThan(5)

  // right-trim caption 0 by +1s → end 3 → 4
  await dragBy(page, blocks.nth(0).locator('.trim.r'), Math.round(pxPerSec))
  await expect
    .poll(async () => (await exportedSubtitle(page)).captions[0].end)
    .toBeGreaterThan(3.8)
  const end0 = (await exportedSubtitle(page)).captions[0].end
  expect(Math.abs(end0 - 4)).toBeLessThanOrEqual(0.15)

  // left-trim caption 1 by -0.5s → start 4 → 3.5
  await dragBy(page, blocks.nth(1).locator('.trim.l'), -Math.round(pxPerSec / 2))
  const start1 = (await exportedSubtitle(page)).captions[1].start
  expect(Math.abs(start1 - 3.5)).toBeLessThanOrEqual(0.15)
  // trims only move the edge, not the other side
  expect((await exportedSubtitle(page)).captions[1].end).toBe(6)
})

/* ---------------- 8. subtitle v2 wire schema round-trip ---------------- */

test('v2 flat subtitle import → export round-trip (maxWordsPerLine, bg opacity)', async ({
  page,
}) => {
  await loadProject(
    page,
    baseDoc({
      captions: [{ start: 0, end: 2, text: 'Hi there friend' }],
      animation: 'karaoke',
      font: { size: 64, color: '#ffff00' },
      background: { color: '#000000', opacity: 0.5, padding: 8 },
      activeWord: { color: '#ff0000' },
      position: 'top',
      margin: { x: 20, y: 30 },
      maxWordsPerLine: 2,
    })
  )

  // maxWordsPerLine is applied on import: words distributed then chunked
  const words = distributeWords('Hi there friend', 0, 2)
  const wantCaps = pickCaps(
    chunkCaptions([{ start: 0, end: 2, text: 'Hi there friend', words }], 2)
  )

  const { captions, ...styles } = await exportedSubtitle(page)
  expect(pickCaps(captions)).toEqual(wantCaps)
  expect(wantCaps.map((c) => c.text)).toEqual(['Hi there', 'friend'])
  expect(styles).toEqual({
    animation: 'karaoke',
    font: { size: 64, color: '#ffff00' },
    // background opacity is folded into the color's alpha channel on import
    background: { color: '#00000080', padding: 8 },
    activeWord: { color: '#ff0000' },
    position: 'top',
    margin: { x: 20, y: 30 },
  })

  // internal model got the ASS-oriented styles (what the preview consumes)
  const st = await store(page, 'project', 'doc.subtitle.styles')
  expect(st.mode).toBe('karaoke')
  expect(st.fontSize).toBe(64)
  expect(st.background).toBe('#00000080')
  expect(st.backgroundPadding).toBe(8)
  expect(st.position).toBe('top-center')
  expect(st.marginH).toBe(20)
  expect(st.marginV).toBe(30)

  // maxWordsPerLine itself is consumed, not re-exported
  expect((await exportedSubtitle(page)).maxWordsPerLine).toBeUndefined()
})
