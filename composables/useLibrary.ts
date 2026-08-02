/**
 * Content library client — examples, Design Studio templates and canvas
 * presets served by orch (/api/library, proxied through the editor origin).
 * Metadata lives in orch's database (Redis-cached); the content JSON comes
 * from Backblaze B2 through the Cloudflare CDN.
 *
 * Lists and content are memoized per session; content is returned as a fresh
 * clone so callers can mutate it freely. The memos MUST be dropped when an
 * admin republishes an item (invalidateLibraryCache) — otherwise the Examples
 * modal and the edit flow keep serving the pre-publish list/JSON until a full
 * page reload, which reads as "publish didn't update the example".
 */

export interface LibraryItem {
  kind: string
  slug: string
  title: string
  description: string | null
  meta: Record<string, any> | null
  version: number
  sortOrder: number
  contentUrl: string
  /** First-publish time (ISO). Absent from orch responses cached pre-rollout. */
  createdAt?: string | null
}

export interface LibraryPage {
  kind: string
  items: LibraryItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

const listCache = new Map<string, LibraryItem[]>()
const pageCache = new Map<string, LibraryPage>()
const contentCache = new Map<string, any>()

/**
 * Drop session memos so the next fetch reflects a republished item.
 * With a slug, drops that item's content plus the kind's lists (item meta —
 * preview, version — lives in the lists). With only a kind, drops everything
 * cached for that kind. With no args, drops all library memos.
 */
export function invalidateLibraryCache(kind?: string, slug?: string) {
  if (!kind) {
    listCache.clear()
    pageCache.clear()
    contentCache.clear()
    return
  }
  listCache.delete(kind)
  for (const key of pageCache.keys()) {
    if (key.startsWith(`${kind}:`)) pageCache.delete(key)
  }
  if (slug) {
    contentCache.delete(`${kind}/${slug}`)
  } else {
    for (const key of contentCache.keys()) {
      if (key.startsWith(`${kind}/`)) contentCache.delete(key)
    }
  }
}

export async function fetchLibraryList(kind: string): Promise<LibraryItem[]> {
  const hit = listCache.get(kind)
  if (hit) return hit
  const res = await $fetch<{ items: LibraryItem[] }>(`/api/library/${kind}`)
  listCache.set(kind, res.items)
  return res.items
}

/**
 * One page of a kind's items (?limit=&offset=) for scroll pagination, with an
 * optional case-insensitive search filter on title/slug/description.
 */
export async function fetchLibraryPage(
  kind: string,
  limit: number,
  offset: number,
  q = ''
): Promise<LibraryPage> {
  const key = `${kind}:${limit}:${offset}:${q}`
  const hit = pageCache.get(key)
  if (hit) return hit
  const res = await $fetch<LibraryPage>(`/api/library/${kind}`, {
    query: q ? { limit, offset, q } : { limit, offset },
  })
  pageCache.set(key, res)
  return res
}

export async function fetchLibraryContent(
  kind: string,
  slug: string,
  opts: { fresh?: boolean } = {}
): Promise<any> {
  const key = `${kind}/${slug}`
  if (opts.fresh || !contentCache.has(key)) {
    contentCache.set(key, await $fetch(`/api/library/${kind}/${slug}/content`))
  }
  return JSON.parse(JSON.stringify(contentCache.get(key)))
}

export function libraryErrorMessage(e: any): string {
  return (
    e?.data?.statusMessage ||
    e?.data?.message ||
    e?.statusMessage ||
    e?.message ||
    'Request failed'
  )
}
