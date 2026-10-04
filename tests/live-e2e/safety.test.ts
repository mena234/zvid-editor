import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunState, assertCleanupTarget } from './helpers/run-state'
import { assertPinnedTemplate, chooseTemplate, contentHash, dimensions, normalizeFixedVideo, normalizeImage, type TemplateCandidate } from './helpers/template'
import { importProject, exportProject } from '../../shared/schema/normalize'
import { buildScenePlan, projectTotalDuration } from '../../shared/schema/scenePlan'
import { decodeRenderPacket } from './helpers/render'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function run(cap = 20): RunState {
  const dir = mkdtempSync(join(tmpdir(), 'zvid-live-guard-test-'))
  dirs.push(dir)
  const state = new RunState(dir, cap)
  state.bindAccount('account-1')
  return state
}
const hash = contentHash({ duration: 2 })
function input(state: RunState, kind: 'video' | 'image' = 'video') { return { kind, name: `${state.prefix}${kind}`, payloadHash: hash } }
function finish(state: RunState, reservation: string, charged: number, job = 'job-video') {
  state.acknowledge(reservation, job)
  state.settle(reservation, charged)
}

describe('live credit and ownership guards', () => {
  it.each([0, -1, 21, 20.1, NaN, Infinity])('rejects unsafe hard cap %s', cap => {
    expect(() => run(cap)).toThrow(/cap/)
  })

  it('persists reservations before submissions, leaves an image credit and never exceeds 20', () => {
    const state = run()
    expect(() => state.reserve(20, input(state))).toThrow(/cap/)
    const reservation = state.reserve(19, input(state))
    expect(JSON.parse(readFileSync(state.file, 'utf8')).spentCeiling).toBe(19)
    finish(state, reservation, 19)
    const image = state.reserve(1, input(state, 'image'))
    finish(state, image, 1, 'job-image')
    expect(state.snapshot().spentCeiling).toBe(20)
    expect(() => state.reserve(1, input(state))).toThrow(/Only one video/)
    expect(() => state.reserve(1, input(state, 'image'))).toThrow(/Only one image/)
  })

  it('does not recycle refunded credits or permit another video', () => {
    const state = run()
    finish(state, state.reserve(19, input(state)), 0)
    expect(state.snapshot().spentCeiling).toBe(19)
    expect(() => state.reserve(1, input(state))).toThrow(/Only one video/)
    expect(() => state.reserve(2, input(state, 'image'))).toThrow(/Invalid render credit/)
    expect(state.reserve(1, input(state, 'image'))).toBeTruthy()
  })

  it('reloads ledger across instances without resetting reservations or increasing the cap', () => {
    const state = run()
    const second = new RunState(state.runDir, 20)
    finish(state, state.reserve(18, input(state)), 18)
    expect(second.snapshot().spentCeiling).toBe(18)
    expect(() => new RunState(state.runDir, 19)).toThrow(/change the cap/)
    expect(() => second.reserve(1, input(second))).toThrow(/Only one video/)
    expect(second.reserve(1, input(second, 'image'))).toBeTruthy()
    expect(state.snapshot().spentCeiling).toBe(19)
  })

  it('keeps an unknown submission counted and permanently stops further submissions', () => {
    const state = run()
    state.reserve(2, input(state))
    expect(() => state.reserve(1, input(state, 'image'))).toThrow(/unknown/)
    expect(state.snapshot()).toMatchObject({ spentCeiling: 2, stoppedReason: expect.stringContaining('unknown') })
    const reopened = new RunState(state.runDir, 20)
    expect(() => reopened.reserve(1, input(reopened, 'image'))).toThrow(/Run stopped/)
  })

  it('requires job acknowledgement before settlement and stops on an underestimated charge', () => {
    const state = run()
    const reservation = state.reserve(2, input(state))
    expect(() => state.settle(reservation, 2)).toThrow(/acknowledged/)
    state.acknowledge(reservation, 'job-1')
    expect(() => state.acknowledge(reservation, 'job-2')).toThrow(/mismatch/)
    expect(() => state.settle(reservation, 3)).toThrow(/exceeded/)
    expect(state.snapshot().reservations[0]).toMatchObject({ charged: 3, status: 'settled', jobId: 'job-1' })
    expect(() => state.reserve(1, input(state, 'image'))).toThrow(/Run stopped/)
    expect(state.eligibleResources()).toHaveLength(1)
  })

  it('rejects unsafe estimates, missing payload proof and names from other runs', () => {
    const state = run()
    for (const cost of [0, -1, 1.5, NaN, Infinity]) expect(() => state.reserve(cost, input(state))).toThrow()
    expect(() => state.reserve(1, { ...input(state), payloadHash: 'unknown' })).toThrow(/SHA-256/)
    expect(() => state.reserve(1, { ...input(state), name: 'user-project' })).toThrow(/prefix/)
    expect(() => state.bindAccount('other-account')).toThrow(/mismatch/)
    expect(state.snapshot().spentCeiling).toBe(0)
  })

  it('requires exact IDs, names and owner match before cleanup', () => {
    const state = run()
    const name = `${state.prefix}project`
    state.track('project', 'prj_1', name)
    const resource = state.eligibleResources()[0]
    const fetched = { id: 'prj_1', name, userId: 'account-1' }
    expect(() => assertCleanupTarget(resource, fetched, 'account-1', state.prefix)).not.toThrow()
    expect(() => assertCleanupTarget(resource, { ...fetched, id: 'prj_existing' }, 'account-1', state.prefix)).toThrow(/ID/)
    expect(() => assertCleanupTarget(resource, { ...fetched, name: `${state.prefix}other` }, 'account-1', state.prefix)).toThrow(/name/)
    expect(() => assertCleanupTarget(resource, { ...fetched, userId: 'someone-else' }, 'account-1', state.prefix)).toThrow(/owner/)
    expect(() => assertCleanupTarget(resource, fetched, 'other-account', state.prefix)).toThrow(/account/)
    expect(() => state.track('project', 'prj_existing', 'Personal project')).toThrow(/prefix/)
    expect(() => state.markCleaned('project', 'prj_untracked')).toThrow(/unregistered/)
    state.markCleanupFailure('project', 'prj_1', 'temporary service failure')
    expect(state.eligibleResources()[0].cleanupError).toContain('temporary')
    state.markCleaned('project', 'prj_1')
    expect(state.eligibleResources()).toEqual([])
  })

  it('records a confirmed rename only for the original exact ID and same run', () => {
    const state = run()
    state.track('project', 'prj_1', `${state.prefix}original`)
    expect(() => state.rename('project', 'missing', `${state.prefix}renamed`)).toThrow(/unregistered/)
    expect(() => state.rename('project', 'prj_1', 'Existing project')).toThrow(/prefix/)
    const name = `${state.prefix}renamed`
    state.rename('project', 'prj_1', name)
    const resource = state.eligibleResources()[0]
    expect(() => assertCleanupTarget(resource, { id: 'prj_1', name }, 'account-1', state.prefix)).not.toThrow()
    expect(() => assertCleanupTarget(resource, { id: 'prj_1', name: `${state.prefix}original` }, 'account-1', state.prefix)).toThrow(/name/)
  })

  it('fails closed on corrupt persisted accounting and returns detached snapshots', () => {
    const state = run()
    state.reserve(2, input(state))
    const snapshot = state.snapshot()
    snapshot.spentCeiling = 0
    expect(state.snapshot().spentCeiling).toBe(2)
    writeFileSync(state.file, JSON.stringify(snapshot))
    expect(() => new RunState(state.runDir, 20)).toThrow(/persisted credit budget/)
  })
})

