<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { canonicalVisualType } from '~/shared/schema/types'

const project = useProjectStore()
const editor = useEditorStore()

const visual = computed(() =>
  editor.selectionKind === 'visual' && editor.selectedId
    ? project.visualById(editor.selectedId)
    : undefined
)
const audio = computed(() =>
  editor.selectionKind === 'audio' && editor.selectedId
    ? project.audioById(editor.selectedId)
    : undefined
)

const type = computed(() =>
  visual.value ? canonicalVisualType(visual.value.type) : null
)

const TABS = computed(() => {
  if (!visual.value) return []
  return [
    { id: 'design', label: 'Design' },
    { id: 'timing', label: 'Timing' },
    { id: 'effects', label: 'Effects' },
    { id: 'json', label: 'JSON' },
  ]
})

const activeTab = computed({
  get: () =>
    TABS.value.find((t) => t.id === editor.inspectorTab)?.id ?? 'design',
  set: (v: string) => (editor.inspectorTab = v),
})
</script>

<template>
  <aside class="inspector">
    <!-- visual item -->
    <template v-if="visual">
      <header class="insp-head">
        <span class="type-chip" :data-type="type">{{ type }}</span>
        <span class="insp-title">{{
          type === 'TEXT'
            ? 'Text element'
            : type === 'SVG'
              ? 'SVG graphic'
              : (visual.src?.split('/').pop() ?? 'element')
        }}</span>
        <button
          class="icon-btn"
          title="Delete element (Del)"
          @click="project.removeVisual(visual._id); editor.clearSelection()"
        >
          <UiIcon name="trash" :size="14" />
        </button>
      </header>
      <nav class="insp-tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          :class="{ active: activeTab === t.id }"
          @click="activeTab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>
      <div class="insp-body">
        <template v-if="activeTab === 'design'">
          <InspectorTextSection v-if="type === 'TEXT'" :item="visual" />
          <InspectorSvgSection v-else-if="type === 'SVG'" :item="visual" />
          <InspectorMediaSection v-else :item="visual" />
          <InspectorLayoutSection :item="visual" />
        </template>
        <template v-else-if="activeTab === 'timing'">
          <InspectorTimingSection :item="visual" />
        </template>
        <template v-else-if="activeTab === 'effects'">
          <InspectorAnimationSection :item="visual" />
          <InspectorFilterSection
            v-if="type === 'VIDEO' || type === 'IMAGE' || type === 'SVG'"
            :item="visual"
          />
          <InspectorCustomCodeSection
            v-if="type === 'TEXT' || type === 'SVG'"
            :item="visual"
          />
        </template>
        <InspectorRawJsonSection v-else :item="visual" />
      </div>
    </template>

    <!-- audio item -->
    <template v-else-if="audio">
      <header class="insp-head">
        <span class="type-chip" data-type="AUDIO">AUDIO</span>
        <span class="insp-title">{{ audio.src?.split('/').pop() ?? 'audio' }}</span>
        <button
          class="icon-btn"
          title="Delete audio (Del)"
          @click="project.removeAudio(audio._id); editor.clearSelection()"
        >
          <UiIcon name="trash" :size="14" />
        </button>
      </header>
      <div class="insp-body">
        <InspectorAudioSection :audio="audio" />
      </div>
    </template>

    <!-- caption selected -->
    <template v-else-if="editor.selectionKind === 'caption'">
      <header class="insp-head">
        <span class="type-chip" data-type="CC">CAPTION</span>
        <span class="insp-title">Caption {{ editor.selectedCaptionIndex + 1 }}</span>
      </header>
      <div class="insp-body">
        <p class="hint">
          Edit caption text, timings and word-level timing in the
          <b>Subtitles</b> panel on the left.
        </p>
        <button class="btn" @click="editor.leftPanel = 'subtitles'">
          <UiIcon name="subtitles" :size="14" /> Open subtitles panel
        </button>
      </div>
    </template>

    <!-- scene selected -->
    <template v-else-if="editor.selectionKind === 'scene'">
      <header class="insp-head">
        <span class="type-chip" data-type="SCENE">SCENE</span>
        <span class="insp-title">Scene settings</span>
      </header>
      <div class="insp-body">
        <ScenesSettings />
      </div>
    </template>

    <!-- nothing selected: project -->
    <template v-else>
      <header class="insp-head">
        <span class="type-chip" data-type="PROJECT">PROJECT</span>
        <span class="insp-title">{{ project.doc.name ?? 'untitled' }}</span>
      </header>
      <div class="insp-body">
        <InspectorProjectSection />
      </div>
    </template>
  </aside>
</template>

<style scoped>
.inspector {
  width: 312px;
  flex: 0 0 312px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-0);
  background: var(--bg-1);
  min-height: 0;
}
.insp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
}
.type-chip {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--bg-4);
  color: var(--text-1);
}
.type-chip[data-type='VIDEO'] {
  background: rgba(58, 95, 217, 0.3);
  color: #9db4ff;
}
.type-chip[data-type='IMAGE'] {
  background: rgba(47, 158, 119, 0.25);
  color: #7fe3bb;
}
.type-chip[data-type='GIF'] {
  background: rgba(199, 126, 46, 0.25);
  color: #ffc57e;
}
.type-chip[data-type='TEXT'] {
  background: rgba(139, 95, 208, 0.28);
  color: #cbaaff;
}
.type-chip[data-type='SVG'] {
  background: rgba(63, 158, 199, 0.25);
  color: #8fd8f5;
}
.type-chip[data-type='AUDIO'] {
  background: rgba(46, 143, 158, 0.25);
  color: #7adfec;
}
.insp-title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.insp-tabs {
  display: flex;
  padding: 6px 10px 0;
  gap: 2px;
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
}
.insp-tabs button {
  flex: 1;
  padding: 6px 4px;
  border: none;
  background: none;
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 600;
  border-bottom: 2px solid transparent;
}
.insp-tabs button:hover {
  color: var(--text-0);
}
.insp-tabs button.active {
  color: var(--accent-strong);
  border-bottom-color: var(--accent);
}
.insp-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
}
</style>
