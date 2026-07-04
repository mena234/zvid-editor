<script setup lang="ts">
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import { computed } from 'vue'

const editor = useEditorStore()
const project = useProjectStore()

const TABS = [
  { id: 'add', icon: 'plus', label: 'Add' },
  { id: 'assets', icon: 'film', label: 'Stock' },
  { id: 'scenes', icon: 'scene', label: 'Scenes' },
  { id: 'subtitles', icon: 'subtitles', label: 'Subtitles' },
  { id: 'variables', icon: 'json', label: 'Variables' },
] as const

const captionCount = computed(() => project.doc.subtitle?.captions?.length ?? 0)
const sceneCount = computed(() => project.doc.scenes?.length ?? 0)
const variableCount = computed(() => Object.keys(project.variables).length)
</script>

<template>
  <aside class="left-rail">
    <nav class="rail-tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="rail-tab"
        :class="{ active: editor.leftPanel === tab.id }"
        :title="tab.label"
        @click="editor.leftPanel = tab.id as any"
      >
        <UiIcon :name="tab.icon" :size="17" />
        <span>{{ tab.label }}</span>
        <span v-if="tab.id === 'scenes' && sceneCount" class="count">{{ sceneCount }}</span>
        <span v-if="tab.id === 'subtitles' && captionCount" class="count">{{
          captionCount
        }}</span>
        <span v-if="tab.id === 'variables' && variableCount" class="count">{{
          variableCount
        }}</span>
      </button>
    </nav>
    <div class="rail-panel">
      <PanelsAddPanel v-if="editor.leftPanel === 'add'" />
      <PanelsStockPanel v-else-if="editor.leftPanel === 'assets'" />
      <PanelsScenesPanel v-else-if="editor.leftPanel === 'scenes'" />
      <PanelsSubtitlesPanel v-else-if="editor.leftPanel === 'subtitles'" />
      <PanelsVariablesPanel v-else-if="editor.leftPanel === 'variables'" />
    </div>
  </aside>
</template>

<style scoped>
.left-rail {
  display: flex;
  width: 326px;
  flex: 0 0 326px;
  border-right: 1px solid var(--border-0);
  background: var(--bg-1);
  min-height: 0;
}
.rail-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 7px;
  border-right: 1px solid var(--border-0);
  background: var(--bg-1);
}
.rail-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 58px;
  padding: 10px 2px 8px;
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--text-2);
  font-size: 9.5px;
  font-weight: 600;
  position: relative;
  transition:
    background 0.12s,
    color 0.12s;
}
.rail-tab:hover {
  background: var(--bg-3);
  color: var(--text-0);
}
.rail-tab.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.count {
  position: absolute;
  top: 4px;
  right: 6px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
}
.rail-panel {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 13px;
  min-width: 0;
  background: var(--bg-1);
}
</style>
