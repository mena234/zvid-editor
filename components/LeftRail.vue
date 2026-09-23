<script setup lang="ts">
import { useEditorStore, type LeftPanel, type PanelView } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import { useTourStore } from '~/stores/tour'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const editor = useEditorStore()
const project = useProjectStore()
const tour = useTourStore()
const railTabsEl = ref<HTMLElement | null>(null)

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
/** image projects have no timeline — the Layers tab is their structure view */
const LAYERS_TAB = { id: 'layers', icon: 'layers', label: 'Layers' } as const
const tabs = computed(() =>
  project.isImage
    ? [LAYERS_TAB, ...TABS.filter((t) => !HIDDEN_IN_IMAGE_MODE.has(t.id))]
    : TABS
)
watch(
  () => project.isImage,
  (isImage) => {
    if (isImage && editor.leftPanel && HIDDEN_IN_IMAGE_MODE.has(editor.leftPanel))
      editor.openPanel('images')
    if (!isImage && editor.leftPanel === 'layers') editor.openPanel('images')
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
const panelLabel = computed(() =>
  showInspector.value ? 'Properties' : tabs.value.find((tab) => tab.id === editor.leftPanel)?.label
)

function closePanel(returnFocus = false) {
  const tab = editor.leftPanel
  if (!tab) return
  editor.togglePanel(tab)
  if (returnFocus) {
    nextTick(() => railTabsEl.value?.querySelector<HTMLButtonElement>(`[data-tool="${tab}"]`)?.focus())
  }
}

// Keep the canvas visible when entering a phone layout; tools open on demand.
let compactLayout: MediaQueryList | null = null
let preTourPanel: { leftPanel: LeftPanel | null; panelView: PanelView } | null = null
function syncTourPanel() {
  if (!compactLayout?.matches || !tour.active) return
  preTourPanel ??= { leftPanel: editor.leftPanel, panelView: editor.panelView }
  if (tour.current?.target !== 'rail-tabs' && tour.current?.target !== 'rail-panel') closePanel()
}
watch(() => tour.active, (active) => {
  if (active) syncTourPanel()
  else if (preTourPanel) {
    editor.leftPanel = preTourPanel.leftPanel
    editor.panelView = preTourPanel.panelView
    preTourPanel = null
  }
}, { flush: 'sync' })
watch(() => tour.current?.target, syncTourPanel)
function onLayoutChange() {
  if (!compactLayout?.matches) return
  if (tour.active) syncTourPanel()
  else closePanel()
}
onMounted(() => {
  compactLayout = window.matchMedia('(max-width: 767px)')
  onLayoutChange()
  compactLayout.addEventListener('change', onLayoutChange)
})
onBeforeUnmount(() => compactLayout?.removeEventListener('change', onLayoutChange))

const captionCount = computed(() => project.doc.subtitle?.captions?.length ?? 0)
const sceneCount = computed(() => project.doc.scenes?.length ?? 0)
const variableCount = computed(() => Object.keys(project.variables).length)
const layerCount = computed(() => project.doc.visuals.length)
</script>

<template>
  <aside class="left-rail">
    <nav ref="railTabsEl" class="rail-tabs" data-tour="rail-tabs" aria-label="Editor tools">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="rail-tab"
        :class="{ active: editor.leftPanel === tab.id }"
        :title="tab.label"
        :data-tool="tab.id"
        :aria-pressed="editor.leftPanel === tab.id"
        aria-controls="editor-tool-panel"
        @click="editor.togglePanel(tab.id as any)"
      >
        <UiIcon :name="tab.icon" :size="17" />
        <span>{{ tab.label }}</span>
        <span v-if="tab.id === 'scenes' && sceneCount" class="count">{{ sceneCount }}</span>
        <span v-if="tab.id === 'layers' && layerCount" class="count">{{ layerCount }}</span>
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
      id="editor-tool-panel"
      class="rail-panel"
      :class="{ bare: showInspector }"
      data-tour="rail-panel"
    >
      <div class="compact-panel-head">
        <strong>{{ panelLabel }}</strong>
        <button class="btn ghost sm" aria-label="Close tool panel" @click="closePanel(true)">
          Done <UiIcon name="chevron_down" :size="14" />
        </button>
      </div>
      <div class="rail-panel-body">
        <InspectorPanel v-if="showInspector" />
        <template v-else>
          <PanelsMediaPanel v-if="mediaKind" :key="mediaKind" :kind="mediaKind" />
          <PanelsLayersPanel v-else-if="editor.leftPanel === 'layers'" />
          <PanelsTextPanel v-else-if="editor.leftPanel === 'text'" />
          <PanelsDesignPanel v-else-if="editor.leftPanel === 'design'" />
          <PanelsShapePanel v-else-if="editor.leftPanel === 'shape'" />
          <PanelsCanvasPanel v-else-if="editor.leftPanel === 'canvas'" />
          <PanelsScenesPanel v-else-if="editor.leftPanel === 'scenes'" />
          <PanelsSubtitlesPanel v-else-if="editor.leftPanel === 'subtitles'" />
          <PanelsVariablesPanel v-else-if="editor.leftPanel === 'variables'" />
        </template>
      </div>
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
  flex: 0 0 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  flex: 0 0 auto;
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-1);
}
.compact-panel-head {
  display: none;
}
.rail-panel-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 13px;
  min-width: 0;
  min-height: 0;
  overscroll-behavior: contain;
}
/* inspector view brings its own header/scroll structure */
.rail-panel.bare .rail-panel-body {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
@media (pointer: coarse) {
  /* iOS zooms focused controls below 16px, which can hide editor actions. */
  .rail-panel :deep(input:not([type='checkbox']):not([type='range']):not([type='color'])),
  .rail-panel :deep(textarea),
  .rail-panel :deep(select) {
    font-size: 16px;
  }
}
@media (max-width: 767px) {
  .left-rail,
  .left-rail:has(.rail-panel) {
    width: 100%;
    flex: 0 0 auto;
    min-width: 0;
    border-right: none;
    border-top: 1px solid var(--border-0);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .rail-tabs {
    width: 100%;
    flex-direction: row;
    gap: 2px;
    padding: 5px 6px;
    border-right: none;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }
  .rail-tab {
    width: 60px;
    min-height: 52px;
    padding: 7px 2px;
  }
  .rail-panel {
    position: absolute;
    z-index: 45;
    left: 8px;
    right: 8px;
    bottom: calc(70px + env(safe-area-inset-bottom, 0px));
    height: min(56dvh, 440px);
    max-height: calc(100% - 82px - env(safe-area-inset-bottom, 0px));
    border: 1px solid var(--border-1);
    border-radius: var(--radius-l);
    box-shadow: var(--shadow-2);
  }
  .compact-panel-head {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    padding: 5px 12px;
    border-bottom: 1px solid var(--border-0);
    font-size: 13px;
  }
}
</style>
