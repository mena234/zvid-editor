import { expect, type Locator, type Page, type Response } from '@playwright/test'

/** Only public configuration and the fixture's account check are needed here. */
export interface DashboardLive {
  env: {
    dashboardUrl: string
    editorUrl: string
    email: string
    password: string
  }
  sensitive: boolean
  verifyAccount?: () => Promise<unknown>
}

const headings: Record<string, string> = {
  '/projects': 'Projects',
  '/templates': 'Templates',
  '/videos': 'Renders',
  '/api-keys': 'API Keys',
  '/credits': 'Credits',
}

function dashboardUrl(live: DashboardLive, path: string): string {
  return new URL(path, `${live.env.dashboardUrl.replace(/\/$/, '')}/`).href
}

function isAction(response: Response, pathname: string, method: string): boolean {
  return new URL(response.url()).pathname === pathname && response.request().method() === method
}

async function requireActionSuccess(response: Response, description: string): Promise<void> {
  expect(response.ok(), `${description}: dashboard request succeeds`).toBe(true)
  const result = await response.json()
  // Do not include response objects in assertion diagnostics: they may contain secrets.
  expect(result?.success === true, `${description}: backend accepted the action`).toBe(true)
}

/** URL predicates must not wait for unrelated fonts/analytics to finish loading. */
export async function expectPageUrl(page: Page, predicate: (url: URL) => boolean, description: string): Promise<void> {
  await expect.poll(() => predicate(new URL(page.url())), { message: description }).toBe(true)
}

/** The customer-facing notification region mounts only after Nuxt hydrates. */
export async function waitForDashboardHydration(page: Page): Promise<void> {
  // An empty live region can have no layout box, so wait for its accessible DOM presence.
  await expect(page.getByRole('region', { name: 'Notifications alt+T', exact: true })).toBeAttached()
}

export async function fillDashboardLogin(page: Page, email: string, password: string): Promise<void> {
  await waitForDashboardHydration(page)
  const emailInput = page.getByLabel('Email address', { exact: true })
  const passwordInput = page.getByLabel('Password', { exact: true })
  await emailInput.fill(email)
  await passwordInput.fill(password)
  // Boolean comparisons keep credential values out of assertion failure diagnostics.
  await expect.poll(async () => (await emailInput.inputValue()) === email && (await passwordInput.inputValue()) === password, {
    message: 'Hydrated login inputs retain both entered credentials',
  }).toBe(true)
}

