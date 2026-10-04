import { expect, type Page, type TestInfo, type WebSocket, type Request, type Response } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import type { LiveSession } from '../fixtures'
import { contentHash, normalizeFixedVideo, normalizeImage } from './template'
import { exportProject } from './editor'
import { findJobCard, navigateDashboard, readDashboardCredits } from './dashboard'

const exec = promisify(execFile)

export interface RenderPacket {
  type: 'event' | 'ack'
  ackId: string
  data: any[]
}

/** Decode only Socket.IO messages in the actual render namespace. */
export function decodeRenderPacket(payload: string | Buffer): RenderPacket | null {
  const text = payload.toString()
  const match = /^4([23])\/frontend,(\d*)(\[.*)$/s.exec(text)
  if (!match) return null
  const data: unknown = JSON.parse(match[3])
  if (!Array.isArray(data)) throw new Error('Unexpected render transport packet')
  return { type: match[1] === '2' ? 'event' : 'ack', ackId: match[2], data }
}

/** Observe the existing Socket.IO transport; never replace or inject application code. */
function observeRender(page: Page, live: LiveSession, reservation: string, approved: Record<string, any>, expectedCost: number) {
  let id = ''
  let submissions = 0
  let problem = ''
  let submissionAck = ''
  const states = new Set<string>()
  const sockets: WebSocket[] = []
  const approvedHash = contentHash(approved)
  const fail = (reason: string) => {
    if (problem) return
    problem = reason
    try { live.run.stop(problem) }
    catch { problem += '; run manifest persistence also failed, so inspect the account before any further run' }
  }
  const decode = (payload: string | Buffer): RenderPacket | null => {
    try { return decodeRenderPacket(payload) }
    catch { fail('The real render transport returned an unreadable packet'); return null }
  }
  const sent = (event: { payload: string | Buffer }) => {
    const packet = decode(event.payload)
    if (!packet || packet.type !== 'event' || packet.data[0] !== 'submitTask') return
    submissions++
    const envelope = packet.data[1]
    if (!packet.ackId || !envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).length !== 1 || !envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
      fail('The real UI submission used an unexpected render envelope or acknowledgement contract')
      return
    }
    submissionAck = packet.ackId
    try {
      if (submissions !== 1 || contentHash(envelope.payload) !== approvedHash)
        fail('Actual UI submission differs from the approved payload or was submitted more than once')
    } catch { fail('The actual UI payload could not be verified against its reserved budget') }
  }
  const received = (event: { payload: string | Buffer }) => {
    const packet = decode(event.payload)
    if (!packet || !submissions) return
    if (packet.type === 'ack') {
      if (packet.ackId !== submissionAck) return
      const message = packet.data[0]
      if (message?.error) { fail('Render submission was rejected by the service'); return }
      if (!message?.taskId) { fail('Render acknowledgement omitted the exact job ID'); return }
      const taskId = String(message.taskId)
      if (id && id !== taskId) { fail('Multiple job IDs acknowledged for one render'); return }
      if (!id) {
        try { live.run.acknowledge(reservation, taskId); id = taskId }
        catch { fail('Could not persist the acknowledged job ID; inspect the reserved render before another run'); return }
      }
      states.add('acknowledged')
      const reserved = Number(message.creditsReserved)
      if (!Number.isSafeInteger(reserved) || reserved !== expectedCost) fail('The service reserved a different credit amount from the approved quote')
      return
    }
    const [eventName, message] = packet.data
    if (typeof eventName !== 'string' || !/^task(?:Queued|Waiting|Assigned|Progress|Complete|Failed|Requeued)$/.test(eventName)) return
    if (!message?.taskId) { fail('Render lifecycle event omitted its job ID'); return }
    if (id && String(message.taskId) !== id) { fail('Another render became active on the dedicated account'); return }
    states.add(eventName)
    if (eventName === 'taskFailed') fail('The service reported a failed render')
  }
  const socket = (ws: WebSocket) => {
    const url = new URL(ws.url())
    const origin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    if (origin !== live.env.apiUrl || !/^\/socket\.io\/?$/.test(url.pathname)) return
    sockets.push(ws)
    ws.on('framesent', sent)
    ws.on('framereceived', received)
  }
  page.on('websocket', socket)
  return {
    get id() { return id }, get submissions() { return submissions }, get problem() { return problem }, get connections() { return sockets.length }, states,
    dispose() { page.off('websocket', socket); for (const ws of sockets) { ws.off('framesent', sent); ws.off('framereceived', received) } },
  }
}