function video(duration = 2): Record<string, any> {
  return { name: 'Public sample', width: 640, height: 360, duration, durationMode: 'fixed', visuals: [{ type: 'TEXT', text: 'Hello', enterBegin: 0, exitEnd: duration }] }
}
function candidate(slug: string, duration = 2): TemplateCandidate {
  return { slug, title: slug, version: 1, isFree: true, content: video(duration) }
}

describe('fixed template selection and pins', () => {
  it('uses actual editor import/export and fixed scene math for the submitted payload', () => {
    const raw: Record<string, any> = {
      ...video(5),
      audios: [{ src: 'https://example.test/music.mp3', exit: 5, matchDuration: false }],
      scenes: [
        { id: 'a', duration: 4, transition: 'fade', transitionId: 'b', transitionDuration: 1, visuals: [{ type: 'TEXT', text: 'A' }] },
        { id: 'b', duration: 3, visuals: [{ type: 'TEXT', text: 'B' }] },
      ],
    }
    const { doc } = importProject(raw)
    const expected = exportProject(doc)
    const probe = () => { throw new Error('unexpected probe') }
    const plan = buildScenePlan(doc, probe)
    expected.duration = projectTotalDuration(doc, probe)
    delete expected.durationMode
    for (const audio of expected.audios) delete audio.matchDuration
    expected.scenes.forEach((scene: any, index: number) => { scene.duration = plan.entries[index].duration })
    expect(normalizeFixedVideo(raw)).toEqual(expected)
    expect(normalizeFixedVideo(raw).duration).toBe(6)
    expect(raw.durationMode).toBe('fixed')
    expect(raw.audios[0].matchDuration).toBe(false)
  })

  it.each([
    { durationMode: 'auto' },
    { duration: -1 },
    { variables: { text: 'Hello' } },
    { visuals: [{ type: 'TEXT', text: '{{title}}' }] },
    { visuals: [{ type: 'TEXT', text: 'A', condition: true }] },
    { scenes: [{ duration: 2, iterate: 'items', visuals: [] }] },
    { scenes: [{ duration: -1, visuals: [] }] },
    { audios: [{ src: 'https://example.test/audio.mp3', exit: 2, matchDuration: true }] },
  ])('rejects uncertain or dynamic video %j', change => {
    expect(() => normalizeFixedVideo({ ...video(), ...change })).toThrow()
  })

  it('selects the shortest valid duration, uses slug order for ties and ignores paid or oversized content', () => {
    const paid = { ...candidate('paid', 1), isFree: false }
    const large = { ...candidate('large', 1), content: { ...video(1), width: 3840, height: 2160 } }
    const selected = chooseTemplate([candidate('expensive', 19), candidate('z', 1.2), paid, large, candidate('a', 1.2), candidate('too-long', 19.1)])
    expect(selected.item.slug).toBe('a')
    expect(selected.cost).toBe(2)
    expect(selected.pin).toMatchObject({ slug: 'a', duration: 1.2, width: 640, height: 360 })
    expect(chooseTemplate([candidate('a', 1.5), candidate('z', 1.2)]).item.slug).toBe('z')
    expect(() => chooseTemplate([paid, large, candidate('too-long', 20)])).toThrow(/No free/)
    expect(() => chooseTemplate([{ ...candidate('unknown'), isFree: undefined }])).toThrow(/No free/)
  })

  it('keeps fixed container duration invariant when media end times are omitted', () => {
    // Published fixed templates can leave background audio open-ended. This
    // does not affect billing: useRenderPayload never probes fixed scenes.
    const raw = {
      ...video(3),
      resolution: 'tiktok',
      audios: [{ src: 'https://example.test/background.mp3', volume: 0.4 }],
      scenes: [{ id: 'intro', duration: 3, visuals: [{ type: 'VIDEO', src: 'https://example.test/clip.mp4' }] }],
    }
    const originalHash = contentHash(raw)
    const { doc } = importProject(raw)
    const noProbe = () => { throw new Error('Fixed timing must not probe media') }
    const expected = exportProject(doc)
    expected.duration = projectTotalDuration(doc, noProbe)
    delete expected.durationMode
    const plan = buildScenePlan(doc, noProbe)
    expected.scenes.forEach((scene: any, index: number) => { scene.duration = plan.entries[index].duration })
    const normalized = normalizeFixedVideo(raw)
    expect(normalized).toEqual(expected)
    expect(normalized.duration).toBe(3)
    expect(normalized.audios).toEqual(raw.audios)
    expect(normalized.scenes[0].visuals).toEqual(raw.scenes[0].visuals)
    expect(contentHash(raw)).toBe(originalHash)
    expect(contentHash(normalizeFixedVideo(normalized))).toBe(contentHash(normalized))
    expect(chooseTemplate([{ ...candidate('fixed-media'), content: raw }]).cost).toBe(3)
    expect(() => normalizeFixedVideo({ ...raw, durationMode: 'auto' })).toThrow(/Automatic/)
    expect(() => normalizeFixedVideo({ ...raw, scenes: [{ ...raw.scenes[0], duration: -1 }] })).toThrow(/explicit fixed duration/)
  })

  it('uses resolution presets for budget dimensions rather than conflicting authored dimensions', () => {
    expect(dimensions({ resolution: 'youtube-short', width: 1, height: 1 })).toEqual({ width: 1080, height: 1920 })
    expect(() => dimensions({ resolution: 'unknown', width: 640, height: 360 })).toThrow(/Unknown/)
    expect(() => dimensions({ width: 3840, height: 2160 })).toThrow(/Full HD/)
  })

  it('rejects drift of every pin field and content while ignoring JSON object key ordering', () => {
    const item = candidate('fixture')
    const { pin, payload } = chooseTemplate([item])
    expect(assertPinnedTemplate(item, pin)).toEqual(payload)
    const reordered = { ...item, content: Object.fromEntries(Object.entries(item.content).reverse()) }
    expect(assertPinnedTemplate(reordered, pin)).toEqual(payload)
    for (const key of ['slug', 'title', 'version', 'contentHash', 'duration', 'width', 'height'] as const) {
      expect(() => assertPinnedTemplate(item, { ...pin, [key]: typeof pin[key] === 'number' ? Number(pin[key]) + 1 : `${pin[key]}changed` })).toThrow(/changed/)
    }
    expect(() => assertPinnedTemplate({ ...item, content: { ...item.content, backgroundColor: '#010203' } }, pin)).toThrow(/contentHash/)
  })

  it('exports images directly without introducing video duration', () => {
    const raw = { type: 'image', width: 640, height: 360, outputFormat: 'png', visuals: [{ type: 'TEXT', text: 'Still image' }] }
    expect(normalizeImage(raw)).toEqual(exportProject(importProject(raw).doc))
    expect(normalizeImage(raw)).not.toHaveProperty('duration')
    expect(() => normalizeFixedVideo(raw)).toThrow(/video/)
    expect(() => normalizeImage({ ...raw, duration: 2 })).toThrow()
  })
})

describe('passive real render packet decoding', () => {
  it('distinguishes namespaced submit events and correlated acknowledgements', () => {
    expect(decodeRenderPacket('42/frontend,0["submitTask",{"payload":{"duration":3}}]')).toEqual({ type: 'event', ackId: '0', data: ['submitTask', { payload: { duration: 3 } }] })
    expect(decodeRenderPacket('43/frontend,0[{"taskId":"job-1","creditsReserved":3}]')).toEqual({ type: 'ack', ackId: '0', data: [{ taskId: 'job-1', creditsReserved: 3 }] })
    expect(decodeRenderPacket('42/frontend,["taskComplete",{"taskId":"job-1"}]')).toMatchObject({ type: 'event', ackId: '' })
  })

  it('ignores unrelated namespaces and heartbeats but never hides malformed render JSON', () => {
    for (const text of ['2', '3', '40/frontend,', '42/other,0["submitTask",{}]', '42["submitTask",{}]']) expect(decodeRenderPacket(text)).toBeNull()
    expect(() => decodeRenderPacket('43/frontend,0[{broken]')).toThrow()
  })
})
