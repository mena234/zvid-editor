import { test, expect, type Page, type Locator } from '@playwright/test'
import { exportedDoc, loadProject, openEditor, store } from './helpers/app'

const EMBED = 'https://embed.tawk.to/6a54e8f61df89a1d45ebaa2a/1jtdqs1ga'

// Exercise the public provider lifecycle with a real iframe that would block
// footer controls if the integration failed to hide it. No chat is submitted.
const widget = `(() => {
  const api = window.Tawk_API;
  window.__supportMock = { autoStart: api.autoStart, zIndex: api.customStyle.zIndex, starts: 0 };
  const frame = document.createElement('iframe');
  frame.title = 'Chat widget';
  frame.style.cssText = 'position:fixed;right:8px;bottom:8px;width:min(350px,calc(100vw - 16px));height:min(400px,calc(100vh - 120px));border:1px solid black;background:white;z-index:' + api.customStyle.zIndex;
  frame.style.display = api.autoStart === false ? 'none' : 'block';
  frame.srcdoc = '<button onclick="parent.Tawk_API.onChatMinimized()">Minimize chat</button><p>Support chat</p>';
  document.body.appendChild(frame);
  api.start = () => { window.__supportMock.starts++; };
  api.showWidget = () => { frame.style.display = 'block'; };
  api.hideWidget = () => { frame.style.display = 'none'; api.onChatHidden?.(); };
  api.maximize = () => { frame.style.display = 'block'; api.onChatMaximized?.(); };
  api.onBeforeLoad?.();
  api.onLoad?.();
})();`

async function activate(page: Page, locator: Locator) {
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await locator.tap()
  else await locator.click()
}

async function openHelp(page: Page) {
  const more = page.getByRole('button', { name: 'More editor actions', exact: true })
  if (await more.isVisible()) await activate(page, more)
  await activate(page, page.getByRole('button', { name: 'Help', exact: true }))
  const help = page.getByRole('dialog', { name: 'Help', exact: true })
  await expect(help).toBeVisible()
  const contact = help.getByRole('link', { name: 'https://zvid.io/contact' })
  await expect(contact).toHaveAttribute('href', 'https://zvid.io/contact')
  await expect(contact).toHaveAttribute('target', '_blank')
  await expect(contact).toHaveAttribute('rel', 'noopener noreferrer')
  return help
}

for (const viewport of [
  { width: 320, height: 640, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 820, height: 1180, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 1366, height: 768, touch: false },
]) {
  test.describe(`support ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.touch })
    test('loads only on request, hides after minimize, and yields to editor dialogs', async ({ page }, info) => {
      let requests = 0
      await page.route(EMBED, async route => {
        requests++
        await route.fulfill({ contentType: 'application/javascript', body: widget })
      })
      await openEditor(page)
      await page.waitForTimeout(250)
      expect(requests).toBe(0)
      await expect(page.locator('iframe[title="Chat widget"]')).toHaveCount(0)
      let help = await openHelp(page)
      expect(requests).toBe(0)
      await activate(page, help.getByRole('button', { name: 'Chat with support' }))
      const frame = page.locator('iframe[title="Chat widget"]')
      await expect(frame).toBeVisible()
      await expect(help).toHaveCount(0)
      expect(await page.evaluate(() => (window as any).__supportMock)).toMatchObject({ autoStart: false, zIndex: 90 })
      await activate(page, page.frameLocator('iframe[title="Chat widget"]').getByRole('button', { name: 'Minimize chat' }))
      await expect(frame).toBeHidden()

      help = await openHelp(page)
      await activate(page, help.getByRole('button', { name: 'Chat with support' }))
      await expect(frame).toBeVisible()
      expect(requests).toBe(1)
      await activate(page, page.locator('.topbar').getByRole('button', { name: 'Export', exact: true }))
      await expect(page.getByRole('dialog', { name: /Export/ })).toBeVisible()
      await expect(frame).toBeHidden()
      const download = page.waitForEvent('download')
      await activate(page, page.getByRole('button', { name: 'Download JSON', exact: true }))
      expect((await download).suggestedFilename()).toMatch(/\.json$/)
      // A late provider maximization must not cover the open editor dialog.
      await page.evaluate(() => (window as any).Tawk_API.maximize())
      await expect(frame).toBeHidden()
      await page.screenshot({ path: info.outputPath(`support-export-${viewport.width}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    })
  })
}

