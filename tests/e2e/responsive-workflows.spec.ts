import { test, expect, type Page, type Locator } from '@playwright/test'
import path from 'node:path'
import { openEditor, resetMockOrch, exportedDoc, loadProject, waitBridge, mockOrchCalls, fx } from './helpers/app'

const devices = [
  { name: 'desktop', width: 1366, height: 768, touch: false },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'small phone', width: 320, height: 640, touch: true },
  { name: 'phone landscape', width: 844, height: 390, touch: true },
]
const doc = { name: 'responsive-workflow', duration: 5, visuals: [{ type: 'TEXT', text: 'Device parity', position: 'center-center' }] }

async function dialogFits(page: Page) {
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  const bounds = await modal.boundingBox()
  const viewport = page.viewportSize()!
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
  expect(await modal.locator('.modal-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
}

for (const device of devices) {
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.touch,
      // Firefox supports touch input at a fixed viewport, but not isMobile.
      isMobile: async ({ browserName }, use) => { await use(device.touch && browserName !== 'firefox') },
    })
    const press = async (locator: Locator) => {
      if (device.touch) await locator.tap()
      else await locator.click()
    }
    async function moreAction(page: Page, locator: Locator) {
      if (!await locator.isVisible()) await press(page.getByRole('button', { name: 'More editor actions', exact: true }))
      await press(locator)
    }
    async function settings(page: Page) {
      if (!await page.getByTitle('Resolution preset', { exact: true }).isVisible()) {
        await press(page.getByRole('button', { name: 'Project settings', exact: true }))
      }
    }
    async function accountAction(page: Page, name: string) {
      await press(page.locator('.account .avatar'))
      await press(page.locator('.account .menu').getByRole('button', { name, exact: true }))
    }
    test.beforeEach(async () => { await resetMockOrch() })

    test('project settings, undo/redo, theme, shortcuts, import and every export tab', async ({ page }, info) => {
      await openEditor(page)
      await settings(page)
      await page.getByTitle('Resolution preset', { exact: true }).selectOption('custom')
      await page.getByTitle('Width (px)', { exact: true }).locator('input').fill('1280')
      await page.getByTitle('Height (px)', { exact: true }).locator('input').fill('720')
      await page.getByTitle('Frame rate', { exact: true }).locator('input').fill('24')
      await page.getByTitle('Output format', { exact: true }).selectOption('webm')
      await press(page.getByRole('button', { name: 'Project duration settings' }))
      await press(page.getByRole('checkbox', { name: 'Fit content automatically' }))
      await expect.poll(async () => (await exportedDoc(page)).outputFormat).toBe('webm')
      expect(await exportedDoc(page)).toMatchObject({ width: 1280, height: 720, frameRate: 24, durationMode: 'fixed' })
      // Variable controls must leave enough room to read the number beside them.
      for (const input of await page.locator('.settings .num:visible').all()) {
        expect(await input.evaluate(el => {
          const field = el as HTMLInputElement
          const css = getComputedStyle(field)
          const canvas = document.createElement('canvas').getContext('2d')!
          canvas.font = css.font || `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
          // Firefox's input clientWidth excludes padding, unlike other engines.
          const available = field.getBoundingClientRect().width
            - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)
            - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
          return available >= canvas.measureText(field.value).width
        })).toBe(true)
      }
      await press(page.locator('.project-identity'))

      await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Renamed on device')
      await press(page.locator('.brand'))
      await moreAction(page, page.getByTitle('Undo (Ctrl+Z)', { exact: true }))
      expect((await exportedDoc(page)).name).not.toBe('Renamed on device')
      await moreAction(page, page.getByTitle('Redo (Ctrl+Y)', { exact: true }))
      expect((await exportedDoc(page)).name).toBe('Renamed on device')
      const theme = await page.locator('html').getAttribute('data-theme')
      await moreAction(page, page.locator('.topbar button[title^="Switch to"]'))
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', theme!)
      await moreAction(page, page.getByTitle('Keyboard shortcuts (?)', { exact: true }))
      await dialogFits(page)
      await press(page.getByRole('button', { name: 'Close', exact: true }))

      await moreAction(page, page.getByRole('button', { name: 'Import', exact: true }))
      await page.locator('.code-ed textarea').fill('{invalid')
      await press(page.getByRole('button', { name: 'Import project', exact: true }))
      await expect(page.locator('pre.err')).toBeVisible()
      await page.locator('.code-ed textarea').fill(JSON.stringify(doc))
      await press(page.getByRole('button', { name: 'Import project', exact: true }))
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect((await exportedDoc(page)).visuals[0].text).toBe('Device parity')
      await press(page.locator('.topbar').getByRole('button', { name: 'Export', exact: true }))
      await dialogFits(page)
      for (const name of ['Node.js', 'CLI', 'HTTP API', /^Validation \(\d+\)$/, 'project.json']) {
        await press(page.locator('.tabs').getByRole('button', { name, exact: true }))
      }
      expect(JSON.parse((await page.locator('.code').textContent())!)).toEqual(await exportedDoc(page))
      const download = page.waitForEvent('download')
      await press(page.getByRole('button', { name: 'Download JSON', exact: true }))
      expect((await download).suggestedFilename()).toBe('responsive-workflow.json')
      await page.screenshot({ path: info.outputPath('export.png') })
    })

    test('sign-in, cloud save/update, projects rename/open/delete, template save and sign-out', async ({ page }, info) => {
      await openEditor(page)
      await press(page.locator('.topbar').getByRole('button', { name: 'Save', exact: true }))
      await dialogFits(page)
      await page.getByRole('textbox', { name: 'Email', exact: true }).fill('e2e@zvid.io')
      await page.getByLabel('Password', { exact: true }).fill('test-password')
      await press(page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }))
      await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', 'Save project to your account')
      await page.locator('.modal input[type=text]').fill('Device project')
      await press(page.getByRole('button', { name: 'Save project', exact: true }))
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('updated-device-project')
      await press(page.locator('.topbar').getByRole('button', { name: 'Save', exact: true }))
      await expect.poll(async () => (await mockOrchCalls()).filter(c => c.method === 'PUT' && c.path.includes('/api/projects/')).length).toBe(1)
      await accountAction(page, 'My projects')
      await dialogFits(page)
      await press(page.getByTitle('Rename', { exact: true }))
      await page.locator('input.rename').fill('Renamed project')
      // Commit through blur, as with a mobile keyboard's Done action.
      await press(page.locator('.modal-head h2'))
      await expect(page.locator('.list .row')).toContainText('Renamed project')
      await press(page.locator('.list .row').getByRole('button', { name: 'Open', exact: true }))
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect((await exportedDoc(page)).name).toBe('updated-device-project')
      await accountAction(page, 'Save as template')
      await dialogFits(page)
      await page.locator('.modal input[type=text]').fill('Device template')
      await press(page.getByRole('button', { name: 'Save template', exact: true }))
      await expect(page.locator('.modal .done')).toContainText('Device template')
      await page.screenshot({ path: info.outputPath('saved-template.png') })
      await press(page.getByRole('button', { name: 'Done', exact: true }))
      await accountAction(page, 'My projects')
      await press(page.getByTitle('Delete', { exact: true }))
      await press(page.getByTitle('Click again to delete', { exact: true }))
      await expect(page.locator('.list .row')).toHaveCount(0)
      await press(page.getByRole('button', { name: 'Close', exact: true }))
      await accountAction(page, 'Sign out')
      await expect(page.locator('.account')).toContainText('Sign in')
    })

    test('upload chooser, add uploaded image and touch-accessible delete', async ({ page }) => {
      await openEditor(page, { authed: true })
      await waitBridge(page, 't.auth.loaded && !!t.auth.user')
      if (!await page.locator('.uploads-section').isVisible()) await press(page.getByRole('button', { name: 'Images', exact: true }))
      const chooser = page.waitForEvent('filechooser')
      await press(page.locator('.upload-btn'))
      await (await chooser).setFiles(path.resolve('tests/e2e/fixtures/image.png'))
      // Upload progress cards share .cell; only completed uploads can be added.
      const cell = page.locator('.uploads-section .cell[draggable="true"]').first()
      await expect(cell).toBeVisible()
      await press(cell)
      await expect.poll(async () => (await exportedDoc(page)).visuals?.length ?? 0).toBe(1)
      expect((await exportedDoc(page)).visuals[0]).toMatchObject({ type: 'IMAGE', src: fx('image.png') })
      page.on('dialog', d => d.accept())
      if (!device.touch) await cell.hover()
      await expect(cell.locator('.del')).toHaveCSS('opacity', '1')
      await press(cell.locator('.del'))
      await expect(page.locator('.uploads-section .cell')).toHaveCount(0)
    })

    test('examples search and video/image library selection', async ({ page }, info) => {
      const examples = [
        { kind: 'examples', slug: 'device-video', title: 'Device Video Example', description: 'Responsive example', meta: { pack: 'saas', duration: 5 }, version: 1, sortOrder: 0 },
        { kind: 'examples', slug: 'device-image', title: 'Device Image Example', description: 'Responsive image', meta: { pack: 'thumbnail', type: 'image', format: 'png' }, version: 1, sortOrder: 1 },
      ]
      await resetMockOrch({ library: { examples }, libraryContent: { 'examples/device-video': doc, 'examples/device-image': { ...doc, type: 'image', outputFormat: 'png' } } })
      await openEditor(page)
      await moreAction(page, page.getByRole('button', { name: 'Examples', exact: true }))
      await expect(page.locator('.ex-search')).toBeVisible()
      await dialogFits(page)
      await page.locator('.ex-search').fill('missing result')
      await expect(page.locator('.empty-note')).toBeVisible()
      await page.locator('.ex-search').fill('device')
      await press(page.locator('.ex-mode-btn', { hasText: 'Images' }))
      await expect(page.locator('.modal .card')).toHaveCount(1)
      await page.screenshot({ path: info.outputPath('examples.png') })
      await press(page.locator('.modal .card').first())
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect((await exportedDoc(page)).type).toBe('image')
      await expect(page.locator('.tl-panel')).toHaveCount(0)
      await moreAction(page, page.getByTitle('New empty project', { exact: true }))
      await press(page.getByRole('button', { name: 'Video project', exact: true }))
      await expect(page.locator('.tl-panel')).toBeVisible()
    })

    test('render progress/result and failure recovery remain usable', async ({ page }, info) => {
      await openEditor(page, { authed: true })
      await waitBridge(page, 't.auth.loaded && !!t.auth.user')
      await loadProject(page, doc)
      await press(page.locator('.topbar').getByRole('button', { name: 'Render', exact: true }))
      await dialogFits(page)
      await press(page.getByRole('button', { name: 'Start render', exact: true }))
      await expect(page.locator('video.result')).toHaveAttribute('src', fx('clip.mp4'))
      await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute('href', fx('clip.mp4'))
      await page.screenshot({ path: info.outputPath('render-result.png') })
      await press(page.getByRole('button', { name: 'Render again', exact: true }))
      await resetMockOrch({ renderMode: 'fail-ack' })
      await press(page.getByRole('button', { name: 'Start render', exact: true }))
      await expect(page.locator('.err-block')).toContainText('Mock rejected the payload')
      await press(page.getByRole('button', { name: 'Try again', exact: true }))
      await resetMockOrch()
      await press(page.getByRole('button', { name: 'Start render', exact: true }))
      await expect(page.locator('video.result')).toBeVisible()
    })

    test('image creation, format, quality, transparency and image render', async ({ page }) => {
      await resetMockOrch({ renderResultUrl: fx('image.png') })
      await openEditor(page, { authed: true })
      await waitBridge(page, 't.auth.loaded && !!t.auth.user')
      await moreAction(page, page.getByTitle('New empty project', { exact: true }))
      await press(page.getByRole('button', { name: 'Image project', exact: true }))
      await expect(page.locator('.tl-panel')).toHaveCount(0)
      await press(page.locator('.topbar').getByRole('button', { name: 'Render', exact: true }))
      await dialogFits(page)
      const format = page.locator('.img-opts select')
      const quality = page.locator('.img-opts input[type=range]')
      const transparent = page.locator('.img-opts input[type=checkbox]')
      await expect(quality).toBeDisabled()
      await format.selectOption('jpg')
      await expect(quality).toBeEnabled()
      await expect(transparent).toBeDisabled()
      await format.selectOption('webp')
      await press(transparent)
      await quality.fill('75')
      expect(await exportedDoc(page)).toMatchObject({ outputFormat: 'webp', quality: 75, transparent: true })
      await press(page.getByRole('button', { name: 'Start render', exact: true }))
      await expect(page.locator('img.result')).toHaveAttribute('src', fx('image.png'))
      await press(page.getByRole('button', { name: 'Close', exact: true }))
    })
  })
}
