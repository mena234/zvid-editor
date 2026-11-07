import { createRequire } from 'node:module'
import { test, expect, type Locator } from '@playwright/test'
import { openEditor, loadProject, exportedDoc } from './helpers/app'

const require = createRequire(import.meta.url)
const { buildHtmlContent, fitTextToBox, buildSvgHtmlContent } = require('../helpers/nativeText.cjs')

// These compare actual browser line boxes against the renderer's capture HTML,
// rather than accepting a whole-frame similarity score that can hide shifted text.
const cases: { name: string; item: Record<string, any> }[] = [
  {
    name: 'production arrow uses the same complete Space Grotesk face',
    item: { html: "<div style='display:inline-block; background:#37D3C0; color:#0A1214; border-radius:999px; padding:26px 64px; font-size:36px; font-weight:700;'>Be the first to view it →</div>", style: { fontFamily: 'Space Grotesk' } },
  },
  {
    name: 'production approximation symbol uses the same Inter line metrics',
    item: { html: "<div style='color:#0EA5A4; font-size:24px; font-weight:800; letter-spacing:4px;'>DURATION</div><div style='margin-top:8px; color:#0C2E2D; font-size:66px; font-weight:800; letter-spacing:-1px;'>≈ 45 min</div>", style: { fontFamily: 'Inter' } },
  },
  {
    name: 'production arrow uses the same Inter chip line metrics',
    item: { html: "<div style='display:inline-block; background:#D9B8E8; color:#131015; border-radius:999px; padding:20px 52px; font-size:32px; font-weight:800;'>Shop now →</div>", style: { fontFamily: 'Inter' } },
  },
  {
    name: 'production gallery inline block chip',
    item: { html: "<div style='display:inline-block; border:1.5px solid rgba(167,243,208,0.55); border-radius:999px; padding:14px 34px; color:#A7F3D0; font-size:25px; font-weight:700; letter-spacing:5px;'>MADE 100% BY AI</div>", style: { fontFamily: 'Sora' } },
  },
  {
    name: 'numeric typography and padded centered text',
    item: { width: 360, height: 140, text: 'ALIGNED TEXT', style: {
      fontSize: 48, padding: 12, letterSpacing: 2, fontWeight: 700,
      lineHeight: 1.2, textAlign: 'center', backgroundColor: '#25344a',
    } },
  },
  {
    name: 'HTML whitespace and heading paragraph margins',
    item: { width: 360, html: '<h2>First</h2>\n<p>Second   line</p>', style: { fontSize: '24px' } },
  },
  {
    name: 'HTML descendant padding and borders',
    item: { width: 360, html: '<div style="padding:18px;border:4px solid #789">Shared box</div>', style: { fontSize: '28px', textAlign: 'center' } },
  },
  {
    name: 'style dimensions override the declared capture box',
    item: { width: 400, height: 160, text: 'The same centered line wraps here', style: { width: 220, height: 130, fontSize: 30, textAlign: 'center' } },
  },
  {
    name: 'CSS custom text uses numeric lengths and style dimensions',
    item: { width: 400, height: 160, html: '<span>Shared custom layout</span>', style: { width: 220, fontSize: 30, padding: 10, textAlign: 'center' }, customCode: { css: '.container { color: #fff; }' } },
  },
  {
    name: 'script custom text uses numeric lengths and style dimensions',
    item: { width: 400, height: 160, text: 'Shared script layout', style: { width: 220, fontSize: 30, padding: 10, textAlign: 'center' }, customCode: { js: 'document.documentElement.dataset.ready = "true"' } },
  },
  {
    name: 'authored HTML spacing and box sizing override the reset',
    item: { width: 360, html: '<p style="margin-left:12px;padding:8px;width:300px;box-sizing:border-box">First\nSecond</p>', style: { fontSize: '24px', whiteSpace: 'pre-wrap' } },
  },
  {
    name: 'fit to box measures the same reset and numeric typography',
    item: { width: 260, height: 100, fitToBox: true, html: '<h2>Fitted heading</h2><p>Second line</p>', style: { fontSize: 42, textAlign: 'center' } },
  },
]

async function textMetrics(container: Locator) {
  return container.evaluate((root) => {
    const origin = root.getBoundingClientRect()
    const rounded = (n: number) => Math.round(n * 64) / 64
    const rect = (r: DOMRect) => ({ x: rounded(r.x - origin.x), y: rounded(r.y - origin.y), width: rounded(r.width), height: rounded(r.height) })
    const elements = [root, ...root.querySelectorAll('*')].map((element) => {
      const s = getComputedStyle(element)
      return { tag: element.tagName, rect: rect(element.getBoundingClientRect()), boxSizing: s.boxSizing, fontSize: s.fontSize, lineHeight: s.lineHeight, whiteSpace: s.whiteSpace, letterSpacing: s.letterSpacing, textAlign: s.textAlign, padding: s.padding, margin: s.margin }
    })
    const lines = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      lines.push({ text: node.textContent, rects: Array.from(range.getClientRects(), rect) })
    }
    return { elements, lines }
  })
}

