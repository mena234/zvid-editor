import { test, expect, type Locator, type Page } from '@playwright/test'
import { openEditor, exportedDoc, loadProject, fx } from './helpers/app'

// Exercise the same controls with touch input at phone/tablet sizes and mouse
// input on desktop. Network fixtures belong to each page, not the shared API.
const screens = [
  { name: 'small phone', width: 320, height: 640, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
]
const base = { width: 640, height: 360, duration: 8, frameRate: 30, outputFormat: 'mp4' }
function sec(page: Page, name: string) {
  return page.locator('.rail-panel section.sec').filter({ has: page.locator('.sec-head > span').filter({ hasText: new RegExp(`^${name}$`) }) })
}
function field(scope: Locator, name: string) {
  return scope.locator('.field').filter({ has: scope.page().locator('.field-label').filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
}
async function num(scope: Locator, name: string, value: string) {
  const input = field(scope, name).locator('input.num')
  await input.fill(value)
  await input.press('Enter')
}
async function fits(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
}
async function panelFits(page: Page) {
  await fits(page, page.locator('.rail-panel'))
  for (const selector of ['.rail-panel-body', '.insp-body']) {
    const area = page.locator(selector)
    if (await area.count()) {
      const overflow = await area.evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth, elements: [...e.querySelectorAll('*')].filter(n => n.getBoundingClientRect().right > e.getBoundingClientRect().right + 1).map(n => `${n.tagName}.${n.className}`).slice(0, 10) }))
      expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 1)
    }
  }
}
async function fixtures(page: Page) {
  await page.route('**/api/stock/**', route => route.fulfill({ json: { results: [], items: [], total: 0 } }))
  await page.route('**/api/library/**', route => {
    const url = new URL(route.request().url())
    const kind = url.pathname.split('/')[3]
    if (url.pathname.endsWith('/content')) return route.fulfill({ json: { js: 'canvas.getContext("2d").fillRect(0,0,20,20)', animationDuration: 4 } })
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#e11d48"/></svg>'
    return route.fulfill({ json: { kind, items: [{ kind, slug: 'responsive-fixture', title: kind === 'shapes' ? 'QA rectangle' : 'QA canvas', meta: { svg, width: 100, height: 100 }, version: 1 }], total: 1, hasMore: false } })
  })
}

