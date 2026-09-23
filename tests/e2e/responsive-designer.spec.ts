import { test, expect, type Locator, type Page } from '@playwright/test'
import { exportedDoc, fx, openEditor } from './helpers/app'

// These tests isolate HTTP fixtures per browser context; they deliberately do
// not reset the shared mock server while other responsive suites are running.
test.use({ hasTouch: true, isMobile: true })
test.setTimeout(180_000)
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(10_000)
  page.on('pageerror', error => console.log('DESIGNER PAGE ERROR', error.message))
})

function section(page: Page, title: string) {
  return page.locator('.studio .sec').filter({ has: page.locator('.sec-head').getByText(title, { exact: true }) })
}

async function field(container: Locator, label: string, value: string) {
  const input = fieldControl(container, label).locator('input:not([type=color])').first()
  await input.fill(value)
  await input.press('Tab')
  await expect(input).toHaveValue(value)
}

function fieldControl(container: Locator, label: string) {
  return container.locator('.field').filter({ has: container.page().getByText(label, { exact: true }) })
}

async function select(container: Locator, label: string, value: string) {
  await fieldControl(container, label).locator('select').selectOption(value)
}

async function fits(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  const vp = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1)
}

async function openStudio(page: Page) {
  await page.getByRole('button', { name: 'Design', exact: true }).tap()
  await page.locator('.design-panel .hero').tap()
  await expect(page.getByRole('dialog', { name: 'Design Studio', exact: true })).toBeVisible()
}

async function touchDrag(page: Page, locator: Locator, dx: number, dy: number) {
  await locator.scrollIntoViewIfNeeded()
  const box = (await locator.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

test('Design Studio commits a real touch drag without scrolling the modal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page)
  await openStudio(page)
  await page.getByTitle('Add a shape / icon layer', { exact: true }).tap()
  await page.locator('.studio .preview').scrollIntoViewIfNeeded()
  const before = await page.locator('.modal-body').evaluate(el => el.scrollTop)
  await touchDrag(page, page.locator('.studio .sel-box.active'), 35, 25)
  expect(await page.locator('.modal-body').evaluate(el => el.scrollTop)).toBe(before)
  await expect(fieldControl(section(page, 'shape layer'), 'X').locator('input')).not.toHaveValue('50')
  expect(Number(await fieldControl(section(page, 'shape layer'), 'X').locator('input').inputValue())).toBeGreaterThan(55)
  expect(Number(await fieldControl(section(page, 'shape layer'), 'Y').locator('input').inputValue())).toBeGreaterThan(55)
})

test('modal keyboard focus stays contained, supports teleported pickers, and returns to visible triggers', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await openEditor(page)
  const signIn = page.locator('.topbar').getByRole('button', { name: 'Sign in', exact: true })
  await signIn.tap()
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused()
  for (const input of await page.locator('.modal input').all()) {
    expect(await input.evaluate(el => getComputedStyle(el).fontSize)).toBe('16px')
  }
  // Traverse two full cycles in each direction, including disabled submit.
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key)
      expect(await page.evaluate(() => !!document.activeElement?.closest('.modal'))).toBe(true)
    }
  }
  await page.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(signIn).toBeFocused()
  await signIn.tap()
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal')).toHaveCount(0)
  await expect(signIn).toBeFocused()

  const more = page.getByRole('button', { name: 'More editor actions', exact: true })
  await more.tap()
  await page.getByRole('button', { name: 'Import', exact: true }).tap()
  await page.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(more).toBeFocused()

  await openStudio(page)
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  expect(await page.locator('.modal-body').evaluate(el => el.scrollTop)).toBe(0)
  expect(await page.getByRole('textbox', { name: 'Search animations', exact: true }).evaluate(el => getComputedStyle(el).fontSize)).toBe('16px')
  const variableTrigger = section(page, 'Text').getByTitle('Insert a variable at the cursor', { exact: true })
  await variableTrigger.tap()
  const variables = page.getByRole('dialog', { name: 'Choose a variable', exact: true })
  await expect(variables).toBeVisible()
  expect(await variables.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(variables).toHaveCount(0)
  await expect(variableTrigger).toBeFocused()

  await page.getByRole('button', { name: 'Canvas settings', exact: true }).tap()
  const fontTrigger = page.getByRole('button', { name: 'Font family', exact: true })
  await fontTrigger.tap()
  const fonts = page.getByRole('dialog', { name: 'Choose Google font', exact: true })
  await expect(page.getByRole('textbox', { name: 'Search Google Fonts', exact: true })).toBeFocused()
  await page.getByRole('textbox', { name: 'Search Google Fonts', exact: true }).fill('Inter')
  await page.keyboard.press('Tab')
  expect(await fonts.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(fonts).toHaveCount(0)
  await expect(fontTrigger).toBeFocused()
  // Stopping editor shortcuts at the modal boundary still permits the
  // Design Studio's own layer keyboard handler inside that boundary.
  const addShape = page.getByTitle('Add a shape / icon layer', { exact: true })
  const layerCount = await page.locator('.studio .layers .row').count()
  await addShape.tap()
  await expect(page.locator('.studio .layers .row')).toHaveCount(layerCount + 1)
  await addShape.focus()
  await page.keyboard.press('Delete')
  await expect(page.locator('.studio .layers .row')).toHaveCount(layerCount)
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap()
  await expect(page.locator('.design-panel .hero')).toBeFocused()
})

