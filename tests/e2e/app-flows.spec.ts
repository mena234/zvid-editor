import { test, expect } from '@playwright/test'
import {
  openEditor,
  exportedDoc,
  store,
  waitBridge,
  EDITOR_URL,
} from './helpers/app'

/**
 * Cross-cutting application flows: playback + global keymap (EditorShell
 * onKeyDown), TopBar project settings, undo/redo history, duplicate/delete,
 * autosave restore, new-project + image mode, import/export modals, toasts.
 *
 * Setup goes through the window.__zvidTest bridge, interactions through the
 * real UI (keyboard/clicks), assertions against exported JSON / store state.
 */

test('Space toggles playback, playhead advances monotonically and freezes on pause; M toggles mute', async ({
  page,
}) => {
  await openEditor(page)
  expect(await store(page, 'editor', 'playing')).toBe(false)

  await page.keyboard.press('Space')
  await waitBridge(page, 't.editor.playing === true')

  // monotonic progress over two observations — no wall-clock assumptions
  const p1 = await store(page, 'editor', 'playhead')
  await expect.poll(() => store(page, 'editor', 'playhead')).toBeGreaterThan(p1)
  const p2 = await store(page, 'editor', 'playhead')
  await expect.poll(() => store(page, 'editor', 'playhead')).toBeGreaterThan(p2)

  await page.keyboard.press('Space')
  await waitBridge(page, 't.editor.playing === false')
  const frozen = await store(page, 'editor', 'playhead')
  // let a few frames pass — a paused clock must not move
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150)))
      )
  )
  expect(await store(page, 'editor', 'playhead')).toBe(frozen)

  // M toggles mute
  expect(await store(page, 'editor', 'muted')).toBe(false)
  await page.keyboard.press('m')
  expect(await store(page, 'editor', 'muted')).toBe(true)
  await page.keyboard.press('m')
  expect(await store(page, 'editor', 'muted')).toBe(false)
})

test('L toggles loop; loop-off stops exactly at duration, loop-on wraps back to 0', async ({
  page,
}) => {
  await openEditor(page)
  // tiny duration so end-of-timeline behavior is observable quickly
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ duration: 0.4 })
  )

  expect(await store(page, 'editor', 'loop')).toBe(true)
  await page.keyboard.press('l')
  expect(await store(page, 'editor', 'loop')).toBe(false)

  // loop off: playback auto-stops pinned to the duration
  await page.keyboard.press('Space')
  expect(await store(page, 'editor', 'playing')).toBe(true)
  await waitBridge(page, 't.editor.playing === false')
  expect(await store(page, 'editor', 'playhead')).toBeCloseTo(0.4, 5)

  // loop on: the playhead wraps (a later sample is smaller than the max seen)
  await page.keyboard.press('l')
  expect(await store(page, 'editor', 'loop')).toBe(true)
  await page.keyboard.press('Space')
  const wrapped = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const t = (window as any).__zvidTest
        let max = 0
        const to = setTimeout(() => {
          clearInterval(iv)
          resolve(false)
        }, 8000)
        const iv = setInterval(() => {
          const p = t.editor.playhead
          if (max > 0.2 && p < max - 0.1) {
            clearInterval(iv)
            clearTimeout(to)
            resolve(true)
          }
          if (p > max) max = p
        }, 10)
      })
  )
  expect(wrapped).toBe(true)
  await page.keyboard.press('Space')
  await waitBridge(page, 't.editor.playing === false')
})

test('arrow keys frame-step the playhead by 1/fps (Shift = 1s) with clamping at 0 and duration', async ({
  page,
}) => {
  await openEditor(page)
  const frame = 1 / 30 // default frameRate 30

  // clamped at 0
  await page.keyboard.press('ArrowLeft')
  expect(await store(page, 'editor', 'playhead')).toBe(0)

  await page.keyboard.press('ArrowRight')
  expect(await store(page, 'editor', 'playhead')).toBeCloseTo(frame, 5)
  await page.keyboard.press('ArrowRight')
  expect(await store(page, 'editor', 'playhead')).toBeCloseTo(2 * frame, 5)

  // Shift steps a whole second (see EditorShell onKeyDown)
  await page.keyboard.press('Shift+ArrowRight')
  expect(await store(page, 'editor', 'playhead')).toBeCloseTo(1 + 2 * frame, 5)
  await page.keyboard.press('Shift+ArrowLeft')
  expect(await store(page, 'editor', 'playhead')).toBeCloseTo(2 * frame, 5)

  // back to 0 and clamp there
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  expect(await store(page, 'editor', 'playhead')).toBe(0)

  // clamp at the context duration (default 10s)
  await page.evaluate(() => (window as any).__zvidTest.editor.seek(9.99, 10))
  await page.keyboard.press('Shift+ArrowRight')
  expect(await store(page, 'editor', 'playhead')).toBe(10)
  await page.keyboard.press('ArrowRight')
  expect(await store(page, 'editor', 'playhead')).toBe(10)
})

