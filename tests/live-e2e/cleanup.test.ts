import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupResources } from './helpers/cleanup'
import { RunState } from './helpers/run-state'
import type { LiveApi } from './helpers/api'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

it('cannot send DELETE for a fabricated same-prefix ID outside the manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zvid-live-cleanup-'))
  directories.push(dir)
  const run = new RunState(dir, 20)
  run.bindAccount('test-account')
  run.track('project', 'prj_recorded', `${run.prefix}project`)
  const resource = run.eligibleResources()[0]
  let calls = 0
  const api = { get: async () => { calls++; return {} }, request: async () => { calls++; return {} } } as unknown as LiveApi
  await expect(cleanupResources(api, run, [{ ...resource, id: 'prj_unrecorded' }])).rejects.toThrow(/outside.*manifest/)
  await expect(cleanupResources(api, run, [{ ...resource, name: `${run.prefix}other` }])).rejects.toThrow(/outside.*manifest/)
  expect(calls).toBe(0)
})

it('retains a job and its uploaded source while rendering remains unfinished', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zvid-live-cleanup-'))
  directories.push(dir)
  const run = new RunState(dir, 20)
  run.bindAccount('test-account')
  run.track('job', 'job-in-progress', `${run.prefix}video`)
  run.track('upload', 'source-upload', `${run.prefix}source.mp4`)
  const methods: string[] = []
  const api = {
    get: async () => ({ user: { id: 'test-account' } }),
    request: async (_path: string, options?: { method?: string }) => {
      methods.push(options?.method || 'GET')
      return { ok: () => true, status: () => 200, json: async () => ({ state: 'active' }) }
    },
  } as unknown as LiveApi
  expect(await cleanupResources(api, run)).toHaveLength(2)
  expect(methods).toEqual(['GET'])
  expect(run.eligibleResources()).toHaveLength(2)
  expect(run.eligibleResources().every(item => Boolean(item.cleanupError))).toBe(true)
})

it('retains every source after an unknown acknowledgement, including after manifest resume, but revokes its exact API key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zvid-live-cleanup-'))
  directories.push(dir)
  const initial = new RunState(dir, 20)
  initial.bindAccount('test-account')
  initial.reserve(3, { kind: 'video', name: `${initial.prefix}video`, payloadHash: 'a'.repeat(64) })
  for (const kind of ['project', 'template', 'design', 'upload'] as const) {
    initial.track(kind, `${kind}-source`, `${initial.prefix}${kind}-source`)
  }
  initial.track('apiKey', 'own-key', `${initial.prefix}key`)
  const run = new RunState(dir, 20)
  const requests: string[] = []
  const api = {
    get: async (path: string) => {
      requests.push(`GET ${path}`)
      if (path === '/user/profile') return { user: { id: 'test-account' } }
      if (path === '/api-keys') return { apiKeys: [{ id: 'own-key', name: `${run.prefix}key`, user_id: 'test-account' }] }
      throw new Error(`Unexpected source inspection: ${path}`)
    },
    request: async (path: string, options?: { method?: string }) => {
      requests.push(`${options?.method || 'GET'} ${path}`)
      if (path !== '/api-keys/own-key' || options?.method !== 'DELETE') throw new Error('Unexpected mutation')
      return { ok: () => true, status: () => 200 }
    },
  } as unknown as LiveApi

  const failures = await cleanupResources(api, run)
  expect(failures).toHaveLength(5)
  expect(failures[0]).toMatch(/reservation .*acknowledgement is unknown/)
  expect(requests).toEqual(['GET /user/profile', 'GET /api-keys', 'DELETE /api-keys/own-key'])
  expect(run.eligibleResources()).toHaveLength(4)
  expect(run.eligibleResources().every(item => Boolean(item.cleanupError))).toBe(true)
  const snapshot = run.snapshot()
  expect(snapshot.spentCeiling).toBe(3)
  expect(snapshot.reservations[0]).toMatchObject({ status: 'reserved', cost: 3 })
  expect(snapshot.reservations[0].jobId).toBeUndefined()
  expect(snapshot.stoppedReason).toMatch(/acknowledgement is unknown/)
  expect(snapshot.resources.find(item => item.kind === 'apiKey')?.cleanedAt).toBeTruthy()
})

it('reports an unknown acknowledgement even when cleanup has no resource receipts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zvid-live-cleanup-'))
  directories.push(dir)
  const run = new RunState(dir, 20)
  run.bindAccount('test-account')
  run.reserve(1, { kind: 'image', name: `${run.prefix}image`, payloadHash: 'b'.repeat(64) })
  const api = {
    get: async () => ({ user: { id: 'test-account' } }),
    request: async () => { throw new Error('Cleanup must not invent a target') },
  } as unknown as LiveApi

  expect(await cleanupResources(api, run)).toEqual([expect.stringMatching(/reservation .*acknowledgement is unknown/)])
  expect(run.snapshot().spentCeiling).toBe(1)
  expect(run.eligibleResources()).toEqual([])
})

it.each(['completed', 'failed'])('retains a %s job and its source until the final charge is settled', async state => {
  const dir = mkdtempSync(join(tmpdir(), 'zvid-live-cleanup-'))
  directories.push(dir)
  const initial = new RunState(dir, 20)
  initial.bindAccount('test-account')
  const name = `${initial.prefix}video`
  const reservation = initial.reserve(3, { kind: 'video', name, payloadHash: 'a'.repeat(64) })
  initial.acknowledge(reservation, 'terminal-job')
  initial.track('upload', 'source-upload', `${initial.prefix}source.mp4`)
  const run = new RunState(dir, 20)
  const requests: string[] = []
  const api = {
    get: async (path: string) => {
      requests.push(`GET ${path}`)
      if (path === '/user/profile') return { user: { id: 'test-account' } }
      if (path.startsWith('/jobs?')) return { jobs: [{ id: 'terminal-job', name }] }
      if (path === '/uploads') return { uploads: [{ id: 'source-upload', name: `${run.prefix}source.mp4`, userId: 'test-account' }] }
      throw new Error(`Unexpected lookup: ${path}`)
    },
    request: async (path: string, options?: { method?: string }) => {
      requests.push(`${options?.method || 'GET'} ${path}`)
      return { ok: () => true, status: () => 200, json: async () => ({ state }) }
    },
  } as unknown as LiveApi

  const failures = await cleanupResources(api, run)
  expect(failures).toHaveLength(3)
  expect(failures[0]).toMatch(/Final render charge is unknown/)
  expect(requests).toContain('GET /jobs/terminal-job')
  expect(requests.some(call => call.startsWith('DELETE'))).toBe(false)
  expect(run.eligibleResources()).toHaveLength(2)
  expect(run.snapshot().reservations[0]).toMatchObject({ status: 'acknowledged', cost: 3 })
  expect(run.snapshot().stoppedReason).toMatch(/final render charge is unknown/)

  // An operator's exact-job reconciliation can settle the retained manifest,
  // after which ordinary targeted cleanup is permitted without another render.
  run.settle(reservation, state === 'completed' ? 3 : 0)
  requests.length = 0
  expect(await cleanupResources(api, run)).toEqual([])
  expect(requests.filter(call => call.startsWith('DELETE'))).toEqual(['DELETE /jobs/terminal-job', 'DELETE /uploads/source-upload'])
  expect(run.eligibleResources()).toEqual([])
  expect(run.snapshot().spentCeiling).toBe(3)
})
