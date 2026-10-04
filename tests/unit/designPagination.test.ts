import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDesignsStore } from '../../stores/designs'

const fetchMock = vi.fn()
const rows = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ id: `d_${start + index}`, name: `Design ${start + index}`, design: {} }))
const page = (designs: ReturnType<typeof rows>, total = 53) => ({ designs, pagination: { total, totalPages: Math.ceil(total / 50) } })

beforeEach(() => {
  setActivePinia(createPinia())
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('saved design pagination', () => {
  it('loads only one bounded page, preserves it during failure, and retries the same next page', async () => {
    fetchMock.mockResolvedValueOnce(page(rows(1, 50)))
    const store = useDesignsStore()
    await store.load()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/designs', { query: { page: 1, limit: 50 } })
    expect(store.total).toBe(53)
    expect(store.items).toHaveLength(50)
    expect(store.hasMore).toBe(true)
    fetchMock.mockRejectedValueOnce(new Error('Temporarily unavailable'))
    await store.loadMore()
    expect(store.items).toHaveLength(50)
    expect(store.loadedPage).toBe(1)
    expect(store.loadMoreError).toBe('Temporarily unavailable')
    fetchMock.mockResolvedValueOnce(page(rows(50, 4)))
    await store.loadMore()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/designs', { query: { page: 2, limit: 50 } })
    expect(store.items).toHaveLength(53)
    expect(store.items?.[52]?.id).toBe('d_53')
    expect(store.hasMore).toBe(false)
    expect(store.loadMoreError).toBeNull()
  })

  it('refreshes the first page after deleting so shifted offsets do not skip a design', async () => {
    const store = useDesignsStore()
    fetchMock.mockResolvedValueOnce(page(rows(1, 50)))
    await store.load()
    fetchMock.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce(page(rows(2, 50), 52))
    await store.remove('d_1')
    expect(store.items?.[0]?.id).toBe('d_2')
    expect(store.items?.[49]?.id).toBe('d_51')
    expect(store.total).toBe(52)
    expect(store.loadedPage).toBe(1)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/designs', { query: { page: 1, limit: 50 } })
    fetchMock.mockResolvedValueOnce(page(rows(52, 2), 52))
    await store.loadMore()
    expect(store.items).toHaveLength(52)
    expect(store.items?.[51]?.id).toBe('d_53')
  })

  it('ignores an old account request after reset and clears saved data on 401', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const store = useDesignsStore()
    const pending = store.load()
    store.reset()
    finish(page(rows(1, 50)))
    await pending
    expect(store.items).toBeNull()
    expect(store.loading).toBe(false)
    fetchMock.mockResolvedValueOnce(page(rows(1, 50)))
    await store.load()
    fetchMock.mockRejectedValueOnce({ statusCode: 401 })
    await store.loadMore()
    expect(store.authRequired).toBe(true)
    expect(store.items).toEqual([])
    expect(store.total).toBe(0)
    expect(store.hasMore).toBe(false)
  })

  it('shows the quota explanation when saving is rejected', async () => {
    const message = 'Your Free plan allows 30 saved designs. Delete a design or upgrade.'
    fetchMock.mockRejectedValueOnce({ statusCode: 403, data: { data: { error: 'DESIGN_LIMIT_REACHED', message } } })
    const store = useDesignsStore()
    await expect(store.save({} as any, 'Extra design')).rejects.toThrow(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes the first page and total after creating a design', async () => {
    const store = useDesignsStore()
    fetchMock.mockResolvedValueOnce(page(rows(1, 50)))
    await store.load()
    const added = rows(0, 1)[0]
    fetchMock.mockResolvedValueOnce({ design: added }).mockResolvedValueOnce(page(rows(0, 50), 54))
    await store.save({} as any, 'New design')
    expect(store.items?.[0]?.id).toBe('d_0')
    expect(store.items).toHaveLength(50)
    expect(store.total).toBe(54)
    expect(store.loadedPage).toBe(1)
    expect(store.hasMore).toBe(true)
  })
})
