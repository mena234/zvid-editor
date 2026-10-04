import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'
import { login, openEditorFromDashboard } from './helpers/dashboard'
import { addText, addUploadedMedia, editFirstText, exportProject, newProject, saveProject, selectExample, setProjectDimensions, setProjectName, uploadMedia, waitForEditor } from './helpers/editor'
import { assertPinnedTemplate, type TemplatePin } from './helpers/template'
import { renderAndVerify } from './helpers/render'

test('published video template → edit → save → render → download → credits @core', async ({ page, live }, info) => {
  test.setTimeout(live.env.renderTimeoutMs + 240_000)
  await test.step('Log in and open the editor from the dashboard', async () => { await login(page, live) })
  const editor = await openEditorFromDashboard(page, live)
  await waitForEditor(editor, live.env.email)
  const pin: TemplatePin = JSON.parse(await readFile(live.env.templatePath, 'utf8'))
  await test.step('Verify and choose the published video template', async () => {
    const item = await live.api.get(`/library/examples/${encodeURIComponent(pin.slug)}`)
    const metadata = item.item || item
    const contentResponse = await editor.request.get(`${live.env.editorUrl}/api/library/examples/${encodeURIComponent(pin.slug)}/content`)
    expect(contentResponse.ok(), 'Pinned template is available').toBe(true)
    assertPinnedTemplate({ slug: metadata.slug, title: metadata.title, version: metadata.version, content: await contentResponse.json(), isFree: !metadata.meta?.premium }, pin)
    await selectExample(editor, { ...pin, version: Number(pin.version) })
  })
  await test.step('Customize text and save the project through the UI', async () => {
    await setProjectName(editor, live.name('template-video'))
    await editFirstText(editor, 'Live E2E video check')
    const exported = await exportProject(editor)
    await saveProject(editor, live, exported.name)
  })
  await test.step('Render once, play/download the video, and reconcile dashboard credits', async () => {
    await renderAndVerify(editor, page, live, 'video', info)
  })
})

test('uploaded image → PNG render → download → credits', async ({ page, live }, info) => {
  test.setTimeout(live.env.renderTimeoutMs + 180_000)
  await login(page, live)
  const editor = await openEditorFromDashboard(page, live)
  await waitForEditor(editor, live.env.email)
  await test.step('Compose an image with a real uploaded fixture', async () => {
    await newProject(editor, 'image', live.name('image-render'))
    await setProjectDimensions(editor, 640, 360)
    const image = await uploadMedia(editor, live, 'image.png')
    await addUploadedMedia(editor, image.name)
    await addText(editor, 'Live E2E image check')
    expect((await exportProject(editor)).type).toBe('image')
  })
  await test.step('Render one PNG and verify output and the one-credit charge', async () => {
    await renderAndVerify(editor, page, live, 'image', info)
  })
})
