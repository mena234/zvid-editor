import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchLibraryContent,
  fetchLibraryList,
  invalidateLibraryCache,
} from '../../composables/useLibrary'
import { exampleSlugFromContentUrl } from '../../composables/useCloud'

/**
 * composables/useLibrary.ts session memos + invalidation, and the CDN URL →
 * slug parser used by the admin ?exampleUrl= banner attach. The memos are
 * module-level, so every test starts by invalidating everything. `$fetch` is
 * a Nuxt auto-import read from the global scope, mocked per test.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  ;(globalThis as any).$fetch = fetchMock
  fetchMock.mockReset()
  invalidateLibraryCache()
})
afterEach(() => {
  delete (globalThis as any).$fetch
})

describe('library content memo', () => {
  it('memoizes per kind/slug and clones on every read', async () => {
    fetchMock.mockResolvedValueOnce({ name: 'v1' })
    const a = await fetchLibraryContent('examples', 'ecom-top5')
    const b = await fetchLibraryContent('examples', 'ecom-top5')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(b).toEqual(a)
    expect(b).not.toBe(a) // mutation-safe clone

    a.name = 'mutated'
    const c = await fetchLibraryContent('examples', 'ecom-top5')
    expect(c.name).toBe('v1')
  })

  it('fresh: true bypasses and replaces the memo', async () => {
    fetchMock.mockResolvedValueOnce({ name: 'v1' })
    await fetchLibraryContent('examples', 'ecom-top5')

    fetchMock.mockResolvedValueOnce({ name: 'v2' })
    const fresh = await fetchLibraryContent('examples', 'ecom-top5', {
      fresh: true,
    })
    expect(fresh.name).toBe('v2')

    // The refreshed value becomes the new memo.
    const again = await fetchLibraryContent('examples', 'ecom-top5')
    expect(again.name).toBe('v2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('invalidateLibraryCache(kind, slug) drops that item and the kind list', async () => {
    fetchMock.mockResolvedValueOnce({ items: [{ slug: 'a' }] })
    await fetchLibraryList('examples')
    fetchMock.mockResolvedValueOnce({ name: 'old-a' })
    await fetchLibraryContent('examples', 'a')
    fetchMock.mockResolvedValueOnce({ name: 'old-b' })
    await fetchLibraryContent('examples', 'b')

    invalidateLibraryCache('examples', 'a')

    // List and slug "a" refetch; slug "b" stays memoized.
    fetchMock.mockResolvedValueOnce({ items: [{ slug: 'a2' }] })
    const list = await fetchLibraryList('examples')
    expect(list).toEqual([{ slug: 'a2' }])
    fetchMock.mockResolvedValueOnce({ name: 'new-a' })
    const a = await fetchLibraryContent('examples', 'a')
    expect(a.name).toBe('new-a')
    const b = await fetchLibraryContent('examples', 'b')
    expect(b.name).toBe('old-b')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('invalidateLibraryCache(kind) leaves other kinds memoized', async () => {
    fetchMock.mockResolvedValueOnce({ name: 'shape' })
    await fetchLibraryContent('shapes', 's1')
    fetchMock.mockResolvedValueOnce({ name: 'ex' })
    await fetchLibraryContent('examples', 'e1')

    invalidateLibraryCache('examples')

    const shape = await fetchLibraryContent('shapes', 's1')
    expect(shape.name).toBe('shape')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockResolvedValueOnce({ name: 'ex2' })
    const ex = await fetchLibraryContent('examples', 'e1')
    expect(ex.name).toBe('ex2')
  })
})

describe('exampleSlugFromContentUrl', () => {
  it('parses the CDN content-object pattern', () => {
    expect(
      exampleSlugFromContentUrl(
        'https://cdn.zvid.io/library/examples/ecom-top5.4c3edbfac8d4.json'
      )
    ).toBe('ecom-top5')
    expect(
      exampleSlugFromContentUrl(
        'http://localhost:9999/library/examples/a1.abcdef.json'
      )
    ).toBe('a1')
  })

  it('rejects everything else', () => {
    expect(exampleSlugFromContentUrl('not a url')).toBeNull()
    expect(
      exampleSlugFromContentUrl('https://cdn.zvid.io/library/examples/x.json')
    ).toBeNull() // no hash segment
    expect(
      exampleSlugFromContentUrl(
        'https://cdn.zvid.io/library/shapes/s.abcdef012345.json'
      )
    ).toBeNull() // wrong kind
    expect(
      exampleSlugFromContentUrl(
        'https://cdn.zvid.io/library/examples/previews/ecom-top5.dca087bdbb10.mp4'
      )
    ).toBeNull() // preview asset, not content
  })
})
