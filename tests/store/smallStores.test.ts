import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../../stores/auth'
import { useDesignsStore } from '../../stores/designs'
import { useUploadsStore } from '../../stores/uploads'
import type { SavedDesign } from '../../stores/designs'
import type { UploadItem } from '../../stores/uploads'

/**
 * stores/auth.ts getters, plus stores/designs.ts / stores/uploads.ts error
 * mapping (errMessage) and optimistic list mutations, with $fetch mocked on
 * globalThis (Nuxt auto-import; vitest has none).
 */

const fetchMock = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  fetchMock.mockReset()
  ;(globalThis as any).$fetch = fetchMock
})

afterEach(() => {
  delete (globalThis as any).$fetch
})

describe('auth store', () => {
  it('initials from first+last name', () => {
    const s = useAuthStore()
    s.user = { email: 'x@y.z', firstName: 'Jane', lastName: 'Doe' }
    expect(s.initials).toBe('JD')
  })

  it('initials from a single name (either half)', () => {
    const s = useAuthStore()
    s.user = { email: 'x@y.z', firstName: 'jane' }
    expect(s.initials).toBe('J')
    s.user = { email: 'x@y.z', lastName: 'doe' }
    expect(s.initials).toBe('D')
    // whitespace-only names are treated as absent → email fallback
    s.user = { email: 'sage@y.z', firstName: '   ' }
    expect(s.initials).toBe('S')
  })

  it('initials falls back to the email, then "?", then ""', () => {
    const s = useAuthStore()
    s.user = { email: 'mina@zvid.io' }
    expect(s.initials).toBe('M')
    s.user = { email: '' }
    expect(s.initials).toBe('?')
    s.user = null
    expect(s.initials).toBe('')
  })

  it('isPaid only when the plan says so', () => {
    const s = useAuthStore()
    expect(s.isPaid).toBe(false)
    s.plan = {}
    expect(s.isPaid).toBe(false)
    s.plan = { isPaid: false }
    expect(s.isPaid).toBe(false)
    s.plan = { isPaid: true }
    expect(s.isPaid).toBe(true)
  })

  it('fetchSession populates the session and always flips loaded', async () => {
    const s = useAuthStore()
    fetchMock.mockResolvedValueOnce({
      user: { email: 'a@b.c' },
      credits: { balance: 5 },
      plan: { isPaid: true },
    })
    await s.fetchSession()
    expect(s.user).toEqual({ email: 'a@b.c' })
    expect(s.credits).toEqual({ balance: 5 })
    expect(s.isPaid).toBe(true)
    expect(s.loaded).toBe(true)

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await s.fetchSession()
    expect(s.user).toBeNull()
    expect(s.credits).toBeNull()
    expect(s.plan).toBeNull()
    expect(s.loaded).toBe(true)
  })

  it('logout clears the session even when the API call fails', async () => {
    const s = useAuthStore()
    s.user = { email: 'a@b.c' }
    s.plan = { isPaid: true }
    fetchMock.mockRejectedValueOnce(new Error('network'))
    await s.logout()
    expect(s.user).toBeNull()
    expect(s.plan).toBeNull()
  })
})

function savedDesign(id: string): SavedDesign {
  return {
    id,
    name: `design ${id}`,
    design: { version: 1, layers: [] } as any,
    createdAt: '2026-07-08T00:00:00Z',
    updatedAt: '2026-07-08T00:00:00Z',
  }
}

