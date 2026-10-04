import { request, type APIRequestContext } from '@playwright/test'
import { test, expect } from './fixtures'
import { expectPageUrl, fillDashboardLogin, login, navigateDashboard, openEditorFromDashboard, waitForDashboardHydration } from './helpers/dashboard'
import { waitForEditor } from './helpers/editor'

test('authentication survives refresh and editor handoff; logout protects deep links', async ({ page, live }) => {
  live.sensitive = true
  const origin = new URL(live.env.dashboardUrl).origin
  const protectedPath = '/projects?source=live-e2e'
  await test.step('Require sign-in for a protected dashboard deep link', async () => {
    await page.goto(`${live.env.dashboardUrl.replace(/\/$/, '')}${protectedPath}`, { waitUntil: 'domcontentloaded' })
    await expectPageUrl(page, url => url.origin === origin && url.pathname === '/login' && url.searchParams.get('returnTo') === protectedPath, 'Protected route redirects to login and preserves its destination')
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  })

  await test.step('Reject nonexistent credentials and display the account error', async () => {
    // A valid reserved example.com address reaches credential lookup. The .invalid
    // TLD fails the backend's email validation before authentication is attempted.
    const nonexistentEmail = `${live.name('invalid-login').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60)}@example.com`
    await fillDashboardLogin(page, nonexistentEmail, 'intentionally-invalid-password')
    const rejectedLogin = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    const result = await (await rejectedLogin).json()
    expect(result?.success === false, 'Invalid credentials are rejected').toBe(true)
    expect(result?.error === 'User not found', 'Authentication rejects the unknown account, rather than rejecting the email format').toBe(true)
    await expect(page.getByText('User not found', { exact: true })).toBeVisible()
    await expectPageUrl(page, url => url.pathname === '/login', 'Rejected credentials remain on the login page')
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled()
  })

  await test.step('Sign in, restore the deep link and preserve the dashboard session on refresh', async () => {
    await login(page, live)
    await expectPageUrl(page, url => url.pathname === '/projects' && url.searchParams.get('source') === 'live-e2e', 'Login restores the requested project deep link')
    await expect(page.getByRole('heading', { name: 'Projects', exact: true, level: 1 })).toBeVisible()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForDashboardHydration(page)
    await expect(page.getByRole('heading', { name: 'Projects', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open profile menu', exact: true })).toBeVisible()
  })

  const editor = await test.step('Open the editor with the same account and preserve its session on refresh', async () => {
    const popup = await openEditorFromDashboard(page, live)
    await waitForEditor(popup, live.env.email)
    await popup.reload({ waitUntil: 'domcontentloaded' })
    await waitForEditor(popup, live.env.email)
    return popup
  })

  await test.step('Log out through the UI and require sign-in in both apps', async () => {
    await page.getByRole('button', { name: 'Open profile menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Logout', exact: true }).click()
    await expectPageUrl(page, url => url.origin === origin && url.pathname === '/login', 'Logout returns to the dashboard login page')
    await page.goto(`${live.env.dashboardUrl.replace(/\/$/, '')}${protectedPath}`, { waitUntil: 'domcontentloaded' })
    await expectPageUrl(page, url => url.pathname === '/login' && url.searchParams.get('returnTo') === protectedPath, 'Protected deep link requires authentication after logout')
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible()

    // Reload the existing second tab to prove the shared session was cleared.
    await editor.reload({ waitUntil: 'domcontentloaded' })
    await expect(editor.locator('.topbar').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(editor.getByRole('button', { name: /^Account for / })).toHaveCount(0)
  })
})

async function keyProfileStatus(client: APIRequestContext, url: string): Promise<number> {
  try {
    const response = await client.get(url, { failOnStatusCode: false })
    return response.status()
  } catch {
    // Playwright's original network error can include request headers, including the key.
    throw new Error('The read-only API-key authentication request could not complete.')
  }
}

test('API key is revealed once, authenticates a read-only request, and is revoked through the UI', async ({ page, live }) => {
  live.sensitive = true
  const keyName = live.name('api-key')
  await test.step('Sign in and open API Keys', async () => {
    await login(page, live)
    await navigateDashboard(page, live, '/api-keys')
  })

  const { keyId, secret } = await test.step('Create a named API key and read its one-time reveal', async () => {
    const create = page.getByRole('button', { name: 'Create API key', exact: true }).first()
    await expect(create, 'Dedicated test account has room for an API key').toBeEnabled()
    await create.click()
    const dialog = page.getByRole('dialog', { name: 'Create API Key', exact: true })
    await expect(dialog.getByRole('button', { name: 'Create API Key', exact: true })).toBeDisabled()
    await dialog.getByPlaceholder('e.g., Production App, Development, Mobile App', { exact: true }).fill(keyName)
    const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/api-keys' && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Create API Key', exact: true }).click()
    const created = await (await createdResponse).json()
    expect(created?.success === true, 'API-key creation succeeds').toBe(true)
    const keyId = created?.data?.id
    expect(keyId != null, 'Created API key has an ID for cleanup').toBe(true)
    await live.track('apiKey', String(keyId), keyName)

    const reveal = page.getByRole('dialog', { name: 'API Key Created', exact: true })
    // The AppModal role wrapper is zero-height because its visible panel is fixed.
    await expect(reveal).toBeAttached()
    await expect(reveal.getByRole('heading', { name: 'API Key Created', exact: true })).toBeVisible()
    await expect(reveal.locator('span.break-all')).toBeVisible()
    // Read the actual one-time reveal. Never put the secret in an assertion or locator.
    const secret = (await reveal.locator('span.break-all').innerText()).trim()
    expect(/^zvid_[a-f0-9]+$/.test(secret), 'One-time reveal contains a valid key format').toBe(true)
    await reveal.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(reveal).toHaveCount(0)
    return { keyId, secret }
  })

  const card = page.locator('.zv-card').filter({ has: page.getByRole('heading', { name: keyName, exact: true, level: 3 }) })
  await test.step('Reload the list and verify that the secret is masked', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForDashboardHydration(page)
    await expect(card).toBeVisible()
    const cardText = await card.innerText()
    expect(/zvid_[a-f0-9]+\*+/.test(cardText), 'Saved key is masked').toBe(true)
    expect((await page.locator('body').innerText()).includes(secret), 'Full key is no longer displayed').toBe(false)
  })

  // This independent client has no dashboard session cookie, so only the new key can authenticate.
  const client = await request.newContext({ extraHTTPHeaders: { 'X-API-Key': secret }, ignoreHTTPSErrors: false })
  try {
    const profileUrl = `${live.env.apiUrl.replace(/\/$/, '')}/api/user/profile`
    await test.step('Authenticate a read-only API request with the key alone', async () => {
      expect(await keyProfileStatus(client, profileUrl), 'New key authenticates the read-only profile endpoint').toBe(200)
    })

    await test.step('Cancel deletion, then revoke the key through the UI', async () => {
      page.once('dialog', confirmation => confirmation.dismiss())
      await card.getByTitle('Delete API key', { exact: true }).click()
      await expect(card).toBeVisible()

      page.once('dialog', confirmation => confirmation.accept())
      const revokedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/api-keys/${keyId}` && response.request().method() === 'DELETE')
      await card.getByTitle('Delete API key', { exact: true }).click()
      const revoked = await (await revokedResponse).json()
      expect(revoked?.success === true, 'API-key revocation succeeds').toBe(true)
      await expect(card).toHaveCount(0)
    })

    await test.step('Confirm revocation persists and the old key is rejected', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForDashboardHydration(page)
      await expect(card).toHaveCount(0)
      expect(await keyProfileStatus(client, profileUrl), 'Revoked key no longer authenticates').toBe(401)
    })
  } finally {
    await client.dispose()
  }
})
