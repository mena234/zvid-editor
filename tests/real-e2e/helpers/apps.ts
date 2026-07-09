import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import type { Page, BrowserContext, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import { ENV } from './env'
import type { OrchUser } from './orch'
import { saveArtifact } from './stack'

const run = promisify(execFile)

/* ------------------------------ dash ------------------------------ */

/** Log in through the real dash /login form; waits for the authenticated
 *  shell (sidebar) to actually mount — the dashboard home does async data
 *  fetching, so the URL changes before the page is interactive. */
export async function dashLogin(page: Page, user: OrchUser) {
  await page.goto(`${ENV.dashUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#email', user.email)
  await page.fill('#password', user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30_000 })
  // the sidebar's Credits link is present on every authenticated page
  await page.waitForSelector('a[href="/credits"]', { timeout: 30_000 })
}

/**
 * Return to the dash after leaving its origin (e.g. after visiting the
 * editor). Goes to the public /login page; an authenticated cookie redirects
 * into the app (sidebar appears), otherwise logs in via the form. Ends on the
 * authenticated shell, ready for dashClientGoto.
 */
export async function dashReturn(page: Page, user: OrchUser) {
  await page.goto(`${ENV.dashUrl}/login`, { waitUntil: 'domcontentloaded' })
  const shell = page.locator('a[href="/credits"]').first()
  const form = page.locator('#email')
  await Promise.race([
    shell.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    form.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
  ])
  if (await form.isVisible().catch(() => false)) {
    await dashLogin(page, user)
  } else {
    await shell.waitFor({ state: 'visible', timeout: 30_000 })
  }
}

/**
 * Navigate to a dash route WITHOUT a full page load. The dash is a hydrated
 * SPA after login, so clicking an in-app link routes client-side — this
 * avoids server-side rendering the target route. (The `/videos` route SSRs
 * badly enough to crash the dash server, so job-visibility checks must reach
 * it this way.) Falls back to an in-page router push if no link is present.
 */
export async function dashClientGoto(page: Page, path: string) {
  // click an in-app sidebar link (Vue Router client nav). The link is always
  // present on the authenticated shell; waiting for it also guarantees the
  // current page has finished mounting.
  const link = page.locator(`a[href="${path}"]`).first()
  await link.waitFor({ state: 'visible', timeout: 30_000 })
  await link.click()
  await page.waitForURL((u) => new URL(String(u)).pathname === path, { timeout: 20_000 })
}

/**
 * From a loaded dash SPA, invalidate the session and client-navigate to a
 * protected route; asserts the app bounces to /login. Exercises dash's real
 * expired-session guard (client middleware + axios 401 interceptor) — the
 * server-side render of a protected route with a bad/absent cookie is broken
 * in this dash build (hangs/500s), so a hard `goto` is deliberately avoided.
 */
/**
 * Prove the session is gone: after clearing the auth cookie, the public
 * /login page renders its form (an authenticated user would be redirected
 * away from /login). Avoids SSR of protected routes, which is broken here.
 */
export async function expectDeauthenticated(page: Page) {
  await page.context().clearCookies()
  await page.goto(`${ENV.dashUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('#email').waitFor({ state: 'visible', timeout: 20_000 })
}

/** Seed the shared auth cookie directly (host-scoped; all localhost ports). */
export async function seedAuthCookie(context: BrowserContext, user: OrchUser) {
  const host = new URL(ENV.dashUrl).hostname
  await context.addCookies([
    {
      name: 'auth_token',
      value: user.token,
      domain: host,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

/* ------------------------------ editor ------------------------------ */

/** Open the real-orch editor with the session already active. */
export async function openRealEditor(page: Page, opts: { query?: string } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('zvid-test-hooks', '1')
      localStorage.removeItem('zvid-editor:autosave')
      localStorage.removeItem('zvid-cloud-project')
    } catch {}
  })
  await page.goto(`${ENV.editorUrl}/${opts.query || ''}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => (window as any).__zvidTest && !!document.querySelector('.stage-frame'),
    undefined,
    { timeout: 90_000 }
  )
}

/** Import a project through the editor's real Import modal (paste JSON). */
export async function importViaModal(page: Page, project: Record<string, any>) {
  await page.click('button[title="Import a zvid JSON file"], button:has-text("Import")')
  const textarea = page.locator('.modal-backdrop textarea')
  await textarea.waitFor({ timeout: 10_000 })
  await textarea.fill(JSON.stringify(project))
  await page.locator('.modal-backdrop button', { hasText: /^Import$/ }).click()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
}

/* --------------------------- artifact checks --------------------------- */

export interface ArtifactMeta {
  bytes: number
  format: string
  width?: number
  height?: number
  duration?: number
  hasVideo: boolean
}

/** Fetch (http) or read (local path) a render output. */
export async function fetchArtifact(urlOrPath: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`artifact fetch ${res.status} for ${urlOrPath}`)
    return Buffer.from(await res.arrayBuffer())
  }
  if (!existsSync(urlOrPath)) throw new Error(`artifact path not found: ${urlOrPath}`)
  return readFileSync(urlOrPath)
}

/** ffprobe a downloaded artifact file. */
export async function probeArtifact(path: string): Promise<ArtifactMeta> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ])
  const meta = JSON.parse(stdout)
  const video = meta.streams?.find(
    (s: any) => s.codec_type === 'video' || s.codec_type === 'image'
  )
  return {
    bytes: Number(meta.format?.size ?? 0),
    format: String(meta.format?.format_name ?? ''),
    width: video?.width,
    height: video?.height,
    duration: meta.format?.duration ? Number(meta.format.duration) : undefined,
    hasVideo: !!video,
  }
}

/** Download + save + probe + assert a video artifact in one step. */
export async function validateVideoArtifact(
  testInfo: TestInfo,
  urlOrPath: string,
  expected: { width: number; height: number; duration: number }
): Promise<ArtifactMeta> {
  const buf = await fetchArtifact(urlOrPath)
  expect(buf.length, 'artifact has non-zero content').toBeGreaterThan(1000)
  const saved = await saveArtifact(testInfo, 'render-output.mp4', buf)
  const meta = await probeArtifact(saved)
  expect(meta.hasVideo, 'artifact contains a video stream').toBe(true)
  expect(meta.format).toContain('mp4')
  expect(meta.width).toBe(expected.width)
  expect(meta.height).toBe(expected.height)
  expect(meta.duration ?? 0).toBeGreaterThan(expected.duration - 0.3)
  expect(meta.duration ?? 0).toBeLessThan(expected.duration + 0.7)
  return meta
}

/* ------------------------- deterministic project ------------------------- */

/**
 * Tiny deterministic render project — text on a solid background, no external
 * media. orch's plan validation rejects loopback/local media URLs for both
 * render and template saves, so a media-free project keeps the whole flow
 * fully local AND lets the template step succeed. Still a real 2 s mp4.
 */
export function tinyProject(name: string) {
  return {
    name,
    width: 640,
    height: 360,
    duration: 2,
    frameRate: 30,
    backgroundColor: '#204080',
    visuals: [
      { type: 'TEXT', text: 'real-e2e render check', x: 60, y: 150, style: { color: '#ffffff', fontSize: '42px' } },
      { type: 'TEXT', text: 'deterministic', x: 60, y: 220, style: { color: '#ffcc33', fontSize: '28px' } },
    ],
  }
}
