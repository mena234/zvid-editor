import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import {
  openEditor,
  exportedDoc,
  store,
  waitBridge,
  resetMockOrch,
  mockOrchCalls,
  FIXTURES,
} from './helpers/app'

/**
 * Cloud & account surface: auth gating + login (AuthModal/AccountMenu),
 * cloud project persistence (SaveProjectModal/ProjectsModal/useCloud),
 * templates (SaveTemplateModal), deep links, user uploads (UploadsSection),
 * saved designs (DesignPanel) and the stock library (StockPanel).
 *
 * Every test resets the mock orch first (its state is shared/mutable), then
 * talks to the real UI and asserts against store state + the mock's call log.
 */

/* ---------------- seeds ---------------- */

const NOW = '2026-07-09T00:00:00.000Z'

/** Small render-ready doc used as a cloud payload. */
const cloudDoc = (name: string) => ({
  name,
  duration: 7,
  frameRate: 30,
  visuals: [{ type: 'TEXT', text: `from-${name}`, position: 'center-center' }],
})

/** Full editor-shape UploadItem (stores/uploads.ts). */
const seedUpload = (id: string, fileName: string) => ({
  id,
  kind: 'image',
  fileName,
  mimeType: 'image/png',
  sizeBytes: 3479,
  width: 320,
  height: 240,
  duration: null,
  url: `${FIXTURES}/image.png`,
  createdAt: NOW,
})

/** Minimal valid DesignDoc (utils/designer/types.ts normalizeDesign shape). */
const seedDesign = {
  id: 'dsn_1',
  name: 'Neon Title',
  design: {
    version: 1,
    width: 800,
    height: 450,
    fontFamily: 'Poppins',
    duration: 'auto',
    background: {
      kind: 'solid',
      color: '#101321',
      from: '#1b2340',
      to: '#0c0f1c',
      angle: 135,
      radius: 0,
    },
    layers: [
      {
        id: 'l1',
        kind: 'text',
        name: 'Text',
        x: 50,
        y: 50,
        rotate: 0,
        scale: 1,
        opacity: 1,
        anim: null,
        text: 'NeonE2E',
        fontSize: 64,
        fontWeight: '700',
        letterSpacing: 0,
        lineHeight: 1.15,
        align: 'center',
        textTransform: '',
        fill: { kind: 'solid', color: '#ffffff' },
      },
    ],
  },
  createdAt: NOW,
  updatedAt: NOW,
}

/** StockItem (stores/stock.ts) — unique ids across pages for the dedupe set. */
const stockItem = (pageNo: number, i: number) => ({
  id: `img-p${pageNo}-${i}`,
  provider: i % 2 ? 'pixabay' : 'pexels',
  kind: 'image',
  preview: `${FIXTURES}/image.png`,
  src: `${FIXTURES}/image.png?full=p${pageNo}-${i}`,
  width: 320,
  height: 240,
  description: `Stock p${pageNo} ${i}`,
})
const stockPage = (pageNo: number, count: number) =>
  Array.from({ length: count }, (_, i) => stockItem(pageNo, i))

/** Rich user so AccountMenu shows initials + credits (balance, not available). */
const RICH_USER = {
  user: { id: 'usr_1', email: 'e2e@zvid.io', firstName: 'E2E', lastName: 'Tester' },
  credits: { balance: 500 },
}

async function callsTo(pathName: string, method?: string) {
  const calls = await mockOrchCalls()
  return calls.filter(
    (c: any) => c.path === pathName && (!method || c.method === method)
  )
}

async function loginViaModal(page: Page) {
  await page.fill('.modal-backdrop input[type="email"]', 'e2e@zvid.io')
  await page.fill('.modal-backdrop input[type="password"]', 'hunter2')
  await page.locator('.modal-backdrop button[type="submit"]').click()
}

async function openAccountMenuItem(page: Page, label: string) {
  await page.locator('.account .avatar').click()
  await page.locator('.account .menu .item', { hasText: label }).click()
}

/* ================= 1–4: account & session ================= */

test('logged out: AccountMenu offers Sign in and TopBar Save gates through the auth modal', async ({
  page,
}) => {
  await resetMockOrch()
  await openEditor(page)

  await expect(page.locator('.account button', { hasText: 'Sign in' })).toBeVisible()
  await expect(page.locator('.account .avatar')).toHaveCount(0)
  expect(await store(page, 'auth', 'user')).toBe(null)

  // Save requires auth: useCloud.requireAuth opens AuthModal, remembers intent
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.modal-backdrop')).toContainText('Sign in to Zvid')
  expect(await store(page, 'editor', 'modal')).toBe('auth')
  expect(await store(page, 'editor', 'postAuthModal')).toBe('saveProject')
})

