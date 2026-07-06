import { defineStore } from 'pinia'

export type UploadKind = 'image' | 'video' | 'audio' | 'gif'

export interface UploadItem {
  id: string
  kind: UploadKind
  fileName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  duration: number | null
  url: string
  createdAt: string
}

interface UploadsResponse {
  uploads: UploadItem[]
  usage: { files: number; usedBytes: number; maxTotalBytes: number }
}

/** Best-effort dimensions/duration probe from the local file, pre-upload. */
async function probeFile(
  file: File
): Promise<{ width?: number; height?: number; duration?: number }> {
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith('image/')) {
      return await new Promise((resolve) => {
        const img = new Image()
        img.onload = () =>
          resolve({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => resolve({})
        img.src = url
      })
    }
    if (file.type.startsWith('video/')) {
      return await new Promise((resolve) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () =>
          resolve({
            width: v.videoWidth || undefined,
            height: v.videoHeight || undefined,
            duration: Number.isFinite(v.duration) ? v.duration : undefined,
          })
        v.onerror = () => resolve({})
        v.src = url
      })
    }
    if (file.type.startsWith('audio/')) {
      return await new Promise((resolve) => {
        const a = new Audio()
        a.preload = 'metadata'
        a.onloadedmetadata = () =>
          resolve({
            duration: Number.isFinite(a.duration) ? a.duration : undefined,
          })
        a.onerror = () => resolve({})
        a.src = url
      })
    }
    return {}
  } finally {
    // the media element has read what it needs once metadata resolved
    setTimeout(() => URL.revokeObjectURL(url), 5_000)
  }
}

function errMessage(e: any, fallback: string): string {
  return (
    e?.data?.data?.error || // orch error body forwarded by the proxy
    e?.data?.data?.message ||
    e?.data?.statusMessage ||
    e?.statusMessage ||
    e?.message ||
    fallback
  )
}

export const useUploadsStore = defineStore('uploads', {
  state: () => ({
    /** null until the first load resolves */
    items: null as UploadItem[] | null,
    usage: null as UploadsResponse['usage'] | null,
    loading: false,
    /** the list endpoint answered 401 — show the sign-in hint */
    authRequired: false,
    error: null as string | null,
    /** in-flight uploads, newest first (skeleton cells) */
    pending: [] as { key: number; name: string; kind: UploadKind }[],
  }),

  getters: {
    ofKind: (state) => (kind: UploadKind) =>
      (state.items ?? []).filter((it) => it.kind === kind),
    pendingOfKind: (state) => (kind: UploadKind) =>
      state.pending.filter((p) => p.kind === kind),
  },

  actions: {
    async load(force = false) {
      if (this.loading || (this.items && !force)) return
      this.loading = true
      this.error = null
      try {
        const res = await $fetch<UploadsResponse>('/api/uploads')
        this.items = res.uploads ?? []
        this.usage = res.usage ?? null
        this.authRequired = false
      } catch (e: any) {
        if ((e?.statusCode ?? e?.status) === 401) {
          this.authRequired = true
          this.items = []
        } else {
          this.error = errMessage(e, 'Failed to load your uploads')
        }
      } finally {
        this.loading = false
      }
    },

    /** Called after a successful sign-in so the panel refreshes. */
    reset() {
      this.items = null
      this.usage = null
      this.authRequired = false
      this.error = null
    },

    /**
     * Upload one file; resolves with the stored item. The caller picks the
     * expected kind from the active tab, but the server classifies by mime —
     * a GIF picked from the Images tab still lands under GIFs.
     */
    async upload(file: File, expectedKind: UploadKind): Promise<UploadItem> {
      const key = Date.now() + Math.random()
      this.pending.unshift({ key, name: file.name, kind: expectedKind })
      try {
        const meta = await probeFile(file)
        const form = new FormData()
        form.append('file', file)
        if (meta.width) form.append('width', String(meta.width))
        if (meta.height) form.append('height', String(meta.height))
        if (meta.duration) form.append('duration', String(meta.duration))
        const res = await $fetch<{ upload: UploadItem }>('/api/uploads', {
          method: 'POST',
          body: form,
        })
        if (this.items) this.items.unshift(res.upload)
        else this.items = [res.upload]
        return res.upload
      } catch (e: any) {
        if ((e?.statusCode ?? e?.status) === 401) this.authRequired = true
        throw new Error(errMessage(e, `Failed to upload ${file.name}`))
      } finally {
        this.pending = this.pending.filter((p) => p.key !== key)
      }
    },

    async remove(id: string) {
      await $fetch(`/api/uploads/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (this.items) this.items = this.items.filter((it) => it.id !== id)
    },
  },
})
