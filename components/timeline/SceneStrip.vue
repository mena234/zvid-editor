<script setup lang="ts">
import { computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'

const props = defineProps<{ headerW: number; pxPerSec: number }>()

const { project, editor, scenePlan } = useEditorContext()

const entries = computed(() => scenePlan.value?.entries ?? [])

const isRoot = computed(() => editor.context === 'root')

function openScene(id: string) {
  editor.setContext(id)
}
</script>

<template>
  <div class="tl-row scene-row">
    <div class="tl-header">
      <span class="lane-badge">SCENES</span>
      <button class="icon-btn sm-btn" title="Add scene" @click="project.addScene()">
        <UiIcon name="plus" :size="12" />
      </button>
    </div>
    <div class="lane">
      <template v-if="isRoot">
        <div
          v-for="(e, i) in entries"
          :key="e.scene._id"
          class="scene-block"
          :class="{ active: editor.context === e.scene._id }"
          :style="{
            left: `${e.start * pxPerSec}px`,
            width: `${Math.max(10, e.duration * pxPerSec)}px`,
            background: `color-mix(in srgb, ${e.backgroundColor} 45%, var(--bg-3))`,
          }"
          :title="`${e.scene.id} · ${e.duration}s — double-click to edit`"
          @dblclick="openScene(e.scene._id)"
          @click="editor.selectScene(e.scene._id)"
        >
          <span class="scene-name">{{ e.scene.id }}</span>
          <span class="scene-dur mono">{{ e.duration }}s</span>
          <span
            v-if="e.transition"
            class="scene-transition"
            :style="{ width: `${e.transitionDuration * pxPerSec}px` }"
            :title="`transition: ${e.transition} (${e.transitionDuration}s overlap)`"
          >
            <UiIcon name="magic" :size="10" />
          </span>
        </div>
      </template>
      <div v-else class="scene-local-note">
        <button class="btn ghost sm" @click="editor.setContext('root')">
          <UiIcon name="chevron_left" :size="12" /> all scenes
        </button>
        <span class="hint">editing scene timeline (times are scene-local)</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scene-row {
  min-height: 34px;
  background: var(--bg-2);
}
.tl-header {
  position: sticky;
  left: 0;
  z-index: 20;
  width: 148px;
  flex: 0 0 148px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  background: var(--bg-2);
  border-right: 1px solid var(--border-0);
}
.lane-badge {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--accent-2);
}
.sm-btn {
  width: 20px;
  height: 20px;
}
.tl-row {
  display: flex;
  border-bottom: 1px solid var(--border-0);
}
.lane {
  position: relative;
  flex: 1;
}
.scene-block {
  position: absolute;
  top: 4px;
  height: 26px;
  border-radius: 4px;
  border: 1px solid var(--border-2);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 10.5px;
  cursor: pointer;
  overflow: hidden;
  user-select: none;
}
.scene-block:hover {
  border-color: var(--accent);
}
.scene-block.active {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 1px var(--accent);
}
.scene-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.scene-dur {
  font-size: 9px;
  color: var(--text-1);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.scene-transition {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  min-width: 12px;
  background: repeating-linear-gradient(
    -45deg,
    rgba(157, 107, 255, 0.5),
    rgba(157, 107, 255, 0.5) 3px,
    transparent 3px,
    transparent 6px
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.scene-local-note {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  padding: 0 8px;
}
</style>
