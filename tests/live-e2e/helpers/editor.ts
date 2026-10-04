import { readFile } from 'node:fs/promises'
import { expect, type Locator, type Page, type Response, type TestInfo } from '@playwright/test'

/** Structural interface shared with the live fixture; no app stores or injected hooks. */
export interface LiveEditorContext {
  env: { dashboardUrl: string; editorUrl: string; apiUrl: string; email: string; password: string }
  api: { get(path: string): Promise<any> }
  track(kind: 'project' | 'template' | 'upload' | 'job' | 'apiKey', id: string, name: string): void | Promise<void>
  name(tag: string): string
  sensitive: boolean
}

export interface ExamplePin {
  slug: string
  title: string
  version: string | number
  contentHash: string
  duration: number
  width: number
  height: number
}

const tourHandlers = new WeakSet<Page>()

export async function waitForEditor(page: Page, email?: string) {
  // First-visit onboarding can appear after the shell. Keep a UI handler
  // registered so a late tour is dismissed before the next user action.
  const tour = page.locator('.tour[role="dialog"]')
  if (!tourHandlers.has(page)) {
    await page.addLocatorHandler(tour, async () => {
      await tour.getByRole('button', { name: 'Skip tour', exact: true }).click()
    })
    tourHandlers.add(page)
  }
  await expect(page.locator('.stage-frame')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toBeVisible()
  if (email) {
    await expect(page.getByRole('button', { name: `Account for ${email}`, exact: true })).toBeVisible()
  }
  await expect(tour).toBeHidden()
}

export async function openEditor(page: Page, live: LiveEditorContext) {
  await page.goto(live.env.editorUrl, { waitUntil: 'domcontentloaded' })
  await waitForEditor(page, live.env.email)
}

/** The same action can be in the compact More menu at narrower widths. */
export async function editorAction(page: Page, action: Locator) {
  if (!await action.isVisible()) {
    await page.getByRole('button', { name: 'More editor actions', exact: true }).click()
  }
  await expect(action).toBeVisible()
  await action.click()
}

export async function setProjectName(page: Page, name: string) {
  const field = page.getByRole('textbox', { name: 'Project name', exact: true })
  await field.fill(name)
  await field.press('Tab')
  await expect(field).toHaveValue(name)
}

export async function setProjectDimensions(page: Page, width: number, height: number) {
  for (const dimension of [width, height]) {
    if (!Number.isSafeInteger(dimension) || dimension < 16) throw new Error('Project dimensions must be integer pixels, at least 16')
  }
  const settings = page.locator('#topbar-settings')
  const preset = settings.getByTitle('Resolution preset', { exact: true })
  if (!await preset.isVisible()) await page.getByRole('button', { name: 'Project settings', exact: true }).click()
  await preset.selectOption('custom')
  for (const [title, value] of [['Width (px)', width], ['Height (px)', height]] as const) {
    const input = settings.getByTitle(title, { exact: true }).locator('input.num')
    await input.fill(String(value))
    await input.press('Enter')
    await expect(input).toHaveValue(String(value))
  }
  await page.locator('.topbar .brand').click()
  const doc = await exportProject(page)
  expect(doc.width, 'Export preserves the requested canvas width').toBe(width)
  expect(doc.height, 'Export preserves the requested canvas height').toBe(height)
}

/** Keep media failures strict while showing whether fetching or decoding failed. */
export async function expectVideoPreview(page: Page, info: TestInfo, network: string[]) {
  const video = page.locator('.stage-frame video')
  try {
    await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState), {
      message: 'Uploaded video loads a playable preview frame', timeout: 30_000,
    }).toBeGreaterThanOrEqual(2)
  } catch (error) {
    const media = await video.evaluate(el => {
      const node = el as HTMLVideoElement
      const raw = node.currentSrc || node.src
      const url = raw ? new URL(raw) : null
      return {
        url: url ? `${url.origin}${url.pathname}` : '',
        readyState: node.readyState, networkState: node.networkState,
        duration: Number.isFinite(node.duration) ? node.duration : null,
        videoWidth: node.videoWidth, videoHeight: node.videoHeight,
        error: node.error ? { code: node.error.code, message: node.error.message } : null,
      }
    }).catch(() => ({ missing: true }))
    await info.attach('video-preview-failure', {
      body: JSON.stringify({ media, network }, null, 2), contentType: 'application/json',
    })
    throw error
  }
}