async function ownedJob(live: LiveSession, id: string, name: string) {
  const body = await live.api.get(`/jobs?q=${encodeURIComponent(name)}&limit=100`)
  if (!Array.isArray(body.jobs)) throw new Error('Invalid job list response')
  const job = body.jobs.find((item: any) => String(item.id) === id)
  if (job && job.name !== name) throw new Error('Render job name differs from the submitted test project')
  return job
}

async function downloadAndInspect(dashboard: Page, live: LiveSession, name: string, kind: 'video' | 'image', payload: any, info: TestInfo) {
  await navigateDashboard(dashboard, live, '/videos')
  const card = findJobCard(dashboard, name)
  await expect(card).toBeVisible()
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  const network: string[] = []
  const safeUrl = (value: string) => { const url = new URL(value); return `${url.origin}${url.pathname}` }
  const response = (item: Response) => {
    if (item.request().resourceType() === 'fetch') network.push(`${item.status()} ${safeUrl(item.url())}`)
  }
  const failed = (item: Request) => network.push(`${item.failure()?.errorText || 'failed'} ${safeUrl(item.url())}`)
  dashboard.on('response', response)
  dashboard.on('requestfailed', failed)
  // The dashboard fetches the complete CDN object before emitting its Blob
  // download. Give that transfer the same deadline as a network navigation.
  let output
  try {
    const download = dashboard.waitForEvent('download', { timeout: 45_000 })
    await card.getByRole('button', { name: 'Download', exact: true }).click()
    output = await download
  } finally {
    dashboard.off('response', response)
    dashboard.off('requestfailed', failed)
    await info.attach('download-network', { body: network.join('\n') || 'No completed fetch observed', contentType: 'text/plain' })
  }
  const file = info.outputPath(kind === 'video' ? 'render-output.mp4' : 'render-output.png')
  await output.saveAs(file)
  expect(await output.failure()).toBeNull()
  const bytes = await readFile(file)
  expect(bytes.length, 'Downloaded media contains nonempty content').toBeGreaterThan(100)
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000, windowsHide: true })
  const probe = JSON.parse(stdout)
  const stream = probe.streams?.find((item: any) => item.codec_type === 'video')
  expect(stream, 'Output has a decodable image/video stream').toBeTruthy()
  expect(stream.width).toBe(payload.width)
  expect(stream.height).toBe(payload.height)
  if (kind === 'video') {
    expect(probe.format.format_name).toContain('mp4')
    expect(Math.abs(Number(probe.format.duration) - payload.duration)).toBeLessThan(0.25)
  } else expect(stream.codec_name).toBe('png')
  await info.attach(`rendered-${kind}`, { path: file, contentType: kind === 'video' ? 'video/mp4' : 'image/png' })
}