/** Authenticate using the real form, preserving a protected-route returnTo. */
export async function login(page: Page, live: DashboardLive): Promise<void> {
  const current = new URL(page.url())
  const origin = new URL(live.env.dashboardUrl).origin
  if (current.origin !== origin || current.pathname !== '/login') {
    await page.goto(dashboardUrl(live, '/login'), { waitUntil: 'domcontentloaded' })
  }
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  const alreadySensitive = live.sensitive
  live.sensitive = true
  await fillDashboardLogin(page, live.env.email, live.env.password)
  const responsePromise = page.waitForResponse(response => isAction(response, '/api/auth/login', 'POST'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await requireActionSuccess(await responsePromise, 'Login')
  await expectPageUrl(page, url => url.origin === origin && !['/login', '/user-info', '/verify-email'].includes(url.pathname), 'Login reaches an authenticated dashboard route')
  await expect(page.getByRole('button', { name: 'Open profile menu', exact: true })).toBeVisible()
  await live.verifyAccount?.()
  live.sensitive = alreadySensitive
}

/** Full navigation deliberately exercises SSR and session persistence as well as the UI. */
export async function navigateDashboard(page: Page, live: DashboardLive, path: string): Promise<void> {
  const target = dashboardUrl(live, path)
  await page.goto(target, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(target)
  await waitForDashboardHydration(page)
  await expect(page.getByRole('button', { name: 'Open profile menu', exact: true })).toBeVisible()
  const heading = headings[new URL(target).pathname]
  if (heading) await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible()
}

/** An absent or nonnumeric visible balance is a failure, never a zero fallback. */
export async function readDashboardCredits(page: Page, live: DashboardLive): Promise<number> {
  await navigateDashboard(page, live, '/credits')
  const label = page.getByText('Total available credits', { exact: true })
  await expect(label).toBeVisible()
  const value = label.locator('xpath=following-sibling::p[1]')
  await expect(value).toBeVisible()
  const text = (await value.innerText()).trim().replaceAll(',', '')
  expect(/^\d+(?:\.\d+)?$/.test(text), 'Dashboard displays a numeric credit balance').toBe(true)
  const credits = Number(text)
  expect(Number.isFinite(credits), 'Dashboard credit balance is finite').toBe(true)
  return credits
}

function namedCard(page: Page, name: string): Locator {
  return page.locator('.zv-card').filter({ has: page.getByRole('link', { name, exact: true }) })
}

async function openPopup(page: Page, link: Locator): Promise<Page> {
  await expect(link).toBeVisible()
  const popupPromise = page.waitForEvent('popup')
  await link.click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  return popup
}

export async function openEditorFromDashboard(page: Page, live: DashboardLive): Promise<Page> {
  await navigateDashboard(page, live, '/projects')
  const popup = await openPopup(page, page.getByRole('link', { name: 'New project', exact: true }))
  await expectPageUrl(popup, url => url.origin === new URL(live.env.editorUrl).origin, 'New project opens the configured editor')
  return popup
}

/** Call from the Projects list. The caller asserts the editor's loaded content. */
export async function openProjectInEditor(page: Page, name: string): Promise<Page> {
  const popup = await openPopup(page, namedCard(page, name).getByTitle('Open in editor', { exact: true }))
  await expectPageUrl(popup, url => Boolean(url.searchParams.get('project')), 'Editor receives the saved project link')
  return popup
}

/** Call from the Templates list. */
export async function openTemplateInEditor(page: Page, name: string): Promise<Page> {
  const popup = await openPopup(page, namedCard(page, name).getByTitle('Open in the visual editor', { exact: true }))
  await expectPageUrl(popup, url => Boolean(url.searchParams.get('template')), 'Editor receives the saved template link')
  return popup
}

export function findJobCard(page: Page, name: string): Locator {
  return page.locator('.zv-card').filter({ has: page.getByRole('heading', { name, exact: true, level: 3 }) })
}

export async function renameProjectUI(page: Page, oldName: string, newName: string): Promise<void> {
  await namedCard(page, oldName).getByTitle('Rename', { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true })
  // AppModal's outer relative dialog has only fixed children and no layout box.
  await expect(dialog.getByRole('heading', { name: 'Rename project', exact: true })).toBeVisible()
  await dialog.getByRole('textbox').fill(newName)
  const responsePromise = page.waitForResponse(response => /^\/api\/projects\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT')
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click()
  await requireActionSuccess(await responsePromise, 'Rename project')
  await expect(dialog).toHaveCount(0)
  await expect(namedCard(page, newName)).toBeVisible()
  await expect(namedCard(page, oldName)).toHaveCount(0)
}

export async function deleteProjectUI(page: Page, name: string, cancelFirst = false): Promise<void> {
  const card = namedCard(page, name)
  await expect(card).toBeVisible()
  if (cancelFirst) {
    page.once('dialog', dialog => dialog.dismiss())
    await card.getByTitle('Delete project', { exact: true }).click()
    await expect(card).toBeVisible()
  }
  page.once('dialog', dialog => dialog.accept())
  const responsePromise = page.waitForResponse(response => /^\/api\/projects\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE')
  await card.getByTitle('Delete project', { exact: true }).click()
  await requireActionSuccess(await responsePromise, 'Delete project')
  await expect(card).toHaveCount(0)
}

export async function archiveTemplateUI(page: Page, name: string): Promise<void> {
  const card = namedCard(page, name)
  await expect(card).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  const responsePromise = page.waitForResponse(response => /^\/api\/templates\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE')
  await card.getByTitle('Archive template', { exact: true }).click()
  await requireActionSuccess(await responsePromise, 'Archive template')
  await expect(card).toHaveCount(0)
}
