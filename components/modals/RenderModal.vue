<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { validateProjectDoc } from '~/shared/schema/validate'

const project = useProjectStore()
const editor = useEditorStore()

const errors = computed(() =>
  validateProjectDoc(project.doc).filter((i) => i.level === 'error')
)

const status = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const progress = ref(0)
const errorMsg = ref('')
const videoUrl = ref('')
const fileName = ref('')
let pollTimer: ReturnType<typeof setInterval> | undefined

async function start() {
  status.value = 'running'
  progress.value = 0
  errorMsg.value = ''
  try {
    const res = await $fetch<{ jobId: string }>('/api/render', {
      method: 'POST',
      body: project.exportRaw(),
    })
    poll(res.jobId)
  } catch (e: any) {
    status.value = 'error'
    errorMsg.value = e?.data?.statusMessage ?? e.message
  }
}

function poll(jobId: string) {
  pollTimer = setInterval(async () => {
    try {
      const job = await $fetch<any>('/api/render-status', { query: { id: jobId } })
      progress.value = job.progress
      if (job.status === 'done') {
        clearInterval(pollTimer)
        status.value = 'done'
        fileName.value = job.fileName
        videoUrl.value = `/api/render-file?id=${jobId}`
      } else if (job.status === 'error') {
        clearInterval(pollTimer)
        status.value = 'error'
        errorMsg.value = job.error ?? 'Render failed'
      }
    } catch {
      clearInterval(pollTimer)
      status.value = 'error'
      errorMsg.value = 'Lost contact with the render job'
    }
  }, 900)
}

onBeforeUnmount(() => clearInterval(pollTimer))
</script>

<template>
  <UiModal title="Render with the zvid package" width="640px" @close="editor.closeModal()">
    <p class="hint">
      Runs the real <code>@zvid-io/zvid</code> renderer on this machine (FFmpeg +
      headless browser) — the ground-truth output for the JSON you built.
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
          <UiIcon name="render" :size="15" /> Start render
        </button>
        <p class="hint">Output: {{ project.defaults.name }}.{{ project.defaults.outputFormat }} · {{ project.defaults.width }}×{{ project.defaults.height }} · {{ project.defaults.duration }}s</p>
      </div>

      <div v-else-if="status === 'running'" class="center">
        <div class="progress">
          <div class="progress-fill" :style="{ width: `${progress}%` }" />
        </div>
        <p class="progress-label mono">{{ progress }}%</p>
        <p class="hint">Rendering… FFmpeg reports scene-weighted progress.</p>
      </div>

      <div v-else-if="status === 'done'" class="done">
        <video :src="videoUrl" controls autoplay class="result" />
        <div class="row">
          <a class="btn primary" :href="videoUrl" :download="fileName">
            <UiIcon name="download" :size="13" /> Download {{ fileName }}
          </a>
          <button class="btn ghost" @click="status = 'idle'">Render again</button>
        </div>
      </div>

      <div v-else class="block err-block">
        <b>Render failed</b>
        <pre class="mono">{{ errorMsg }}</pre>
        <p class="hint">
          Typical causes: FFmpeg not on PATH, media URL unreachable from this
          machine, or the package isn't built (<span class="mono">yarn build</span> in
          <span class="mono">package/</span>).
        </p>
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
code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  background: var(--bg-3);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