describe('designs store', () => {
  it('load fills items; a repeat load without force skips the fetch', async () => {
    const s = useDesignsStore()
    fetchMock.mockResolvedValue({ designs: [savedDesign('d1')] })
    await s.load()
    expect(s.items!.map((d) => d.id)).toEqual(['d1'])
    expect(s.authRequired).toBe(false)

    fetchMock.mockClear()
    await s.load()
    expect(fetchMock).not.toHaveBeenCalled()
    await s.load(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('load 401 flips authRequired instead of erroring', async () => {
    const s = useDesignsStore()
    fetchMock.mockRejectedValueOnce({ statusCode: 401 })
    await s.load()
    expect(s.authRequired).toBe(true)
    expect(s.items).toEqual([])
    expect(s.error).toBeNull()
  })

  it('load errors surface through the errMessage chain (deepest body wins)', async () => {
    const s = useDesignsStore()
    fetchMock.mockRejectedValueOnce({
      data: {
        data: { error: 'orch says no', message: 'shadowed' },
        statusMessage: 'shadowed too',
      },
    })
    await s.load()
    expect(s.error).toBe('orch says no')

    s.reset()
    fetchMock.mockRejectedValueOnce({ statusMessage: 'Bad Gateway' })
    await s.load()
    expect(s.error).toBe('Bad Gateway')

    s.reset()
    fetchMock.mockRejectedValueOnce({})
    await s.load()
    expect(s.error).toBe('Failed to load your designs')
  })

  it('save optimistically prepends, even before the first load', async () => {
    const s = useDesignsStore()
    fetchMock.mockResolvedValueOnce({ design: savedDesign('new') })
    const saved = await s.save({ version: 1, layers: [] } as any, 'My design')
    expect(saved!.id).toBe('new')
    expect(s.items!.map((d) => d.id)).toEqual(['new'])

    fetchMock.mockResolvedValueOnce({ design: savedDesign('newer') })
    await s.save({ version: 1, layers: [] } as any, 'Another')
    expect(s.items!.map((d) => d.id)).toEqual(['newer', 'new'])
  })

  it('save returns null on 401 (best-effort) and throws mapped errors otherwise', async () => {
    const s = useDesignsStore()
    fetchMock.mockRejectedValueOnce({ status: 401 })
    const res = await s.save({ version: 1, layers: [] } as any, 'x')
    expect(res).toBeNull()
    expect(s.authRequired).toBe(true)

    fetchMock.mockRejectedValueOnce({ data: { data: { message: 'too big' } } })
    await expect(
      s.save({ version: 1, layers: [] } as any, 'x')
    ).rejects.toThrow('too big')
  })

  it('remove deletes on the server then filters the local list', async () => {
    const s = useDesignsStore()
    s.items = [savedDesign('a b'), savedDesign('keep')]
    fetchMock.mockResolvedValueOnce({})
    await s.remove('a b')
    expect(fetchMock).toHaveBeenCalledWith('/api/designs/a%20b', {
      method: 'DELETE',
    })
    expect(s.items!.map((d) => d.id)).toEqual(['keep'])
  })

  it('reset returns to the pristine unloaded state', () => {
    const s = useDesignsStore()
    s.items = [savedDesign('a')]
    s.authRequired = true
    s.error = 'x'
    s.reset()
    expect(s.items).toBeNull()
    expect(s.authRequired).toBe(false)
    expect(s.error).toBeNull()
  })
})

function uploadItem(id: string, kind: UploadItem['kind'] = 'image'): UploadItem {
  return {
    id,
    kind,
    fileName: `${id}.bin`,
    mimeType: 'application/octet-stream',
    sizeBytes: 10,
    width: null,
    height: null,
    duration: null,
    url: `https://cdn/x/${id}`,
    createdAt: '2026-07-08T00:00:00Z',
  }
}

describe('uploads store', () => {
  it('load fills items + usage; 401 flips authRequired', async () => {
    const s = useUploadsStore()
    const usage = { files: 1, usedBytes: 10, maxTotalBytes: 100 }
    fetchMock.mockResolvedValueOnce({ uploads: [uploadItem('u1')], usage })
    await s.load()
    expect(s.items!.map((u) => u.id)).toEqual(['u1'])
    expect(s.usage).toEqual(usage)

    s.reset()
    expect(s.items).toBeNull()
    expect(s.usage).toBeNull()

    fetchMock.mockRejectedValueOnce({ status: 401 })
    await s.load()
    expect(s.authRequired).toBe(true)
    expect(s.items).toEqual([])
  })

  it('load errors go through the same errMessage chain', async () => {
    const s = useUploadsStore()
    fetchMock.mockRejectedValueOnce({ data: { data: { error: 'B2 down' } } })
    await s.load()
    expect(s.error).toBe('B2 down')

    s.reset()
    fetchMock.mockRejectedValueOnce(new Error('net'))
    await s.load()
    expect(s.error).toBe('net')

    s.reset()
    fetchMock.mockRejectedValueOnce({})
    await s.load()
    expect(s.error).toBe('Failed to load your uploads')
  })

  it('ofKind/pendingOfKind filter by media kind', () => {
    const s = useUploadsStore()
    s.items = [uploadItem('i1', 'image'), uploadItem('v1', 'video'), uploadItem('i2', 'image')]
    s.pending = [
      { key: 1, name: 'a.gif', kind: 'gif', progress: 40 },
      { key: 2, name: 'b.png', kind: 'image', progress: 10 },
    ]
    expect(s.ofKind('image').map((u) => u.id)).toEqual(['i1', 'i2'])
    expect(s.ofKind('audio')).toEqual([])
    expect(s.pendingOfKind('gif').map((p) => p.key)).toEqual([1])
    // items null → empty, not a crash
    s.items = null
    expect(s.ofKind('image')).toEqual([])
  })

  it('remove deletes on the server then filters the local list', async () => {
    const s = useUploadsStore()
    s.items = [uploadItem('keep'), uploadItem('bye bye')]
    fetchMock.mockResolvedValueOnce({})
    await s.remove('bye bye')
    expect(fetchMock).toHaveBeenCalledWith('/api/uploads/bye%20bye', {
      method: 'DELETE',
    })
    expect(s.items!.map((u) => u.id)).toEqual(['keep'])
  })
})