test('login resumes the queued Save flow and AccountMenu shows initials, email and credits', async ({
  page,
}) => {
  await resetMockOrch({ ...RICH_USER })
  await openEditor(page)

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.modal-backdrop')).toContainText('Sign in to Zvid')
  await loginViaModal(page)

  await waitBridge(page, "t.auth.user && t.auth.user.email === 'e2e@zvid.io'")
  await expect(page.locator('.toast', { hasText: 'Signed in' })).toBeVisible()

  // queued postAuthModal reopens: the Save flow continues after login
  await expect(page.locator('.modal-backdrop')).toContainText(
    'Save project to your account'
  )
  expect(await store(page, 'editor', 'modal')).toBe('saveProject')
  await page.getByRole('button', { name: 'Cancel' }).click()

  const avatar = page.locator('.account .avatar')
  await expect(avatar).toHaveText('ET')
  await avatar.click()
  await expect(page.locator('.account .menu-head .email')).toHaveText('e2e@zvid.io')
  // credits.balance mirrors orch's creditService.getUserCredits shape
  await expect(page.locator('.account .menu-head .credits')).toContainText(
    '500 credits'
  )
})

test('login failure shows the orch message inside the modal and stays logged out', async ({
  page,
}) => {
  await resetMockOrch({ loginOk: false })
  await openEditor(page)

  await page.locator('.account button', { hasText: 'Sign in' }).click()
  await loginViaModal(page)

  await expect(page.locator('.modal-backdrop .err')).toHaveText(
    'Wrong email or password'
  )
  expect(await store(page, 'editor', 'modal')).toBe('auth')
  expect(await store(page, 'auth', 'user')).toBe(null)
  await page.locator('.modal-backdrop button[aria-label="Close"]').click()
  await expect(page.locator('.account button', { hasText: 'Sign in' })).toBeVisible()
})

test('booting with the auth cookie loads the session automatically', async ({
  page,
}) => {
  await resetMockOrch({ ...RICH_USER })
  await openEditor(page, { authed: true })

  await waitBridge(page, 't.auth.loaded && !!t.auth.user')
  expect(await store(page, 'auth', 'user.email')).toBe('e2e@zvid.io')
  await expect(page.locator('.account .avatar')).toHaveText('ET')
  await expect(page.locator('.account button', { hasText: 'Sign in' })).toHaveCount(0)
})

/* ================= 5–9: cloud persistence ================= */

test('Save project: POST creates and links, localStorage remembers, next Save PUTs the same id', async ({
  page,
}) => {
  await resetMockOrch()
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded && !!t.auth.user')

  // unlinked doc → Save opens the naming modal
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.modal-backdrop')).toContainText(
    'Save project to your account'
  )
  await page.fill('.modal-backdrop input[type="text"]', 'cloud-save-e2e')
  await page.getByRole('button', { name: 'Save project' }).click()

  await expect(page.locator('.toast', { hasText: 'Project saved' })).toBeVisible()
  await expect
    .poll(() => store(page, 'editor', 'cloudProject'))
    .toEqual({ id: 'prj_1', name: 'cloud-save-e2e' })

  const posts = await callsTo('/api/projects', 'POST')
  expect(posts).toHaveLength(1)
  expect(posts[0].auth).toBe(true)
  expect(posts[0].body.name).toBe('cloud-save-e2e')
  expect(posts[0].body.payload.duration).toBeGreaterThan(0)
  expect(posts[0].body.payload.frameRate).toBeGreaterThan(0)

  // the session plugin mirrors the link into localStorage
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('zvid-cloud-project') ?? ''))
    .toContain('prj_1')

  // linked doc → Save updates in place (PUT, same id)
  await page.evaluate(() =>
    (window as any).__zvidTest.project.patchProject({ duration: 12 })
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'Saved to your account' })).toBeVisible()

  const puts = await callsTo('/api/projects/prj_1', 'PUT')
  expect(puts.length).toBeGreaterThanOrEqual(1)
  expect(puts[0].body.payload.duration).toBe(12)
  expect(await store(page, 'editor', 'cloudProject.id')).toBe('prj_1')
  expect((await callsTo('/api/projects', 'POST')).length).toBe(1) // no fork
})