for (const entry of cases) {
  test(entry.name, async ({ page, context }, testInfo) => {
    const item: Record<string, any> = { type: 'TEXT', x: 40, y: 40, ...entry.item, style: { fontFamily: 'Noto Sans', color: '#fff', ...entry.item.style } }
    const project = { width: 640, height: 360, duration: 4, frameRate: 30, backgroundColor: '#141820', visuals: [item] }
    await openEditor(page)
    await loadProject(page, project)
    await page.evaluate(() => {
      const e = (window as any).__zvidTest.editor
      e.stageZoom = 1
      e.clearSelection()
      e.showGrid = false
      e.showSafeArea = false
    })
    const isIframe = !!(item as any).customCode?.js
    const preview = isIframe
      ? page.frameLocator('.stage-frame .code-frame').locator('.container')
      : page.locator('.stage-frame .text-inner, .stage-frame .shadow-content .container')
    await expect(preview).toBeVisible()
    await preview.evaluate(async (el) => { await el.ownerDocument.fonts.ready })

    const reference = await context.newPage()
    try {
      await reference.setViewportSize({ width: 640, height: 360 })
      await reference.setContent(await buildHtmlContent({
        width: item.width, height: (item as any).height, text: (item as any).text,
        html: (item as any).html, animationCss: (item as any).customCode?.css, ...item.style,
      }))
      expect(await reference.evaluate(() => document.compatMode)).toBe('CSS1Compat')
      await reference.evaluate(async () => { await document.fonts.ready })
      await fitTextToBox(reference, item)
      const expected = await textMetrics(reference.locator('.container'))
      // Keep a 0.05px geometry tolerance, far below a visible pixel shift,
      // while CSS declarations remain exact.
      const near = (value: any): any => typeof value === 'number' ? expect.closeTo(value, 1)
        : Array.isArray(value) ? value.map(near)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, near(entry)]))
        : value
      await expect.poll(() => textMetrics(preview), { timeout: 15_000 }).toEqual(near(expected))
      const output = await exportedDoc(page)
      expect(output.visuals[0].style).toEqual(item.style)
      await testInfo.attach('text-layout', { body: JSON.stringify(expected, null, 2), contentType: 'application/json' })
    } finally {
      await page.screenshot({ path: testInfo.outputPath('editor.png') })
      await reference.screenshot({ path: testInfo.outputPath('renderer-text.png') })
      await reference.close()
    }
  })
}

for (const customCode of [undefined, { js: 'document.documentElement.dataset.ready = "true"' }]) {
  test(`standalone SVG fonts match the renderer in ${customCode ? 'script iframe' : 'shadow DOM'}`, async ({ page, context }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="180"><text x="5" y="60" font-family="Space Grotesk" font-size="44" font-weight="700">Standalone →</text><text x="5" y="130" style="font-family:Inter;font-size:54px;font-weight:800">≈ 45 min</text></svg>'
    const item = { type: 'SVG', svg, x: 40, y: 40, width: 560, height: 180, customCode }
    await openEditor(page)
    await loadProject(page, { width: 640, height: 360, duration: 4, frameRate: 30, visuals: [item] })
    await page.evaluate(() => { (window as any).__zvidTest.editor.stageZoom = 1 })
    const preview = customCode
      ? page.frameLocator('.stage-frame .code-frame').locator('.container')
      : page.locator('.stage-frame .shadow-content .container')
    await expect(preview).toBeVisible()
    const metrics = (container: Locator) => container.evaluate(async root => {
      await root.ownerDocument.fonts.ready
      return Array.from(root.querySelectorAll('text'), el => {
        const b = el.getBBox()
        return { x: b.x, y: b.y, width: b.width, height: b.height }
      })
    })
    const reference = await context.newPage()
    try {
      await reference.setContent(await buildSvgHtmlContent(item))
      const expected = await metrics(reference.locator('.container'))
      await expect.poll(() => metrics(preview), { timeout: 15_000 }).toEqual(expected.map(rect => ({
        x: expect.closeTo(rect.x, 1), y: expect.closeTo(rect.y, 1),
        width: expect.closeTo(rect.width, 1), height: expect.closeTo(rect.height, 1),
      })))
    } finally {
      await reference.close()
    }
  })
}
