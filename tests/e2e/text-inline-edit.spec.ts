import { test, expect, type Page } from '@playwright/test'
import { openEditor, exportedDoc, loadProject, store } from './helpers/app'

/**
 * In-place text editing on the stage: double-click a TEXT element (or press
 * Enter / just start typing while it is selected) turns the canvas text into
 * a contenteditable. Edits patch the doc live, land as ONE history entry on
 * exit (blur / Escape / selecting elsewhere), customCode texts are excluded,
 * and template {{placeholders}} are edited raw.
 *
 * Ground truth is exportedDoc() — gestures go through the real DOM.
 */

function baseDoc(visuals: Record<string, any>[]) {
  return {
    name: 'inline-text-spec',
    resolution: 'full-hd',
    duration: 10,
    frameRate: 30,
    backgroundColor: '#101319',
    outputFormat: 'mp4',
    visuals,
    audios: [],
  }
}

const TEXT_ITEM = {
  type: 'TEXT',
  text: 'Hello world',
  position: 'center-center',
  style: { fontSize: '80px', color: '#ffffff' },
}

/** the stage-canvas text while editable (either CE flavour) */
const EDITABLE =
  '.text-inner[contenteditable="plaintext-only"], .text-inner[contenteditable="true"]'

async function stageCenter(page: Page) {
  const box = await page.locator('.stage-frame').boundingBox()
  if (!box) throw new Error('stage frame not visible')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Select the first visual via the bridge: a first canvas click would open
 *  the side panel and reflow the stage between the two clicks of a real
 *  double-click. */
async function selectFirst(page: Page) {
  await page.evaluate(() => {
    const t = (window as any).__zvidTest
    t.editor.selectVisual(t.project.doc.visuals[0]._id)
    t.editor.openInspector()
  })
  await expect(page.locator('.sel-box')).toBeVisible()
}

test('double-click edits text in place; the session is one undo step', async ({
  page,
}) => {
  await openEditor(page)
  await loadProject(page, baseDoc([TEXT_ITEM]))
  await selectFirst(page)

  const c = await stageCenter(page)
  await page.mouse.dblclick(c.x, c.y)
  const editable = page.locator(EDITABLE)
  await expect(editable).toBeVisible()

  // entering selects all — typing replaces the content
  await page.keyboard.type('Replaced!')
  await page.keyboard.press('Escape')
  await expect(page.locator(EDITABLE)).toHaveCount(0)
  expect((await exportedDoc(page)).visuals[0].text).toBe('Replaced!')

  // every keystroke was patched without committing — one undo restores the
  // pre-edit text, not an intermediate keystroke
  await page.keyboard.press('Control+z')
  expect((await exportedDoc(page)).visuals[0].text).toBe('Hello world')
})

test('typing with a selected text starts editing and replaces the content', async ({
  page,
}) => {
  await openEditor(page)
  await loadProject(page, baseDoc([TEXT_ITEM]))
  await selectFirst(page)

  await page.keyboard.type('Hi!')
  const editable = page.locator(EDITABLE)
  await expect(editable).toBeVisible()
  await expect
    .poll(async () => (await store(page, 'project', 'doc.visuals'))[0].text)
    .toBe('Hi!')

  // clicking the empty stage blurs → commits and exits
  const box = await page.locator('.stage-frame').boundingBox()
  await page.mouse.click(box!.x + 5, box!.y + 5)
  await expect(page.locator(EDITABLE)).toHaveCount(0)
  expect((await exportedDoc(page)).visuals[0].text).toBe('Hi!')
  expect(await store(page, 'editor', 'editingTextId')).toBe(null)
})

test('Enter starts editing keeping the content; Escape without typing changes nothing', async ({
  page,
}) => {
  await openEditor(page)
  await loadProject(page, baseDoc([TEXT_ITEM]))
  await selectFirst(page)

  await page.keyboard.press('Enter')
  await expect(page.locator(EDITABLE)).toBeVisible()
  await expect(page.locator(EDITABLE)).toHaveText('Hello world')

  await page.keyboard.press('Escape')
  await expect(page.locator(EDITABLE)).toHaveCount(0)
  expect((await exportedDoc(page)).visuals[0].text).toBe('Hello world')
})

test('single-key shortcuts type into the text instead of firing (split/mute)', async ({
  page,
}) => {
  await openEditor(page)
  await loadProject(page, baseDoc([TEXT_ITEM]))
  await selectFirst(page)

  // 's' used to split the clip and 'm' to mute — with a text selected they
  // must start/continue the in-place edit instead
  await page.keyboard.type('sm')
  await expect
    .poll(async () => (await store(page, 'project', 'doc.visuals'))[0].text)
    .toBe('sm')
  const visuals = await store(page, 'project', 'doc.visuals')
  expect(visuals).toHaveLength(1) // no split happened
  expect(await store(page, 'editor', 'muted')).toBe(false)
  await page.keyboard.press('Escape')
})

test('an html text edits its markup in place', async ({ page }) => {
  await openEditor(page)
  await loadProject(
    page,
    baseDoc([
      {
        type: 'TEXT',
        html: '<div style="color:#fff;font-size:80px">Rich <b>text</b></div>',
        position: 'center-center',
      },
    ])
  )
  await selectFirst(page)

  const c = await stageCenter(page)
  await page.mouse.dblclick(c.x, c.y)
  const editable = page.locator('.text-inner[contenteditable="true"]')
  await expect(editable).toBeVisible()

  await page.keyboard.type('Bold new')
  await page.keyboard.press('Escape')
  const doc = await exportedDoc(page)
  expect(doc.visuals[0].html).toContain('Bold new')
  expect(doc.visuals[0].text).toBeUndefined()
})

test('customCode texts are not editable in place', async ({ page }) => {
  await openEditor(page)
  await loadProject(
    page,
    baseDoc([
      {
        type: 'TEXT',
        text: 'coded',
        position: 'center-center',
        style: { fontSize: '80px' },
        customCode: { css: '.container { color: #f33; }' },
      },
    ])
  )
  await selectFirst(page)

  const c = await stageCenter(page)
  await page.mouse.dblclick(c.x, c.y)
  await expect(page.locator(EDITABLE)).toHaveCount(0)
  expect(await store(page, 'editor', 'editingTextId')).toBe(null)
})

test('template placeholders are edited raw, not resolved', async ({ page }) => {
  await openEditor(page)
  await loadProject(
    page,
    baseDoc([
      {
        type: 'TEXT',
        text: 'Hey {{title}}',
        position: 'center-center',
        style: { fontSize: '80px', color: '#ffffff' },
      },
    ])
  )
  await page.evaluate(() =>
    (window as any).__zvidTest.project.setVariable('title', 'World')
  )
  await selectFirst(page)

  // the stage shows the resolved copy…
  await expect(page.locator('.text-inner')).toHaveText('Hey World')

  const c = await stageCenter(page)
  await page.mouse.dblclick(c.x, c.y)
  const editable = page.locator(EDITABLE)
  await expect(editable).toBeVisible()
  // …but the editable holds the raw doc text, so the placeholder survives
  await expect(editable).toHaveText('Hey {{title}}')

  await page.keyboard.press('Escape')
  expect((await exportedDoc(page)).visuals[0].text).toBe('Hey {{title}}')
  await expect(page.locator('.text-inner')).toHaveText('Hey World')
})
