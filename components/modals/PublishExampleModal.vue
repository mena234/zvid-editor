<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue'
import type { Socket } from 'socket.io-client'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useAuthStore } from '~/stores/auth'
import { validateProjectDoc } from '~/shared/schema/validate'
import { connectRenderSocket, disconnectRenderSocket } from '~/utils/renderSocket'

const project = useProjectStore()
const editor = useEditorStore()
const auth = useAuthStore()

const source = computed(() => editor.sourceExample)

const errors = computed(() => validateProjectDoc(project.doc).filter((i) => i.level === 'error'))

type Status = 'idle' | 'connecting' | 'rendering' | 'publishing' | 'done' | 'error'
const status = ref<Status>('idle')
const progress = ref(0)
const errorMsg = ref('')
const errorDetails = ref<{ field?: string; message: string }[]>([])
const newVersion = ref<number | null>(null)
const previewUrl = ref('')
const jobId = ref('')

let activeSocket: Socket | null = null
const boundEvents: [string, (data: any) => void][] = []

function bind(s: Socket, event: string, handler: (data: any) => void) {
  s.on(event, handler)
  boundEvents.push([event, handler])
}
function unbindAll() {
  if (activeSocket) {
    for (const [event, handler] of boundEvents) activeSocket.off(event, handler)
  }
  boundEvents.length = 0
}

function fail(message: string, details: any[] = []) {
  status.value = 'error'
  errorMsg.value = message
  errorDetails.value = Array.isArray(details) ? details : []
}

async function start() {
  if (!source.value) return
  status.value = 'connecting'
  progress.value = 0
  errorMsg.value = ''
  errorDetails.value = []

  const clientKey = String(auth.user?.id ?? 'editor')
  let socket: Socket
  try {
    socket = await connectRenderSocket(clientKey)
  } catch (e: any) {
    if (/unauthorized/i.test(e?.message ?? '')) {
      disconnectRenderSocket()
      auth.sessionExpired()
      status.value = 'idle'
      editor.notify('Your session expired — please sign in again', 'info')
      editor.closeModal()
    } else {
      fail('Could not reach the render service. Check your connection and retry.')
    }
    return
  }

  activeSocket = socket
  unbindAll()

  // Kick off the server-side render + reupload + republish.
  let resp: any
  try {
    resp = await $fetch(
      `/api/admin/library/${encodeURIComponent(source.value.slug)}/render-publish`,
      { method: 'POST', body: { content: project.exportRaw(), clientKey } }
    )
  } catch (e: any) {
    fail(e?.data?.message || e?.message || 'Failed to start the render')
    return
  }
  if (!resp?.success || !resp.jobId) {
    fail(resp?.error || 'Failed to start the render', resp?.details || [])
    return
  }

  jobId.value = resp.jobId
  status.value = 'rendering'
  const mineTask = (d: any) => d?.taskId === jobId.value
  const mineJob = (d: any) => d?.jobId === jobId.value

  bind(socket, 'taskAssigned', (d) => mineTask(d) && (status.value = 'rendering'))
  bind(socket, 'taskProgress', (d) => {
    if (!mineTask(d)) return
    status.value = 'rendering'
    const p = typeof d.progress === 'number' ? d.progress : d.progress?.progress
    if (typeof p === 'number') progress.value = Math.min(100, Math.round(p))
  })
  // Render finished on the cell; orch is now downscaling + reuploading.
  bind(socket, 'taskComplete', (d) => {
    if (!mineTask(d)) return
    progress.value = 100
    status.value = 'publishing'
  })
  bind(socket, 'taskFailed', (d) => {
    if (!mineTask(d)) return
    unbindAll()
    fail(typeof d.error === 'string' ? d.error : 'Render failed')
  })
  // Terminal success/failure of the whole edit→render→reupload→update-DB flow.
  bind(socket, 'examplePublished', (d) => {
    if (!mineJob(d)) return
    unbindAll()
    status.value = 'done'
    newVersion.value = d.item?.version ?? null
    previewUrl.value = d.item?.meta?.preview || d.item?.meta?.thumbnail || ''
    // Reflect the fresh preview/meta in the in-memory record.
    if (source.value && d.item) {
      editor.setSourceExample({
        slug: source.value.slug,
        title: d.item.title ?? source.value.title,
        meta: d.item.meta ?? source.value.meta,
      })
    }
  })
  bind(socket, 'examplePublishFailed', (d) => {
    if (!mineJob(d)) return
    unbindAll()
    fail(typeof d.error === 'string' ? d.error : 'Publish failed')
  })
}

