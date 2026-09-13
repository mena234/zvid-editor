import { test, expect } from '@playwright/test'
import { exportedDoc, FIXTURES, openEditor, resetMockOrch } from './helpers/app'

for (const kind of ['image', 'audio'] as const) {
  test(`${kind} uploads show eight initially and expand without hiding the stock section`, async ({ page }) => {
    await resetMockOrch({ uploads: Array.from({ length: 17 }, (_, i) => ({
      id: `upload-${i}`, kind, fileName: `Upload ${i + 1}`,
      mimeType: kind === 'audio' ? 'audio/mpeg' : 'image/png',
      sizeBytes: 100, width: 320, height: 240, duration: kind === 'audio' ? 2 : null,
      url: `${FIXTURES}/${kind === 'audio' ? 'tone.mp3' : 'image.png'}`,
      createdAt: '2026-09-13T00:00:00.000Z',
    })) })
    await openEditor(page, { authed: true })
    if (kind === 'audio') await page.locator('.rail-tab[title="Audio"]').click()
    const section = page.locator('.uploads-section')
    const items = section.locator(kind === 'audio' ? '.audio-row:not(.pending)' : '.cell:not(.skeleton)')
    await expect(items).toHaveCount(8)
    await expect(page.locator('.stock-panel .title')).toBeVisible()
    await section.getByRole('button', { name: 'Show more', exact: true }).click()
    await expect(items).toHaveCount(16)
    await section.getByRole('button', { name: 'Show more', exact: true }).click()
    await expect(items).toHaveCount(17)
    await expect(section.getByRole('button', { name: 'Show more', exact: true })).toHaveCount(0)
    await section.getByRole('button', { name: 'Show less', exact: true }).click()
    await expect(items).toHaveCount(8)
    await expect(section.getByRole('button', { name: 'Show less', exact: true })).toHaveCount(0)
  })
}

test('audio categories preserve music search and add a playable effect for its natural duration at the cursor', async ({ page }) => {
  // Production projects use the deployed URL; serve that same shipped asset
  // locally during tests so this never depends on an editor deployment.
  await page.route('https://editor.zvid.io/audio/sound-effects/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    await route.fulfill({ response: await page.request.get(`http://127.0.0.1:4597${path}`) })
  })
  await resetMockOrch({ stockPages: { audio: [[{
    id: 'music-1', kind: 'audio', provider: 'jamendo', preview: '',
    src: `${FIXTURES}/tone.mp3`, description: 'Gentle tune', duration: 2,
  }]] } })
  await openEditor(page)
  await page.locator('.rail-tab[title="Audio"]').click()
  await expect(page.getByRole('button', { name: 'Music', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.stock-panel .search-input').fill('gentle')
  await expect.poll(() => page.evaluate(() => (window as any).__zvidTest.stock.byKind.audio.query)).toBe('gentle')
  await page.getByRole('button', { name: 'Sound effects', exact: true }).click()
  const effects = page.locator('.sound-effects-panel')
  await expect(effects.locator('.audio-row')).toHaveCount(8)
  await effects.getByRole('searchbox', { name: 'Search sound effects' }).fill('swipe')
  await expect(effects.locator('.audio-row')).toHaveCount(1)
  await expect(effects.locator('.name')).toHaveText('Whoosh')
  // Verify that the same shipped asset preview and cloud-project URL are playable.
  const response = page.waitForResponse((res) => res.url().includes('/audio/sound-effects/v1/whoosh.wav'))
  await effects.getByRole('button', { name: 'Play Whoosh preview' }).click()
  expect((await response).ok()).toBe(true)
  await page.evaluate(() => {
    const t = (window as any).__zvidTest
    t.project.patchProject({ duration: 10 })
    t.editor.playhead = 9.8
  })
  await effects.getByRole('button', { name: 'Whoosh 0.8s' }).click()
  const doc = await exportedDoc(page)
  expect(doc.audios[0]).toMatchObject({ enter: 9.8, exit: 10.55, audioEnd: 0.75 })
  const origin = process.env.EDITOR_TEST_PRODUCTION === '1'
    ? 'https://editor.zvid.io' : 'http://127.0.0.1:4597'
  expect(doc.audios[0].src).toBe(`${origin}/audio/sound-effects/v1/whoosh.wav`)
  expect(doc.duration).toBe(10.55)
  await page.getByRole('button', { name: 'Music', exact: true }).click()
  await expect(page.locator('.stock-panel .search-input')).toHaveValue('gentle')
  await expect(page.locator('.stock-panel .audio-row')).toHaveCount(1)
})
