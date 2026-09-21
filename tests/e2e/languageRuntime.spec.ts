import { test, expect } from '@playwright/test'

test('a missing language dictionary gives a visible error and reload recovers', async ({ page }) => {
  const dictionary = '**/icu_capi*.wasm*'
  await page.route(dictionary, route => route.abort('failed'))
  await page.goto('/')
  await expect(page.getByText('Subtitle language support could not load. Check your connection and reload the editor.', { exact: true })).toBeVisible()
  await expect(page.locator('.stage-frame')).toHaveCount(0)

  await page.unroute(dictionary)
  await page.reload()
  await expect(page.locator('.stage-frame')).toBeVisible({ timeout: 30_000 })
})