for (const screen of screens) {
  test.describe(`responsive panels: ${screen.name}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height }, hasTouch: screen.touch, isMobile: screen.touch })
    const activate = async (locator: Locator) => screen.touch ? locator.tap({ timeout: 12_000 }) : locator.click({ timeout: 12_000 })
    async function tool(page: Page, name: string) {
      const tab = page.locator('.rail-tab').filter({ hasText: new RegExp(`^${name}(?:\\d+)?$`) })
      if (await tab.getAttribute('aria-pressed') === 'true') {
        const back = page.getByTitle('Back to library', { exact: true })
        if (await back.count()) await activate(back)
      } else await activate(tab)
      await panelFits(page)
    }
    async function close(page: Page) {
      const done = page.getByRole('button', { name: 'Close tool panel' })
      if (await done.isVisible()) await activate(done)
    }
    test.beforeEach(async ({ page }) => { await fixtures(page); await openEditor(page) })

    test('custom dimensions, frame rate and paired inspector numbers show their full values', async ({ page }, info) => {
      await loadProject(page, { ...base, width: 1920, height: 1080, frameRate: 120, visuals: [{ type: 'IMAGE', src: fx('image.png'), width: 1920, height: 1080 }] })
      const settings = page.getByRole('button', { name: 'Project settings', exact: true })
      if (await settings.isVisible()) await activate(settings)
      await page.getByTitle('Resolution preset', { exact: true }).selectOption('custom')
      const width = page.locator('.topbar .num-wrap[title="Width (px)"] input')
      const height = page.locator('.topbar .num-wrap[title="Height (px)"] input')
      const rate = page.locator('.topbar label[title="Frame rate"] input')
      async function readable(input: Locator, value: string) {
        await expect(input).toHaveValue(value)
        await input.scrollIntoViewIfNeeded()
        await fits(page, input)
        const sizes = await input.evaluate((el: HTMLInputElement) => {
          const style = getComputedStyle(el)
          const measure = document.createElement('canvas').getContext('2d')!
          measure.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          return {
            available: el.getBoundingClientRect().width
              - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
              - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            required: measure.measureText(el.value).width,
          }
        })
        expect(sizes.available, `Full value ${value} must remain readable`).toBeGreaterThanOrEqual(sizes.required)
      }
      await readable(width, '1920')
      await readable(height, '1080')
      await readable(rate, '120')
      await page.screenshot({ path: info.outputPath('readable-project-numbers.png') })
      if (await settings.isVisible()) await page.keyboard.press('Escape')
      await close(page)
      await activate(page.locator('.clip').filter({ hasText: 'image.png' }).first())
      await activate(sec(page, 'Layout').locator('.sec-head'))
      await readable(field(sec(page, 'Layout'), 'Width').locator('input.num'), '1920')
      await readable(field(sec(page, 'Layout'), 'Height').locator('input.num'), '1080')
      await panelFits(page)
      await page.screenshot({ path: info.outputPath('readable-inspector-numbers.png') })
    })

    test('stock search paginates through actual scrolling and items insert by tap', async ({ page }, info) => {
      await loadProject(page, { ...base, visuals: [] })
      const requested: number[] = []
      await page.route('**/api/stock/search**', route => {
        const pageNo = Number(new URL(route.request().url()).searchParams.get('page'))
        requested.push(pageNo)
        return route.fulfill({ json: { items: Array.from({ length: pageNo === 1 ? 48 : 12 }, (_, i) => ({
          id: `image-${pageNo}-${i}`, kind: 'image', provider: 'fixture', preview: fx('image.png'),
          src: `${fx('image.png')}?page=${pageNo}&item=${i}`, width: 320, height: 240,
          description: `Stock ${pageNo} ${i}`,
        })), hasMore: pageNo === 1 } })
      })
      await tool(page, 'Images')
      const search = page.locator('.stock-panel input').first()
      await search.fill('responsive stock')
      await search.press('Enter')
      const cells = page.locator('.stock-panel .cell:not(.skeleton)')
      await expect(cells).toHaveCount(48)
      const area = page.locator('.rail-panel-body')
      const box = (await area.boundingBox())!
      if (screen.touch) {
        const cdp = await page.context().newCDPSession(page)
        for (let swipe = 0; swipe < 16 && await cells.count() === 48; swipe++) {
          const start = box.y + box.height - 15
          const end = box.y + 20
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: start }] })
          for (let step = 1; step <= 8; step++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2, y: start + (end - start) * step / 8 }] })
            await page.waitForTimeout(20)
          }
          // Rest the finger before release, so the browser does not consume
          // the later selection tap solely to cancel a high-velocity fling.
          await page.waitForTimeout(150)
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2, y: end }] })
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await page.waitForTimeout(80)
        }
        await cdp.detach()
      } else {
        await area.hover()
        await page.mouse.wheel(0, 5000)
      }
      await expect(cells).toHaveCount(60)
      expect(requested.filter(p => p === 2)).toHaveLength(1)
      // Wait until kinetic touch scrolling stops before selecting a tile.
      await cells.last().scrollIntoViewIfNeeded()
      let lastTop = -1
      let stationarySamples = 0
      await expect.poll(async () => {
        const top = await area.evaluate(e => e.scrollTop)
        stationarySamples = top === lastTop ? stationarySamples + 1 : 0
        lastTop = top
        return stationarySamples
      }, { intervals: [100], timeout: 10_000 }).toBeGreaterThanOrEqual(4)
      await activate(cells.last())
      await expect.poll(async () => (await exportedDoc(page)).visuals?.some((v: any) => v.src === `${fx('image.png')}?page=2&item=11`)).toBe(true)
      await panelFits(page)
      await page.screenshot({ path: info.outputPath('stock-scroll.png') })
    })

    test('media URL insertion and all inspector tabs remain editable', async ({ page }, info) => {
      test.setTimeout(120_000)
      await loadProject(page, { ...base, visuals: [] })
      for (const [tab, kind, file] of [['Images', 'image', 'image.png'], ['Videos', 'video', 'clip.mp4'], ['GIFs', 'GIF', 'anim.gif'], ['Audio', 'audio', 'tone.mp3']]) {
        await tool(page, tab)
        await activate(page.getByRole('button', { name: `Add ${kind} by URL`, exact: true }))
        await page.locator('.url-form input').fill(fx(file))
        await activate(page.getByRole('button', { name: `Add ${kind}`, exact: true }))
        await expect.poll(async () => kind === 'audio' ? (await exportedDoc(page)).audios?.length : (await exportedDoc(page)).visuals?.some((v: any) => v.src === fx(file))).toBe(kind === 'audio' ? 1 : true)
      }
      // Select the image with the normal timeline control (setup placed it at 0).
      await close(page)
      await activate(page.locator('.clip').filter({ hasText: 'image.png' }).first())
      await expect(page.locator('.inspector')).toBeVisible()
      await activate(sec(page, 'Layout').locator('.sec-head'))
      await num(sec(page, 'Layout'), 'Width', '180')
      await num(sec(page, 'Layout'), 'Rotation', '20')
      await activate(sec(page, 'Layout').getByRole('button', { name: 'Flip H', exact: true }))
      await expect.poll(async () => (await exportedDoc(page)).visuals[0]).toMatchObject({ width: 180, angle: 20, flipH: true })
      await activate(page.locator('.insp-tabs').getByRole('button', { name: 'Timing', exact: true }))
      await num(sec(page, 'Timeline window'), 'Disappears at (exitEnd)', '6')
      await activate(page.locator('.insp-tabs').getByRole('button', { name: 'Effects', exact: true }))
      await sec(page, 'Enter animation').getByRole('textbox', { name: 'Search effects' }).fill('fade')
      await activate(sec(page, 'Enter animation').getByTitle('Fade', { exact: true }))
      await activate(sec(page, 'Exit animation').getByTitle('Fade', { exact: true }))
      await activate(sec(page, 'Color filters').locator('.sec-head'))
      await field(sec(page, 'Color filters'), 'Brightness').locator('input').press('ArrowRight')
      await field(sec(page, 'Color filters'), 'Blur').locator('input').press('ArrowRight')
      await expect.poll(async () => (await exportedDoc(page)).visuals[0]).toMatchObject({ enterAnimation: 'fade', exitAnimation: 'fade', filter: { brightness: 1, blur: 1 } })
      await panelFits(page)
      await page.screenshot({ path: info.outputPath('media-effects.png') })
      await activate(page.locator('.insp-tabs').getByRole('button', { name: 'JSON', exact: true }))
      await expect(page.locator('.insp-body')).toContainText('JSON')
      const raw = sec(page, 'Raw element JSON')
      const imageJson = (await exportedDoc(page)).visuals[0]
      await raw.locator('textarea').fill(JSON.stringify({ ...imageJson, angle: 35 }, null, 2))
      await activate(raw.getByRole('button', { name: 'Apply', exact: true }))
      await expect.poll(async () => (await exportedDoc(page)).visuals[0].angle).toBe(35)
      await close(page)
      await activate(page.locator('.clip').filter({ hasText: 'clip.mp4' }).first())
      await activate(page.locator('.insp-tabs').getByRole('button', { name: 'Timing', exact: true }))
      await num(sec(page, 'Source trim'), 'Video begin', '0.2')
      await num(sec(page, 'Source trim'), 'Video end', '1.5')
      await num(sec(page, 'Source trim'), 'Playback speed', '1.5')
      await num(sec(page, 'Source trim'), 'Volume', '50')
      await expect.poll(async () => (await exportedDoc(page)).visuals[1]).toMatchObject({ videoBegin: 0.2, videoEnd: 1.5, speed: 1.5, volume: 0.5 })
      await close(page)
      await activate(page.locator('.clip').filter({ hasText: 'anim.gif' }).first())
      await num(sec(page, 'Playback'), 'Speed', '2')
      await expect.poll(async () => (await exportedDoc(page)).visuals[2].speed).toBe(2)
      await close(page)
      await activate(page.locator('.aclip').filter({ hasText: 'tone.mp3' }).first())
      await num(sec(page, 'Mix'), 'Volume', '40')
      await num(sec(page, 'Mix'), 'Speed (atempo)', '1.25')
      await num(sec(page, 'Source trim'), 'Audio begin', '0.1')
      await expect.poll(async () => (await exportedDoc(page)).audios[0]).toMatchObject({ volume: 0.4, speed: 1.25, audioBegin: 0.1 })
      await panelFits(page)
    })

    test('text, shape and canvas additions; fonts and long variable menus', async ({ page }, info) => {
      test.setTimeout(120_000)
      await loadProject(page, { ...base, visuals: [], variables: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`label${i}`, i + 1])) })
      await tool(page, 'Text')
      await activate(page.getByRole('button', { name: 'Add a heading Heading', exact: true }))
      await close(page)
      await activate(page.locator('.clip').filter({ hasText: 'Your heading' }).first())
      await sec(page, 'Content').locator('textarea').fill('Responsive heading')
      await sec(page, 'Content').locator('textarea').press('Tab')
      await activate(sec(page, 'Typography').getByRole('button', { name: 'Font family' }))
      await fits(page, page.getByRole('dialog', { name: 'Choose Google font' }))
      await page.getByRole('textbox', { name: 'Search Google Fonts' }).fill('Roboto')
      await activate(page.getByRole('dialog', { name: 'Choose Google font' }).getByRole('button', { name: 'Roboto', exact: true }))
      await num(sec(page, 'Typography'), 'Size', '36')
      await panelFits(page)
      await activate(page.locator('.insp-tabs').getByRole('button', { name: 'Timing', exact: true }))
      const variableButton = sec(page, 'Timeline window').locator('.vm-btn').last()
      await activate(variableButton)
      await fits(page, page.locator('.vm-pop'))
      await expect(page.locator('.vm-pop')).toHaveCSS('opacity', '1')
      await page.screenshot({ path: info.outputPath('variable-menu.png') })
      await activate(page.locator('.vm-pop').getByRole('button', { name: '{{label3}}', exact: true }))
      await expect.poll(async () => (await exportedDoc(page)).visuals[0].exitBegin).toBe('{{label3}}')
      await expect(page.locator('.vm-pop')).toHaveCount(0)
      await activate(variableButton)
      await page.keyboard.press('Escape')
      await expect(page.locator('.vm-pop')).toHaveCount(0)
      await expect(variableButton).toBeFocused()
      await activate(variableButton)
      await activate(page.locator('.vm-pop').getByRole('button', { name: 'Manage variables…', exact: true }))
      await expect(page.locator('.vars-panel')).toBeVisible()
      await page.screenshot({ path: info.outputPath('variables.png') })
      await tool(page, 'Shape')
      await page.getByPlaceholder('Search shapes… (arrow, badge, wave)').fill('rectangle')
      await activate(page.getByRole('button', { name: 'QA rectangle', exact: true }))
      await expect.poll(async () => (await exportedDoc(page)).visuals.some((v: any) => v.type === 'SVG')).toBe(true)
      await tool(page, 'Canvas')
      await activate(page.getByRole('button', { name: 'QA canvas', exact: true }))
      await expect.poll(async () => (await exportedDoc(page)).visuals.some((v: any) => v.customCode?.js)).toBe(true)
      await panelFits(page)
    })

    test('variables, scenes, transitions, captions and image layer actions', async ({ page }, info) => {
      test.setTimeout(150_000)
      await loadProject(page, { ...base, visuals: [] })
      await tool(page, 'Variables')
      await page.getByPlaceholder('variableName').fill('headline')
      await activate(page.locator('.add-row').getByRole('button', { name: 'Add', exact: true }))
      await page.locator('.var-row input[placeholder="value"]').fill('Hello tablet')
      await page.locator('.var-row input[placeholder="value"]').press('Tab')
      await activate(page.getByTitle('Rename', { exact: true }))
      await page.locator('.rename').fill('title')
      await page.locator('.rename').press('Enter')
      await expect.poll(async () => (await exportedDoc(page)).variables).toEqual({ title: 'Hello tablet' })
      await panelFits(page)
      await tool(page, 'Scenes')
      await activate(page.locator('.rail-panel').getByRole('button', { name: 'Add scene', exact: true }))
      await activate(page.locator('.rail-panel').getByRole('button', { name: 'Add scene', exact: true }))
      const scenes = page.locator('.scene-card:not(.global)')
      await activate(scenes.first())
      await field(page.locator('.scene-settings'), 'Scene id').locator('input').fill('intro')
      await field(page.locator('.scene-settings'), 'Scene id').locator('input').press('Tab')
      await page.locator('.scene-settings').getByRole('textbox', { name: 'Search effects' }).fill('fade')
      await activate(page.locator('.scene-settings').getByTitle('Fade', { exact: true }))
      await num(page.locator('.scene-settings'), 'Transition duration', '0.7')
      await expect.poll(async () => (await exportedDoc(page)).scenes[0]).toMatchObject({ id: 'intro', transition: 'fade', transitionDuration: 0.7 })
      await activate(scenes.first().getByTitle('Move down', { exact: true }))
      await expect.poll(async () => (await exportedDoc(page)).scenes[1].id).toBe('intro')
      await panelFits(page)
      await tool(page, 'Subtitles')
      await activate(page.getByRole('button', { name: 'Add caption at playhead' }))
      await field(page.locator('.subs-panel'), 'Text').locator('textarea').fill('Hello small screens')
      await field(page.locator('.subs-panel'), 'Text').locator('textarea').press('Tab')
      await activate(sec(page, 'Subtitle style').locator('.sec-head'))
      await field(sec(page, 'Subtitle style'), 'Mode').locator('select').selectOption('karaoke')
      await expect.poll(async () => (await exportedDoc(page)).subtitle?.captions?.[0]?.text).toBe('Hello small screens')
      await panelFits(page)
      await page.screenshot({ path: info.outputPath('captions.png') })
      // Image project is staged data; all stack operations use real controls.
      await loadProject(page, { type: 'image', width: 640, height: 360, outputFormat: 'png', visuals: [{ type: 'IMAGE', src: fx('image.png'), width: 100 }, { type: 'TEXT', text: 'Top layer' }] })
      await tool(page, 'Layers')
      const rows = page.locator('.layers-panel .row')
      await activate(rows.first().locator('.thumb'))
      await activate(rows.first().getByTitle('Duplicate', { exact: true }))
      await expect(rows).toHaveCount(3)
      await activate(rows.first().getByTitle('Send backward', { exact: true }))
      await activate(rows.nth(1).locator('.thumb'))
      await activate(rows.nth(1).getByTitle('Delete layer', { exact: true }))
      await expect(rows).toHaveCount(2)
      const imageRow = rows.filter({ has: page.locator('.row-label[title="image.png"]') })
      await activate(imageRow.locator('.thumb'))
      await activate(imageRow.getByTitle('Replace image (keeps size, position and effects)', { exact: true }))
      await activate(page.getByRole('button', { name: 'Add image by URL', exact: true }))
      await page.locator('.url-form input').fill(fx('shape.svg'))
      await activate(page.getByRole('button', { name: 'Add image', exact: true }))
      await expect.poll(async () => (await exportedDoc(page)).visuals.find((v: any) => v.type === 'IMAGE')?.src).toBe(fx('shape.svg'))
      expect((await exportedDoc(page)).visuals.find((v: any) => v.type === 'IMAGE').width).toBe(100)
      await panelFits(page)
    })
  })
}