export async function newProject(page: Page, type: 'video' | 'image', name: string) {
  await editorAction(page, page.getByTitle('New empty project', { exact: true }))
  await page.getByRole('button', { name: type === 'video' ? 'Video project' : 'Image project', exact: true }).click()
  await setProjectName(page, name)
  await expect(page.locator('.stage-frame .stage-item')).toHaveCount(0)
  if (type === 'video') await expect(page.locator('.tl-panel')).toBeVisible()
  else await expect(page.locator('.tl-panel')).toHaveCount(0)
}

/** Read the customer-facing export. It is an authoring document, not a render estimate. */
export async function exportProject(page: Page): Promise<Record<string, any>> {
  await page.locator('.topbar').getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export — automation-ready JSON', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'project.json', exact: true }).click()
  const doc = JSON.parse(await dialog.locator('pre.code').innerText())
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  return doc
}

export async function importProject(page: Page, doc: Record<string, any>) {
  await editorAction(page, page.locator('.topbar').getByRole('button', { name: 'Import', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'Import zvid project JSON', exact: true })
  await dialog.locator('.code-ed textarea').fill(JSON.stringify(doc))
  await dialog.getByRole('button', { name: 'Import project', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  if (doc.name) await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(doc.name)
}

async function successfulBody(response: Response, operation: string) {
  expect(response.ok(), `${operation} returned HTTP ${response.status()}`).toBe(true)
  const body = await response.json()
  expect(body.success, `${operation} did not succeed`).toBe(true)
  return body
}

export async function saveProject(page: Page, live: LiveEditorContext, name: string): Promise<string> {
  await setProjectName(page, name)
  const save = page.locator('.topbar').getByRole('button', { name: 'Save', exact: true })
  const updating = (await save.getAttribute('title'))?.startsWith('Save to “') ?? false
  const response = page.waitForResponse(r => {
    const url = new URL(r.url())
    return url.origin === new URL(live.env.editorUrl).origin
      && (updating ? /^\/api\/projects\/prj_[^/]+$/.test(url.pathname) : url.pathname === '/api/projects')
      && r.request().method() === (updating ? 'PUT' : 'POST')
  })
  await save.click()
  if (!updating) {
    const dialog = page.getByRole('dialog', { name: 'Save project to your account', exact: true })
    await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name)
    await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  }
  const body = await successfulBody(await response, 'Save project')
  const id = body.project?.id
  expect(id).toMatch(/^prj_/)
  await live.track('project', id, name)
  expect(body.project.name).toBe(name)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(save).toHaveAttribute('title', `Save to “${name}” in your account`)
  return id
}

export async function inspectorSection(page: Page, title: string): Promise<Locator> {
  const section = page.locator('.insp-body section.sec').filter({
    has: page.locator('.sec-head span').filter({ hasText: new RegExp(`^${escapeRegex(title)}$`) }),
  })
  await expect(section).toHaveCount(1)
  if (!await section.locator('.sec-body').isVisible()) await section.locator('button.sec-head').click()
  await expect(section.locator('.sec-body')).toBeVisible()
  return section
}

export async function editSelectedText(page: Page, text: string) {
  await page.locator('.insp-tabs').getByRole('button', { name: 'Design', exact: true }).click()
  const content = await inspectorSection(page, 'Content')
  await content.getByRole('button', { name: 'Plain text', exact: true }).click()
  const field = content.getByPlaceholder('Your text…', { exact: true })
  await field.fill(text)
  await field.press('Tab')
  await expect(field).toHaveValue(text)
}

/** Edit an existing plain-text item, entering its scene through the timeline when needed. */
export async function editFirstText(page: Page, text: string) {
  const before = await exportProject(page)
  const containers: { sceneIndex: number; visuals: Record<string, any>[] }[] = [
    { sceneIndex: -1, visuals: before.visuals ?? [] },
    ...(before.scenes ?? []).map((scene: any, sceneIndex: number) => ({ sceneIndex, visuals: scene.visuals ?? [] })),
  ]
  const eligible = (item: Record<string, any>) => String(item.type).toUpperCase() === 'TEXT'
    && typeof item.text === 'string' && item.text.length > 0
    && !item.customCode?.css && !item.customCode?.js && !item.designer
  const container = containers.find(group => group.visuals.some(eligible))
  if (!container) throw new Error('This example has no existing plain-text element that the UI can edit')
  const itemIndex = container.visuals.findIndex(eligible)
  const item = container.visuals[itemIndex]
  if (container.sceneIndex >= 0) {
    const allScenes = page.locator('.scene-local-note').getByRole('button', { name: 'all scenes', exact: true })
    if (await allScenes.isVisible()) await allScenes.click()
    await page.locator('.tl-panel .scene-block').nth(container.sceneIndex).dblclick()
    await expect(page.locator('.scene-local-note')).toBeVisible()
  }

  if (before.type === 'image') {
    const candidate = page.locator('.stage-frame .stage-item.interactive').filter({
      has: page.locator('.text-inner').filter({ hasText: new RegExp(`^${escapeRegex(item.text)}$`) }),
    })
    await expect(candidate).toHaveCount(1)
    await candidate.click()
  } else {
    const label = item.text.length > 42 ? `${item.text.slice(0, 42)}…` : item.text
    const titledClip = page.locator('.tl-panel').getByTitle(label, { exact: true }).and(page.locator('.clip'))
    await expect(titledClip).toHaveCount(1)
    await titledClip.click()
  }
  await editSelectedText(page, text)
  const after = await exportProject(page)
  const changed = container.sceneIndex < 0 ? after.visuals : after.scenes[container.sceneIndex].visuals
  expect(changed).toHaveLength(container.visuals.length)
  expect(changed[itemIndex].text).toBe(text)
  expect(item.text, 'Existing template text is changed').not.toBe(text)
  if (container.sceneIndex >= 0) {
    await page.locator('.scene-local-note').getByRole('button', { name: 'all scenes', exact: true }).click()
  }
}

async function openLibraryTab(page: Page, title: string, content: Locator) {
  const button = page.getByTitle(title, { exact: true }).and(page.locator('.rail-tab'))
  if (await button.getAttribute('aria-pressed') === 'true') {
    if (!await content.isVisible()) {
      const back = page.locator('.inspector').getByTitle('Back to library', { exact: true })
      if (await back.isVisible()) await back.click()
      else {
        await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'false')
        await button.click()
      }
    }
  } else await button.click()
  await expect(content).toBeVisible()
}

export async function addText(page: Page, text: string) {
  await openLibraryTab(page, 'Text', page.locator('.text-panel'))
  await page.locator('.text-panel .preset').filter({ hasText: 'Add a heading' }).click()
  // Adding selects the item but deliberately leaves the library open.
  await page.locator('.stage-frame .stage-item').filter({ hasText: 'Your heading' }).last().click()
  await editSelectedText(page, text)
  await expect(page.locator('.stage-frame .text-inner').filter({ hasText: text })).toBeVisible()
}

/** Selection stays user-driven; fixture identity is also checked against actual network traffic. */
export async function selectExample(page: Page, pin: ExamplePin) {
  await editorAction(page, page.getByRole('button', { name: 'Examples', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'Example projects', exact: true })
  await dialog.getByRole('tab', { name: /Videos/ }).click()
  // Search terms are word-prefix matches; punctuation such as '(scenes)'
  // is not a word prefix. The card still must match the full pinned title.
  const search = (pin.title.match(/[a-zA-Z0-9]+/g) ?? []).slice(0, 6).join(' ')
  await dialog.getByRole('searchbox', { name: 'Search example projects', exact: true }).fill(search)
  const card = dialog.locator('button.card').filter({ has: page.locator('.card-head b').filter({ hasText: new RegExp(`^${escapeRegex(pin.title)}$`) }) })
  await expect(card).toHaveCount(1)
  await expect(card.locator('.pro-badge')).toHaveCount(0)
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/library/examples/${pin.slug}/content` && r.request().method() === 'GET')
  await card.click()
  expect((await response).ok(), 'Pinned example content must load').toBe(true)
  await expect(dialog).toHaveCount(0)
}

const MEDIA = {
  'image.png': { tab: 'Images', mimeType: 'image/png' },
  'clip.mp4': { tab: 'Videos', mimeType: 'video/mp4' },
  'tone.mp3': { tab: 'Audio', mimeType: 'audio/mpeg' },
} as const

export async function uploadMedia(page: Page, live: LiveEditorContext, fixtureName: keyof typeof MEDIA) {
  const fixture = MEDIA[fixtureName]
  const dot = fixtureName.lastIndexOf('.')
  const name = `${live.name(fixtureName.slice(0, dot))}${fixtureName.slice(dot)}`
  const section = page.locator('.uploads-section')
  await openLibraryTab(page, fixture.tab, section)
  await expect(section.getByRole('button', { name: 'Upload', exact: true })).toBeEnabled()
  const chooser = page.waitForEvent('filechooser')
  await section.getByRole('button', { name: 'Upload', exact: true }).click()
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/uploads' && r.request().method() === 'POST')
  await (await chooser).setFiles({
    name,
    mimeType: fixture.mimeType,
    buffer: await readFile(new URL(`../../e2e/fixtures/${fixtureName}`, import.meta.url)),
  })
  const res = await response
  expect(res.ok(), `Upload returned HTTP ${res.status()}`).toBe(true)
  const { upload } = await res.json()
  expect(upload?.id).toBeTruthy()
  await live.track('upload', upload.id, name)
  expect(upload.fileName).toBe(name)
  expect(upload.url).toMatch(/^https:\/\//)
  await expect(section.getByTitle(new RegExp(`^${escapeRegex(name)} — click to add`))).toBeVisible()
  return { id: upload.id as string, name, src: upload.url as string }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function addUploadedMedia(page: Page, name: string) {
  const item = page.locator('.uploads-section').getByTitle(new RegExp(`^${escapeRegex(name)} — click to add`))
  await expect(item).toBeVisible()
  await item.click()
  await expect(page.locator('.sel-box.primary, .tl-panel .aclip.selected')).toBeVisible()
}

export async function deleteUploadedMedia(page: Page, fixtureName: keyof typeof MEDIA, upload: { id: string; name: string }) {
  await openLibraryTab(page, MEDIA[fixtureName].tab, page.locator('.uploads-section'))
  const item = page.locator('.uploads-section').getByTitle(new RegExp(`^${escapeRegex(upload.name)} — click to add`))
  await expect(item).toBeVisible()
  await item.hover()
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/uploads/${upload.id}` && r.request().method() === 'DELETE')
  page.once('dialog', dialog => {
    if (!dialog.message().includes(`"${upload.name}"`)) return dialog.dismiss()
    return dialog.accept()
  })
  await item.getByTitle('Delete upload', { exact: true }).click()
  expect((await response).ok(), 'Delete own uploaded media must succeed').toBe(true)
  await expect(item).toHaveCount(0)
}

export async function saveTemplate(page: Page, live: LiveEditorContext, name: string): Promise<string> {
  await page.getByRole('button', { name: `Account for ${live.env.email}`, exact: true }).click()
  await page.locator('#account-menu').getByRole('button', { name: 'Save as template', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as render template', exact: true })
  await dialog.getByRole('textbox', { name: 'Template name', exact: true }).fill(name)
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/templates' && r.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Save template', exact: true }).click()
  const body = await successfulBody(await response, 'Save template')
  const id = body.template?.id
  expect(id).toMatch(/^tpl_/)
  await live.track('template', id, name)
  await expect(dialog.locator('.done')).toContainText(id)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  return id
}
