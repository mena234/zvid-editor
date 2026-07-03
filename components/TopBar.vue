<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import {
  RESOLUTION_PRESET_NAMES,
  RESOLUTION_PRESETS,
  SUPPORTED_FORMATS,
} from '~/shared/schema/constants'

const project = useProjectStore()
const editor = useEditorStore()

const dims = computed(() => project.defaults)

const resolutionLabel = (r: string) => {
  const p = RESOLUTION_PRESETS[r as keyof typeof RESOLUTION_PRESETS]
  return p ? `${r} · ${p.width}×${p.height}` : r
}

function setResolution(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  const patch: Record<string, any> = { resolution: value }
  if (value === 'custom') {
    patch.width = project.doc.width ?? dims.value.width
    patch.height = project.doc.height ?? dims.value.height
  }
  project.patchProject(patch)
}

const renderEnabled = useRuntimeConfig().public.renderEnabled
</script>

<template>
  <header class="topbar">
    <div class="brand" title="Zvid Editor">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="4" fill="var(--accent)" />
        <path d="M8 9h8l-5.2 6H16v0" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      </svg>
      <span>zvid<b>editor</b></span>
    </div>

    <div class="divider" />

    <input
      class="ctl name-input"
      :value="project.doc.name ?? ''"
      placeholder="project-name"
      spellcheck="false"
      title="Project name (output file name)"
      @change="project.patchProject({ name: ($event.target as HTMLInputElement).value || undefined })"
    />

    <select
      class="ctl"
      :value="project.doc.resolution ?? 'custom'"
      title="Resolution preset"
      @change="setResolution"
    >
      <option v-for="r in RESOLUTION_PRESET_NAMES" :key="r" :value="r">
        {{ resolutionLabel(r) }}
      </option>
    </select>

    <template v-if="(project.doc.resolution ?? 'custom') === 'custom'">
      <UiNumberInput
        class="w-64"
        :model-value="project.doc.width"
        :min="16"
        :step="2"
        placeholder="width"
        title="Width (px)"
        @update:model-value="project.patchProject({ width: $event })"
      />
      <span class="x">×</span>
      <UiNumberInput
        class="w-64"
        :model-value="project.doc.height"
        :min="16"
        :step="2"
        placeholder="height"
        title="Height (px)"
        @update:model-value="project.patchProject({ height: $event })"
      />
    </template>
    <span v-else class="dim-badge mono">{{ dims.width }}×{{ dims.height }}</span>

    <label class="mini-field" title="Timeline duration (seconds)">
      <UiIcon name="clock" :size="13" />
      <UiNumberInput
        class="w-56"
        :model-value="project.doc.duration"
        :min="0.1"
        :step="0.5"
        placeholder="10"
        @update:model-value="project.patchProject({ duration: $event })"
      />
      <span class="suffix">s</span>
    </label>

    <label class="mini-field" title="Frame rate">
      <UiIcon name="film" :size="13" />
      <UiNumberInput
        class="w-48"
        :model-value="project.doc.frameRate"
        :min="1"
        :max="120"
        placeholder="30"
        @update:model-value="project.patchProject({ frameRate: $event })"
      />
      <span class="suffix">fps</span>
    </label>

    <label class="mini-field" title="Background color">
      <input
        class="ctl"
        type="color"
        :value="dims.backgroundColor.slice(0, 7)"
        @input="project.patchProject({ backgroundColor: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <select
      class="ctl"
      :value="project.doc.outputFormat ?? 'mp4'"
      title="Output format"
      @change="project.patchProject({ outputFormat: ($event.target as HTMLSelectElement).value })"
    >
      <option v-for="f in SUPPORTED_FORMATS" :key="f" :value="f">{{ f }}</option>
    </select>

    <div class="spacer" />

    <button
      class="icon-btn"
      :disabled="!project.canUndo"
      title="Undo (Ctrl+Z)"
      @click="project.undo()"
    >
      <UiIcon name="undo" />
    </button>
    <button
      class="icon-btn"
      :disabled="!project.canRedo"
      title="Redo (Ctrl+Y)"
      @click="project.redo()"
    >
      <UiIcon name="redo" />
    </button>

    <div class="divider" />

    <button class="btn ghost" title="Load an example project" @click="editor.openModal('examples')">
      <UiIcon name="folder" :size="14" /> Examples
    </button>
    <button class="btn ghost" title="New empty project" @click="project.newProject(); editor.clearSelection()">
      New
    </button>
    <button class="btn" @click="editor.openModal('import')">
      <UiIcon name="upload" :size="14" /> Import
    </button>
    <button class="btn primary" title="Export the zvid JSON" @click="editor.openModal('export')">
      <UiIcon name="export" :size="14" /> Export JSON
    </button>
    <button
      v-if="renderEnabled"
      class="btn"
      title="Render an MP4 with the real zvid package (requires FFmpeg on the server)"
      @click="editor.openModal('render')"
    >
      <UiIcon name="render" :size="14" /> Render
    </button>
    <button class="icon-btn" title="Keyboard shortcuts (?)" @click="editor.openModal('shortcuts')">
      <UiIcon name="keyboard" />
    </button>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 12px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border-0);
  flex: 0 0 auto;
  z-index: 20;
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  color: var(--text-1);
  user-select: none;
}
.brand b {
  color: var(--text-0);
  font-weight: 700;
}
.divider {
  width: 1px;
  height: 22px;
  background: var(--border-1);
  margin: 0 2px;
}
.name-input {
  width: 150px;
  font-weight: 600;
}
.x {
  color: var(--text-3);
}
.w-64 {
  width: 64px;
}
.w-56 {
  width: 56px;
}
.w-48 {
  width: 48px;
}
.dim-badge {
  font-size: 11px;
  color: var(--text-2);
  background: var(--bg-2);
  border: 1px solid var(--border-0);
  padding: 4px 7px;
  border-radius: var(--radius-s);
}
.mini-field {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-2);
}
.suffix {
  font-size: 10px;
  color: var(--text-3);
}
.spacer {
  flex: 1;
}
</style>
