<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '~/stores/editor'
import { useAuthStore } from '~/stores/auth'
import { useCloud } from '~/composables/useCloud'

/**
 * Admin-only strip shown when a library example is open for editing (via the
 * dash Examples page deep link, or the Edit button in the Examples modal). It
 * is the entry point to re-render + republish that example.
 */
const editor = useEditorStore()
const auth = useAuthStore()
const cloud = useCloud()

const show = computed(() => !!auth.user?.isAdmin && !!editor.sourceExample)

function stop() {
  editor.setSourceExample(null)
  editor.notify('Stopped editing the example', 'info')
}
</script>

<template>
  <div v-if="show" class="admin-ex-banner">
    <span class="badge">ADMIN</span>
    <span class="label">
      Editing example
      <b>{{ editor.sourceExample?.title }}</b>
    </span>
    <span class="spacer" />
    <button class="btn ghost sm" @click="stop">Stop editing</button>
    <button class="btn primary sm" @click="cloud.publishExample()">
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
</style>
