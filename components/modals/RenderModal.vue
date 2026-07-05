<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue'
import type { Socket } from 'socket.io-client'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useAuthStore } from '~/stores/auth'
import { validateProjectDoc } from '~/shared/schema/validate'
import {
  connectRenderSocket,
  submitRenderTask,
  disconnectRenderSocket,
} from '~/utils/renderSocket'

const project = useProjectStore()
const editor = useEditorStore()
const auth = useAuthStore()
const dashUrl = useRuntimeConfig().public.dashUrl

const errors = computed(() =>
  validateProjectDoc(project.doc).filter((i) => i.level === 'error')
)

type Status = 'idle' | 'connecting' | 'queued' | 'rendering' | 'done' | 'error'
const status = ref<Status>('idle')
const progress = ref(0)
const queueAhead = ref(0)
const creditsReserved = ref<number | null>(null)
const errorMsg = ref('')
const errorDetails = ref<{ field?: string; message: string }[]>([])
const videoUrl = ref('')
const taskId = ref('')

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

function signIn() {
  editor.postAuthModal = 'render'
  editor.openModal('auth')
}

function fail(message: string, details: any[] = []) {
  status.value = 'error'
  errorMsg.value = message
  errorDetails.value = Array.isArray(details) ? details : []
}

async function start() {
  status.value = 'connecting'
  progress.value = 0
  errorMsg.value = ''
  errorDetails.value = []
  videoUrl.value = ''

  let socket: Socket
  try {
    socket = await connectRenderSocket(String(auth.user?.id ?? 'editor'))
  } catch (e: any) {
    if (/unauthorized/i.test(e?.message ?? '')) {
      disconnectRenderSocket()
      auth.sessionExpired()
      status.value = 'idle'
      editor.notify('Your session expired — please sign in again', 'info')
      signIn()
    } else {
      fail(
        'Could not reach the render service. Please check your connection and try again.'
      )
    }
    return
  }

  activeSocket = socket
  unbindAll()

  let ack
  try {
    ack = await submitRenderTask(socket, { payload: project.exportRaw() })
  } catch (e: any) {
    fail(e?.message ?? 'Failed to submit the render')
    return
  }

  if (!ack.taskId || ack.error) {
    if (ack.error === 'insufficient_credits') {
      fail(
        `${ack.message ?? 'Not enough credits for this render.'} (needs ${ack.creditsRequired}, you have ${ack.creditsAvailable})`
      )
    } else if (ack.error === 'Authentication required') {
      status.value = 'idle'
      signIn()
    } else {
      fail(ack.message ?? ack.error ?? 'Failed to submit the render', ack.details)
    }
    return
  }

  taskId.value = ack.taskId
  queueAhead.value = ack.queueAhead ?? 0
  creditsReserved.value = ack.creditsReserved ?? null
  status.value = 'queued'

  const mine = (data: any) => data?.taskId === taskId.value

  bind(socket, 'taskAssigned', (data) => {
    if (!mine(data)) return
    status.value = 'rendering'
  })

  bind(socket, 'taskProgress', (data) => {
    if (!mine(data)) return
    status.value = 'rendering'
    const p =
      typeof data.progress === 'number' ? data.progress : data.progress?.progress
    if (typeof p === 'number') progress.value = Math.min(100, Math.round(p))
  })

  bind(socket, 'taskComplete', (data) => {
    if (!mine(data)) return
    unbindAll()
    progress.value = 100
    videoUrl.value = data.result?.url ?? ''
    status.value = 'done'
    // reserved vs actual credits get reconciled server-side — refresh balance
    auth.fetchSession()
  })

  bind(socket, 'taskFailed', (data) => {
    if (!mine(data)) return
    unbindAll()
    fail(typeof data.error === 'string' ? data.error : 'Render failed')
    auth.fetchSession()
  })
}

const fileName = computed(() => {
  if (!videoUrl.value) return 'render.mp4'
  try {
    const last = new URL(videoUrl.value).pathname.split('/').pop()
    return last || 'render.mp4'
  } catch {
    return 'render.mp4'
  }
})

onBeforeUnmount(unbindAll)
</script>

<template>
  <UiModal title="Render video" width="640px" @close="editor.closeModal()">
    <p class="hint">
      Renders in the Zvid cloud — the finished video lands in
      <a :href="`${dashUrl}/videos`" target="_blank" rel="noopener">your dashboard</a>
      and stays available on the CDN.
    </p>

    <div v-if="errors.length" class="block err-block">
      <b>{{ errors.length }} validation error(s) must be fixed first:</b>
      <ul>
        <li v-for="(e, i) in errors.slice(0, 5)" :key="i">
          <span class="mono">{{ e.path }}</span> — {{ e.message }}
        </li>
      </ul>
    </div>

    <div v-else-if="!auth.user" class="center">
      <p class="hint">Sign in to render — jobs run on your account's credits.</p>
      <button class="btn primary lg" @click="signIn">Sign in to render</button>
    </div>

    <template v-else>
      <div v-if="status === 'idle'" class="center">
        <button class="btn primary lg" @click="start">
          <UiIcon name="render" :size="15" /> Start render
        </button>
        <p class="hint">
          Output: {{ project.defaults.name }}.{{ project.defaults.outputFormat }} ·
          {{ project.defaults.width }}×{{ project.defaults.height }} ·
          {{ project.defaults.duration }}s
          <template v-if="auth.credits?.balance != null">
            · {{ auth.credits.balance }} credits available
          </template>
        </p>
      </div>

      <div v-else-if="status === 'connecting'" class="center">
        <p class="hint">Contacting the render service…</p>
      </div>

      <div v-else-if="status === 'queued' || status === 'rendering'" class="center">
        <div class="progress">
          <div class="progress-fill" :style="{ width: `${progress}%` }" />
        </div>
        <p class="progress-label mono">{{ progress }}%</p>
        <p v-if="status === 'queued'" class="hint">
          Queued{{ queueAhead > 0 ? ` — ${queueAhead} job(s) ahead` : '' }}…
        </p>
        <p v-else class="hint">
          Rendering in the cloud
          <template v-if="creditsReserved != null">
            · {{ creditsReserved }} credits reserved
          </template>
        </p>
      </div>

      <div v-else-if="status === 'done'" class="done">
        <video :src="videoUrl" controls autoplay class="result" />
        <div class="row">
          <a class="btn primary" :href="videoUrl" :download="fileName" target="_blank" rel="noopener">
            <UiIcon name="download" :size="13" /> Download
          </a>
          <button class="btn ghost" @click="status = 'idle'">Render again</button>
        </div>
      </div>

      <div v-else class="block err-block">
        <b>Render failed</b>
        <pre class="mono">{{ errorMsg }}</pre>
        <ul v-if="errorDetails.length">
          <li v-for="(d, i) in errorDetails.slice(0, 5)" :key="i">
            <span v-if="d.field" class="mono">{{ d.field }}</span> {{ d.message }}
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
  gap: 10px;
}
.result {
  width: 100%;
  max-height: 46vh;
  background: #000;
  border-radius: var(--radius-m);
}
.row {
  display: flex;
  gap: 8px;
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
.hint a {
  color: var(--accent);
}
</style>
