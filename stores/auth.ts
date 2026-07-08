import { defineStore } from 'pinia'
import { disconnectRenderSocket } from '~/utils/renderSocket'

export interface SessionUser {
  id?: number
  email: string
  firstName?: string
  lastName?: string
  [key: string]: unknown
}

export interface SessionCredits {
  balance?: number
  [key: string]: unknown
}

export interface SessionPlan {
  name?: string
  isPaid?: boolean
}

/**
 * Account session for the editor. Anyone can use the editor logged-out;
 * the session only gates cloud saves (projects / templates).
 * Transport is the shared httpOnly auth_token cookie (same as dash), read
 * server-side by /api/session — the client never sees the token.
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as SessionUser | null,
    credits: null as SessionCredits | null,
    plan: null as SessionPlan | null,
    loaded: false,
  }),

  getters: {
    /** Paid-plan session — unlocks premium library templates. */
    isPaid(state): boolean {
      return !!state.plan?.isPaid
    },

    initials(state): string {
      const u = state.user
      if (!u) return ''
      const a = (u.firstName || '').trim()
      const b = (u.lastName || '').trim()
      if (a || b) return `${a[0] ?? ''}${b[0] ?? ''}`.toUpperCase()
      return (u.email[0] ?? '?').toUpperCase()
    },
  },

  actions: {
    async fetchSession() {
      try {
        const data = await $fetch<{
          user: SessionUser | null
          credits: SessionCredits | null
          plan: SessionPlan | null
        }>('/api/session')
        this.user = data?.user || null
        this.credits = data?.credits || null
        this.plan = data?.plan || null
      } catch {
        this.user = null
        this.credits = null
        this.plan = null
      }
      this.loaded = true
    },

    async login(email: string, password: string) {
      const result = await $fetch<{
        success: boolean
        user?: SessionUser
        error?: string
      }>('/api/auth/login', { method: 'POST', body: { email, password } })
      if (result.success) await this.fetchSession()
      return result
    },

    async logout() {
      try {
        await $fetch('/api/auth/logout', { method: 'POST' })
      } catch {
        /* clearing local state is what matters */
      }
      this.user = null
      this.credits = null
      this.plan = null
      disconnectRenderSocket()
    },

    /** Called when an API round-trip reveals the session expired. */
    sessionExpired() {
      this.user = null
      this.credits = null
      this.plan = null
      disconnectRenderSocket()
    },
  },
})
