<script setup lang="ts">
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import { computed, watch } from 'vue'

const editor = useEditorStore()
const project = useProjectStore()

const TABS = [
  { id: 'images', icon: 'image', label: 'Images' },
  { id: 'videos', icon: 'video', label: 'Videos' },
  { id: 'audio', icon: 'audio', label: 'Audio' },
  { id: 'gifs', icon: 'gif', label: 'GIFs' },
  { id: 'text', icon: 'text', label: 'Text' },
  { id: 'design', icon: 'magic', label: 'Design' },
  { id: 'shape', icon: 'svg', label: 'Shape' },
  { id: 'canvas', icon: 'code', label: 'Canvas' },
  { id: 'scenes', icon: 'scene', label: 'Scenes' },
  { id: 'subtitles', icon: 'subtitles', label: 'Subtitles' },
  { id: 'variables', icon: 'json', label: 'Variables' },
] as const

/** image projects compose static sources only (D2) — no time-domain tabs */
const HIDDEN_IN_IMAGE_MODE = new Set(['videos', 'audio', 'gifs', 'scenes', 'subtitles'])
const tabs = computed(() =>
  project.isImage ? TABS.filter((t) => !HIDDEN_IN_IMAGE_MODE.has(t.id)) : TABS
)
watch(
  () => project.isImage,
  (isImage) => {
    if (isImage && editor.leftPanel && HIDDEN_IN_IMAGE_MODE.has(editor.leftPanel))
      editor.openPanel('images')
  },
  { immediate: true }
)

/** media tab id → upload/stock kind */
const MEDIA_KIND = {
  images: 'image',
  videos: 'video',
  audio: 'audio',
  gifs: 'gif',
} as const
const mediaKind = computed(
  () => MEDIA_KIND[editor.leftPanel as keyof typeof MEDIA_KIND] ?? null
)

/** the panel shows the selection's properties instead of the tab content */
const showInspector = computed(() => editor.panelView === 'inspector')

const captionCount = computed(() => project.doc.subtitle?.captions?.length ?? 0)
const sceneCount = computed(() => project.doc.scenes?.length ?? 0)
const variableCount = computed(() => Object.keys(project.variables).length)
</script>

<template>
  <aside class="left-rail">
    <nav class="rail-tabs" data-tour="rail-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="rail-tab"
        :class="{ active: editor.leftPanel === tab.id }"
        :title="tab.label"
        @click="editor.togglePanel(tab.id as any)"
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
    <div
      v-if="editor.leftPanel"
      class="rail-panel"
      :class="{ bare: showInspector }"
      data-tour="rail-panel"
    >
      <InspectorPanel v-if="showInspector" />
      <template v-else>
        <PanelsMediaPanel v-if="mediaKind" :key="mediaKind" :kind="mediaKind" />
        <PanelsTextPanel v-else-if="editor.leftPanel === 'text'" />
        <PanelsDesignPanel v-else-if="editor.leftPanel === 'design'" />
        <PanelsShapePanel v-else-if="editor.leftPanel === 'shape'" />
        <PanelsCanvasPanel v-else-if="editor.leftPanel === 'canvas'" />
        <PanelsScenesPanel v-else-if="editor.leftPanel === 'scenes'" />
        <PanelsSubtitlesPanel v-else-if="editor.leftPanel === 'subtitles'" />
        <PanelsVariablesPanel v-else-if="editor.leftPanel === 'variables'" />
      </template>
    </div>
  </aside>
</template>

<style scoped>
.left-rail {
  display: flex;
  flex: 0 0 auto;
  border-right: 1px solid var(--border-0);
  background: var(--bg-1);
  min-height: 0;
}
/* collapsed: only the tab strip remains */
.left-rail:has(.rail-panel) {
  width: 326px;
  flex: 0 0 326px;
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
/* inspector view brings its own header/scroll structure */
.rail-panel.bare {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
</style>