test('TopBar project settings all write through to the exported JSON', async ({
  page,
}) => {
  await openEditor(page)

  // rename
  await page.fill('.name-input', 'flow-settings')
  await page.locator('.name-input').blur()
  expect((await exportedDoc(page)).name).toBe('flow-settings')

  // resolution preset changes the effective dimensions
  await page.selectOption('select[title="Resolution preset"]', 'hd')
  expect(await store(page, 'project', 'doc.resolution')).toBe('hd')
  await expect(page.locator('.settings .dim-badge').first()).toHaveText('1280×720')

  // custom preset reveals W/H inputs prefilled with the previous dims
  await page.selectOption('select[title="Resolution preset"]', 'custom')
  const wIn = page.locator('.settings .w-64 input').first()
  const hIn = page.locator('.settings .w-64 input').nth(1)
  await expect(wIn).toHaveValue('1280')
  await expect(hIn).toHaveValue('720')
  await wIn.fill('900')
  await wIn.press('Enter')
  await hIn.fill('600')
  await hIn.press('Enter')

  // duration & fps mini-fields
  const dur = page.locator('label[title="Timeline duration (seconds)"] input')
  await dur.fill('12')
  await dur.press('Enter')
  const fps = page.locator('label[title="Frame rate"] input')
  await fps.fill('24')
  await fps.press('Enter')

  // background color — native pickers can't be typed into, drive the input event
  await page
    .locator('label[title="Background color"] input[type="color"]')
    .evaluate((el, v) => {
      ;(el as HTMLInputElement).value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, '#112233')

  // output format
  await page.selectOption('select[title="Output format"]', 'webm')

  expect(await exportedDoc(page)).toMatchObject({
    name: 'flow-settings',
    resolution: 'custom',
    width: 900,
    height: 600,
    duration: 12,
    frameRate: 24,
    backgroundColor: '#112233',
    outputFormat: 'webm',
  })
})

test('undo/redo walks three distinct edits; TopBar buttons mirror keys; new edit clears redo', async ({
  page,
}) => {
  await openEditor(page)
  const snap = () => exportedDoc(page)

  const s0 = await snap()
  const id = await page.evaluate(
    () =>
      (window as any).__zvidTest.project.addVisual('root', {
        type: 'TEXT',
        text: 'undo-me',
        position: 'center-center',
      })._id
  )
  const s1 = await snap()
  await page.evaluate(
    (vid) => (window as any).__zvidTest.project.patchVisual(vid, { x: 120, y: 80 }),
    id
  )
  const s2 = await snap()
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ duration: 20 })
  )
  const s3 = await snap()
  expect(s1).not.toEqual(s0)
  expect(s2).not.toEqual(s1)
  expect(s3).not.toEqual(s2)

  // three undos restore each prior state exactly
  await page.keyboard.press('Control+z')
  expect(await snap()).toEqual(s2)
  await page.keyboard.press('Control+z')
  expect(await snap()).toEqual(s1)
  await page.keyboard.press('Control+z')
  expect(await snap()).toEqual(s0)
  await expect(page.locator('button[title="Undo (Ctrl+Z)"]')).toBeDisabled()

  // Ctrl+Y redoes; TopBar buttons behave identically
  await page.keyboard.press('Control+y')
  expect(await snap()).toEqual(s1)
  await page.click('button[title="Redo (Ctrl+Y)"]')
  expect(await snap()).toEqual(s2)
  await page.click('button[title="Undo (Ctrl+Z)"]')
  expect(await snap()).toEqual(s1)

  // a fresh edit after undo drops the redo branch
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ name: 'branched' })
  )
  expect(await store(page, 'project', 'canRedo')).toBe(false)
  await expect(page.locator('button[title="Redo (Ctrl+Y)"]')).toBeDisabled()
})

