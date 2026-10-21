import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useCloud } from '../../composables/useCloud'
import { fetchLibraryContent, invalidateLibraryCache } from '../../composables/useLibrary'

const mocks = vi.hoisted(() => ({
  auth: { loaded: true, user: null },
  editor: { notify: vi.fn(), setCloudProject: vi.fn(), setContext: vi.fn(), clearSelection: vi.fn() },
  project: { loadRaw: vi.fn(), doc: {} },
}))
vi.mock('../../stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('../../stores/editor', () => ({ useEditorStore: () => mocks.editor }))
vi.mock('../../stores/project', () => ({ useProjectStore: () => mocks.project }))

const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  invalidateLibraryCache()
  vi.stubGlobal('$fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('public marketing links', () => {
  it('an old hashed URL bypasses stale session content and loads the current library version without signing in', async () => {
    fetchMock.mockResolvedValueOnce({ name: 'old design' }).mockResolvedValueOnce({ name: 'repaired design' })
    await fetchLibraryContent('examples', 'example')
    await useCloud().openExampleFromUrl('https://cdn.zvid.io/library/examples/example.abcdef123456.json')
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/library/examples/example/content', '/api/library/examples/example/content',
    ])
    expect(mocks.project.loadRaw).toHaveBeenCalledWith({ name: 'repaired design' })
    expect(mocks.auth.user).toBe(null)
  })

  it.each([401, 403, 404, 503])('does not fall back to old CDN content when current content returns %s', async (status) => {
    fetchMock.mockRejectedValue({ statusCode: status })
    await useCloud().openExampleFromUrl('https://cdn.zvid.io/library/examples/example.abcdef123456.json')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.project.loadRaw).not.toHaveBeenCalled()
    expect(mocks.editor.notify).toHaveBeenCalledWith(expect.stringContaining('Could not open'), 'error')
  })

  it('retains explicit documents on trusted hosts and rejects untrusted links before fetching', async () => {
    fetchMock.mockResolvedValue({ name: 'custom document' })
    await useCloud().openExampleFromUrl('https://cdn.zvid.io/blog/custom-project.json')
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.zvid.io/blog/custom-project.json', { responseType: 'json' })
    expect(mocks.project.loadRaw).toHaveBeenCalledWith({ name: 'custom document' })
    fetchMock.mockClear()
    await useCloud().openExampleFromUrl('https://example.invalid/library/examples/example.abcdef123456.json')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
