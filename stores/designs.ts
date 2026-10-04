import { defineStore } from 'pinia'
import type { DesignDoc } from '~/utils/designer/types'

export interface SavedDesign {
  id: string
  name: string
  design: DesignDoc
  createdAt: string
  updatedAt: string
}

function errMessage(e: any, fallback: string): string {
  return (
    e?.data?.data?.message ||
    e?.data?.data?.error ||
    e?.data?.statusMessage ||
    e?.statusMessage ||
    e?.message ||
    fallback
  )
}

interface DesignPage {
  designs: SavedDesign[]
  pagination?: { total: number; totalPages: number }
}
const PAGE_SIZE = 50

export const useDesignsStore = defineStore('designs', {
  state: () => ({
    /** null until first load resolves */
    items: null as SavedDesign[] | null,
    loading: false,
    /** the list endpoint answered 401 — show the sign-in hint */
    authRequired: false,
    error: null as string | null,
    total: null as number | null,
    loadedPage: 0,
    hasMore: false,
    loadingMore: false,
    loadMoreError: null as string | null,
    generation: 0,
  }),

  actions: {
    async load(force = false) {
      if (this.loading || (this.items && !force)) return
      this.loading = true
      this.error = null
      const generation = this.generation
      try {
        const res = await $fetch<DesignPage>('/api/designs', { query: { page: 1, limit: PAGE_SIZE } })
        if (generation !== this.generation) return
        if (!Array.isArray(res.designs)) throw new Error('Failed to load your designs')
        this.items = res.designs
        this.total = res.pagination?.total ?? res.designs.length
        this.loadedPage = 1
        this.hasMore = res.pagination ? res.pagination.totalPages > 1 : res.designs.length === PAGE_SIZE
        this.loadMoreError = null
        this.authRequired = false
      } catch (e: any) {
        if (generation !== this.generation) return
        if ((e?.statusCode ?? e?.status) === 401) {
          this.reset()
          this.authRequired = true
          this.items = []
          this.total = 0
        } else {
          this.error = errMessage(e, 'Failed to load your designs')
        }
      } finally {
        if (generation === this.generation) this.loading = false
      }
    },

    async loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore) return
      this.loadingMore = true
      this.loadMoreError = null
      const generation = this.generation
      try {
        const page = this.loadedPage + 1
        const res = await $fetch<DesignPage>('/api/designs', { query: { page, limit: PAGE_SIZE } })
        if (generation !== this.generation) return
        if (!Array.isArray(res.designs)) throw new Error('Failed to load more designs')
        this.items = [...new Map([...(this.items || []), ...res.designs].map(design => [design.id, design])).values()]
        this.total = res.pagination?.total ?? this.items.length
        this.loadedPage = page
        this.hasMore = res.pagination ? page < res.pagination.totalPages : res.designs.length === PAGE_SIZE
      } catch (e: any) {
        if (generation !== this.generation) return
        if ((e?.statusCode ?? e?.status) === 401) {
          this.reset()
          this.authRequired = true
          this.items = []
          this.total = 0
        } else {
          this.loadMoreError = errMessage(e, 'Failed to load more designs')
        }
      } finally {
        if (generation === this.generation) this.loadingMore = false
      }
    },

    /** Called after a sign-in / sign-out so the panel refreshes. */
    reset() {
      this.generation += 1
      this.items = null
      this.loading = false
      this.authRequired = false
      this.error = null
      this.total = null
      this.loadedPage = 0
      this.hasMore = false
      this.loadingMore = false
      this.loadMoreError = null
    },

    /**
     * Persist a design to the user's stock. Returns the saved record, or null
     * when the user isn't signed in (saving is best-effort in that case).
     */
    async save(design: DesignDoc, name: string): Promise<SavedDesign | null> {
      try {
        const res = await $fetch<{ design: SavedDesign }>('/api/designs', {
          method: 'POST',
          body: { name, design },
        })
        // A mutation shifts every offset. Refresh the first page before paging
        // again so creating/deleting a design cannot skip the next saved item.
        this.reset()
        await this.load()
        return res.design
      } catch (e: any) {
        if ((e?.statusCode ?? e?.status) === 401) {
          this.authRequired = true
          return null
        }
        throw new Error(errMessage(e, 'Failed to save design'))
      }
    },

    async remove(id: string) {
      await $fetch(`/api/designs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      this.reset()
      await this.load()
    },
  },
})
