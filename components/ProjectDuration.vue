<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { formatTime } from '~/utils/time'

const { project, totalDuration, activeScene, contextDuration } =
  useEditorContext()
const automatic = computed(() => project.doc.durationMode === 'auto')
const open = ref(false)
const root = ref<HTMLElement | null>(null)
function closeOutside(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', closeOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', closeOutside))
function setMode(auto: boolean) {
  project.patchProject({
    durationMode: auto ? 'auto' : 'fixed',
    duration: auto ? undefined : totalDuration.value,
  })
}
</script>

<template>
  <div ref="root" class="duration-control" @keydown.esc="open = false">
    <button
      class="btn ghost sm"
      aria-label="Project duration settings"
      :aria-expanded="open"
      @click="open = !open"
    >
      <UiIcon name="clock" :size="13" />
      <span data-testid="project-duration"
        >Project: {{ formatTime(totalDuration) }}</span
      >
      <span class="hint">{{ automatic ? 'Auto' : 'Set length' }}</span>
    </button>
    <span v-if="activeScene" class="hint scene-duration"
      >Scene: {{ formatTime(contextDuration) }}</span
    >
    <div
      v-if="open"
      class="duration-popover"
      role="region"
      aria-label="Project duration"
    >
      <b>Project duration</b>
      <label class="mode">
        <input
          type="checkbox"
          :checked="automatic"
          @change="setMode(($event.target as HTMLInputElement).checked)"
        />
        Fit content automatically
      </label>
      <p class="hint">
        {{
          automatic
            ? 'Follows scenes, timed elements, audio and captions. Transition overlaps are included.'
            : 'Existing project timing is preserved. Enable Auto to follow content when you edit.'
        }}
      </p>
      <UiField
        :label="
          automatic || project.hasScenes
            ? 'Minimum project length'
            : 'Project length'
        "
        :hint="
          automatic
            ? 'Optional extra time. Clear to end with the content.'
            : undefined
        "
      >
        <UiNumberInput
          :model-value="project.doc.duration"
          :min="0.1"
          :step="0.5"
          :clearable="automatic"
          placeholder="Auto"
          unit="s"
          @update:model-value="project.patchProject({ duration: $event })"
        />
      </UiField>
      <p v-if="project.hasScenes && !automatic" class="hint">
        The project always includes the full scene sequence.
      </p>
    </div>
  </div>
</template>

<style scoped>
.duration-control {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
}
.duration-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 60;
  width: min(300px, calc(100vw - 24px));
  padding: 16px;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: 0 8px 24px #0002;
  color: var(--text-0);
}
.mode {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
}
.hint {
  white-space: normal;
}
.scene-duration {
  white-space: nowrap;
}
</style>
