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
    e?.data?.data?.error ||
    e?.data?.data?.message ||
    e?.data?.statusMessage ||
    e?.statusMessage ||
    e?.message ||
    fallback
  )
}

export const useDesignsStore = defineStore('designs', {
  state: () => ({
    /** null until first load resolves */
    items: null as SavedDesign[] | null,
    loading: false,
    /** the list endpoint answered 401 — show the sign-in hint */
    authRequired: false,
    error: null as string | null,
  }),

  actions: {
    async load(force = false) {
      if (this.loading || (this.items && !force)) return
      this.loading = true
      this.error = null
      try {
        const res = await $fetch<{ designs: SavedDesign[] }>('/api/designs')
        this.items = res.designs ?? []
        this.authRequired = false
      } catch (e: any) {
        if ((e?.statusCode ?? e?.status) === 401) {
          this.authRequired = true
          this.items = []
        } else {
          this.error = errMessage(e, 'Failed to load your designs')
        }
      } finally {
        this.loading = false
      }
    },

    /** Called after a sign-in / sign-out so the panel refreshes. */
    reset() {
      this.items = null
      this.authRequired = false
      this.error = null
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
        if (this.items) this.items.unshift(res.design)
        else this.items = [res.design]
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
      if (this.items) this.items = this.items.filter((d) => d.id !== id)
    },
  },
})
