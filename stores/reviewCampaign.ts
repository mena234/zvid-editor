import { defineStore } from 'pinia'
import { useAuthStore } from '~/stores/auth'
import { useEditorStore } from '~/stores/editor'
import type {
  ReviewCampaignResponse,
  ReviewCampaignSnapshot,
  ReviewCampaignView,
  ReviewRewardKind,
} from '~/types/reviewCampaign'

export const useReviewCampaignStore = defineStore('reviewCampaign', {
  state: () => ({
    accountKey: '',
    generation: 0,
    requestVersion: 0,
    snapshot: null as ReviewCampaignSnapshot | null,
    view: 'question' as ReviewCampaignView,
    source: 'manual' as 'manual' | 'editor_output',
    leaseToken: '',
    busy: false,
    error: '',
    feedbackSaved: false,
    dismissedThisSession: false,
    // The single host consumes these events; no timer belongs to a result modal.
    outputInteraction: 0,
  }),

  actions: {
    currentAccountKey() {
      const user = useAuthStore().user
      return user ? String(user.id ?? user.email) : ''
    },

    syncAccount() {
      const key = this.currentAccountKey()
      if (key === this.accountKey) return
      const nextGeneration = this.generation + 1
      if (useEditorStore().modal === 'reviewCampaign') useEditorStore().closeModal()
      this.$reset()
      this.accountKey = key
      this.generation = nextGeneration
    },

    async request(body?: Record<string, unknown>) {
      this.syncAccount()
      if (!this.accountKey) return null
      const key = this.accountKey
      const generation = this.generation
      const version = ++this.requestVersion
      const response = await $fetch<ReviewCampaignResponse>('/api/review-campaign', body
        ? { method: 'POST', timeout: 10000, body: { source: this.source, leaseToken: this.leaseToken || undefined, ...body } }
        : { method: 'GET', timeout: 10000 })
      // Account A's network response must never populate account B's popup.
      if (key !== this.currentAccountKey() || generation !== this.generation) return null
      if (version === this.requestVersion) this.snapshot = response
      return response
    },

    async refresh() {
      try {
        await this.request()
      } catch {
        // Campaign availability must not interfere with the editor.
      }
    },

    outputUsed() {
      this.syncAccount()
      if (this.accountKey) this.outputInteraction++
    },

    async show(manual = false, isSafe: () => boolean = () => true) {
      this.syncAccount()
      if (!this.accountKey || this.busy || useEditorStore().modal || !isSafe() || (!manual && this.dismissedThisSession)) return
      const generation = this.generation
      this.busy = true
      this.error = ''
      this.source = manual ? 'manual' : 'editor_output'
      try {
        const response = await this.request({ action: 'show', manual })
        if (!response?.shown) {
          if (manual && response) useEditorStore().notify('This invitation is already open in another tab. Please finish it there.', 'info')
          return
        }
        this.leaseToken = response.leaseToken ?? ''
        // Never steal focus if editing resumed while the admission request ran.
        if (useEditorStore().modal || !isSafe()) {
          const canceledLease = this.leaseToken
          await this.request({ action: 'dismiss' })
          if (generation === this.generation && this.leaseToken === canceledLease) this.leaseToken = ''
          return
        }
        const state = response.state
        this.view = state.answer || state.feedbackSubmitted
          || state.g2Status !== 'available' || state.videoStatus !== 'available'
          ? 'rewards' : 'question'
        this.feedbackSaved = false
        useEditorStore().openModal('reviewCampaign')
      } catch {
        if (manual && generation === this.generation) {
          useEditorStore().notify('Could not open feedback and rewards. Please try again.', 'error')
        }
      } finally {
        if (generation === this.generation) this.busy = false
      }
    },

    async mutate(body: Record<string, unknown>) {
      if (this.busy) return false
      const generation = this.generation
      this.busy = true
      this.error = ''
      try {
        return !!await this.request(body)
      } catch {
        if (generation === this.generation) this.error = 'Could not save this. Please try again.'
        return false
      } finally {
        if (generation === this.generation) this.busy = false
      }
    },

    async answer(answer: 'yes' | 'no') {
      if (await this.mutate({ action: 'answer', answer })) {
        this.view = answer === 'yes' ? 'rewards' : 'feedback'
      }
    },

    async saveFeedback(feedback: string) {
      if (!feedback.trim() || feedback.trim().length > 4000) return false
      if (!await this.mutate({ action: 'feedback', feedback: feedback.trim() })) return false
      this.feedbackSaved = true
      this.view = 'rewards'
      return true
    },

    async openOffer(kind: ReviewRewardKind) {
      // A link click is analytics only, never a submitted or awarded claim.
      if (this.busy) return
      try { await this.request({ action: 'open_offer', kind }) } catch {}
    },

    async submitClaim(kind: ReviewRewardKind, publicationConsent = false) {
      if (kind === 'video' && !publicationConsent) return false
      return this.mutate({ action: 'submit_claim', kind, ...(kind === 'video' && { publicationConsent }) })
    },

    async close(optOut = false) {
      const generation = this.generation
      const leaseToClose = this.leaseToken
      // Escape/backdrop must still work if the network is slow or unavailable.
      this.dismissedThisSession = true
      useEditorStore().closeModal()
      try {
        await this.request({ action: optOut ? 'opt_out' : 'dismiss', leaseToken: leaseToClose || undefined })
      } catch {
        if (optOut && generation === this.generation) {
          useEditorStore().notify('Could not save your preference. Invitations are paused for this session; please try again later.', 'info')
        }
      } finally {
        if (generation === this.generation && this.leaseToken === leaseToClose) this.leaseToken = ''
      }
    },
  },
})
