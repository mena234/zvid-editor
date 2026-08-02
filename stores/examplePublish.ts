import { defineStore } from 'pinia'
import type { Socket } from 'socket.io-client'
import { useEditorStore } from '~/stores/editor'
import { useAuthStore } from '~/stores/auth'
import { invalidateLibraryCache } from '~/composables/useLibrary'
import {
  connectRenderSocket,
  disconnectRenderSocket,
} from '~/utils/renderSocket'

/**
 * Admin "Render & publish" lifecycle for library examples.
 *
 * This state machine deliberately lives OUTSIDE PublishExampleModal: the
 * render + republish keeps running server-side after the HTTP 202, so closing
 * the modal must not orphan the flow. The store keeps the socket listeners
 * bound until a terminal event, notifies on success/failure even when the
 * modal is closed, and polls orch's publish-status snapshot as a fallback for
 * dropped sockets (renders can take many minutes).
 */

export type PublishStatus =
  | 'idle'
  | 'connecting'
  | 'rendering'
  | 'publishing'
  | 'done'
  | 'error'

interface ErrorDetail {
  field?: string
  message: string
}

const POLL_INTERVAL_MS = 10_000

let activeSocket: Socket | null = null
const boundEvents: [string, (data: any) => void][] = []
let pollTimer: ReturnType<typeof setInterval> | null = null

