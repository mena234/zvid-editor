import type { Page } from '@playwright/test'

/**
 * Shared helpers for the Playwright suite.
 *
 * Ground-truth channel: plugins/testHooks.client.ts exposes window.__zvidTest
 * (stores + import/export/validate) on dev servers — specs interact via the
 * real UI and assert against the exported JSON, which is what `zvid render`
 * consumes.
 */

export const EDITOR_URL = 'http://127.0.0.1:4597/'
export const FIXTURES = 'http://127.0.0.1:4598'
export const MOCK_ORCH = 'http://127.0.0.1:4599'
export const VALID_TOKEN = 'tok-valid'

/** Reset the mock orch to defaults + overrides (see mockOrch.mjs). */
export async function resetMockOrch(overrides: Record<string, unknown> = {}) {
  const res = await fetch(`${MOCK_ORCH}/__mock/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
  })
  if (!res.ok) throw new Error('mock orch reset failed')
}

/** Requests the mock orch has received since the last reset. */
export async function mockOrchCalls(): Promise<any[]> {
  return (await fetch(`${MOCK_ORCH}/__mock/calls`)).json()
}

export interface OpenOptions {
  /** query string, e.g. '?type=image' or '?project=prj_1' */
  query?: string
  /** pre-set the auth cookie the mock orch accepts */
  authed?: boolean
  /** keep localStorage autosave/cloud-link from a previous page (default: cleared) */
  keepStorage?: boolean
}

/** Navigate to the editor and wait for the shell + test bridge. */
export async function openEditor(page: Page, opts: OpenOptions = {}) {
  await page.addInitScript(
    ({ keep }) => {
      try {
        localStorage.setItem('zvid-test-hooks', '1')
        if (!keep) {
          localStorage.removeItem('zvid-editor:autosave')
          localStorage.removeItem('zvid-cloud-project')
        }
      } catch {}
    },
    { keep: !!opts.keepStorage }
  )
  if (opts.authed) {
    await page.context().addCookies([
      {
        name: 'auth_token',
        value: VALID_TOKEN,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
      },
    ])
  }
  await page.goto(EDITOR_URL + (opts.query || ''), { waitUntil: 'domcontentloaded' })
  // image-mode projects never render the timeline panel (EditorShell v-if)
  const expectTimeline = !/type=image/.test(opts.query || '')
  await page.waitForFunction(
    (needTl) =>
      (window as any).__zvidTest &&
      !!document.querySelector('.stage-frame') &&
      (!needTl || !!document.querySelector('.tl-panel')),
    expectTimeline,
    { timeout: 120_000 }
  )
}

/** The exported, render-ready JSON of the current document. */
export async function exportedDoc(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__zvidTest.exportedDoc())
}

/** Load raw project JSON into the editor (same code path as Import). */
export async function loadProject(page: Page, raw: any): Promise<any[]> {
  return page.evaluate((r) => (window as any).__zvidTest.loadRaw(r), raw)
}

/** Validation issues for the current document. */
export async function validateDoc(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__zvidTest.validate())
}

/** Read a value from a store, e.g. store(page, 'editor', 'modal'). */
export async function store(page: Page, name: string, path: string): Promise<any> {
  return page.evaluate(
    ([n, p]) => {
      let v: any = (window as any).__zvidTest[n]
      for (const key of p.split('.')) v = v?.[key]
      // strip reactivity for serialization
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
    },
    [name, path] as const
  )
}

/** Wait until an expression over the bridge becomes truthy. */
export async function waitBridge(page: Page, expr: string, timeout = 15_000) {
  await page.waitForFunction(
    (e) => {
      const t = (window as any).__zvidTest
      // eslint-disable-next-line no-new-func
      return new Function('t', `return (${e})`)(t)
    },
    expr,
    { timeout }
  )
}

/** Fixture asset URL. */
export const fx = (file: string) => `${FIXTURES}/${file}`