export async function renderAndVerify(editor: Page, dashboard: Page, live: LiveSession, kind: 'video' | 'image', info: TestInfo) {
  const { redact } = await import('./env')
  let authoring: Record<string, any> | undefined
  let observed: ReturnType<typeof observeRender> | undefined
  let reservation: string | undefined
  let accountingAttached = false
  let dashboardCaptured = false
  let jobIdentityVerified = false
  const accounting: Record<string, unknown> = { kind, phase: 'preflight', outcome: 'pending' }
  const evidenceErrors: string[] = []
  const attachJson = (name: string, value: unknown) => info.attach(name, {
    body: redact(JSON.stringify(value, null, 2)), contentType: 'application/json',
  })
  const captureDashboardJob = async () => {
    if (!observed?.id || !authoring?.name || dashboard.isClosed()) return
    if (!jobIdentityVerified) {
      if (!await ownedJob(live, observed.id, authoring.name)) throw new Error('Acknowledged job has no exact matching dashboard identity')
      jobIdentityVerified = true
    }
    // An exact run-unique name was corroborated with the acknowledged ID by
    // the API. Capture just its card, without account menus or other jobs.
    await dashboard.goto(`${live.env.dashboardUrl}/videos`, { timeout: 10_000, waitUntil: 'domcontentloaded' })
    const card = findJobCard(dashboard, authoring.name)
    await expect(card).toHaveCount(1, { timeout: 5000 })
    await expect(card).toBeVisible({ timeout: 5000 })
    await info.attach(`dashboard-render-${observed.id}`, { body: await card.screenshot({ timeout: 5000 }), contentType: 'image/png' })
    dashboardCaptured = true
  }
  try {
    authoring = await exportProject(editor)
    await attachJson('render-ui-export', authoring)
    const approved = kind === 'video' ? normalizeFixedVideo(authoring) : normalizeImage(authoring)
    await attachJson('render-normalized-submission', approved)
    await live.api.noActiveJobs()
    const before = await live.api.balance()
    accounting.before = before
    expect(await readDashboardCredits(dashboard, live), 'Visible starting balance agrees with the account').toBe(before)
    const quote = await live.api.validate(approved)
    accounting.quoted = quote.creditsRequired
    await attachJson('render-validated-payload', quote.payload)
    if (before < quote.creditsRequired) throw new Error('Test account has insufficient available credits; nothing submitted')
    reservation = live.run.reserve(quote.creditsRequired, { kind, name: authoring.name, payloadHash: contentHash(approved) })
    accounting.reservationId = reservation
    accounting.phase = 'reserved'
    observed = observeRender(editor, live, reservation, approved, quote.creditsRequired)
    const observer = observed
    await editor.locator('.topbar').getByRole('button', { name: 'Render', exact: true }).click()
    const dialog = editor.getByRole('dialog', { name: kind === 'video' ? 'Render video' : 'Render image', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Start render', exact: true }).click()
    try {
      await expect.poll(() => observer.problem || observer.id, { timeout: 30_000, message: 'UI submission acknowledges one real job' }).not.toBe('')
    } catch {
      throw new Error(observer.connections
        ? 'Real WebSocket submission acknowledgement was not observed; the reservation remains counted and another submission is forbidden'
        : 'The editor did not create the expected real WebSocket (stale connection or transport fallback); charge is uncertain and the run must stop')
    }
    if (observer.problem) throw new Error(observer.problem)
    expect(observer.submissions, 'Exactly one UI render submission').toBe(1)
    const id = observer.id
    accounting.id = id
    accounting.phase = 'acknowledged'
    await expect.poll(async () => {
      if (observer.problem) throw new Error(observer.problem)
      const status = await live.api.get(`/jobs/${encodeURIComponent(id)}`)
      observer.states.add(status.state)
      accounting.lastJobState = status.state
      if (status.state === 'failed') throw new Error(`Render failed: ${id}`)
      return status.state
    }, { timeout: live.env.renderTimeoutMs, intervals: [1000, 2000, 3000], message: `Render ${id} completes` }).toBe('completed')
    accounting.phase = 'completed'
    // Persist the known charge before playback/download assertions can fail.
    // Cleanup may then delete the job without destroying its accounting proof.
    await expect.poll(async () => {
      const record = await ownedJob(live, id, authoring!.name)
      const value = record?.creditsConsumed ?? record?.credits_consumed
      return value === undefined || value === null ? NaN : Number(value)
    }, { timeout: 30_000 }).toBe(quote.creditsRequired)
    const job = await ownedJob(live, id, authoring.name)
    jobIdentityVerified = true
    const charged = Number(job.creditsConsumed ?? job.credits_consumed)
    accounting.charged = charged
    live.run.settle(reservation, charged)
    accounting.phase = 'settled'
    await expect.poll(() => live.api.balance(), { timeout: 30_000 }).toBe(before - charged)
    accounting.after = await live.api.balance()
    const transactions = await live.api.get('/credits/transactions?limit=100&sortBy=createdAt&sortOrder=DESC')
    if (!Array.isArray(transactions.transactions)) throw new Error('Invalid credit transaction history response')
    const matching = transactions.transactions.filter((item: any) => String(item.job_id ?? item.jobId) === id)
    expect(matching.length, 'Render has job-specific credit transactions').toBeGreaterThan(0)
    if (matching.some((item: any) => item.amount === null || item.amount === undefined || !Number.isSafeInteger(Number(item.amount)))) throw new Error('Invalid job-specific credit transaction amount')
    const netCharge = -matching.reduce((sum: number, item: any) => sum + Number(item.amount), 0)
    accounting.netCharge = netCharge
    accounting.transactionAmounts = matching.map((item: any) => Number(item.amount))
    expect(netCharge, 'Subscription and add-on debits/refunds reconcile').toBe(charged)
    accounting.phase = 'reconciled'
    await attachJson('render-accounting', accounting)
    accountingAttached = true
    await captureDashboardJob()
    expect(await readDashboardCredits(dashboard, live), 'Dashboard shows the settled credit balance').toBe(before - charged)
    if (kind === 'video') {
      const video = dialog.locator('video.result')
      await expect(video).toBeVisible({ timeout: 30_000 })
      // Observe real playback; .play() is not used to bypass the displayed UI.
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.error), {
        timeout: 30_000, message: 'Rendered video loads and plays in the editor',
      }).toBe(true)
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 15_000 }).toBeGreaterThan(0)
    } else {
      const image = dialog.getByRole('img', { name: 'rendered image', exact: true })
      await expect(image).toBeAttached()
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), {
        timeout: 45_000, message: 'Rendered PNG downloads and decodes in the editor',
      }).toBe(true)
      await expect(image).toBeVisible()
    }
    await expect(dialog.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute('href', /^https:\/\//)
    await downloadAndInspect(dashboard, live, authoring.name, kind, quote.payload, info)
    if (observer.problem) throw new Error(observer.problem)
    expect(observer.submissions, 'Exactly one UI render submission throughout the journey').toBe(1)
    await info.attach('render-complete', { body: await dialog.screenshot(), contentType: 'image/png' })
    accounting.phase = 'verified'
    accounting.outcome = 'passed'
    return id
  } catch (error) {
    accounting.outcome = 'failed'
    accounting.failure = redact(error instanceof Error ? error.message : 'Render verification failed')
    if (reservation) {
      try { live.run.stop('A render journey failed; inspect the exact job and manifest before starting another run') }
      catch { evidenceErrors.push('Could not persist the stopped run state; inspect the account before another run') }
    }
    throw error
  } finally {
    try {
      // Evidence is collected before the fixture's teardown removes owned jobs.
      if (observed?.id && !dashboardCaptured) {
        try { await captureDashboardJob() }
        catch { evidenceErrors.push('Could not capture the exact dashboard job card before cleanup') }
      }
      if (!accountingAttached) await attachJson('render-accounting', accounting)
      let recordedReservation: unknown = null
      try { recordedReservation = live.run.snapshot().reservations.find(item => item.id === reservation) ?? null }
      catch { evidenceErrors.push('Could not read final reservation state') }
      await attachJson('render-outcome', {
        ...accounting,
        acknowledgedJobId: observed?.id || null,
        submissions: observed?.submissions ?? 0,
        websocketConnections: observed?.connections ?? 0,
        transportProblem: observed?.problem || null,
        observedStates: observed ? [...observed.states] : [],
        reservation: recordedReservation,
        dashboardCaptured,
        evidenceErrors,
      })
    } finally { observed?.dispose() }
  }
}