test('Projects modal lists, opens (replaces doc + links), renames and deletes with confirm', async ({
  page,
}) => {
  await resetMockOrch({
    projects: [
      { id: 'prj_a', name: 'Alpha', payload: cloudDoc('alpha-doc'), createdAt: NOW, updatedAt: NOW },
      { id: 'prj_b', name: 'Beta', payload: cloudDoc('beta-doc'), createdAt: NOW, updatedAt: NOW },
    ],
  })
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded && !!t.auth.user')

  await openAccountMenuItem(page, 'My projects')
  const rows = page.locator('.modal-backdrop .list .row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Alpha')
  await expect(rows.nth(1)).toContainText('Beta')

  // open → doc replaced, cloud link set, modal closed
  await rows.nth(0).locator('.name').click()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
  const doc = await exportedDoc(page)
  expect(doc.name).toBe('alpha-doc')
  expect(doc.duration).toBe(7)
  expect(doc.visuals[0]).toMatchObject({ type: 'TEXT', text: 'from-alpha-doc' })
  expect(await store(page, 'editor', 'cloudProject')).toEqual({
    id: 'prj_a',
    name: 'Alpha',
  })

  // reopen: the linked row carries the "open" badge
  await openAccountMenuItem(page, 'My projects')
  await expect(
    page.locator('.modal-backdrop .row', { hasText: 'Alpha' }).locator('.badge')
  ).toHaveText('open')

  // rename Beta (Enter commits). Once editing starts the row's name button is
  // replaced by the input, so a hasText:'Beta' row filter would stop matching
  // — target the (single) rename input globally.
  const beta = page.locator('.modal-backdrop .row', { hasText: 'Beta' })
  await beta.locator('button[title="Rename"]').click()
  const rename = page.locator('.modal-backdrop input.rename')
  await rename.fill('Beta Renamed')
  await rename.press('Enter')
  await expect(
    page.locator('.modal-backdrop .row', { hasText: 'Beta Renamed' })
  ).toBeVisible()
  const renames = await callsTo('/api/projects/prj_b', 'PUT')
  expect(renames.length).toBeGreaterThanOrEqual(1)
  expect(renames[0].body.name).toBe('Beta Renamed')

  // delete needs a second confirming click
  const betaRow = page.locator('.modal-backdrop .row', { hasText: 'Beta Renamed' })
  await betaRow.locator('button[title="Delete"]').click()
  await expect(page.locator('.modal-backdrop .list .row')).toHaveCount(2) // not yet
  await betaRow.locator('button[title="Click again to delete"]').click()
  await expect(page.locator('.modal-backdrop .list .row')).toHaveCount(1)
  await expect(page.locator('.toast', { hasText: 'Project deleted' })).toBeVisible()
  expect(await callsTo('/api/projects/prj_b', 'DELETE')).toHaveLength(1)
})

test('expired session on a cloud call signs the user out and reopens the auth modal', async ({
  page,
}) => {
  await resetMockOrch()
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded && !!t.auth.user')

  // the httpOnly cookie goes stale behind the app's back
  await page.context().addCookies([
    {
      name: 'auth_token',
      value: 'tok-expired',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
    },
  ])

  // the client still believes it's signed in — the next cloud call 401s
  await openAccountMenuItem(page, 'My projects')
  await expect
    .poll(() => store(page, 'editor', 'modal'))
    .toBe('auth')
  await expect(page.locator('.modal-backdrop')).toContainText('Sign in to Zvid')
  await expect(
    page.locator('.toast', { hasText: 'session expired' })
  ).toBeVisible()
  expect(await store(page, 'auth', 'user')).toBe(null)
  expect(await store(page, 'editor', 'postAuthModal')).toBe('projects')
})