test('Ctrl+D duplicates and Delete removes a visual; Delete inside a text input is ignored', async ({
  page,
}) => {
  await openEditor(page)
  const id = await page.evaluate(() => {
    const t = (window as any).__zvidTest
    const v = t.project.addVisual('root', { type: 'TEXT', text: 'dup-me', x: 10, y: 10 })
    t.editor.selectVisual(v._id)
    return v._id
  })

  await page.keyboard.press('Control+d')
  let doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(2)
  // duplicate is offset by +24/+24 so it's visibly a copy
  expect(doc.visuals[1]).toMatchObject({ text: 'dup-me', x: 34, y: 34 })

  // the copy is auto-selected — Delete removes it
  await page.keyboard.press('Delete')
  doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(1)
  expect(await store(page, 'editor', 'selectionKind')).toBe(null)

  // typing-target guard: with a visual selected but focus in an input,
  // Delete must edit the text field, never the document
  await page.evaluate((vid) => (window as any).__zvidTest.editor.selectVisual(vid), id)
  await page.click('.name-input')
  await page.keyboard.press('Delete')
  doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(1)
  expect(await store(page, 'editor', 'selectionKind')).toBe('visual')
})

test('autosave (600ms debounce) restores with keepStorage and resets without', async ({
  page,
  context,
}) => {
  await openEditor(page)
  await page.evaluate(() => {
    const t = (window as any).__zvidTest
    t.project.patchProject({ name: 'autosave-flow' })
    t.project.addVisual('root', { type: 'TEXT', text: 'saved' })
  })
  // wait out the 600ms debounce via the storage side effect
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('zvid-editor:autosave') ?? ''), {
      timeout: 5000,
    })
    .toContain('autosave-flow')

  // new page, storage kept → the document is restored
  const restored = await context.newPage()
  await openEditor(restored, { keepStorage: true })
  const doc = await exportedDoc(restored)
  expect(doc.name).toBe('autosave-flow')
  expect(doc.visuals).toHaveLength(1)
  await restored.close()

  // new page without keepStorage → fresh default doc
  const fresh = await context.newPage()
  await openEditor(fresh)
  const doc2 = await exportedDoc(fresh)
  expect(doc2.name).toBe('untitled-video')
  expect(doc2.visuals ?? []).toEqual([])
  await fresh.close()
})

test('New menu resets to a video project and switches into image mode', async ({
  page,
}) => {
  await openEditor(page)
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ name: 'dirty' })
  )

  // New → Video project resets the doc
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.new-menu .item', { hasText: 'Video project' }).click()
  let doc = await exportedDoc(page)
  expect(doc.name).toBe('untitled-video')
  expect(doc.type).toBeUndefined()
  await expect(page.locator('.tl-panel')).toBeVisible()

  // New → Image project switches to image mode
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.new-menu .item', { hasText: 'Image project' }).click()
  doc = await exportedDoc(page)
  expect(doc.type).toBe('image')
  expect(doc.name).toBe('untitled-image')
  expect(doc.outputFormat).toBe('png')

  // TopBar badge, timeline gone, time-domain rail tabs gone
  await expect(page.locator('.mode-badge')).toHaveText('IMAGE')
  await expect(page.locator('.tl-panel')).toHaveCount(0)
  for (const hidden of ['Videos', 'Audio', 'GIFs', 'Scenes', 'Subtitles']) {
    await expect(page.locator(`.rail-tab[title="${hidden}"]`), hidden).toHaveCount(0)
  }
  for (const shown of ['Images', 'Text', 'Design', 'Shape', 'Canvas', 'Variables']) {
    await expect(page.locator(`.rail-tab[title="${shown}"]`), shown).toHaveCount(1)
  }
  // duration/fps mini-fields hidden, formats narrowed to image encoders
  await expect(page.locator('label[title="Timeline duration (seconds)"]')).toHaveCount(0)
  expect(
    await page.locator('select[title="Output format"] option').allTextContents()
  ).toEqual(['png', 'jpg', 'webp'])
})

