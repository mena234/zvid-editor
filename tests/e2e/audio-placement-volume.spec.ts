import { test, expect, type Page } from '@playwright/test'
import { openEditor, loadProject, exportedDoc, fx, resetMockOrch } from './helpers/app'

const BASE = { width: 640, height: 360, duration: 10, frameRate: 30, outputFormat: 'mp4' }

async function observeGainNodes(page: Page) {
  await page.addInitScript(() => {
    const OriginalContext = window.AudioContext
    const entries: { context: AudioContext; gain: GainNode; media?: HTMLMediaElement }[] = []
    ;(window as any).__previewGains = entries
    window.AudioContext = class extends OriginalContext {
      override createGain() {
        const gain = super.createGain()
        entries.push({ context: this, gain })
        return gain
      }
      override createMediaElementSource(media: HTMLMediaElement) {
        const source = super.createMediaElementSource(media)
        const entry = entries.findLast((entry) => entry.context === this && !entry.media)
        if (entry) entry.media = media
        return source
      }
    }
  })
}

function volumeField(page: Page) {
  return page.locator('.insp-body .field').filter({
    has: page.locator('.field-label:text-is("Volume")'),
  })
}

async function setVolume(page: Page, value: string) {
  const input = volumeField(page).locator('input.num')
  await input.fill(value)
  await input.press('Enter')
}

test.beforeAll(async () => { await resetMockOrch() })

test('audio URL starts at the cursor; percent volume amplifies remote preview through the CORS fallback', async ({ page }) => {
  await observeGainNodes(page)
  const audio = Buffer.from(await (await fetch(fx('tone.mp3'))).arrayBuffer())
  const remote = 'https://media.example.test/track.mp3'
  await page.route(remote, (route) => route.fulfill({
    status: 200, contentType: 'audio/mpeg', body: audio,
    // An explicit mismatch prevents Playwright from adding its permissive
    // default header when fulfilling a cross-origin request.
    headers: { 'access-control-allow-origin': 'https://different-origin.example.test' },
  }))
  await page.route('**/api/filter-media?src=*', (route) => route.fulfill({
    status: 200, contentType: 'audio/mpeg', body: audio,
  }))
  await openEditor(page)
  await loadProject(page, { ...BASE, audios: [] })
  await page.evaluate(() => {
    const { editor } = (window as any).__zvidTest
    editor.seek(3.25)
    editor.openPanel('audio')
  })
  await page.getByRole('button', { name: 'Add audio by URL' }).click()
  await page.locator('.url-form input.ctl').fill(remote)
  await page.locator('.url-form').getByRole('button', { name: 'Add audio', exact: true }).click()
  await expect.poll(async () => (await exportedDoc(page)).audios?.[0].enter).toBe(3.25)

  await page.evaluate(() => (window as any).__zvidTest.editor.openInspector())
  await expect(volumeField(page).locator('input[type=range]')).toHaveAttribute('max', '200')
  await expect(volumeField(page).locator('.unit')).toHaveText('%')
  await setVolume(page, '200')
  await expect.poll(async () => (await exportedDoc(page)).audios?.[0].volume).toBe(2)
  await expect.poll(() => page.evaluate(() => {
    const entry = (window as any).__previewGains.findLast((entry: any) => entry.media?.tagName === 'AUDIO')
    return entry && {
      gain: entry.gain.gain.value,
      loaded: entry.media.readyState >= 2,
      proxy: entry.media.src.includes('/api/filter-media?src='),
    }
  })).toEqual({ gain: 2, loaded: true, proxy: true })

  await page.evaluate(() => {
    const { editor } = (window as any).__zvidTest
    editor.seek(3.5)
    editor.playing = true
  })
  await expect.poll(() => page.evaluate(() => {
    const entry = (window as any).__previewGains.findLast((entry: any) => entry.media?.tagName === 'AUDIO')
    return entry.media.paused
  })).toBe(false)

  await page.evaluate(() => { (window as any).__zvidTest.editor.playing = false })
  await setVolume(page, '50')
  await expect.poll(async () => (await exportedDoc(page)).audios?.[0].volume).toBe(0.5)
  await setVolume(page, '-1')
  await expect.poll(async () => (await exportedDoc(page)).audios?.[0].volume).toBe(0)
  await setVolume(page, '')
  await expect.poll(async () => (await exportedDoc(page)).audios?.[0].volume).toBeUndefined()
})

test('video volume displays percentages and previews the stored gain above 100%', async ({ page }) => {
  await observeGainNodes(page)
  await openEditor(page)
  await loadProject(page, {
    ...BASE,
    visuals: [{ type: 'VIDEO', src: fx('clip.mp4'), volume: 1.5 }],
  })
  await page.evaluate(() => {
    const { project, editor } = (window as any).__zvidTest
    editor.selectVisual(project.doc.visuals[0]._id)
    editor.openInspector()
  })
  await page.locator('.insp-tabs button', { hasText: 'Timing' }).click()
  await expect(volumeField(page).locator('input.num')).toHaveValue('150')
  await setVolume(page, '250')
  await expect(volumeField(page).locator('input.num')).toHaveValue('200')
  await expect.poll(async () => (await exportedDoc(page)).visuals?.[0].volume).toBe(2)
  await expect.poll(() => page.evaluate(() => {
    const entry = (window as any).__previewGains.findLast((entry: any) => entry.media?.tagName === 'VIDEO')
    return entry && { gain: entry.gain.gain.value, loaded: entry.media.readyState >= 2 }
  })).toEqual({ gain: 2, loaded: true })
})

test('adding URL audio at the endpoint leaves a playable timeline window', async ({ page }) => {
  await openEditor(page)
  await loadProject(page, { ...BASE, audios: [] })
  await page.locator('button[title="Next start point (End)"]').click()
  await page.locator('.rail-tab[title="Audio"]').click()
  await page.getByRole('button', { name: 'Add audio by URL' }).click()
  await page.locator('.url-form input.ctl').fill(fx('tone.mp3?endpoint'))
  await page.locator('.url-form').getByRole('button', { name: 'Add audio', exact: true }).click()
  await expect.poll(async () => (await exportedDoc(page)).audios?.[0].enter).toBe(10)
  await expect.poll(async () => (await exportedDoc(page)).duration).toBeGreaterThan(10)
  await expect(page.locator('.aclip')).toHaveCount(1)
  expect((await page.locator('.aclip').boundingBox())!.width).toBeGreaterThan(30)
})
