import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStockStore } from '../../stores/stock'
import type { StockItem } from '../../stores/stock'

/**
 * stores/stock.ts — request ordering, pagination, dedupe, error halting and
 * provider fallback. `$fetch` is a Nuxt auto-import; the store reads it from
 * the global scope, so it is mocked on globalThis per test.
 */

function item(id: string, over: Partial<StockItem> = {}): StockItem {
  return {
    id,
    provider: 'pexels',
    kind: 'image',
    preview: `p/${id}.jpg`,
    src: `s/${id}.jpg`,
    ...over,
  }
}

function page(items: StockItem[], hasMore = true, extra: Record<string, any> = {}) {
  return { items, page: 1, perPage: 24, hasMore, ...extra }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: any) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const fetchMock = vi.fn()

describe('stock store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    ;(globalThis as any).$fetch = fetchMock
  })

  afterEach(() => {
    delete (globalThis as any).$fetch
  })

  it('loadMore fetches page 1 with the kind/provider/query and appends items', async () => {
    const store = useStockStore()
    fetchMock.mockResolvedValueOnce(page([item('a'), item('b')]))
    await store.loadMore()
    expect(fetchMock).toHaveBeenCalledWith('/api/stock/search', {
      query: {
        type: 'image',
        provider: 'all',
        query: '',
        page: 1,
        perPage: 24,
      },
    })
    const s = store.byKind.image
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(s.page).toBe(1)
    expect(s.hasMore).toBe(true)
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('discards a stale response that resolves after a newer refresh (requestId guard)', async () => {
    const store = useStockStore()
    const first = deferred<any>()
    const second = deferred<any>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const p1 = store.loadMore() // requestId 1, in flight
    const p2 = store.refresh() // invalidates (2), then loadMore → requestId 3
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // the STALE response lands first — must be thrown away entirely
    first.resolve(page([item('stale-1'), item('stale-2')]))
    await p1
    const s = store.byKind.image
    expect(s.items).toEqual([])
    expect(s.page).toBe(0)
    expect(s.loading).toBe(true) // the newer request is still in flight

    second.resolve(page([item('fresh')], false))
    await p2
    expect(s.items.map((i) => i.id)).toEqual(['fresh'])
    expect(s.page).toBe(1)
    expect(s.hasMore).toBe(false)
    expect(s.loading).toBe(false)
  })

  it('a stale rejection cannot poison the refreshed state either', async () => {
    const store = useStockStore()
    const first = deferred<any>()
    const second = deferred<any>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const p1 = store.loadMore()
    const p2 = store.refresh()
    first.reject(new Error('boom from the past'))
    await p1
    const s = store.byKind.image
    expect(s.error).toBeNull()
    expect(s.loading).toBe(true)

    second.resolve(page([item('ok')]))
    await p2
    expect(s.error).toBeNull()
    expect(s.items.map((i) => i.id)).toEqual(['ok'])
  })

  it('dedupes items by id across pages', async () => {
    const store = useStockStore()
    fetchMock
      .mockResolvedValueOnce(page([item('a'), item('b')]))
      .mockResolvedValueOnce(page([item('b'), item('c'), item('c')]))
    await store.loadMore()
    await store.loadMore()
    const s = store.byKind.image
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(s.page).toBe(2)
  })

  it('a failed load sets a readable error and halts further auto-loading', async () => {
    const store = useStockStore()
    fetchMock.mockRejectedValueOnce({
      data: { data: { message: 'pixabay rate limited' } },
    })
    await store.loadMore()
    const s = store.byKind.image
    expect(s.error).toBe('pixabay rate limited')
    expect(s.loading).toBe(false)

    // infinite-scroll watchers calling loadMore again must NOT refetch
    fetchMock.mockClear()
    await store.loadMore()
    await store.loadMore()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls through the error-shape chain to a generic message', async () => {
    const store = useStockStore()
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
    await store.loadMore()
    expect(store.byKind.image.error).toBe('socket hang up')

    // refresh clears the error… but $fetch rejects with nothing useful
    fetchMock.mockRejectedValueOnce({})
    await store.refresh()
    expect(store.byKind.image.error).toBe('Stock search failed')
  })

  it('retry resumes after an error: loadMore with items, full refresh without', async () => {
    const store = useStockStore()
    // fail on the very first page → retry refreshes from scratch
    fetchMock.mockRejectedValueOnce(new Error('down'))
    await store.loadMore()
    expect(store.byKind.image.error).toBe('down')
    fetchMock.mockResolvedValueOnce(page([item('a')]))
    await store.retry()
    let s = store.byKind.image
    expect(s.error).toBeNull()
    expect(s.items.map((i) => i.id)).toEqual(['a'])
    expect(s.page).toBe(1)

    // fail on page 2 → retry only loads the next page, keeping items
    fetchMock.mockRejectedValueOnce(new Error('flaky'))
    await store.loadMore()
    expect(store.byKind.image.error).toBe('flaky')
    fetchMock.mockResolvedValueOnce(page([item('b')]))
    await store.retry()
    s = store.byKind.image
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(s.page).toBe(2)
  })

  it('hasMore goes false when the server says so — and when a page comes back empty', async () => {
    const store = useStockStore()
    fetchMock.mockResolvedValueOnce(page([item('a')], false))
    await store.loadMore()
    expect(store.byKind.image.hasMore).toBe(false)
    fetchMock.mockClear()
    await store.loadMore() // exhausted → no fetch
    expect(fetchMock).not.toHaveBeenCalled()

    // hasMore:true with zero items is treated as exhausted too
    fetchMock.mockResolvedValueOnce(page([], true))
    await store.refresh()
    expect(store.byKind.image.hasMore).toBe(false)
    fetchMock.mockClear()
    await store.loadMore()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('captures per-provider errors from a successful page', async () => {
    const store = useStockStore()
    fetchMock.mockResolvedValueOnce(
      page([item('a')], true, { providerErrors: { giphy: 'quota' } })
    )
    await store.loadMore()
    expect(store.byKind.image.providerErrors).toEqual({ giphy: 'quota' })
  })

  it('setKind lazily initializes each kind exactly once', async () => {
    const store = useStockStore()
    fetchMock.mockResolvedValue(page([item('v1', { kind: 'video' })]))
    store.setKind('video')
    await Promise.resolve()
    expect(store.kind).toBe('video')
    expect(store.byKind.video.initialized).toBe(true)
    await vi.waitFor(() => expect(store.byKind.video.items.length).toBe(1))

    fetchMock.mockClear()
    store.setKind('image') // never initialized → refresh
    store.setKind('video') // already initialized → no refetch
    await Promise.resolve()
    expect(
      fetchMock.mock.calls.filter(([, o]: any) => o.query.type === 'video')
    ).toHaveLength(0)
  })

  it('search() and setProvider() skip redundant refreshes', async () => {
    const store = useStockStore()
    fetchMock.mockResolvedValue(page([item('a')]))
    store.search('cats')
    await vi.waitFor(() => expect(store.byKind.image.items.length).toBe(1))
    fetchMock.mockClear()
    store.search('cats') // same query, already initialized
    store.setProvider('all') // unchanged provider
    expect(fetchMock).not.toHaveBeenCalled()

    store.setProvider('pexels')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][1].query.provider).toBe('pexels')
  })

  it('kindProviders falls back to the static list until providers load', async () => {
    const store = useStockStore()
    expect(store.providers).toBeNull()
    expect(store.kindProviders).toEqual(['pexels', 'pixabay', 'unsplash'])
    store.kind = 'gif'
    expect(store.kindProviders).toEqual(['giphy'])
    store.kind = 'audio'
    expect(store.kindProviders).toEqual(['jamendo'])
    store.kind = 'video'
    expect(store.kindProviders).toEqual(['pexels', 'pixabay'])
  })

  it('loadProviders swaps in the server list; failures keep the fallback', async () => {
    const store = useStockStore()
    fetchMock.mockRejectedValueOnce(new Error('orch down'))
    await store.loadProviders()
    expect(store.providers).toBeNull()
    expect(store.kindProviders).toEqual(['pexels', 'pixabay', 'unsplash'])

    fetchMock.mockResolvedValueOnce({
      image: ['unsplash'],
      video: ['pexels'],
      gif: [],
      audio: ['jamendo'],
    })
    await store.loadProviders()
    expect(store.kindProviders).toEqual(['unsplash'])

    fetchMock.mockClear()
    await store.loadProviders() // already loaded → no fetch
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