test.describe('support loading and failure', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
  test('Help contains editor shortcuts and Enter still opens chat', async ({ page }) => {
    await page.route(EMBED, route => route.fulfill({ contentType: 'application/javascript', body: widget }))
    await openEditor(page)
    await loadProject(page, {
      name: 'Help keyboard isolation', resolution: 'full-hd', duration: 8,
      visuals: [{ type: 'TEXT', text: 'Keep this text', x: 600, y: 350, width: 600, height: 120, fontSize: 70 }],
    })
    const panel = page.getByRole('button', { name: 'Close tool panel', exact: true })
    if (await panel.isVisible()) await panel.tap()
    await page.locator('.stage-item').tap()
    const selected = await store(page, 'editor', 'selectedId')
    expect(selected).toBeTruthy()
    const before = await exportedDoc(page)
    const help = await openHelp(page)
    // The contact link has no native action for these keys, unlike Space on a
    // button. Shortcuts must not reach the selected text or the transport.
    const contact = help.getByRole('link', { name: 'https://zvid.io/contact' })
    for (const key of ['ArrowRight', 'Delete', 'Backspace', 'x', 'Space', 'Control+z', 'Control+y', 'Control+d']) {
      await contact.focus()
      await page.keyboard.press(key)
      expect(await exportedDoc(page), key).toEqual(before)
      expect(await store(page, 'editor', 'editingTextId'), key).toBeNull()
      expect(await store(page, 'editor', 'playing'), key).toBe(false)
      expect(await store(page, 'editor', 'selectedId'), key).toBe(selected)
      await expect(help).toBeVisible()
    }
    await help.getByRole('button', { name: 'Chat with support' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('iframe[title="Chat widget"]')).toBeVisible()
    expect(await exportedDoc(page)).toEqual(before)
    expect(await store(page, 'editor', 'editingTextId')).toBeNull()
    await activate(page, page.frameLocator('iframe[title="Chat widget"]').getByRole('button', { name: 'Minimize chat' }))
    await activate(page, page.locator('.topbar').getByRole('button', { name: 'Sign in', exact: true }))
    const email = page.getByLabel('Email', { exact: true })
    await email.fill('help@example.com')
    await email.press('End')
    await email.press('Backspace')
    await expect(email).toHaveValue('help@example.co')
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal')).toHaveCount(0)
  })

  test('a delayed widget cannot reopen after Help closes or cover another modal', async ({ page }) => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    await page.route(EMBED, async route => {
      await waiting
      await route.fulfill({ contentType: 'application/javascript', body: widget })
    })
    await openEditor(page)
    const help = await openHelp(page)
    await activate(page, help.getByRole('button', { name: 'Chat with support' }))
    await expect(help.getByRole('button', { name: 'Opening chat…' })).toBeDisabled()
    await activate(page, help.getByRole('button', { name: 'Close', exact: true }))
    await activate(page, page.locator('.topbar').getByRole('button', { name: 'Export', exact: true }))
    release()
    await expect(page.locator('iframe[title="Chat widget"]')).toHaveCount(1)
    await expect(page.locator('iframe[title="Chat widget"]')).toBeHidden()
    await expect(page.getByRole('dialog', { name: /Export/ })).toBeVisible()
    await activate(page, page.getByRole('button', { name: 'Close', exact: true }))
    const reopened = await openHelp(page)
    await expect(page.locator('iframe[title="Chat widget"]')).toBeHidden()
    await activate(page, reopened.getByRole('button', { name: 'Chat with support' }))
    await expect(page.locator('iframe[title="Chat widget"]')).toBeVisible()
  })

  test('blocked chat keeps the contact fallback and permits retry', async ({ page }) => {
    await page.route(EMBED, route => route.abort())
    await openEditor(page)
    const help = await openHelp(page)
    await activate(page, help.getByRole('button', { name: 'Chat with support' }))
    await expect(help.getByRole('status')).toContainText('Chat is unavailable')
    await expect(help.getByRole('link', { name: 'https://zvid.io/contact' })).toBeVisible()
    await page.unroute(EMBED)
    await page.route(EMBED, route => route.fulfill({ contentType: 'application/javascript', body: widget }))
    await activate(page, help.getByRole('button', { name: 'Chat with support' }))
    await expect(page.locator('iframe[title="Chat widget"]')).toBeVisible()
  })
})