for (const [width, height] of [[320, 640], [390, 844], [820, 1180], [844, 390]]) {
  test(`Design Studio full editing parity at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    await openEditor(page)
    await openStudio(page)
    await fits(page, page.locator('.modal'))
    await fits(page, page.locator('.modal-foot'))
    expect(await page.locator('.modal-body').evaluate(el => el.scrollTop)).toBe(0)
    await page.screenshot({ path: info.outputPath(`designer-open-${width}.png`) })

    // Preview controls are usable before the inspector is scrolled.
    await page.locator('.studio').getByTitle('Pause', { exact: true }).tap()
    await expect(page.locator('.studio').getByTitle('Play', { exact: true })).toBeVisible()
    await page.locator('.studio').getByTitle('Replay from start', { exact: true }).tap()
    await expect(page.locator('.studio').getByTitle('Pause', { exact: true })).toBeVisible()
    for (const backdrop of ['dark', 'light', 'checker']) {
      await page.getByTitle(`${backdrop} backdrop`, { exact: true }).tap()
      await expect(page.locator('.studio .frame')).toHaveAttribute('data-backdrop', backdrop)
    }
    const scrub = page.locator('.studio .scrub')
    await scrub.tap({ position: { x: 2, y: 5 } })
    await expect(page.locator('.studio').getByTitle('Play', { exact: true })).toBeVisible()

    // Add and configure text, including the fields below the initial fold.
    await page.getByTitle('Add a text layer', { exact: true }).tap()
    await page.locator('.studio textarea').fill('Mobile title')
    const text = section(page, 'Text')
    for (const [label, value] of [['Size', '52'], ['Spacing', '0.05'], ['Line height', '1.3'], ['Wrap width', '360']]) await field(text, label, value)
    await select(text, 'Weight', '800')
    await select(text, 'Align', 'left')
    await select(text, 'Case', 'uppercase')
    const transform = section(page, 'text layer')
    for (const [label, value] of [['X', '35'], ['Y', '30'], ['Rotate', '12'], ['Scale', '1.1'], ['Opacity', '0.8']]) await field(transform, label, value)
    await section(page, 'Fill').getByRole('button', { name: 'Gradient', exact: true }).tap()
    await field(section(page, 'Fill'), 'Angle', '90')
    for (const title of ['Outline', 'Shadow', 'Highlight pill']) {
      const sec = section(page, title)
      await sec.locator('input[type=checkbox]').check()
      await sec.locator('.sec-head').tap()
      await expect(sec.locator('.sec-body')).toBeVisible()
    }
    await field(section(page, 'Outline'), 'Width', '3')
    await field(section(page, 'Shadow'), 'Blur', '14')
    await field(section(page, 'Highlight pill'), 'Pad X', '16')
    await page.locator('.studio').getByTitle('Rise', { exact: true }).tap()
    await field(section(page, 'Animation'), 'Duration', '0.8')
    await field(section(page, 'Animation'), 'Delay', '0.2')
    await select(section(page, 'Animation'), 'Easing', 'linear')

    // Layer actions remain discoverable after selecting a row on touch.
    let row = page.locator('.studio .layers .row').filter({ hasText: 'Mobile title' })
    await row.getByTitle('Duplicate', { exact: true }).tap()
    await expect(page.locator('.studio .layers .row')).toHaveCount(3)
    await page.locator('.studio .layers .row.active').getByTitle('Delete layer', { exact: true }).tap()
    await expect(page.locator('.studio .layers .row')).toHaveCount(2)

    await page.getByTitle('Add a shape / icon layer', { exact: true }).tap()
    await field(section(page, 'shape layer'), 'Name', 'Mobile shape')
    await page.getByPlaceholder('Search shapes…', { exact: true }).fill('ring')
    await page.locator('.studio .shape-btn').first().tap()
    await field(section(page, 'Shape'), 'Stroke width', '12')
    await field(section(page, 'Shape'), 'Width', '180')
    await field(section(page, 'Shape'), 'Height', '120')
    row = page.locator('.studio .layers .row').filter({ hasText: 'Mobile shape' })
    await row.getByTitle('Hide', { exact: true }).tap()
    await expect(row).toHaveClass(/hidden/)
    await row.getByTitle('Show', { exact: true }).tap()
    await row.getByTitle('Move down (toward back)', { exact: true }).tap()
    await expect(page.locator('.studio .layers .row').nth(1)).toContainText('Mobile shape')
    await row.getByTitle('Move up (toward front)', { exact: true }).tap()

    await page.getByTitle('Add an image layer', { exact: true }).tap()
    await field(section(page, 'image layer'), 'Name', 'Mobile image')
    await field(section(page, 'Image'), 'URL', fx('image.png'))
    for (const [label, value] of [['Width', '220'], ['Height', '160'], ['Radius', '18']]) await field(section(page, 'Image'), label, value)
    await select(section(page, 'Image'), 'Fit', 'contain')
    await expect.poll(async () => page.locator('.studio .canvas-host img').evaluateAll(images => images.some(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    await page.locator('.studio').getByTitle('Slide in', { exact: true }).tap()
    await select(section(page, 'Animation'), 'From', 'left')

    // A direct touch control reaches canvas settings even on a full artboard.
    await page.getByRole('button', { name: 'Canvas settings', exact: true }).tap()
    await expect(section(page, 'Canvas')).toBeVisible()
    await field(section(page, 'Canvas'), 'Width', '900')
    await field(section(page, 'Canvas'), 'Height', '500')
    await section(page, 'Background').locator('select').selectOption('gradient')
    await field(section(page, 'Background'), 'Angle', '45')
    await field(section(page, 'Background'), 'Corner radius', '16')
    await section(page, 'Font').getByRole('button', { name: 'Font family', exact: true }).tap()
    await page.getByRole('textbox', { name: 'Search Google Fonts', exact: true }).fill('Inter')
    await fits(page, page.getByRole('dialog', { name: 'Choose Google font', exact: true }))
    await page.getByRole('dialog', { name: 'Choose Google font', exact: true }).getByRole('button', { name: 'Inter', exact: true }).tap()
    await section(page, 'Loop').locator('input[type=checkbox]').uncheck()
    await field(section(page, 'Loop'), 'Loop duration', '4')
    expect(await page.locator('.modal-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`designer-settings-${width}.png`) })
    await fits(page, page.getByRole('button', { name: 'Insert element', exact: true }))
    await page.getByRole('button', { name: 'Insert element', exact: true }).tap()
    await expect(page.locator('.modal')).toHaveCount(0)

    const design = (await exportedDoc(page)).visuals[0].designer
    expect(design).toMatchObject({ width: 900, height: 500, duration: 4, fontFamily: 'Inter', background: { kind: 'gradient', angle: 45, radius: 16 } })
    expect(design.layers).toHaveLength(4)
    expect(design.layers.find((l: any) => l.text === 'Mobile title')).toMatchObject({ fontSize: 52, fontWeight: '800', letterSpacing: 0.05, lineHeight: 1.3, width: 360, align: 'left', textTransform: 'uppercase', x: 35, y: 30, rotate: 12, scale: 1.1, opacity: 0.8, stroke: { width: 3 }, shadow: { blur: 14 }, pill: { padX: 16 }, anim: { preset: 'rise', duration: 0.8, delay: 0.2, easing: 'linear' } })
    expect(design.layers.find((l: any) => l.name === 'Mobile shape')).toMatchObject({ width: 180, height: 120, hidden: false, strokeWidth: 12 })
    expect(design.layers.find((l: any) => l.name === 'Mobile image')).toMatchObject({ src: fx('image.png'), width: 220, height: 160, radius: 18, fit: 'contain', anim: { preset: 'slide-in', dir: 'left' } })

    // Update persists changes; Cancel discards them.
    if (!await page.locator('.design-panel').isVisible()) await page.getByRole('button', { name: 'Design', exact: true }).tap()
    await page.locator('.design-panel .edit-selected').tap()
    await page.locator('.studio .layers .row').filter({ hasText: 'Mobile title' }).locator('.row-label').tap()
    await page.locator('.studio textarea').fill('Updated title')
    await page.getByRole('button', { name: 'Update element', exact: true }).tap()
    await expect(page.locator('.modal')).toHaveCount(0)
    expect((await exportedDoc(page)).visuals[0].designer.layers.some((l: any) => l.text === 'Updated title')).toBe(true)
    await page.locator('.design-panel .edit-selected').tap()
    await page.locator('.studio .layers .row').filter({ hasText: 'Updated title' }).locator('.row-label').tap()
    await page.locator('.studio textarea').fill('Discard this')
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap()
    await expect(page.locator('.modal')).toHaveCount(0)
    expect((await exportedDoc(page)).visuals[0].designer.layers.some((l: any) => l.text === 'Updated title')).toBe(true)
  })

  test(`Design templates and walkthrough are usable at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    const templates = Array.from({ length: 24 }, (_, n) => ({
      kind: 'design-templates', slug: `touch-${n + 1}`, title: `Touch template ${n + 1}`,
      description: 'A local test template', version: 1, sortOrder: n, contentUrl: '',
      meta: { thumbnail: fx('image.png') },
    }))
    await page.route('**/api/library/design-templates?*', route => {
      const url = new URL(route.request().url())
      const offset = Number(url.searchParams.get('offset') || 0)
      return route.fulfill({ json: { kind: 'design-templates', items: templates.slice(offset, offset + 12), total: 24, offset, limit: 12, hasMore: offset + 12 < 24 } })
    })
    await page.route('**/api/library/design-templates/*/content', route => route.fulfill({ json: {
      version: 1, width: 800, height: 450, fontFamily: 'Inter', duration: 'auto',
      background: { kind: 'solid', color: '#112233' },
      layers: [{ kind: 'text', text: 'Touch template applied', fontSize: 60 }],
    } }))
    await openEditor(page)
    await openStudio(page)
    await page.locator('.studio').getByRole('button', { name: 'Templates', exact: true }).tap()
    await expect(page.locator('.tpl-card').first()).toBeVisible()
    await fits(page, page.locator('.tpl-menu'))
    await page.screenshot({ path: info.outputPath(`designer-templates-${width}.png`) })
    // User scrolling triggers the sentinel for the second page.
    await page.locator('.tpl-card').nth(11).scrollIntoViewIfNeeded()
    await expect(page.locator('.tpl-card')).toHaveCount(24)
    await page.locator('.tpl-card').last().tap()
    await expect(page.locator('.tpl-menu')).toHaveCount(0)
    await expect(page.locator('.studio .layers')).toContainText('Touch template app')
    await page.getByRole('button', { name: 'Insert element', exact: true }).tap()
    await expect(page.locator('.modal')).toHaveCount(0)
    expect((await exportedDoc(page)).visuals[0].designer.layers[0].text).toBe('Touch template applied')

    // Every tour step remains navigable with touch in both layouts.
    await page.getByRole('button', { name: 'More editor actions', exact: true }).tap()
    await page.getByTitle('Product tour', { exact: true }).tap()
    for (let step = 0; step < 9; step++) {
      await fits(page, page.locator('.tour .card'))
      await fits(page, page.locator('.tour .btn.primary'))
      await page.locator('.tour .btn.primary').tap()
    }
    await expect(page.locator('.tour')).toHaveCount(0)
  })
}
