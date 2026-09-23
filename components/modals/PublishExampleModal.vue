<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useExamplePublishStore } from '~/stores/examplePublish'
import { validateProjectDoc } from '~/shared/schema/validate'

/**
 * Viewer over the examplePublish store. The publish lifecycle (socket
 * listeners, progress, terminal outcome, status polling) lives in the store,
 * so this modal can be closed and reopened mid-flight without losing the run —
 * the banner keeps showing progress and the toast still fires on completion.
 */
const project = useProjectStore()
const editor = useEditorStore()
const publish = useExamplePublishStore()

const source = computed(() => editor.sourceExample)

const errors = computed(() =>
  validateProjectDoc(project.doc).filter((i) => i.level === 'error')
)

// A finished (done/error) run for ANOTHER example is stale context here —
// treat it as idle so the admin can start publishing the current one.
const viewStatus = computed(() => {
  if (publish.slug && source.value && publish.slug !== source.value.slug) {
    return publish.active ? 'busy-other' : 'idle'
  }
  return publish.status
})

function start() {
  if (!source.value) return
  publish.start(
    { slug: source.value.slug, title: source.value.title },
    project.exportRaw()
  )
}

function retry() {
  publish.reset()
}
</script>

<template>
  <UiModal title="Publish example" width="560px" @close="editor.closeModal()">
    <p class="hint">
      Re-renders
      <b>{{ source?.title || publish.title || publish.slug }}</b> in the cloud, reuploads a fresh preview, and updates the example in
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
      <div v-if="viewStatus === 'busy-other'" class="center">
        <p class="hint">
          Still publishing “{{ publish.title || publish.slug }}” — wait for it to finish before
          publishing this example.
        </p>
      </div>

      <div v-else-if="viewStatus === 'idle'" class="center">
        <button class="btn primary lg" @click="start">
          <UiIcon name="render" :size="15" /> Render &amp; publish
        </button>
        <p class="hint">
          Rendered at native resolution, then downscaled to a 540p preview. No credits are charged.
          You can close this dialog — publishing continues and you’ll be notified.
        </p>
      </div>

      <div v-else-if="viewStatus === 'connecting'" class="center">
        <p class="hint">Contacting the render service…</p>
      </div>

      <div v-else-if="viewStatus === 'rendering' || viewStatus === 'publishing'" class="center">
        <div class="progress">
          <div class="progress-fill" :style="{ width: `${publish.progress}%` }" />
        </div>
        <p class="progress-label mono">{{ publish.progress }}%</p>
        <p class="hint">
          {{
            viewStatus === 'publishing'
              ? 'Rendered — reuploading the preview and updating the library…'
              : 'Rendering in the cloud…'
          }}
        </p>
        <p class="hint">Safe to close — this keeps running and you’ll get a notification.</p>
      </div>

      <div v-else-if="viewStatus === 'done'" class="done">
        <video
          v-if="publish.previewUrl && /\.mp4($|\?)/i.test(publish.previewUrl)"
          :src="publish.previewUrl"
          class="result"
          autoplay
          muted
          loop
          playsinline
        />
        <img v-else-if="publish.previewUrl" :src="publish.previewUrl" class="result" alt="new preview" />
        <p class="ok">
          ✓ Published<template v-if="publish.newVersion != null">
            — now version {{ publish.newVersion }}</template
          >. The updated preview is live on the CDN.
        </p>
        <button class="btn primary" @click="publish.reset(); editor.closeModal()">Done</button>
      </div>

      <div v-else class="block err-block">
        <b>Publish failed</b>
        <pre class="mono">{{ publish.errorMsg }}</pre>
        <ul v-if="publish.errorDetails.length">
          <li v-for="(d, i) in publish.errorDetails.slice(0, 5)" :key="i">
            <span v-if="d.field" class="mono">{{ d.field }}</span>
            {{ d.message }}
          </li>
        </ul>
        <button class="btn" @click="retry">Try again</button>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.hint, .block, .ok {
  overflow-wrap: anywhere;
  min-width: 0;
}
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