test('Save as template: variables summary + undeclared warning, then success screen with tpl id', async ({
  page,
}) => {
  await resetMockOrch()
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded && !!t.auth.user')

  await page.evaluate(() => {
    const t = (window as any).__zvidTest
    t.project.setVariable('title', 'Hello')
    t.project.addVisual('root', {
      type: 'TEXT',
      text: '{{title}} meet {{who}}',
      position: 'center-center',
    })
  })

  await openAccountMenuItem(page, 'Save as template')
  const modal = page.locator('.modal-backdrop')
  await expect(modal).toContainText('Save as render template')

  // declared variable summarized with its usage count
  await expect(modal.locator('.vars-summary')).toContainText('Variables (1)')
  await expect(modal.locator('.vars-row .vars-name')).toContainText('title')
  await expect(modal.locator('.vars-row .vars-used')).toHaveText('used ×1')

  // {{who}} has no default → undeclared warning
  await expect(modal.locator('.warn-block')).toContainText(
    '1 placeholder without a default'
  )
  await expect(modal.locator('.warn-block .mono')).toContainText('who')

  await modal.locator('input[type="text"]').fill('tpl-e2e')
  await page.getByRole('button', { name: 'Save template' }).click()

  // success screen: name, tpl_ id and the render snippet
  await expect(modal.locator('.done')).toContainText('“tpl-e2e” saved')
  await expect(modal.locator('.done')).toContainText('tpl_1')
  await expect(modal.locator('.done')).toContainText('POST /api/render')

  const posts = await callsTo('/api/templates', 'POST')
  expect(posts).toHaveLength(1)
  expect(posts[0].auth).toBe(true)
  expect(posts[0].body.name).toBe('tpl-e2e')
  expect(posts[0].body.payload.visuals[0].text).toBe('{{title}} meet {{who}}')
  await page.getByRole('button', { name: 'Done' }).click()
})

test('deep links: ?project= loads and links, ?template= loads without linking, query stripped', async ({
  page,
}) => {
  const tplDoc = cloudDoc('tpl-doc')
  await resetMockOrch({
    projects: [
      { id: 'prj_X', name: 'Deep Project', payload: cloudDoc('deep-doc'), createdAt: NOW, updatedAt: NOW },
    ],
    // orch serves the template doc under template.project (templateService
    // mapRow) even though it is SENT as "payload" — useCloud matches that.
    templates: [{ id: 'tpl_Y', name: 'Deep Template', project: tplDoc }],
  })

  await openEditor(page, { authed: true, query: '?project=prj_X' })
  await expect.poll(async () => (await exportedDoc(page)).name).toBe('deep-doc')
  expect(await store(page, 'editor', 'cloudProject')).toEqual({
    id: 'prj_X',
    name: 'Deep Project',
  })
  await expect
    .poll(() => new URL(page.url()).searchParams.get('project'))
    .toBeNull()

  await openEditor(page, { authed: true, query: '?template=tpl_Y' })
  await expect.poll(async () => (await exportedDoc(page)).name).toBe('tpl-doc')
  // templates load as a working copy — never linked to a cloud project
  expect(await store(page, 'editor', 'cloudProject')).toBe(null)
  await expect
    .poll(() => new URL(page.url()).searchParams.get('template'))
    .toBeNull()
})

test('public deep link: ?exampleUrl= loads from a trusted host without auth, rejects other hosts, query stripped', async ({
  page,
}) => {
  await resetMockOrch()

  // A trusted loopback URL (the fixture server) loads its payload as a fresh,
  // unsaved doc — no sign-in, no cloud link (the marketing-site "Open in editor").
  await openEditor(page, {
    query: `?exampleUrl=${encodeURIComponent(`${FIXTURES}/example-doc.json`)}`,
  })
  await expect
    .poll(async () => (await exportedDoc(page)).name)
    .toBe('cdn-example-doc')
  expect((await exportedDoc(page)).visuals[0]).toMatchObject({
    type: 'TEXT',
    text: 'from-cdn-example',
  })
  expect(await store(page, 'auth', 'user')).toBe(null)
  expect(await store(page, 'editor', 'cloudProject')).toBe(null)
  await expect(page.locator('.toast', { hasText: 'Example loaded' })).toBeVisible()
  await expect
    .poll(() => new URL(page.url()).searchParams.get('exampleUrl'))
    .toBeNull()

  // An untrusted host is refused: the crafted payload never loads.
  await openEditor(page, {
    query: `?exampleUrl=${encodeURIComponent('https://evil.example.com/x.json')}`,
  })
  await expect(
    page.locator('.toast', { hasText: 'not from a trusted source' })
  ).toBeVisible()
  expect((await exportedDoc(page)).name).not.toBe('cdn-example-doc')
})

