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

function safeParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
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
    /** in-flight uploads, newest first (skeleton cells), 0–100 progress */
    pending: [] as {
      key: number
      name: string
      kind: UploadKind
      progress: number
    }[],
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
     *
     * Uses XMLHttpRequest (not $fetch) so `upload.onprogress` can drive the
     * per-file percentage shown in the grid.
     */
    async upload(file: File, expectedKind: UploadKind): Promise<UploadItem> {
      const key = Date.now() + Math.random()
      const entry = { key, name: file.name, kind: expectedKind, progress: 0 }
      this.pending.unshift(entry)
      try {
        const meta = await probeFile(file)
        const form = new FormData()
        form.append('file', file)
        if (meta.width) form.append('width', String(meta.width))
        if (meta.height) form.append('height', String(meta.height))
        if (meta.duration) form.append('duration', String(meta.duration))

        const upload = await new Promise<UploadItem>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', '/api/uploads')
          xhr.responseType = 'json'
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              // cap at 99 until the server responds — 100 means "stored"
              entry.progress = Math.min(99, Math.round((ev.loaded / ev.total) * 100))
            }
          }
          xhr.onload = () => {
            const body = xhr.response || safeParse(xhr.responseText)
            if (xhr.status >= 200 && xhr.status < 300 && body?.upload) {
              entry.progress = 100
              resolve(body.upload as UploadItem)
            } else {
              const err: any = new Error(
                body?.data?.error ||
                  body?.error ||
                  body?.message ||
                  `Upload failed (${xhr.status})`
              )
              err.status = xhr.status
              reject(err)
            }
          }
          xhr.onerror = () => reject(new Error('Network error during upload'))
          xhr.onabort = () => reject(new Error('Upload cancelled'))
          xhr.send(form)
        })

        if (this.items) this.items.unshift(upload)
        else this.items = [upload]
        return upload
      } catch (e: any) {
        if ((e?.status ?? e?.statusCode) === 401) this.authRequired = true
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
