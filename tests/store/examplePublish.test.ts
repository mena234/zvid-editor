import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useExamplePublishStore } from '../../stores/examplePublish'

/**
 * stores/examplePublish.ts _poll: the HTTP fallback that must always drive the
 * publish to a terminal state even when the socket events are lost. Verifies
 * the terminal transitions (published/failed) and the lost-snapshot strikes:
 * a snapshot that 404s repeatedly can never turn terminal, so the store must
 * fail instead of polling forever. $fetch is mocked on globalThis (Nuxt
 * auto-import; vitest has none).
 */

const fetchMock = vi.fn()

function activePublishingStore() {
  const s = useExamplePublishStore()
  s.jobId = 'job-1'
  s.slug = 'demo'
  s.title = 'Demo'
  s.status = 'publishing'
  return s
}

/** Reset the module-level 404 strike counter via a successful poll. */
async function resetStrikes(s: ReturnType<typeof activePublishingStore>) {
  fetchMock.mockResolvedValueOnce({ success: true, state: 'rendering' })
  await s._poll()
}

beforeEach(() => {
  setActivePinia(createPinia())
  fetchMock.mockReset()
  ;(globalThis as any).$fetch = fetchMock
  // editor.notify schedules the toast dismissal on window (vitest runs in node)
  ;(globalThis as any).window = globalThis
})

afterEach(() => {
  delete (globalThis as any).$fetch
  delete (globalThis as any).window
})

describe('examplePublish store _poll', () => {
  it('published snapshot completes the run', async () => {
    const s = activePublishingStore()
    await resetStrikes(s)
    fetchMock.mockResolvedValueOnce({
      success: true,
      state: 'published',
      item: { title: 'Demo', version: 9, meta: { preview: 'https://cdn/p.mp4' } },
    })
    await s._poll()
    expect(s.status).toBe('done')
    expect(s.newVersion).toBe(9)
    expect(s.previewUrl).toBe('https://cdn/p.mp4')
  })

  it('failed snapshot fails the run with the server error', async () => {
    const s = activePublishingStore()
    await resetStrikes(s)
    fetchMock.mockResolvedValueOnce({
      success: true,
      state: 'failed',
      error: 'cell exploded',
    })
    await s._poll()
    expect(s.status).toBe('error')
    expect(s.errorMsg).toBe('cell exploded')
  })

  it('three consecutive 404s fail the run (snapshot lost)', async () => {
    const s = activePublishingStore()
    await resetStrikes(s)
    fetchMock.mockResolvedValue({ success: false, status: 404 })
    await s._poll()
    await s._poll()
    expect(s.status).toBe('publishing')
    await s._poll()
    expect(s.status).toBe('error')
    expect(s.errorMsg).toMatch(/status was lost/i)
  })

  it('a successful poll resets the 404 strikes', async () => {
    const s = activePublishingStore()
    await resetStrikes(s)
    fetchMock.mockResolvedValueOnce({ success: false, status: 404 })
    await s._poll()
    fetchMock.mockResolvedValueOnce({ success: false, status: 404 })
    await s._poll()
    await resetStrikes(s)
    fetchMock.mockResolvedValueOnce({ success: false, status: 404 })
    await s._poll()
    fetchMock.mockResolvedValueOnce({ success: false, status: 404 })
    await s._poll()
    expect(s.status).toBe('publishing')
  })

  it('non-404 errors and transient fetch failures never fail the run', async () => {
    const s = activePublishingStore()
    await resetStrikes(s)
    fetchMock.mockResolvedValueOnce({ success: false, status: 502 })
    await s._poll()
    fetchMock.mockRejectedValueOnce(new Error('network'))
    await s._poll()
    fetchMock.mockResolvedValueOnce({ success: false, status: 502 })
    await s._poll()
    expect(s.status).toBe('publishing')
  })

  it('rendering→publishing transition comes from the snapshot too', async () => {
    const s = useExamplePublishStore()
    s.jobId = 'job-1'
    s.slug = 'demo'
    s.status = 'rendering'
    fetchMock.mockResolvedValueOnce({ success: true, state: 'publishing' })
    await s._poll()
    expect(s.status).toBe('publishing')
    expect(s.progress).toBe(100)
  })
})
