<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '~/stores/editor'
import { useAuthStore } from '~/stores/auth'
import { useExamplePublishStore } from '~/stores/examplePublish'
import { useCloud } from '~/composables/useCloud'

/**
 * Admin-only strip shown whenever a library example is open in the editor
 * (dash deep link, Examples-modal Edit OR plain load, public ?exampleUrl=
 * link). It is the entry point to re-render + republish that example, and it
 * keeps showing live progress while a publish runs — even with the modal
 * closed, and even after "Stop editing".
 */
const editor = useEditorStore()
const auth = useAuthStore()
const publish = useExamplePublishStore()
const cloud = useCloud()

const show = computed(
  () => !!auth.user?.isAdmin && (!!editor.sourceExample || publish.active)
)

const publishLabel = computed(() =>
  publish.status === 'publishing'
    ? 'updating library…'
    : `rendering ${publish.progress}%`
)

function stop() {
  editor.setSourceExample(null)
  editor.notify('Stopped editing the example', 'info')
}
</script>

<template>
  <div v-if="show" class="admin-ex-banner">
    <span class="badge">ADMIN</span>
    <span v-if="editor.sourceExample" class="label">
      Editing example
      <b>{{ editor.sourceExample?.title }}</b>
    </span>
    <span v-else class="label">
      Publishing
      <b>{{ publish.title || publish.slug }}</b>
    </span>
    <button
      v-if="publish.active"
      class="chip publishing"
      title="Publishing — click for details"
      @click="editor.openModal('publishExample')"
    >
      <span class="dot" /> {{ publishLabel }}
    </button>
    <span class="spacer" />
    <button v-if="editor.sourceExample" class="btn ghost sm" @click="stop">
      Stop editing
    </button>
    <button
      v-if="editor.sourceExample"
      class="btn primary sm"
      :disabled="publish.active"
      @click="cloud.publishExample()"
    >
      <UiIcon name="render" :size="13" /> Render &amp; publish
    </button>
  </div>
</template>

<style scoped>
.admin-ex-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 16%, var(--bg-1)),
    var(--bg-1)
  );
  border-bottom: 1px solid var(--border-1);
  font-size: 12px;
  color: var(--text-1);
}
.badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
}
.label b {
  color: var(--text-0);
}
.spacer {
  flex: 1;
}
.btn.sm {
  height: 26px;
  padding: 0 12px;
  font-size: 11.5px;
}
.btn.sm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.chip.publishing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text-0);
  font-size: 10.5px;
  cursor: pointer;
}
.chip.publishing .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pubPulse 1.1s ease-in-out infinite;
}
@keyframes pubPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