export const useExamplePublishStore = defineStore('examplePublish', {
  state: () => ({
    status: 'idle' as PublishStatus,
    progress: 0,
    jobId: '',
    slug: '',
    title: '',
    errorMsg: '',
    errorDetails: [] as ErrorDetail[],
    newVersion: null as number | null,
    previewUrl: '',
  }),

  getters: {
    /** A publish is running (used to gate re-entry and show the banner chip). */
    active: (s) =>
      s.status === 'connecting' ||
      s.status === 'rendering' ||
      s.status === 'publishing',
  },

  actions: {
    _bind(s: Socket, event: string, handler: (data: any) => void) {
      s.on(event, handler)
      boundEvents.push([event, handler])
    },
    _unbindAll() {
      if (activeSocket) {
        for (const [event, handler] of boundEvents) {
          activeSocket.off(event, handler)
        }
      }
      boundEvents.length = 0
      activeSocket = null
    },
    _stopPolling() {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    },

    _fail(message: string, details: ErrorDetail[] = []) {
      this._unbindAll()
      this._stopPolling()
      this.status = 'error'
      this.errorMsg = message
      this.errorDetails = Array.isArray(details) ? details : []
      useEditorStore().notify(
        `Publishing “${this.title || this.slug}” failed — ${message}`,
        'error'
      )
    },

    _succeed(item: any) {
      this._unbindAll()
      this._stopPolling()
      this.status = 'done'
      this.progress = 100
      this.newVersion = item?.version ?? null
      this.previewUrl = item?.meta?.preview || item?.meta?.thumbnail || ''

      const editor = useEditorStore()
      // The library changed: drop the session memos so the Examples modal and
      // any further Edit re-fetch the fresh list/preview/JSON immediately.
      invalidateLibraryCache('examples', this.slug)
      // Reflect the fresh meta in the banner's in-memory record.
      if (editor.sourceExample?.slug === this.slug && item) {
        editor.setSourceExample({
          slug: this.slug,
          title: item.title ?? editor.sourceExample.title,
          meta: item.meta ?? editor.sourceExample.meta,
        })
      }
      editor.notify(
        `Example “${item?.title ?? this.slug}” published${
          this.newVersion != null ? ` — now version ${this.newVersion}` : ''
        }`,
        'success'
      )
    },

    /** Poll orch's status snapshot — terminal states win over a dead socket. */
    async _poll() {
      if (!this.jobId || !this.active) return
      let r: any
      try {
        r = await $fetch(
          `/api/admin/library/publish-status/${encodeURIComponent(this.jobId)}`
        )
      } catch {
        return // transient — the socket path is still primary
      }
      if (!r?.success) return // 404 = snapshot expired/orch predates the route
      if (r.state === 'published') {
        this._succeed(r.item)
      } else if (r.state === 'failed') {
        this._fail(typeof r.error === 'string' ? r.error : 'Publish failed')
      } else if (r.state === 'publishing' && this.status === 'rendering') {
        this.status = 'publishing'
        this.progress = 100
      }
    },

    /**
     * Kick off render + republish for the example currently open for editing.
     * Safe to call only when no publish is active; the modal gates on that.
     */
    async start(source: { slug: string; title: string }, content: any) {
      if (this.active) {
        useEditorStore().notify(
          'A publish is already running — wait for it to finish',
          'info'
        )
        return
      }
      const editor = useEditorStore()
      const auth = useAuthStore()

      this.$reset()
      this.slug = source.slug
      this.title = source.title
      this.status = 'connecting'

      const clientKey = String(auth.user?.id ?? 'editor')
      let socket: Socket
      try {
        socket = await connectRenderSocket(clientKey)
      } catch (e: any) {
        if (/unauthorized/i.test(e?.message ?? '')) {
          disconnectRenderSocket()
          auth.sessionExpired()
          this.status = 'idle'
          editor.notify('Your session expired — please sign in again', 'info')
          editor.closeModal()
        } else {
          this._fail(
            'Could not reach the render service. Check your connection and retry.'
          )
        }
        return
      }

      activeSocket = socket

      let resp: any
      try {
        resp = await $fetch(
          `/api/admin/library/${encodeURIComponent(source.slug)}/render-publish`,
          { method: 'POST', body: { content, clientKey } }
        )
      } catch (e: any) {
        this._fail(
          e?.data?.message || e?.message || 'Failed to start the render',
          e?.data?.details || []
        )
        return
      }
      if (!resp?.success || !resp.jobId) {
        this._fail(
          resp?.error || 'Failed to start the render',
          (resp?.details as ErrorDetail[]) || []
        )
        return
      }

      this.jobId = resp.jobId
      this.status = 'rendering'

      const mineTask = (d: any) => d?.taskId === this.jobId
      const mineJob = (d: any) => d?.jobId === this.jobId

      this._bind(socket, 'taskAssigned', (d) => {
        if (mineTask(d) && this.status === 'rendering') this.progress = 0
      })
      this._bind(socket, 'taskProgress', (d) => {
        if (!mineTask(d) || !this.active) return
        this.status = 'rendering'
        const p = typeof d.progress === 'number' ? d.progress : d.progress?.progress
        if (typeof p === 'number') this.progress = Math.min(100, Math.round(p))
      })
      // Render finished on the cell; orch is now downscaling + reuploading.
      this._bind(socket, 'taskComplete', (d) => {
        if (!mineTask(d) || !this.active) return
        this.progress = 100
        this.status = 'publishing'
      })
      this._bind(socket, 'taskFailed', (d) => {
        if (!mineTask(d) || !this.active) return
        this._fail(typeof d.error === 'string' ? d.error : 'Render failed')
      })
      // Terminal success/failure of the whole edit→render→reupload→update-DB
      // flow. Also delivered via _poll when the socket dropped.
      this._bind(socket, 'examplePublished', (d) => {
        if (mineJob(d) && this.active) this._succeed(d.item)
      })
      this._bind(socket, 'examplePublishFailed', (d) => {
        if (!mineJob(d) || !this.active) return
        this._fail(
          typeof d.error === 'string' ? d.error : 'Publish failed'
        )
      })

      this._stopPolling()
      pollTimer = setInterval(() => void this._poll(), POLL_INTERVAL_MS)
    },

    /** Back to idle (after done/error, or to dismiss a finished run). */
    reset() {
      this._unbindAll()
      this._stopPolling()
      this.$reset()
    },
  },
})
