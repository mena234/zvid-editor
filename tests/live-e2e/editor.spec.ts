import { readFile } from 'node:fs/promises'
import type { Request, Response } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  login, navigateDashboard, openProjectInEditor, openTemplateInEditor, archiveTemplateUI,
  renameProjectUI, deleteProjectUI,
} from './helpers/dashboard'
import {
  addText, addUploadedMedia, deleteUploadedMedia, editSelectedText, editorAction, exportProject, importProject,
  expectVideoPreview, inspectorSection, newProject, openEditor, saveProject, saveTemplate, uploadMedia, waitForEditor,
} from './helpers/editor'

test('project draft: compose, save, update, export and reopen from the dashboard', async ({ page, live }) => {
  const id = await test.step('Log in, compose a video draft and save it', async () => {
    await login(page, live)
    await openEditor(page, live)
    const name = live.name('project')
    await newProject(page, 'video', name)
    await addText(page, 'A customer-created draft')
    return saveProject(page, live, name)
  })

  const { updatedName, exported } = await test.step('Update the same project and download its JSON', async () => {
    await editSelectedText(page, 'Updated through the editor')
    const updatedName = live.name('updated-project')
    expect(await saveProject(page, live, updatedName)).toBe(id)
    const exported = await exportProject(page)
    expect(exported.name).toBe(updatedName)
    expect(exported.visuals).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'TEXT', text: 'Updated through the editor' })]))

    await page.locator('.topbar').getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export — automation-ready JSON', exact: true })
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download JSON', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(`${updatedName}.json`)
    const file = await download.path()
    expect(file).toBeTruthy()
    expect(JSON.parse(await readFile(file!, 'utf8'))).toEqual(exported)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    return { updatedName, exported }
  })

  await test.step('Refresh and reopen the saved document from the dashboard', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForEditor(page, live.env.email)
    expect(await exportProject(page)).toEqual(exported)
    const server = await live.api.get(`/projects/${id}`)
    expect(server.project.name).toBe(updatedName)
    expect(server.project.payload).toEqual(exported)

    await navigateDashboard(page, live, '/projects')
    const reopened = await openProjectInEditor(page, updatedName)
    await waitForEditor(reopened, live.env.email)
    expect(await exportProject(reopened)).toEqual(exported)
    await reopened.close()
  })

  await test.step('Rename and delete the project, then verify its old link fails visibly', async () => {
    const renamedName = live.name('dashboard-renamed-project')
    await renameProjectUI(page, updatedName, renamedName)
    await live.track('project', id, renamedName)
    expect((await live.api.get(`/projects/${id}`)).project.name).toBe(renamedName)
    await deleteProjectUI(page, renamedName, true)
    const missing = page.waitForResponse(r => new URL(r.url()).pathname === `/api/projects/${id}` && r.request().method() === 'GET')
    await page.goto(`${live.env.editorUrl}/?project=${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' })
    const missingBody = await (await missing).json()
    expect(missingBody.success).toBe(false)
    expect(missingBody.status).toBe(404)
    await expect(page.locator('.toast').filter({ hasText: /project not found|could not open|no project/i })).toBeVisible()
    await waitForEditor(page, live.env.email)
  })
})

test('media editing: real uploads, inspector, timeline trim, undo/redo and import round trip', async ({ page, live }, info) => {
  await test.step('Log in and position text through the inspector', async () => {
    await login(page, live)
    await openEditor(page, live)
    await newProject(page, 'video', live.name('media-edit'))
    await addText(page, 'Media editing check')

    const layout = await inspectorSection(page, 'Layout')
    for (const [label, value] of [['X (anchor point)', '120'], ['Y (anchor point)', '80']]) {
      const field = layout.locator('.field').filter({ has: page.getByText(label, { exact: true }) }).locator('input.num')
      await field.fill(value)
      await field.press('Enter')
    }
    expect((await exportProject(page)).visuals[0]).toMatchObject({ type: 'TEXT', x: 120, y: 80 })
  })

  const { image, video, audio, before } = await test.step('Upload and add image, video and audio fixtures', async () => {
    const image = await uploadMedia(page, live, 'image.png')
    await addUploadedMedia(page, image.name)
    const network: string[] = []
    const safeUrl = (raw: string) => { const url = new URL(raw); return `${url.origin}${url.pathname}` }
    const onResponse = (response: Response) => {
      if (response.request().resourceType() === 'media') network.push(`${response.status()} ${safeUrl(response.url())}`)
    }
    const onFailed = (request: Request) => {
      if (request.resourceType() === 'media') network.push(`FAILED ${safeUrl(request.url())} ${request.failure()?.errorText ?? ''}`)
    }
    page.on('response', onResponse)
    page.on('requestfailed', onFailed)
    let video: Awaited<ReturnType<typeof uploadMedia>>
    try {
      video = await uploadMedia(page, live, 'clip.mp4')
      await addUploadedMedia(page, video.name)
      await expectVideoPreview(page, info, network)
    } finally {
      page.off('response', onResponse)
      page.off('requestfailed', onFailed)
    }
    const audio = await uploadMedia(page, live, 'tone.mp3')
    await addUploadedMedia(page, audio.name)
    const before = await exportProject(page)
    expect(before.visuals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'IMAGE', src: image.src }),
      expect.objectContaining({ type: 'VIDEO', src: video.src }),
    ]))
    expect(before.audios).toEqual(expect.arrayContaining([expect.objectContaining({ src: audio.src })]))
    await expect(page.locator('.tl-panel .aclip')).toHaveCount(1)
    return { image, video, audio, before }
  })

  const afterTrim = await test.step('Trim the video with the mouse and verify undo and redo', async () => {
    const videoLabel = new URL(video.src).pathname.split('/').pop()!
    const clip = page.locator('.tl-panel .clip').filter({ hasText: videoLabel })
    await expect(clip).toHaveCount(1)
    await clip.click()
    const clipBox = await clip.boundingBox()
    const handle = clip.locator('.trim.r')
    const handleBox = await handle.boundingBox()
    expect(clipBox).toBeTruthy()
    expect(handleBox).toBeTruthy()
    const startX = handleBox!.x + handleBox!.width / 2
    const startY = handleBox!.y + handleBox!.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - clipBox!.width / 3, startY, { steps: 12 })
    await page.mouse.up()
    const afterTrim = await exportProject(page)
    const findVideo = (doc: Record<string, any>) => doc.visuals.find((item: any) => item.src === video.src)
    expect(findVideo(afterTrim).exitEnd).toBeLessThan(findVideo(before).exitEnd)
    expect(findVideo(afterTrim).exitEnd).toBeGreaterThan(findVideo(before).enterBegin ?? 0)
    await editorAction(page, page.getByTitle('Undo (Ctrl+Z)', { exact: true }))
    expect(findVideo(await exportProject(page))).toEqual(findVideo(before))
    await editorAction(page, page.getByTitle('Redo (Ctrl+Y)', { exact: true }))
    expect(findVideo(await exportProject(page))).toEqual(findVideo(afterTrim))
    return afterTrim
  })

  await test.step('Reject invalid JSON, round-trip the document and delete the test uploads', async () => {
    await editorAction(page, page.locator('.topbar').getByRole('button', { name: 'Import', exact: true }))
    const importDialog = page.getByRole('dialog', { name: 'Import zvid project JSON', exact: true })
    await importDialog.locator('.code-ed textarea').fill('{invalid')
    await importDialog.getByRole('button', { name: 'Import project', exact: true }).click()
    await expect(importDialog.locator('pre.err')).toBeVisible()
    await importDialog.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await exportProject(page)).toEqual(afterTrim)
    await newProject(page, 'video', live.name('empty-roundtrip'))
    await importProject(page, afterTrim)
    expect(await exportProject(page)).toEqual(afterTrim)
    await expect(page.locator('.stage-frame .stage-item')).toHaveCount(afterTrim.visuals.length)
    await deleteUploadedMedia(page, 'image.png', image)
    await deleteUploadedMedia(page, 'clip.mp4', video)
    await deleteUploadedMedia(page, 'tone.mp3', audio)
  })
})

test('reusable image template: save, reopen from dashboard and archive', async ({ page, live }) => {
  const name = live.name('template')
  const exported = await test.step('Log in, compose an image and save it as a template', async () => {
    await login(page, live)
    await openEditor(page, live)
    await newProject(page, 'image', name)
    await addText(page, 'Reusable image template')
    const exported = await exportProject(page)
    expect(exported.type).toBe('image')
    const id = await saveTemplate(page, live, name)
    const response = await live.api.get(`/templates/${id}`)
    expect(response.template.name).toBe(name)
    expect(response.template.project.visuals).toEqual(exported.visuals)
    return exported
  })

  await test.step('Reopen the template through the dashboard', async () => {
    await navigateDashboard(page, live, '/templates')
    const reopened = await openTemplateInEditor(page, name)
    await waitForEditor(reopened, live.env.email)
    const reopenedDoc = await exportProject(reopened)
    expect(reopenedDoc.type).toBe('image')
    expect(reopenedDoc.visuals).toEqual(exported.visuals)
    await reopened.close()
  })
  await test.step('Archive the newly created template through the dashboard', async () => {
    await archiveTemplateUI(page, name)
  })
})