onBeforeUnmount(unbindAll)
</script>

<template>
  <UiModal title="Publish example" width="560px" @close="editor.closeModal()">
    <p class="hint">
      Re-renders
      <b>{{ source?.title }}</b> in the cloud, reuploads a fresh preview, and updates the example in
      the shared library. This replaces what every user sees for this example.
    </p>

    <div v-if="errors.length" class="block err-block">
      <b>{{ errors.length }} validation error(s) must be fixed first:</b>
      <ul>
        <li v-for="(e, i) in errors.slice(0, 5)" :key="i">
          <span class="mono">{{ e.path }}</span> — {{ e.message }}
        </li>
      </ul>
    </div>

    <template v-else>
      <div v-if="status === 'idle'" class="center">
        <button class="btn primary lg" @click="start">
          <UiIcon name="render" :size="15" /> Render &amp; publish
        </button>
        <p class="hint">
          Rendered at native resolution, then downscaled to a 540p preview. No credits are charged.
        </p>
      </div>

      <div v-else-if="status === 'connecting'" class="center">
        <p class="hint">Contacting the render service…</p>
      </div>

      <div v-else-if="status === 'rendering' || status === 'publishing'" class="center">
        <div class="progress">
          <div class="progress-fill" :style="{ width: `${progress}%` }" />
        </div>
        <p class="progress-label mono">{{ progress }}%</p>
        <p class="hint">
          {{
            status === 'publishing'
              ? 'Rendered — reuploading the preview and updating the library…'
              : 'Rendering in the cloud…'
          }}
        </p>
      </div>

      <div v-else-if="status === 'done'" class="done">
        <video
          v-if="previewUrl && /\.mp4($|\?)/i.test(previewUrl)"
          :src="previewUrl"
          class="result"
          autoplay
          muted
          loop
          playsinline
        />
        <img v-else-if="previewUrl" :src="previewUrl" class="result" alt="new preview" />
        <p class="ok">
          ✓ Published<template v-if="newVersion != null"> — now version {{ newVersion }}</template
          >. The updated preview is live on the CDN.
        </p>
        <button class="btn primary" @click="editor.closeModal()">Done</button>
      </div>

      <div v-else class="block err-block">
        <b>Publish failed</b>
        <pre class="mono">{{ errorMsg }}</pre>
        <ul v-if="errorDetails.length">
          <li v-for="(d, i) in errorDetails.slice(0, 5)" :key="i">
            <span v-if="d.field" class="mono">{{ d.field }}</span>
            {{ d.message }}
          </li>
        </ul>
        <button class="btn" @click="status = 'idle'">Try again</button>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 26px 0;
}
.btn.lg {
  height: 36px;
  padding: 0 20px;
  font-size: 13px;
}
.progress {
  width: 100%;
  height: 10px;
  border-radius: 6px;
  background: var(--bg-3);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.4s;
}
.progress-label {
  font-size: 13px;
}
.done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.result {
  width: 100%;
  max-height: 40vh;
  background: #000;
  border-radius: var(--radius-m);
  object-fit: contain;
}
.ok {
  font-size: 12px;
  color: var(--text-1);
  text-align: center;
}
.block {
  padding: 12px;
  border-radius: var(--radius-m);
  font-size: 12px;
}
.err-block {
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
}
.err-block pre {
  white-space: pre-wrap;
  font-size: 11px;
  margin: 6px 0;
}
.err-block ul {
  margin: 6px 0 0;
  padding-left: 16px;
}
</style>
