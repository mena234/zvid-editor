/**
 * Content library client — examples, Design Studio templates and canvas
 * presets served by orch (/api/library, proxied through the editor origin).
 * Metadata lives in orch's database (Redis-cached); the content JSON comes
 * from Backblaze B2 through the Cloudflare CDN.
 *
 * Lists and content are memoized per session; content is returned as a fresh
 * clone so callers can mutate it freely.
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
}

const listCache = new Map<string, LibraryItem[]>()
const contentCache = new Map<string, any>()

export async function fetchLibraryList(kind: string): Promise<LibraryItem[]> {
  const hit = listCache.get(kind)
  if (hit) return hit
  const res = await $fetch<{ items: LibraryItem[] }>(`/api/library/${kind}`)
  listCache.set(kind, res.items)
  return res.items
}

export async function fetchLibraryContent(
  kind: string,
  slug: string
): Promise<any> {
  const key = `${kind}/${slug}`
  if (!contentCache.has(key)) {
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