test('booting with ?type=image starts straight in an image project', async ({ page }) => {
  // NOTE: openEditor() cannot be used for this boot — its ready-wait requires
  // '.tl-panel', which an image-mode boot never renders (TimelinePanel is
  // v-if="!isImage"). Same init script, custom ready-wait instead.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('zvid-test-hooks', '1')
      localStorage.removeItem('zvid-editor:autosave')
      localStorage.removeItem('zvid-cloud-project')
    } catch {}
  })
  await page.goto(EDITOR_URL + '?type=image', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => {
      const t = (window as any).__zvidTest
      return (
        !!t &&
        !!document.querySelector('.stage-frame') &&
        t.project?.doc?.type === 'image'
      )
    },
    undefined,
    { timeout: 120_000 }
  )

  const doc = await exportedDoc(page)
  expect(doc.type).toBe('image')
  expect(doc.name).toBe('untitled-image')
  expect(doc.outputFormat).toBe('png')
  await expect(page.locator('.mode-badge')).toHaveText('IMAGE')
  await expect(page.locator('.tl-panel')).toHaveCount(0)
  // the shell strips the one-shot ?type= param after applying it
  expect(new URL(page.url()).searchParams.get('type')).toBeNull()
})

test('Import modal replaces the doc on valid JSON and shows a readable error on invalid', async ({
  page,
}) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.locator('.modal-backdrop')).toBeVisible()

  const valid = JSON.stringify({
    name: 'imported-flow',
    duration: 5,
    visuals: [{ type: 'TEXT', text: 'hi', position: 'center-center' }],
  })
  await page.fill('.code-ed textarea', valid)
  await page.getByRole('button', { name: 'Import project' }).click()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Project imported')
  let doc = await exportedDoc(page)
  expect(doc.name).toBe('imported-flow')
  expect(doc.duration).toBe(5)
  expect(doc.visuals[0]).toMatchObject({ type: 'TEXT', text: 'hi' })

  // invalid JSON: error shown, modal stays open, doc untouched
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.fill('.code-ed textarea', '{ "name": "broken", ')
  await page.getByRole('button', { name: 'Import project' }).click()
  const err = page.locator('.modal-backdrop pre.err')
  await expect(err).toBeVisible()
  expect(((await err.textContent()) ?? '').trim().length).toBeGreaterThan(0)
  expect(await store(page, 'editor', 'modal')).toBe('import')
  doc = await exportedDoc(page)
  expect(doc.name).toBe('imported-flow')
  await page.click('.modal-backdrop button[aria-label="Close"]')
})

test('Export modal shows the exported JSON, snippet tabs, clean validation and a copy button', async ({
  page,
}) => {
  await openEditor(page)
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ name: 'export-flow' })
  )
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.locator('.modal-backdrop')).toBeVisible()
  await expect(page.locator('.pill.ok')).toContainText('valid for rendering')

  // project.json tab shows exactly the exported document
  const shown = await page.locator('.code-wrap pre.code').textContent()
  expect(JSON.parse(shown ?? '')).toEqual(await exportedDoc(page))

  // snippet tabs carry their expected markers (content is unit-tested)
  await page.locator('.tabs button', { hasText: 'Node.js' }).click()
  await expect(page.locator('.code-wrap pre.code')).toContainText(
    "import zvid from 'zvid'"
  )
  await page.locator('.tabs button', { hasText: 'CLI' }).click()
  await expect(page.locator('.code-wrap pre.code')).toContainText(
    'npx zvid render export-flow.json'
  )
  await page.locator('.tabs button', { hasText: 'HTTP API' }).click()
  await expect(page.locator('.code-wrap pre.code')).toContainText(
    "await fetch('https://YOUR-RENDER-API/render'"
  )

  // validation panel is clean for a default doc
  await page.locator('.tabs button', { hasText: 'Validation' }).click()
  await expect(page.locator('.issues .ok-text')).toContainText('No issues found')

  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()
  await page.click('.modal-backdrop button[aria-label="Close"]')
})

test('toast notifications appear and auto-dismiss', async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() =>
    (window as any).__zvidTest.editor.notify('flow toast check', 'success')
  )
  const toast = page.locator('.toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('flow toast check')
  await expect(toast).toHaveClass(/success/)
  // 3.5s auto-dismiss timer
  await expect(toast).toHaveCount(0, { timeout: 6000 })
})