test('New and Import both clear the cloud link and its localStorage mirror', async ({
  page,
}) => {
  await resetMockOrch()
  await openEditor(page)

  const link = () => store(page, 'editor', 'cloudProject')
  const stored = () =>
    page.evaluate(() => localStorage.getItem('zvid-cloud-project'))
  const setLink = () =>
    page.evaluate(() =>
      (window as any).__zvidTest.editor.setCloudProject({ id: 'prj_9', name: 'Linked' })
    )

  // New → Video project unlinks
  await setLink()
  await expect.poll(stored).toContain('prj_9')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.new-menu .item', { hasText: 'Video project' }).click()
  await expect.poll(link).toBe(null)
  await expect.poll(stored).toBe(null)

  // Import (loadRaw path) unlinks too
  await setLink()
  await expect.poll(stored).toContain('prj_9')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.fill(
    '.code-ed textarea',
    JSON.stringify({ name: 'imported-unlink', duration: 5 })
  )
  await page.getByRole('button', { name: 'Import project' }).click()
  await expect.poll(link).toBe(null)
  await expect.poll(stored).toBe(null)
  expect((await exportedDoc(page)).name).toBe('imported-unlink')
})

/* ================= 10: uploads ================= */

test('uploads: seeded items render, file upload POSTs to orch, delete confirms and removes', async ({
  page,
}) => {
  await resetMockOrch({ uploads: [seedUpload('upl_seed', 'seeded.png')] })
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded && !!t.auth.user')

  // seeded upload listed on the default Images tab
  const cells = page.locator('.uploads-section .cell')
  await expect(cells).toHaveCount(1)
  await expect(cells.first().locator('img')).toHaveAttribute(
    'src',
    `${FIXTURES}/image.png`
  )
  expect((await callsTo('/api/uploads', 'GET')).length).toBeGreaterThanOrEqual(1)

  // upload a real file through the hidden input (XHR multipart → mock orch)
  await page.setInputFiles(
    '.uploads-section input[type="file"]',
    path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'image.png')
  )
  await expect
    .poll(async () => (await callsTo('/api/uploads', 'POST')).length)
    .toBe(1)
  expect((await callsTo('/api/uploads', 'POST'))[0].auth).toBe(true)
  // the stored item lands in the store…
  await expect
    .poll(() => page.evaluate(() => (window as any).__zvidTest.uploads.items?.length))
    .toBe(2)
  expect(
    await page.evaluate(() => (window as any).__zvidTest.uploads.items[0].id)
  ).toBe('upl_1')
  // the mock returns the real orch item shape ({ kind, fileName, sizeBytes,
  // url … }), so the fresh upload renders immediately at the front of the grid
  await expect(cells).toHaveCount(2)

  // click-to-add places an upload on the stage
  await cells.first().click()
  const doc = await exportedDoc(page)
  expect(doc.visuals[0]).toMatchObject({
    type: 'IMAGE',
    src: `${FIXTURES}/image.png`,
  })

  // delete the seeded upload (second cell — the fresh one was unshifted first)
  page.on('dialog', (d) => d.accept())
  await cells.nth(1).hover()
  await cells.nth(1).locator('.del').click()
  await expect(cells).toHaveCount(1)
  await expect
    .poll(async () => (await callsTo('/api/uploads/upl_seed', 'DELETE')).length)
    .toBe(1)
})

test('uploads logged out: sign-in hint instead of the upload button', async ({
  page,
}) => {
  await resetMockOrch()
  await openEditor(page)

  const box = page.locator('.uploads-section .state-box')
  await expect(box).toContainText('Sign in to upload')
  await expect(page.locator('.uploads-section .upload-btn')).toHaveCount(0)
  await expect
    .poll(() => store(page, 'uploads', 'authRequired'))
    .toBe(true)
  await box.locator('button', { hasText: 'Sign in' }).click()
  expect(await store(page, 'editor', 'modal')).toBe('auth')
})

/* ================= 11: designs ================= */

test('designs: seeded design renders with preview, inserts a designer TEXT visual, deletes', async ({
  page,
}) => {
  await resetMockOrch({ designs: [seedDesign] })
  await openEditor(page, { authed: true })
  await waitBridge(page, 't.auth.loaded && !!t.auth.user')

  await page.locator('.rail-tab[title="Design"]').click()
  const cards = page.locator('.design-grid .design-card')
  await expect(cards).toHaveCount(1)
  await expect(cards.first().locator('.design-name')).toHaveText('Neon Title')
  await expect(cards.first().locator('.mini')).toBeVisible() // MiniPreview

  // insert onto the stage: compiled TEXT visual with the designer round-trip field
  await cards.first().click()
  await expect(page.locator('.toast', { hasText: 'added to the stage' })).toBeVisible()
  const doc = await exportedDoc(page)
  expect(doc.visuals).toHaveLength(1)
  expect(doc.visuals[0].type).toBe('TEXT')
  expect(doc.visuals[0].html).toContain('NeonE2E')
  expect(doc.visuals[0].designer?.layers?.[0]?.text).toBe('NeonE2E')

  // delete with confirm
  page.on('dialog', (d) => d.accept())
  await cards.first().hover()
  await cards.first().locator('.del').click()
  await expect(cards).toHaveCount(0)
  await expect
    .poll(async () => (await callsTo('/api/designs/dsn_1', 'DELETE')).length)
    .toBe(1)
  await expect(page.locator('.design-panel .empty-note')).toBeVisible()
})

