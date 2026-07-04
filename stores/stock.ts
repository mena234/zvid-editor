import { defineStore } from 'pinia'

export type StockKind = 'image' | 'video' | 'gif'

export interface StockItem {
  id: string
  provider: string
  kind: StockKind
  /** small thumbnail for the sidebar grid */
  preview: string
  /** full-quality URL to embed in the project */
  src: string
  width?: number
  height?: number
  duration?: number
  description?: string
  credit?: { name?: string; link?: string }
}

interface StockSearchResponse {
  items: StockItem[]
  page: number
  perPage: number
  hasMore: boolean
  providerErrors?: Record<string, string>
}

interface KindState {
  query: string
  provider: string // 'all' or a provider id
  items: StockItem[]
  page: number
  hasMore: boolean
  loading: boolean
  error: string | null
  /** per-provider failures from the last page (e.g. one provider rate-limited) */
  providerErrors: Record<string, string> | null
  /** guards against out-of-order responses */
  requestId: number
  /** first load already triggered for this kind */
  initialized: boolean
}

const PER_PAGE = 24

const FALLBACK_PROVIDERS: Record<StockKind, string[]> = {
  image: ['pexels', 'pixabay', 'unsplash'],
  video: ['pexels', 'pixabay'],
  gif: ['giphy'],
}

function emptyKindState(): KindState {
  return {
    query: '',
    provider: 'all',
    items: [],
    page: 0,
    hasMore: true,
    loading: false,
    error: null,
    providerErrors: null,
    requestId: 0,
    initialized: false,
  }
}

export const useStockStore = defineStore('stock', {
  state: () => ({
    kind: 'image' as StockKind,
    byKind: {
      image: emptyKindState(),
      video: emptyKindState(),
      gif: emptyKindState(),
    } as Record<StockKind, KindState>,
    /** providers with configured keys, per type (from orch); null until loaded */
    providers: null as Record<StockKind, string[]> | null,
  }),

  getters: {
    current(state): KindState {
      return state.byKind[state.kind]
    },
    kindProviders(state): string[] {
      return state.providers?.[state.kind] ?? FALLBACK_PROVIDERS[state.kind]
    },
  },

  actions: {
    async loadProviders() {
      if (this.providers) return
      try {
        this.providers = await $fetch<Record<StockKind, string[]>>(
          '/api/stock/providers'
        )
      } catch {
        /* fall back to the static list */
      }
    },

    setKind(kind: StockKind) {
      this.kind = kind
      if (!this.byKind[kind].initialized) void this.refresh()
    },

    setProvider(provider: string) {
      const s = this.byKind[this.kind]
      if (s.provider === provider) return
      s.provider = provider
      void this.refresh()
    },

    search(query: string) {
      const s = this.byKind[this.kind]
      if (s.query === query && s.initialized) return
      s.query = query
      void this.refresh()
    },

    /** Reset the current kind and load its first page. */
    async refresh() {
      const s = this.byKind[this.kind]
      s.items = []
      s.page = 0
      s.hasMore = true
      s.error = null
      s.providerErrors = null
      s.initialized = true
      s.requestId++ // invalidate in-flight loads
      s.loading = false
      await this.loadMore()
    },

    /** Clear a failed state and try again (user-initiated). */
    async retry() {
      const s = this.byKind[this.kind]
      s.error = null
      if (s.items.length) await this.loadMore()
      else await this.refresh()
    },

    /**
     * Load the next page of the current kind (infinite scroll).
     * A set `error` halts auto-loading — otherwise the fill/scroll watchers
     * would hammer a failing backend in a retry loop; `retry()` resumes.
     */
    async loadMore() {
      const kind = this.kind
      const s = this.byKind[kind]
      if (s.loading || !s.hasMore || s.error) return
      const rid = ++s.requestId
      s.loading = true
      try {
        const res = await $fetch<StockSearchResponse>('/api/stock/search', {
          query: {
            type: kind,
            provider: s.provider,
            query: s.query,
            page: s.page + 1,
            perPage: PER_PAGE,
          },
        })
        if (rid !== s.requestId) return // superseded by a newer request
        const seen = new Set(s.items.map((it) => it.id))
        for (const it of res.items ?? []) {
          if (!seen.has(it.id)) {
            seen.add(it.id)
            s.items.push(it)
          }
        }
        s.page += 1
        s.hasMore = !!res.hasMore && (res.items?.length ?? 0) > 0
        s.providerErrors = res.providerErrors ?? null
      } catch (e: any) {
        if (rid !== s.requestId) return
        s.error =
          e?.data?.data?.message || // orch error body forwarded by the proxy
          e?.data?.statusMessage ||
          e?.data?.message ||
          e?.statusMessage ||
          e?.message ||
          'Stock search failed'
      } finally {
        if (rid === s.requestId) s.loading = false
      }
    },
  },
})