/* ================= 12: stock ================= */

test('stock: provider chips, debounced search, infinite scroll to page 2, click adds visual', async ({
  page,
}) => {
  await resetMockOrch({
    stockProviders: {
      image: ['pexels', 'pixabay'],
      video: ['pexels'],
      gif: ['giphy'],
      audio: ['jamendo'],
    },
    stockPages: { image: [stockPage(1, 48), stockPage(2, 12)] },
  })
  await openEditor(page)

  // first page renders on the default Images tab
  const cells = page.locator('.stock-panel .grid .cell:not(.skeleton)')
  await expect(cells).toHaveCount(48)
  const first = (await callsTo('/api/stock/search'))[0]
  expect(first.query).toMatchObject({ type: 'image', page: '1' })

  // providers endpoint drives the chips (>1 provider for images)
  expect((await callsTo('/api/stock/providers')).length).toBeGreaterThanOrEqual(1)
  const chips = page.locator('.stock-panel .chips .chip')
  await expect(chips).toHaveText(['All', 'Pexels', 'Pixabay'])
  await expect(chips.first()).toHaveClass(/active/)

  // debounced search fires one request with the query
  await page.fill('.stock-panel .search-input', 'sunset')
  await expect
    .poll(async () =>
      (await callsTo('/api/stock/search')).filter((c) => c.query.query === 'sunset')
        .length
    )
    .toBe(1)
  await expect(cells).toHaveCount(48) // mock ignores the term; list reloaded

  // infinite scroll: bottom of the rail panel pulls page 2 (dedup by id)
  await page
    .locator('.rail-panel')
    .evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(cells).toHaveCount(60)
  const page2 = (await callsTo('/api/stock/search')).filter(
    (c) => c.query.page === '2'
  )
  expect(page2.length).toBe(1)
  expect(page2[0].query.query).toBe('sunset')
  // both pages consumed → auto-load stops with the end note
  await expect(page.locator('.stock-panel .end-note')).toContainText(
    "That's everything"
  )

  // clicking an item adds a visual with the payload's full-quality src
  await cells.first().click()
  await expect(page.locator('.toast', { hasText: 'image added' })).toBeVisible()
  const doc = await exportedDoc(page)
  expect(doc.visuals[0]).toMatchObject({
    type: 'IMAGE',
    src: `${FIXTURES}/image.png?full=p1-0`,
    resize: 'contain',
  })

  // provider chip narrows the search
  await chips.nth(2).click() // Pixabay
  await expect
    .poll(async () =>
      (await callsTo('/api/stock/search')).filter(
        (c) => c.query.provider === 'pixabay'
      ).length
    )
    .toBeGreaterThanOrEqual(1)
})

test('stock provider error: notice shown, auto-load halts, Retry recovers', async ({
  page,
}) => {
  await resetMockOrch({ stockError: 'boom upstream' })

  // Count the browser's own /api/stock/search requests — unlike the mock's
  // shared call log this can't be clobbered by a concurrent __mock/reset.
  // (Absolute counts are >1 anyway: ofetch retries GETs on 502 both browser-
  // side and inside the Nuxt proxy.)
  const searchReqs: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/stock/search')) searchReqs.push(r.url())
  })

  await openEditor(page)

  const errBox = page.locator('.stock-panel .state-box.error')
  await expect(errBox).toContainText('boom upstream')
  await expect
    .poll(() => store(page, 'stock', 'byKind.image.error'))
    .toBe('boom upstream')

  // a set error halts the scroll/fill auto-load loop — the count must plateau
  const before = searchReqs.length
  expect(before).toBeGreaterThanOrEqual(1)
  await page
    .locator('.rail-panel')
    .evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.waitForTimeout(700)
  expect(searchReqs.length).toBe(before)

  // provider recovers → Retry reloads the first page
  await resetMockOrch({ stockPages: { image: [stockPage(1, 6)] } })
  await errBox.locator('button', { hasText: 'Retry' }).click()
  await expect(page.locator('.stock-panel .grid .cell:not(.skeleton)')).toHaveCount(6)
  await expect(errBox).toHaveCount(0)
})
